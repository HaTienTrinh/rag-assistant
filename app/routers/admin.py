from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import hash_password, require_admin, revoke_all_user_tokens
from app.config import settings
from app.database import get_db
from app.models import (
    Chunk,
    Conversation,
    Document,
    Message,
    UnansweredQuestion,
    User,
)

router = APIRouter(prefix="/admin", tags=["admin"])

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class CreateUserBody(BaseModel):
    email: str = Field(pattern=EMAIL_PATTERN, max_length=255)
    password: str = Field(min_length=8, max_length=72)
    role: str = Field(default="user", pattern="^(admin|user)$")
    daily_limit: int | None = Field(default=None, ge=1, le=100000)


class UpdateUserBody(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|user)$")
    is_active: bool | None = None
    daily_limit: int | None = Field(default=None, ge=1, le=100000)


class ResetPasswordBody(BaseModel):
    password: str = Field(min_length=8, max_length=72)


class ResolveBody(BaseModel):
    resolved: bool


def _check_password_bytes(password: str) -> None:
    if len(password.encode()) > 72:
        raise HTTPException(400, "Mật khẩu quá dài (tối đa 72 byte)")


# ======================= Người dùng =======================

def _is_last_active_admin(db: Session, target_user: User) -> bool:
    """Kiểm tra target_user có phải là quản trị viên đang hoạt động duy nhất còn lại không."""
    if target_user.role != "admin" or not target_user.is_active or target_user.deleted_at is not None:
        return False
    active_count = db.scalar(
        select(func.count(User.id)).where(
            User.role == "admin",
            User.is_active.is_(True),
            User.deleted_at.is_(None),
            User.id != target_user.id,
        )
    ) or 0
    return active_count < 1


def _question_counts(db: Session, only_today: bool) -> dict[int, int]:
    q = (
        select(Conversation.user_id, func.count(Message.id))
        .join(Message, Message.conversation_id == Conversation.id)
        .where(Message.role == "user")
        .group_by(Conversation.user_id)
    )
    if only_today:
        q = q.where(func.date(Message.created_at) == func.curdate())
    return {r[0]: r[1] for r in db.execute(q).all()}


def _serialize_user(u: User, total: dict, today: dict) -> dict:
    limit = u.daily_limit if u.daily_limit is not None else settings.daily_question_limit
    return {
        "id": u.id,
        "email": u.email,
        "role": u.role,
        "is_active": u.is_active,
        "daily_limit": u.daily_limit,
        "default_limit": settings.daily_question_limit,
        "effective_limit": None if u.role == "admin" else limit,
        "questions_today": today.get(u.id, 0),
        "questions_total": total.get(u.id, 0),
        "last_login_at": u.last_login_at,
        "created_at": u.created_at,
        "deleted_at": u.deleted_at,
    }


def _get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Không tìm thấy người dùng")
    return user


@router.get("/users")
def list_users(
    view: str = Query("active", pattern="^(active|trash)$"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Lấy danh sách người dùng theo chế độ view: active (mặc định) hoặc trash (thùng rác)."""
    total = _question_counts(db, only_today=False)
    today = _question_counts(db, only_today=True)
    q = select(User).order_by(User.id)
    if view == "active":
        q = q.where(User.deleted_at.is_(None))
    elif view == "trash":
        q = q.where(User.deleted_at.is_not(None))
    users = db.scalars(q).all()
    return [_serialize_user(u, total, today) for u in users]


@router.get("/users/counts")
def user_counts(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Trả về số lượng tài khoản theo từng nhóm: all, active, locked, trash."""
    def count(*conds):
        return db.scalar(select(func.count(User.id)).where(*conds)) or 0

    return {
        "all": count(User.deleted_at.is_(None)),
        "active": count(User.deleted_at.is_(None), User.is_active.is_(True)),
        "locked": count(User.deleted_at.is_(None), User.is_active.is_(False)),
        "trash": count(User.deleted_at.is_not(None)),
    }


@router.post("/users", status_code=201)
def create_user(
    body: CreateUserBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    _check_password_bytes(body.password)
    email = body.email.strip()
    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user:
        if existing_user.deleted_at is not None:
            raise HTTPException(
                409, "Email thuộc một tài khoản trong thùng rác, hãy khôi phục hoặc xóa vĩnh viễn"
            )
        raise HTTPException(409, "Email đã tồn tại")
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        role=body.role,
        daily_limit=body.daily_limit,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _serialize_user(user, {}, {})


@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    body: UpdateUserBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = _get_user(db, user_id)
    fields = body.model_fields_set

    if user.id == admin.id:
        if "is_active" in fields and body.is_active is False:
            raise HTTPException(400, "Không thể tự khóa tài khoản của chính bạn")
        if "role" in fields and body.role not in (None, "admin"):
            raise HTTPException(400, "Không thể tự hạ quyền của chính bạn")

    # Không được khóa hoặc hạ quyền admin hoạt động cuối cùng của hệ thống
    will_deactivate = "is_active" in fields and body.is_active is False
    will_demote = "role" in fields and body.role == "user"
    if (will_deactivate or will_demote) and _is_last_active_admin(db, user):
        raise HTTPException(
            409, "Không thể khóa hoặc hạ quyền quản trị viên đang hoạt động cuối cùng của hệ thống"
        )

    if "role" in fields and body.role is not None:
        user.role = body.role
    if "is_active" in fields and body.is_active is not None:
        was_active = user.is_active
        user.is_active = body.is_active
        if was_active and not body.is_active:
            # Khóa tài khoản -> thu hồi toàn bộ phiên và tăng token_version
            revoke_all_user_tokens(db, user)
    if "daily_limit" in fields:
        user.daily_limit = body.daily_limit  # null = dùng hạn mức mặc định
    db.commit()
    return _serialize_user(user, {}, {})


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    body: ResetPasswordBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    _check_password_bytes(body.password)
    user = _get_user(db, user_id)
    user.password_hash = hash_password(body.password)
    # Đặt lại mật khẩu -> thu hồi toàn bộ phiên và tăng token_version
    revoke_all_user_tokens(db, user)
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def trash_user(
    user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    """Chuyển tài khoản vào thùng rác (xóa mềm), thu hồi phiên và giữ nguyên dữ liệu hội thoại."""
    user = _get_user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(400, "Không thể tự chuyển tài khoản của chính bạn vào thùng rác")
    if user.deleted_at is not None:
        raise HTTPException(
            409, "Tài khoản đã ở trong thùng rác. Sử dụng endpoint xóa vĩnh viễn để xóa hoàn toàn."
        )
    if _is_last_active_admin(db, user):
        raise HTTPException(
            409, "Không thể chuyển vào thùng rác quản trị viên đang hoạt động cuối cùng của hệ thống"
        )

    user.deleted_at = datetime.now(timezone.utc)
    revoke_all_user_tokens(db, user)
    db.commit()
    return {"trashed": user_id, "message": "Đã chuyển tài khoản vào thùng rác"}


@router.post("/users/{user_id}/restore")
def restore_user(
    user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    """Khôi phục tài khoản từ thùng rác; trạng thái Khóa trước đó giữ nguyên."""
    user = _get_user(db, user_id)
    if user.deleted_at is None:
        raise HTTPException(409, "Tài khoản không ở trong thùng rác")

    user.deleted_at = None
    db.commit()
    return {"restored": user_id, "message": "Đã khôi phục tài khoản"}


@router.delete("/users/{user_id}/permanent")
def permanent_delete_user(
    user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    """Xóa vĩnh viễn tài khoản trong thùng rác cùng toàn bộ hội thoại và tin nhắn."""
    user = _get_user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(400, "Không thể tự xóa tài khoản của chính bạn")
    if user.deleted_at is None:
        raise HTTPException(409, "Chỉ có thể xóa vĩnh viễn tài khoản đang ở trong thùng rác")
    if db.scalar(select(func.count(Document.id)).where(Document.uploaded_by == user.id)):
        raise HTTPException(
            409, "Tài khoản này đã tải tài liệu lên. Không thể xóa vĩnh viễn."
        )

    conv_ids = db.scalars(
        select(Conversation.id).where(Conversation.user_id == user.id)
    ).all()
    if conv_ids:
        db.execute(delete(Message).where(Message.conversation_id.in_(conv_ids)))
        db.execute(delete(Conversation).where(Conversation.id.in_(conv_ids)))
    db.delete(user)
    db.commit()
    return {"deleted": user_id, "message": "Đã xóa vĩnh viễn tài khoản"}


# ======================= Thống kê =======================

@router.get("/stats")
def stats(
    days: int = Query(14, ge=1, le=90),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    today = db.scalar(select(func.curdate()))
    since = today - timedelta(days=days - 1)
    day = func.date(Message.created_at)

    def count(column, *conds):
        return db.scalar(select(func.count(column)).where(*conds)) or 0

    doc_status = {
        r[0]: r[1]
        for r in db.execute(
            select(Document.status, func.count(Document.id)).group_by(Document.status)
        ).all()
    }
    totals = {
        "users": count(User.id, User.deleted_at.is_(None)),
        "users_active": count(User.id, User.is_active.is_(True), User.deleted_at.is_(None)),
        "users_trashed": count(User.id, User.deleted_at.is_not(None)),
        "documents": sum(doc_status.values()),
        "documents_done": doc_status.get("done", 0),
        "chunks": count(Chunk.id),
        "conversations": count(Conversation.id),
        "questions": count(Message.id, Message.role == "user"),
        "questions_today": count(Message.id, Message.role == "user", day == today),
        "unanswered_open": count(
            UnansweredQuestion.id, UnansweredQuestion.resolved.is_(False)
        ),
    }

    questions_by_day = {
        r[0]: r[1]
        for r in db.execute(
            select(day, func.count(Message.id))
            .where(Message.role == "user", day >= since)
            .group_by(day)
        ).all()
    }
    users_by_day = {
        r[0]: r[1]
        for r in db.execute(
            select(day, func.count(func.distinct(Conversation.user_id)))
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Message.role == "user", day >= since)
            .group_by(day)
        ).all()
    }
    daily = []
    for i in range(days):
        d = since + timedelta(days=i)
        daily.append(
            {
                "date": d.isoformat(),
                "questions": questions_by_day.get(d, 0),
                "active_users": users_by_day.get(d, 0),
            }
        )

    # Tài liệu được trích dẫn nhiều nhất (mỗi câu trả lời tính một lần cho mỗi file)
    source_rows = db.scalars(
        select(Message.sources)
        .where(Message.role == "assistant", day >= since)
        .order_by(Message.id.desc())
        .limit(5000)
    ).all()
    cited: Counter = Counter()
    for sources in source_rows:
        if not sources:
            continue
        for filename in {s.get("filename") for s in sources if isinstance(s, dict)}:
            if filename:
                cited[filename] += 1

    def tokens(*conds):
        row = db.execute(
            select(
                func.coalesce(func.sum(Message.prompt_tokens), 0),
                func.coalesce(func.sum(Message.completion_tokens), 0),
            ).where(*conds)
        ).one()
        return {"prompt": int(row[0]), "completion": int(row[1])}

    return {
        "days": days,
        "totals": totals,
        "daily": daily,
        "top_documents": [
            {"filename": name, "citations": n} for name, n in cited.most_common(5)
        ],
        "tokens": {
            "period": tokens(day >= since),
            "today": tokens(day == today),
        },
    }


# ======================= Câu hỏi chưa trả lời được =======================

def _serialize_unanswered(q: UnansweredQuestion) -> dict:
    return {
        "id": q.id,
        "question": q.question,
        "reason": q.reason,
        "top_score": q.top_score,
        "resolved": q.resolved,
        "created_at": q.created_at,
    }


@router.get("/unanswered")
def list_unanswered(
    status: str = Query("open", pattern="^(open|resolved|all)$"),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    q = select(UnansweredQuestion).order_by(UnansweredQuestion.id.desc()).limit(limit)
    if status == "open":
        q = q.where(UnansweredQuestion.resolved.is_(False))
    elif status == "resolved":
        q = q.where(UnansweredQuestion.resolved.is_(True))
    return [_serialize_unanswered(r) for r in db.scalars(q).all()]


@router.patch("/unanswered/{item_id}")
def resolve_unanswered(
    item_id: int,
    body: ResolveBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    item = db.get(UnansweredQuestion, item_id)
    if item is None:
        raise HTTPException(404, "Không tìm thấy")
    item.resolved = body.resolved
    db.commit()
    return _serialize_unanswered(item)


@router.delete("/unanswered/{item_id}")
def delete_unanswered(
    item_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    item = db.get(UnansweredQuestion, item_id)
    if item is None:
        raise HTTPException(404, "Không tìm thấy")
    db.delete(item)
    db.commit()
    return {"deleted": item_id}
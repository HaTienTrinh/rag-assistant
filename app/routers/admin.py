import calendar
from collections import Counter
from datetime import date, datetime, timedelta, timezone
import logging
import threading

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session
from starlette.responses import Response

from app.auth import (
    hash_password,
    require_admin,
    revoke_all_user_tokens,
    validate_password_rules,
)
from app.services.bulk_import import (
    execute_bulk_import_creation,
    generate_template_xlsx,
    parse_and_classify_import_file,
)
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
    password: str
    role: str = Field(default="user", pattern="^(admin|user)$")
    daily_limit: int | None = Field(default=None, ge=1, le=100000)
    require_change: bool = True


class UpdateUserBody(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|user)$")
    is_active: bool | None = None
    daily_limit: int | None = Field(default=None, ge=1, le=100000)


class ResetPasswordBody(BaseModel):
    password: str
    require_change: bool = True


class ResolveBody(BaseModel):
    resolved: bool


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
        offset_min = settings.display_utc_offset_minutes
        today_display = (datetime.now(timezone.utc) + timedelta(minutes=offset_min)).date()
        today_utc_start = datetime.combine(today_display, datetime.min.time()) - timedelta(minutes=offset_min)
        today_utc_end = datetime.combine(today_display, datetime.max.time()) - timedelta(minutes=offset_min)
        q = q.where(Message.created_at >= today_utc_start, Message.created_at <= today_utc_end)
    return {r[0]: r[1] for r in db.execute(q).all()}


def _serialize_user(u: User, total: dict, today: dict) -> dict:
    limit = u.daily_limit if u.daily_limit is not None else settings.daily_question_limit
    return {
        "id": u.id,
        "email": u.email,
        "role": u.role,
        "is_active": u.is_active,
        "must_change_password": u.must_change_password,
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
    validate_password_rules(body.password)
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
        must_change_password=body.require_change,
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
    validate_password_rules(body.password)
    user = _get_user(db, user_id)
    user.password_hash = hash_password(body.password)
    user.must_change_password = body.require_change
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


# ======================= Nhập người dùng hàng loạt =======================

_bulk_import_lock = threading.Lock()
logger = logging.getLogger(__name__)


@router.get("/users-import/template")
def download_users_import_template(
    admin: User = Depends(require_admin),
):
    """Tải file Excel mẫu mau-tao-tai-khoan.xlsx."""
    xlsx_bytes = generate_template_xlsx()
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="mau-tao-tai-khoan.xlsx"',
            "Cache-Control": "no-cache",
        },
    )


@router.post("/users-import")
async def import_users(
    response: Response,
    file: UploadFile = File(...),
    dry_run: bool = Form(True),
    daily_limit: str | None = Form(None),
    require_password_change: bool = Form(True),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Xem trước (dry_run=True) hoặc tạo tài khoản hàng loạt (dry_run=False) từ file Excel/CSV."""
    parsed_daily_limit: int | None = None
    if daily_limit is not None and str(daily_limit).strip() != "":
        try:
            parsed_daily_limit = int(daily_limit)
            if parsed_daily_limit < 1 or parsed_daily_limit > 100000:
                raise HTTPException(400, "Hạn mức câu hỏi/ngày phải từ 1 đến 100.000")
        except ValueError:
            raise HTTPException(400, "Hạn mức câu hỏi/ngày phải là số nguyên")

    lock_acquired = False
    if not dry_run:
        if not _bulk_import_lock.acquire(blocking=False):
            raise HTTPException(
                status_code=409,
                detail="Đang có đợt nhập khác đang chạy, vui lòng thử lại sau",
            )
        lock_acquired = True

    try:
        content = await file.read()
        filename = file.filename or ""

        classified_data = parse_and_classify_import_file(
            filename=filename, content=content, db=db
        )

        if dry_run:
            return {
                "dry_run": True,
                "total_rows": classified_data["total_rows"],
                "summary": classified_data["summary"],
                "rows": classified_data["rows"],
            }

        # Tạo tài khoản thật
        result = execute_bulk_import_creation(
            classified_data=classified_data,
            daily_limit=parsed_daily_limit,
            require_password_change=require_password_change,
            db=db,
        )
        response.headers["Cache-Control"] = "no-store"
        logger.info(
            "Admin id=%s đã tạo thành công %d tài khoản qua bulk import",
            admin.id,
            result["summary"]["created"],
        )
        return result
    finally:
        if lock_acquired:
            _bulk_import_lock.release()


# ======================= Thống kê =======================

@router.get("/stats")
def stats(
    period: str = Query("recent", pattern="^(recent|week|month|year)$"),
    anchor: str | None = Query(None),
    days: int = Query(14, ge=1, le=90),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Lấy số liệu thống kê hệ thống theo kỳ: recent, week, month hoặc year."""
    offset_min = settings.display_utc_offset_minutes
    today_display = (datetime.now(timezone.utc) + timedelta(minutes=offset_min)).date()

    # 1. Xác thực ngày mốc (anchor)
    if anchor is not None:
        try:
            anchor_date = datetime.strptime(anchor.strip(), "%Y-%m-%d").date()
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="Ngày anchor không đúng định dạng YYYY-MM-DD")
    else:
        anchor_date = today_display

    # 2. Tính toán khoảng thời gian (start_date, end_date), prev_anchor, next_anchor, granularity và buckets
    if period == "recent":
        granularity = "day"
        end_date = anchor_date
        start_date = end_date - timedelta(days=days - 1)
        prev_anchor = (start_date - timedelta(days=1)).isoformat()
        if end_date >= today_display:
            next_anchor = None
        else:
            cand = end_date + timedelta(days=days)
            next_anchor = min(today_display, cand).isoformat()

        bucket_defs = []
        for i in range(days):
            d = start_date + timedelta(days=i)
            bucket_defs.append({
                "key": d.isoformat(),
                "label": d.strftime("%d/%m"),
                "future": d > today_display,
            })

    elif period == "week":
        granularity = "day"
        # Tuần bắt đầu từ thứ Hai (weekday=0) đến Chủ nhật (weekday=6)
        start_date = anchor_date - timedelta(days=anchor_date.weekday())
        end_date = start_date + timedelta(days=6)
        prev_anchor = (start_date - timedelta(days=7)).isoformat()
        next_cand = start_date + timedelta(days=7)
        next_anchor = None if next_cand > today_display else next_cand.isoformat()

        day_names = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]
        bucket_defs = []
        for i in range(7):
            d = start_date + timedelta(days=i)
            bucket_defs.append({
                "key": d.isoformat(),
                "label": f"{day_names[i]} {d.strftime('%d/%m')}",
                "future": d > today_display,
            })

    elif period == "month":
        granularity = "day"
        year, month = anchor_date.year, anchor_date.month
        start_date = date(year, month, 1)
        num_days = calendar.monthrange(year, month)[1]
        end_date = date(year, month, num_days)

        if month == 1:
            prev_anchor = date(year - 1, 12, 1).isoformat()
        else:
            prev_anchor = date(year, month - 1, 1).isoformat()

        if month == 12:
            next_cand = date(year + 1, 1, 1)
        else:
            next_cand = date(year, month + 1, 1)
        next_anchor = None if next_cand > today_display else next_cand.isoformat()

        bucket_defs = []
        for day_num in range(1, num_days + 1):
            d = date(year, month, day_num)
            bucket_defs.append({
                "key": d.isoformat(),
                "label": f"{day_num:02d}",
                "future": d > today_display,
            })

    elif period == "year":
        granularity = "month"
        year = anchor_date.year
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)
        prev_anchor = date(year - 1, 1, 1).isoformat()
        next_cand = date(year + 1, 1, 1)
        next_anchor = None if next_cand > today_display else next_cand.isoformat()

        current_month_start = today_display.replace(day=1)
        bucket_defs = []
        for m in range(1, 13):
            m_start = date(year, m, 1)
            bucket_defs.append({
                "key": f"{year}-{m:02d}",
                "label": f"T{m}",
                "future": m_start > current_month_start,
            })

    # 3. Chuyển đổi start_date và end_date sang timestamp UTC để truy vấn nhanh qua index
    utc_start = datetime.combine(start_date, datetime.min.time()) - timedelta(minutes=offset_min)
    utc_end = datetime.combine(end_date, datetime.max.time()) - timedelta(minutes=offset_min)

    # Biểu thức SQL chuyển sang múi giờ hiển thị
    display_dt = func.date_add(Message.created_at, text(f"INTERVAL {offset_min} MINUTE"))
    msg_date = func.date(display_dt)
    msg_month = func.date_format(display_dt, "%Y-%m")

    # 4. Gom số câu hỏi và người dùng theo bucket
    if granularity == "day":
        questions_map = {
            r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0]): r[1]
            for r in db.execute(
                select(msg_date, func.count(Message.id))
                .where(
                    Message.role == "user",
                    Message.created_at >= utc_start,
                    Message.created_at <= utc_end,
                )
                .group_by(msg_date)
            ).all()
        }
        users_map = {
            r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0]): r[1]
            for r in db.execute(
                select(msg_date, func.count(func.distinct(Conversation.user_id)))
                .select_from(Message)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(
                    Message.role == "user",
                    Message.created_at >= utc_start,
                    Message.created_at <= utc_end,
                )
                .group_by(msg_date)
            ).all()
        }
    else:  # granularity == "month"
        questions_map = {
            str(r[0]): r[1]
            for r in db.execute(
                select(msg_month, func.count(Message.id))
                .where(
                    Message.role == "user",
                    Message.created_at >= utc_start,
                    Message.created_at <= utc_end,
                )
                .group_by(msg_month)
            ).all()
        }
        users_map = {
            str(r[0]): r[1]
            for r in db.execute(
                select(msg_month, func.count(func.distinct(Conversation.user_id)))
                .select_from(Message)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(
                    Message.role == "user",
                    Message.created_at >= utc_start,
                    Message.created_at <= utc_end,
                )
                .group_by(msg_month)
            ).all()
        }

    buckets = []
    for b in bucket_defs:
        key = b["key"]
        is_future = b["future"]
        q_count = 0 if is_future else questions_map.get(key, 0)
        u_count = 0 if is_future else users_map.get(key, 0)
        buckets.append({
            "key": key,
            "label": b["label"],
            "questions": q_count,
            "active_users": u_count,
            "future": is_future,
            "date": key if granularity == "day" else f"{key}-01",
        })

    # 5. Tổng hợp trong kỳ (period_totals)
    period_questions = sum(b["questions"] for b in buckets)
    period_active_users = db.scalar(
        select(func.count(func.distinct(Conversation.user_id)))
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Message.role == "user",
            Message.created_at >= utc_start,
            Message.created_at <= utc_end,
        )
    ) or 0

    token_row = db.execute(
        select(
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
        ).where(
            Message.created_at >= utc_start,
            Message.created_at <= utc_end,
        )
    ).one()
    period_tokens = {"prompt": int(token_row[0]), "completion": int(token_row[1])}

    # 6. Top tài liệu trích dẫn trong kỳ (giới hạn quét 20.000 bản ghi)
    SCAN_LIMIT = 20000
    source_rows = db.scalars(
        select(Message.sources)
        .where(
            Message.role == "assistant",
            Message.created_at >= utc_start,
            Message.created_at <= utc_end,
            Message.sources.is_not(None),
        )
        .order_by(Message.id.desc())
        .limit(SCAN_LIMIT + 1)
    ).all()
    truncated = len(source_rows) > SCAN_LIMIT
    if truncated:
        source_rows = source_rows[:SCAN_LIMIT]

    cited: Counter = Counter()
    for sources in source_rows:
        if not sources:
            continue
        for filename in {s.get("filename") for s in sources if isinstance(s, dict)}:
            if filename:
                cited[filename] += 1
    top_documents = [{"filename": name, "citations": n} for name, n in cited.most_common(5)]

    # 7. Số liệu tổng thể hiện tại (totals, không phụ thuộc kỳ)
    def count(column, *conds):
        return db.scalar(select(func.count(column)).where(*conds)) or 0

    doc_status = {
        r[0]: r[1]
        for r in db.execute(
            select(Document.status, func.count(Document.id)).group_by(Document.status)
        ).all()
    }

    today_utc_start = datetime.combine(today_display, datetime.min.time()) - timedelta(minutes=offset_min)
    today_utc_end = datetime.combine(today_display, datetime.max.time()) - timedelta(minutes=offset_min)

    today_token_row = db.execute(
        select(
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
        ).where(
            Message.created_at >= today_utc_start,
            Message.created_at <= today_utc_end,
        )
    ).one()
    today_tokens = {"prompt": int(today_token_row[0]), "completion": int(today_token_row[1])}

    totals = {
        "users": count(User.id, User.deleted_at.is_(None)),
        "users_active": count(User.id, User.is_active.is_(True), User.deleted_at.is_(None)),
        "users_trashed": count(User.id, User.deleted_at.is_not(None)),
        "documents": sum(doc_status.values()),
        "documents_done": doc_status.get("done", 0),
        "chunks": count(Chunk.id),
        "conversations": count(Conversation.id),
        "questions": count(Message.id, Message.role == "user"),
        "questions_today": count(
            Message.id,
            Message.role == "user",
            Message.created_at >= today_utc_start,
            Message.created_at <= today_utc_end,
        ),
        "unanswered_open": count(
            UnansweredQuestion.id, UnansweredQuestion.resolved.is_(False)
        ),
    }

    return {
        "period": period,
        "anchor": anchor_date.isoformat(),
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "prev_anchor": prev_anchor,
        "next_anchor": next_anchor,
        "granularity": granularity,
        "buckets": buckets,
        "totals": totals,
        "period_totals": {
            "questions": period_questions,
            "active_users": period_active_users,
            "tokens": period_tokens,
        },
        "top_documents": top_documents,
        "tokens": {
            "period": period_tokens,
            "today": today_tokens,
        },
        "truncated": truncated,
        # Giữ lại các trường cũ cho tính tương thích
        "days": days if period == "recent" else len(buckets),
        "daily": buckets,
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
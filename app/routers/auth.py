import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth import (
    REFRESH_COOKIE_NAME,
    cleanup_old_refresh_tokens,
    clear_refresh_cookie,
    create_access_token,
    get_current_user,
    hash_token,
    require_admin,
    set_refresh_cookie,
    verify_password,
)
from app.config import settings
from app.database import get_db
from app.models import RefreshToken, User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.email == form.username))
    # Tài khoản không tồn tại, đã xóa mềm hoặc sai mật khẩu đều trả cùng lỗi 401 tránh lộ thông tin
    if (
        user is None
        or user.deleted_at is not None
        or not verify_password(form.password, user.password_hash)
    ):
        raise HTTPException(status_code=401, detail="Sai email hoặc mật khẩu")
    if not user.is_active:
        raise HTTPException(
            status_code=403, detail="Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên"
        )
    user.last_login_at = func.now()

    # Dọn dẹp định kỳ các token quá hạn hoặc thu hồi quá 7 ngày
    cleanup_old_refresh_tokens(db, force=False)

    # Khởi tạo Refresh Token và phiên đăng nhập (family_id) mới
    raw_refresh_token = secrets.token_urlsafe(32)
    token_hash = hash_token(raw_refresh_token)
    family_id = secrets.token_hex(16)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=settings.refresh_token_expire_days)
    user_agent = request.headers.get("user-agent", "")[:255]

    refresh_record = RefreshToken(
        user_id=user.id,
        token_hash=token_hash,
        family_id=family_id,
        created_at=now,
        expires_at=expires_at,
        user_agent=user_agent,
    )
    db.add(refresh_record)
    db.commit()

    # Gắn cookie HttpOnly cho path /auth
    set_refresh_cookie(response, raw_refresh_token)

    expires_in = settings.access_token_expire_minutes * 60
    return {
        "access_token": create_access_token(user.id, user.token_version),
        "token_type": "bearer",
        "expires_in": expires_in,
    }


@router.post("/refresh")
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Xoay vòng refresh token: cấp access token mới, thay thế refresh token cũ và đặt cookie mới."""
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw_token:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Không có refresh token")

    token_hash = hash_token(raw_token)
    token_record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if token_record is None:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Refresh token không hợp lệ")

    user = db.get(User, token_record.user_id)
    if user is None or user.deleted_at is not None or not user.is_active:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Tài khoản không tồn tại hoặc đã bị khóa")

    now = datetime.now(timezone.utc)
    token_exp = token_record.expires_at
    if token_exp.tzinfo is None:
        token_exp = token_exp.replace(tzinfo=timezone.utc)

    if now > token_exp:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Refresh token đã hết hạn")

    # Kiểm tra phát hiện tái sử dụng token đã thu hồi
    if token_record.revoked_at is not None:
        # Nếu token bị thu hồi trực tiếp (logout, admin đặt lại mật khẩu, admin khóa...) -> 401 ngay lập tức
        if token_record.replaced_by_id is None:
            clear_refresh_cookie(response)
            raise HTTPException(status_code=401, detail="Refresh token đã bị thu hồi")

        rev_at = token_record.revoked_at
        if rev_at.tzinfo is None:
            rev_at = rev_at.replace(tzinfo=timezone.utc)
        elapsed = (now - rev_at).total_seconds()

        if elapsed > settings.refresh_reuse_grace_seconds:
            # Quá thời gian ân hạn: Nghi ngờ token bị đánh cắp -> Thu hồi toàn bộ token cùng family!
            db.execute(
                update(RefreshToken)
                .where(
                    RefreshToken.family_id == token_record.family_id,
                    RefreshToken.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
            # Tăng token_version để vô hiệu hóa access token hiện tại
            user.token_version += 1
            db.commit()
            clear_refresh_cookie(response)
            raise HTTPException(status_code=401, detail="Phát hiện refresh token bị sử dụng lại")
        # Trong thời gian ân hạn (do hai request refresh đồng thời): chấp nhận và cấp token mới cùng family

    # Xoay vòng: tạo refresh token mới cùng family_id
    new_raw_token = secrets.token_urlsafe(32)
    new_token_hash = hash_token(new_raw_token)
    new_expires_at = now + timedelta(days=settings.refresh_token_expire_days)
    user_agent = request.headers.get("user-agent", "")[:255]

    new_record = RefreshToken(
        user_id=user.id,
        token_hash=new_token_hash,
        family_id=token_record.family_id,
        created_at=now,
        expires_at=new_expires_at,
        user_agent=user_agent,
    )
    db.add(new_record)
    db.flush()

    # Thu hồi token cũ và trỏ replaced_by_id sang token mới
    if token_record.revoked_at is None:
        token_record.revoked_at = now
        token_record.replaced_by_id = new_record.id

    db.commit()

    # Đặt cookie mới và trả về access token mới
    set_refresh_cookie(response, new_raw_token)
    expires_in = settings.access_token_expire_minutes * 60
    return {
        "access_token": create_access_token(user.id, user.token_version),
        "token_type": "bearer",
        "expires_in": expires_in,
    }


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Đăng xuất: thu hồi refresh token hiện tại và xóa cookie trên trình duyệt."""
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if raw_token:
        token_hash = hash_token(raw_token)
        token_record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        if token_record and token_record.revoked_at is None:
            token_record.revoked_at = datetime.now(timezone.utc)
            db.commit()

    clear_refresh_cookie(response)
    return {"ok": True, "message": "Đã đăng xuất"}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "role": user.role}


@router.get("/admin-check")
def admin_check(user: User = Depends(require_admin)):
    return {"message": f"Xin chào admin {user.email}"}
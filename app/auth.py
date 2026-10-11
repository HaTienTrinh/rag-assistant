import hashlib
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Response
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import RefreshToken, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

REFRESH_COOKIE_NAME = "refresh_token"
_last_cleanup_timestamp = 0.0


def hash_password(password: str) -> str:
    """Băm mật khẩu người dùng bằng bcrypt."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    """Kiểm tra mật khẩu người dùng khớp với bản băm."""
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:  # ví dụ mật khẩu dài hơn 72 ký tự
        return False


def validate_password_rules(password: str) -> None:
    """Kiểm tra quy tắc mật khẩu dùng chung: tối thiểu 8 ký tự và tối đa 72 ký tự."""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có tối thiểu 8 ký tự")
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Mật khẩu quá dài (tối đa 72 ký tự)")


def hash_token(raw_token: str) -> str:
    """Băm refresh token bằng SHA-256 để lưu DB (không bao giờ lưu hoặc log token gốc)."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def set_refresh_cookie(response: Response, raw_token: str) -> None:
    """Gắn cookie refresh_token với các cờ bảo mật HttpOnly, SameSite=Strict, Path=/auth."""
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        max_age=settings.refresh_token_expire_days * 86400,
        httponly=True,
        samesite="strict",
        path="/auth",
        secure=settings.cookie_secure,
    )


def clear_refresh_cookie(response: Response) -> None:
    """Xóa cookie refresh_token khỏi trình duyệt."""
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/auth",
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
    )


def create_access_token(user_id: int, token_version: int = 0) -> str:
    """Tạo JWT access token chứa id và token_version (tv) của người dùng."""
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    return jwt.encode(
        {"sub": str(user_id), "tv": token_version, "exp": expire},
        settings.secret_key,
        algorithm="HS256",
    )


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """Xác thực access token, từ chối nếu hết hạn, tài khoản bị khóa hoặc token_version không khớp."""
    credentials_error = HTTPException(
        status_code=401,
        detail="Token không hợp lệ hoặc đã hết hạn",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id = int(payload["sub"])
        token_version = payload.get("tv")
    except (jwt.PyJWTError, KeyError, ValueError):
        raise credentials_error

    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise credentials_error
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Tài khoản đã bị khóa")
    # Kiểm tra token_version: nếu user bị đổi mật khẩu/khóa, access token cũ lập tức bị vô hiệu
    if token_version is None or token_version != user.token_version:
        raise credentials_error
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Yêu cầu quyền quản trị viên (admin)."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Chỉ admin được phép")
    return user


def revoke_all_user_tokens(db: Session, user: User) -> None:
    """Thu hồi tất cả refresh token còn hiệu lực và tăng token_version để vô hiệu access token cũ."""
    now = datetime.now(timezone.utc)
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    user.token_version += 1
    db.commit()


def cleanup_old_refresh_tokens(db: Session, force: bool = False) -> None:
    """Xóa các refresh token đã hết hạn hoặc đã thu hồi quá 7 ngày (tối đa mỗi giờ một lần)."""
    global _last_cleanup_timestamp
    now_ts = time.time()
    if not force and (now_ts - _last_cleanup_timestamp < 3600):
        return

    now_utc = datetime.now(timezone.utc)
    threshold = now_utc - timedelta(days=7)
    db.execute(
        delete(RefreshToken).where(
            (RefreshToken.expires_at < threshold)
            | (RefreshToken.revoked_at.is_not(None) & (RefreshToken.revoked_at < threshold))
        )
    )
    db.commit()
    _last_cleanup_timestamp = now_ts
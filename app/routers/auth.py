from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import (
    create_access_token,
    get_current_user,
    require_admin,
    verify_password,
)
from app.database import get_db
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == form.username))
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Sai email hoặc mật khẩu")
    if not user.is_active:
        raise HTTPException(
            status_code=403, detail="Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên"
        )
    user.last_login_at = func.now()
    db.commit()
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "role": user.role}


@router.get("/admin-check")
def admin_check(user: User = Depends(require_admin)):
    return {"message": f"Xin chào admin {user.email}"}
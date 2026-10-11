from sqlalchemy import select

from app.auth import hash_password
from app.config import settings
from app.database import SessionLocal
from app.models import User


def seed_users() -> None:
    """Tạo tài khoản admin và demo từ biến môi trường nếu chưa tồn tại."""
    accounts = [
        (settings.admin_email, settings.admin_password, "admin"),
        (settings.demo_email, settings.demo_password, "user"),
    ]
    with SessionLocal() as db:
        for email, password, role in accounts:
            if not email or not password:
                continue
            if db.scalar(select(User).where(User.email == email)):
                continue
            db.add(User(email=email, password_hash=hash_password(password), role=role))
        db.commit()

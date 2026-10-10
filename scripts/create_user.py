import sys

from sqlalchemy import select

from app.auth import hash_password
from app.database import SessionLocal
from app.models import User

# Đảm bảo in tiếng Việt trên console Windows không bị lỗi UnicodeEncodeError
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


def main():
    if len(sys.argv) < 3:
        print("Cách dùng: python -m scripts.create_user <email> <mật_khẩu> [admin|user]")
        return

    email, password = sys.argv[1], sys.argv[2]
    role = sys.argv[3] if len(sys.argv) > 3 else "user"

    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email)):
            print("Email đã tồn tại")
            return
        db.add(User(email=email, password_hash=hash_password(password), role=role))
        db.commit()
        print(f"Đã tạo {role}: {email}")


if __name__ == "__main__":
    main()
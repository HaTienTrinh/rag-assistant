from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# Cột mới cần có trên các bảng đã tồn tại từ các phiên bản trước.
NEW_COLUMNS = {
    "users": [
        ("is_active", "TINYINT(1) NOT NULL DEFAULT 1"),
        ("daily_limit", "INT NULL"),
        ("last_login_at", "DATETIME NULL"),
    ],
    "documents": [("is_active", "TINYINT(1) NOT NULL DEFAULT 1")],
    "messages": [("prompt_tokens", "INT NULL"), ("completion_tokens", "INT NULL")],
}


def ensure_columns(engine: Engine) -> None:
    """Thêm các cột còn thiếu (an toàn khi chạy nhiều lần)."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in NEW_COLUMNS.items():
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{name}` {ddl}"))
                    print(f"Đã thêm cột {table}.{name}")
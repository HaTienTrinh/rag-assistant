from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# Cột mới cần có trên các bảng đã tồn tại từ các phiên bản trước.
NEW_COLUMNS = {
    "users": [
        ("is_active", "TINYINT(1) NOT NULL DEFAULT 1"),
        ("token_version", "INT NOT NULL DEFAULT 0"),
        ("daily_limit", "INT NULL"),
        ("last_login_at", "DATETIME NULL"),
        ("deleted_at", "DATETIME NULL"),
        ("must_change_password", "TINYINT(1) NOT NULL DEFAULT 0"),
    ],
    "documents": [("is_active", "TINYINT(1) NOT NULL DEFAULT 1")],
    "messages": [("prompt_tokens", "INT NULL"), ("completion_tokens", "INT NULL")],
}

# Chỉ mục mới cần tạo trên các bảng đã tồn tại (hỗ trợ tối ưu hóa truy vấn).
NEW_INDEXES = {
    "messages": [
        ("ix_messages_role_created_at", ["role", "created_at"]),
    ],
}


def ensure_columns(engine: Engine) -> None:
    """Thêm các cột còn thiếu và tạo chỉ mục (an toàn khi chạy nhiều lần)."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in NEW_COLUMNS.items():
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{name}` {ddl}"))
                    print(f"Đã thêm cột {table}.{name}")
    # Đảm bảo các chỉ mục bổ sung cũng được tạo
    ensure_indexes(engine)


def ensure_indexes(engine: Engine) -> None:
    """Tạo các chỉ mục còn thiếu (an toàn khi chạy nhiều lần)."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, indexes in NEW_INDEXES.items():
            existing = {idx["name"] for idx in inspector.get_indexes(table)}
            for name, cols in indexes:
                if name not in existing:
                    cols_str = ", ".join(f"`{c}`" for c in cols)
                    conn.execute(text(f"CREATE INDEX `{name}` ON `{table}` ({cols_str})"))
                    print(f"Đã thêm chỉ mục {name} trên bảng {table}")
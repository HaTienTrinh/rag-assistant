import certifi
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


def _build_engine():
    db_url = settings.database_url
    connect_args = {}

    # Tự động chuẩn hóa driver sang pymysql nếu URL dùng mysql:// hoặc mysql+mysqldb://
    if db_url.startswith("mysql://"):
        db_url = db_url.replace("mysql://", "mysql+pymysql://", 1)
    elif db_url.startswith("mysql+mysqldb://"):
        db_url = db_url.replace("mysql+mysqldb://", "mysql+pymysql://", 1)

    # Nếu kết nối tới TiDB Cloud, tự động dùng chứng chỉ gốc CA của certifi
    if "tidbcloud.com" in db_url:
        connect_args["ssl"] = {"ca": certifi.where()}

    return create_engine(db_url, connect_args=connect_args, pool_pre_ping=True)


engine = _build_engine()


@event.listens_for(engine, "connect")
def set_utc_timezone(dbapi_connection, connection_record):
    """Đảm bảo mọi kết nối DB đặt SET time_zone = '+00:00' để NOW() luôn là UTC."""
    cursor = dbapi_connection.cursor()
    cursor.execute("SET time_zone = '+00:00'")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
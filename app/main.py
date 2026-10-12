import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError
from starlette.responses import Response

from app import models  # noqa: F401
from app.auth import cleanup_old_refresh_tokens
from app.database import Base, SessionLocal, engine
from app.migrate import ensure_columns, ensure_indexes
from app.routers import admin, auth, conversations, documents, rag
from app.seed import seed_users


def init_db(retries: int = 20, delay: float = 3.0) -> None:
    """Đợi MySQL sẵn sàng, tạo bảng, thêm các cột/chỉ mục mới còn thiếu và dọn dẹp token cũ."""
    for attempt in range(1, retries + 1):
        try:
            Base.metadata.create_all(bind=engine)
            ensure_columns(engine)
            ensure_indexes(engine)
            with SessionLocal() as db:
                cleanup_old_refresh_tokens(db, force=True)
            return
        except OperationalError:
            if attempt == retries:
                raise
            print(f"MySQL chưa sẵn sàng, thử lại ({attempt}/{retries})...")
            time.sleep(delay)


init_db()
seed_users()


def _warmup_background():
    """Khởi động trước FastEmbed model và nạp sẵn cache ma trận vector vào RAM để câu hỏi đầu tiên không bị trễ."""
    try:
        from app.services.embeddings import _get_model
        _get_model()
        with SessionLocal() as db:
            from app.services.retrieval import search_chunks
            search_chunks(db, "khởi động")
    except Exception as exc:
        print(f"Warmup notice: {exc}")


import threading
threading.Thread(target=_warmup_background, daemon=True).start()

STATIC_DIR = Path(__file__).parent / "static"


class NoCacheStaticFiles(StaticFiles):
    """StaticFiles tùy biến: gửi Cache-Control: no-cache để trình duyệt luôn revalidate bằng ETag."""

    def file_response(self, *args, **kwargs) -> Response:
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


def html_response(file_path: Path) -> FileResponse:
    """Trả về file HTML kèm header Cache-Control: no-cache tránh lưu cache cũ trên trình duyệt."""
    return FileResponse(file_path, headers={"Cache-Control": "no-cache"})


app = FastAPI(
    title="RAG Assistant",
    swagger_ui_parameters={"persistAuthorization": True},
)
app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(rag.router)
app.include_router(conversations.router)
app.include_router(admin.router)

# Mount thư mục static với cơ chế chống cache cũ
app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return html_response(STATIC_DIR / "index.html")


@app.get("/login", include_in_schema=False)
def login_page():
    return html_response(STATIC_DIR / "login.html")


@app.get("/admin", include_in_schema=False)
def admin_page():
    return html_response(STATIC_DIR / "admin.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(STATIC_DIR / "favicon.ico")


@app.get("/health")
def health():
    return {"status": "ok"}
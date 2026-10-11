from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import models  # noqa: F401
from app.database import Base, engine
from app.routers import auth, conversations, documents, rag

Base.metadata.create_all(bind=engine)

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(
    title="RAG Assistant",
    swagger_ui_parameters={"persistAuthorization": True},
)
app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(rag.router)
app.include_router(conversations.router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health():
    return {"status": "ok"}
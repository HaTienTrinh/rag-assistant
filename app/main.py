from fastapi import FastAPI

from app import models  # noqa: F401
from app.database import Base, engine
from app.routers import auth, documents, rag

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="RAG Assistant",
    swagger_ui_parameters={"persistAuthorization": True},
)
app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(rag.router)


@app.get("/health")
def health():
    return {"status": "ok"}
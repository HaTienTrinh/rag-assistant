from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.services.llm import answer_question
from app.services.retrieval import search_chunks

router = APIRouter(prefix="/rag", tags=["rag"])


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    top_k: int | None = Field(default=None, ge=1, le=20)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


@router.post("/search")
def search(
    body: SearchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Chỉ tìm đoạn liên quan, không gọi LLM. Dùng để kiểm tra chất lượng tìm kiếm."""
    return search_chunks(db, body.query, body.top_k)


@router.post("/ask")
def ask(
    body: AskRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    contexts = search_chunks(db, body.question)
    if not contexts:
        return {"answer": "Chưa có tài liệu nào được nạp vào hệ thống.", "sources": []}
    answer = answer_question(body.question, contexts)
    return {"answer": answer, "sources": contexts}
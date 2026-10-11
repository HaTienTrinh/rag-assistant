from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import User
from app.services.retrieval import search_chunks

router = APIRouter(prefix="/rag", tags=["rag"])


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    top_k: int | None = Field(default=None, ge=1, le=20)


@router.post("/search")
def search(
    body: SearchRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Công cụ cho admin: xem điểm tìm kiếm để chỉnh MIN_SCORE, không gọi LLM."""
    return search_chunks(db, body.query, body.top_k)
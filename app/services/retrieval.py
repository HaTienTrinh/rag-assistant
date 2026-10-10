import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Chunk, Document
from app.services.embeddings import embed_query


def search_chunks(db: Session, query: str, top_k: int | None = None) -> list[dict]:
    top_k = top_k or settings.top_k

    rows = db.execute(
        select(Chunk.content, Chunk.page, Chunk.embedding, Document.filename)
        .join(Document, Document.id == Chunk.document_id)
        .where(Document.status == "done")
    ).all()
    if not rows:
        return []

    matrix = np.array([r.embedding for r in rows], dtype=np.float32)
    scores = matrix @ embed_query(query)
    best = np.argsort(-scores)[:top_k]

    return [
        {
            "filename": rows[i].filename,
            "page": rows[i].page,
            "content": rows[i].content,
            "score": round(float(scores[i]), 4),
        }
        for i in best
    ]
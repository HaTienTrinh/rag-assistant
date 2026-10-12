import time
import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Chunk, Document
from app.services.embeddings import embed_query

# Bộ nhớ đệm RAM lưu ma trận vector và thông tin đoạn tài liệu để tránh đọc lặp lại từ MySQL ở mỗi request
_cached_matrix: np.ndarray | None = None
_cached_metadata: list[dict] | None = None
_last_cache_time: float = 0.0
CACHE_TTL_SECONDS = 3600.0  # Tự động đồng bộ lại sau 1 giờ nếu có thay đổi ngầm (bình thường đã có invalidate_retrieval_cache)


def invalidate_retrieval_cache() -> None:
    """Xóa bộ nhớ đệm ma trận vector trên RAM để nạp lại dữ liệu mới nhất (gọi khi thêm/xóa/bật/tắt tài liệu)."""
    global _cached_matrix, _cached_metadata, _last_cache_time
    _cached_matrix = None
    _cached_metadata = None
    _last_cache_time = 0.0


def search_chunks(db: Session, query: str, top_k: int | None = None) -> list[dict]:
    """Trả về các đoạn gần nhất (chưa lọc theo ngưỡng), chỉ trong tài liệu đang bật.

    Sử dụng ma trận vector được cache trên RAM để thực hiện phép nhân ma trận trực tiếp,
    giúp tốc độ tìm kiếm duy trì dưới 5ms ngay cả khi hệ thống có hàng chục nghìn đoạn văn bản.
    """
    global _cached_matrix, _cached_metadata, _last_cache_time
    top_k = top_k or settings.top_k
    now = time.time()

    # Kiểm tra xem cache trên RAM có sẵn và còn trong thời hạn TTL không
    if _cached_matrix is None or (now - _last_cache_time) > CACHE_TTL_SECONDS:
        rows = db.execute(
            select(
                Chunk.content,
                Chunk.page,
                Chunk.embedding,
                Document.filename,
                Document.id.label("document_id"),
            )
            .join(Document, Document.id == Chunk.document_id)
            .where(Document.status == "done", Document.is_active.is_(True))
        ).all()
        if not rows:
            _cached_matrix = np.empty((0, 0), dtype=np.float32)
            _cached_metadata = []
        else:
            _cached_matrix = np.array([r.embedding for r in rows], dtype=np.float32)
            _cached_metadata = [
                {
                    "filename": r.filename,
                    "page": r.page,
                    "content": r.content,
                    "document_id": r.document_id,
                }
                for r in rows
            ]
        _last_cache_time = now

    if _cached_matrix.size == 0 or not _cached_metadata:
        return []

    scores = _cached_matrix @ embed_query(query)
    best = np.argsort(-scores)[:top_k]

    return [
        {
            "document_id": _cached_metadata[i]["document_id"],
            "filename": _cached_metadata[i]["filename"],
            "page": _cached_metadata[i]["page"],
            "content": _cached_metadata[i]["content"],
            "score": round(float(scores[i]), 4),
        }
        for i in best
    ]
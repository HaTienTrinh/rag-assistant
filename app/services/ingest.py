from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.models import Chunk, Document
from app.services.chunking import chunk_pages
from app.services.embeddings import embed_passages
from app.services.extract import extract_pages


def stored_path(doc: Document) -> Path:
    ext = Path(doc.filename).suffix.lower()
    return Path(settings.upload_dir) / f"{doc.file_hash}{ext}"


def process_document(doc_id: int) -> None:
    """Chạy nền: trích văn bản, tách đoạn, tạo embedding, lưu vào bảng chunks."""
    with SessionLocal() as db:
        try:
            doc = db.get(Document, doc_id)
            doc.status = "processing"
            db.commit()

            pages = extract_pages(stored_path(doc))
            chunks = chunk_pages(pages)
            if not chunks:
                raise ValueError(
                    "Không trích xuất được văn bản (có thể là PDF dạng ảnh scan)"
                )

            vectors = embed_passages([text for _, text in chunks])
            db.add_all(
                Chunk(document_id=doc_id, page=page, content=text, embedding=vec)
                for (page, text), vec in zip(chunks, vectors)
            )
            doc.status = "done"
            doc.error = None
            db.commit()
            from app.services.retrieval import invalidate_retrieval_cache
            invalidate_retrieval_cache()
        except Exception as exc:
            db.rollback()
            doc = db.get(Document, doc_id)
            if doc is not None:
                doc.status = "failed"
                doc.error = str(exc)[:1000]
                db.commit()
import hashlib
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.models import Chunk, Document, User
from app.services.ingest import process_document, stored_path

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".docx"}


class UpdateDocumentBody(BaseModel):
    is_active: bool


def _serialize(doc: Document, chunk_count: int | None = None) -> dict:
    return {
        "id": doc.id,
        "filename": doc.filename,
        "status": doc.status,
        "error": doc.error,
        "is_active": doc.is_active,
        "chunks": chunk_count,
        "created_at": doc.created_at,
    }


def _get_doc(db: Session, doc_id: int) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "Không tìm thấy tài liệu")
    return doc


def _chunk_count(db: Session, doc_id: int) -> int:
    return db.scalar(select(func.count(Chunk.id)).where(Chunk.document_id == doc_id)) or 0


@router.post("", status_code=202)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    filename = Path(file.filename or "").name
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, "Chỉ hỗ trợ file .pdf, .txt, .docx")

    max_bytes = settings.max_upload_mb * 1024 * 1024
    content = file.file.read(max_bytes + 1)
    if not content:
        raise HTTPException(400, "File rỗng")
    if len(content) > max_bytes:
        raise HTTPException(413, f"File vượt quá {settings.max_upload_mb} MB")

    file_hash = hashlib.sha256(content).hexdigest()
    if db.scalar(select(Document).where(Document.file_hash == file_hash)):
        raise HTTPException(409, "Tài liệu này đã được tải lên trước đó")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    (upload_dir / f"{file_hash}{ext}").write_bytes(content)

    doc = Document(
        filename=filename, file_hash=file_hash, status="pending", uploaded_by=admin.id
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(process_document, doc.id)
    return _serialize(doc)


@router.get("")
def list_documents(
    db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    rows = db.execute(
        select(Document, func.count(Chunk.id))
        .outerjoin(Chunk, Chunk.document_id == Document.id)
        .group_by(Document.id)
        .order_by(Document.id.desc())
    ).all()
    return [_serialize(doc, count) for doc, count in rows]


@router.get("/{doc_id}")
def get_document(
    doc_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    doc = _get_doc(db, doc_id)
    return _serialize(doc, _chunk_count(db, doc_id))


@router.get("/{doc_id}/chunks")
def list_chunks(
    doc_id: int,
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Xem các đoạn đã tách (không trả về vector embedding)."""
    doc = _get_doc(db, doc_id)
    rows = db.execute(
        select(Chunk.id, Chunk.page, Chunk.content)
        .where(Chunk.document_id == doc_id)
        .order_by(Chunk.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return {
        "document": _serialize(doc),
        "total": _chunk_count(db, doc_id),
        "items": [{"id": r.id, "page": r.page, "content": r.content} for r in rows],
    }


@router.patch("/{doc_id}")
def update_document(
    doc_id: int,
    body: UpdateDocumentBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    doc = _get_doc(db, doc_id)
    doc.is_active = body.is_active
    db.commit()
    return _serialize(doc, _chunk_count(db, doc_id))


@router.post("/{doc_id}/reprocess", status_code=202)
def reprocess_document(
    doc_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    doc = _get_doc(db, doc_id)
    if doc.status in ("pending", "processing"):
        raise HTTPException(409, "Tài liệu đang được xử lý")
    if not stored_path(doc).exists():
        raise HTTPException(
            409, "File gốc không còn trên máy chủ, hãy xóa và tải lại tài liệu"
        )

    db.execute(delete(Chunk).where(Chunk.document_id == doc_id))
    doc.status = "pending"
    doc.error = None
    db.commit()

    background_tasks.add_task(process_document, doc_id)
    return _serialize(doc, 0)


@router.delete("/{doc_id}")
def delete_document(
    doc_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    doc = _get_doc(db, doc_id)
    path = stored_path(doc)
    db.execute(delete(Chunk).where(Chunk.document_id == doc_id))
    db.delete(doc)
    db.commit()
    path.unlink(missing_ok=True)
    return {"deleted": doc_id}
import hashlib
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.models import Chunk, Document, User
from app.services.ingest import process_document, stored_path

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".docx"}


def _serialize(doc: Document, chunk_count: int | None = None) -> dict:
    return {
        "id": doc.id,
        "filename": doc.filename,
        "status": doc.status,
        "error": doc.error,
        "chunks": chunk_count,
        "created_at": doc.created_at,
    }


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
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "Không tìm thấy tài liệu")
    count = db.scalar(select(func.count(Chunk.id)).where(Chunk.document_id == doc_id))
    return _serialize(doc, count)


@router.delete("/{doc_id}")
def delete_document(
    doc_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "Không tìm thấy tài liệu")

    path = stored_path(doc)
    db.execute(delete(Chunk).where(Chunk.document_id == doc_id))
    db.delete(doc)
    db.commit()
    path.unlink(missing_ok=True)
    return {"deleted": doc_id}
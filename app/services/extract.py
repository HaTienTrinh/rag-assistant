from pathlib import Path

from docx import Document as DocxDocument
from pypdf import PdfReader


def extract_pages(path: Path) -> list[tuple[int | None, str]]:
    """Trả về danh sách (số trang, văn bản). TXT/DOCX không có trang nên page = None."""
    ext = path.suffix.lower()

    if ext == ".pdf":
        reader = PdfReader(str(path))
        return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]

    if ext == ".docx":
        doc = DocxDocument(str(path))
        return [(None, "\n".join(p.text for p in doc.paragraphs))]

    if ext == ".txt":
        return [(None, path.read_text(encoding="utf-8-sig", errors="ignore"))]

    raise ValueError(f"Định dạng không được hỗ trợ: {ext}")
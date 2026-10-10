from app.config import settings


def chunk_pages(pages: list[tuple[int | None, str]]) -> list[tuple[int | None, str]]:
    """Tách mỗi trang thành các đoạn theo số từ, có chồng lấn giữa các đoạn."""
    size = settings.chunk_words
    overlap = settings.chunk_overlap
    step = max(size - overlap, 1)

    chunks: list[tuple[int | None, str]] = []
    for page, text in pages:
        words = text.split()
        for start in range(0, len(words), step):
            piece = words[start : start + size]
            # Đoạn đuôi quá ngắn đã nằm trong phần chồng lấn của đoạn trước
            if len(piece) < 10 and start > 0:
                continue
            chunks.append((page, " ".join(piece)))
    return chunks
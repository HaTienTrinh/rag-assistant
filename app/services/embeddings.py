import threading

import numpy as np
from fastembed import TextEmbedding

from app.config import settings

_model = None
_lock = threading.Lock()


def _get_model() -> TextEmbedding:
    global _model
    with _lock:
        if _model is None:
            _model = TextEmbedding(model_name=settings.embedding_model, threads=1)
        return _model


def _is_e5() -> bool:
    return "e5" in settings.embedding_model.lower()


def _embed(texts: list[str]) -> np.ndarray:
    vectors = np.array(list(_get_model().embed(texts, batch_size=32)), dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return vectors / norms  # đã chuẩn hóa nên tích vô hướng = cosine


def embed_passages(texts: list[str]) -> list[list[float]]:
    prefix = "passage: " if _is_e5() else ""
    return _embed([prefix + t for t in texts]).tolist()


def embed_query(text: str) -> np.ndarray:
    prefix = "query: " if _is_e5() else ""
    return _embed([prefix + text])[0]
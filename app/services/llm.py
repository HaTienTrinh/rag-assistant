import logging

from fastapi import HTTPException
from openai import OpenAI

from app.config import settings

logger = logging.getLogger("uvicorn.error")

NOT_FOUND_MARKER = "[KHONG_CO_THONG_TIN]"

SYSTEM_PROMPT = f"""Bạn là trợ lý hỏi đáp nội bộ.
Chỉ trả lời dựa trên phần TÀI LIỆU được cung cấp trong câu hỏi hiện tại.
Nếu TÀI LIỆU không có thông tin để trả lời câu hỏi, hãy bắt đầu câu trả lời bằng đúng chuỗi {NOT_FOUND_MARKER} rồi giải thích ngắn gọn rằng tài liệu không đề cập, không tự suy đoán.
Trả lời bằng tiếng Việt, ngắn gọn, và ghi số nguồn như [1], [2] sau mỗi ý lấy từ tài liệu.
Số nguồn [n] chỉ tham chiếu tới TÀI LIỆU của câu hỏi hiện tại, không liên quan đến các số nguồn trong lượt trả lời trước."""


def _client() -> OpenAI:
    if not settings.deepseek_api_key:
        raise HTTPException(500, "Chưa cấu hình DEEPSEEK_API_KEY trong file .env")
    return OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        timeout=90,
    )


def _chat(messages: list[dict], max_tokens: int) -> tuple[str, int, int]:
    """Trả về (nội dung, token đầu vào, token đầu ra)."""
    try:
        response = _client().chat.completions.create(
            model=settings.llm_model,
            messages=messages,
            max_tokens=max_tokens,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Lỗi khi gọi DeepSeek API")
        raise

    text = (response.choices[0].message.content or "").strip()
    usage = response.usage
    prompt = getattr(usage, "prompt_tokens", 0) or 0
    completion = getattr(usage, "completion_tokens", 0) or 0
    return text, prompt, completion


def _format_context(contexts: list[dict]) -> str:
    blocks = []
    for i, c in enumerate(contexts, start=1):
        where = c["filename"] + (f", trang {c['page']}" if c["page"] else "")
        blocks.append(f"[{i}] ({where})\n{c['content']}")
    return "\n\n".join(blocks)


def rewrite_question(question: str, history: list[dict]) -> tuple[str, int, int]:
    """Viết lại câu hỏi nối tiếp thành câu đầy đủ. Trả về (câu hỏi, token vào, token ra)."""
    transcript = "\n".join(
        f"{'Người dùng' if m['role'] == 'user' else 'Trợ lý'}: {m['content'][:500]}"
        for m in history[-4:]
    )
    prompt = (
        "Dưới đây là đoạn hội thoại và câu hỏi mới nhất của người dùng.\n"
        "Hãy viết lại câu hỏi mới nhất thành MỘT câu hỏi đầy đủ, tự đứng được một mình "
        "(thay các từ như 'nó', 'trường hợp đó' bằng nội dung cụ thể). "
        "Nếu câu hỏi đã đầy đủ thì giữ nguyên. Chỉ trả về câu hỏi, không giải thích.\n\n"
        f"HỘI THOẠI:\n{transcript}\n\nCÂU HỎI MỚI NHẤT: {question}"
    )
    try:
        text, p, c = _chat([{"role": "user", "content": prompt}], max_tokens=300)
        return (text or question), p, c
    except HTTPException:
        raise
    except Exception:
        return question, 0, 0


def answer_question(
    question: str, contexts: list[dict], history: list[dict] | None = None
) -> dict:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history or [])
    messages.append(
        {
            "role": "user",
            "content": f"TÀI LIỆU:\n{_format_context(contexts)}\n\nCÂU HỎI: {question}",
        }
    )
    text, prompt_tokens, completion_tokens = _chat(messages, max_tokens=2000)

    found = NOT_FOUND_MARKER not in text
    text = text.replace(NOT_FOUND_MARKER, "").strip()
    if not text:
        text, found = "Mô hình không trả về nội dung, vui lòng thử lại.", False

    return {
        "text": text,
        "found": found,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
    }
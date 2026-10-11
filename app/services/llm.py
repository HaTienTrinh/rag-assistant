from fastapi import HTTPException
from openai import OpenAI

from app.config import settings

SYSTEM_PROMPT = """Bạn là trợ lý hỏi đáp nội bộ.
Chỉ trả lời dựa trên phần TÀI LIỆU được cung cấp trong câu hỏi hiện tại.
Nếu tài liệu không chứa thông tin để trả lời, hãy nói rõ là không tìm thấy trong tài liệu, không tự suy đoán.
Trả lời bằng tiếng Việt, ngắn gọn, và ghi số nguồn như [1], [2] sau mỗi ý lấy từ tài liệu.
Số nguồn [n] chỉ tham chiếu tới TÀI LIỆU của câu hỏi hiện tại, không liên quan đến các số nguồn trong lượt trả lời trước."""


def _client() -> OpenAI:
    if not settings.deepseek_api_key:
        raise HTTPException(500, "Chưa cấu hình DEEPSEEK_API_KEY trong file .env")
    return OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
    )


def _text(response) -> str:
    return (response.choices[0].message.content or "").strip()


def _format_context(contexts: list[dict]) -> str:
    blocks = []
    for i, c in enumerate(contexts, start=1):
        where = c["filename"] + (f", trang {c['page']}" if c["page"] else "")
        blocks.append(f"[{i}] ({where})\n{c['content']}")
    return "\n\n".join(blocks)


def rewrite_question(question: str, history: list[dict]) -> str:
    """Viết lại câu hỏi nối tiếp thành câu hỏi đầy đủ, dùng để tìm kiếm tài liệu."""
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
        response = _client().chat.completions.create(
            model=settings.llm_model,
            max_tokens=200,
            temperature=0.1,
            messages=[{"role": "user", "content": prompt}],
        )
        return _text(response) or question
    except HTTPException:
        raise
    except Exception:
        return question


def answer_question(
    question: str, contexts: list[dict], history: list[dict] | None = None
) -> str:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        for m in history:
            messages.append({"role": m["role"], "content": m["content"]})
    messages.append(
        {
            "role": "user",
            "content": f"TÀI LIỆU:\n{_format_context(contexts)}\n\nCÂU HỎI: {question}",
        }
    )
    response = _client().chat.completions.create(
        model=settings.llm_model,
        max_tokens=1000,
        temperature=0.3,
        messages=messages,
    )
    return _text(response)
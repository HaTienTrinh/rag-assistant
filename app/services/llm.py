from fastapi import HTTPException
from openai import OpenAI

from app.config import settings

SYSTEM_PROMPT = """Bạn là trợ lý hỏi đáp nội bộ.
Chỉ trả lời dựa trên phần TÀI LIỆU được cung cấp.
Nếu tài liệu không chứa thông tin để trả lời, hãy nói rõ là không tìm thấy trong tài liệu, không tự suy đoán.
Trả lời bằng tiếng Việt, ngắn gọn, và ghi số nguồn như [1], [2] sau mỗi ý lấy từ tài liệu."""


def _format_context(contexts: list[dict]) -> str:
    blocks = []
    for i, c in enumerate(contexts, start=1):
        where = c["filename"] + (f", trang {c['page']}" if c["page"] else "")
        blocks.append(f"[{i}] ({where})\n{c['content']}")
    return "\n\n".join(blocks)


def answer_question(question: str, contexts: list[dict]) -> str:
    if not settings.deepseek_api_key:
        raise HTTPException(500, "Chưa cấu hình DEEPSEEK_API_KEY trong file .env")

    client = OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
    )
    response = client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"TÀI LIỆU:\n{_format_context(contexts)}\n\nCÂU HỎI: {question}",
            },
        ],
        max_tokens=1000,
        temperature=0.3,
    )
    return response.choices[0].message.content or ""
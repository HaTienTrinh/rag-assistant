import logging
import re

from fastapi import HTTPException
from openai import OpenAI

from app.config import settings

logger = logging.getLogger("uvicorn.error")

NOT_FOUND_MARKER = "[KHONG_CO_THONG_TIN]"

SYSTEM_PROMPT = f"""Bạn là trợ lý hỏi đáp nội bộ.
Chỉ trả lời dựa trên phần TÀI LIỆU được cung cấp trong câu hỏi hiện tại, tuyệt đối không tự suy đoán ngoài tài liệu.
Quy tắc trả lời:
1. Trả lời ngay phần mà tài liệu có và nêu rõ phần nào tài liệu không đề cập. Luôn ghi số nguồn như [1], [2] ngay sau mỗi ý lấy từ tài liệu.
2. CHỈ bắt đầu câu trả lời bằng đúng chuỗi {NOT_FOUND_MARKER} khi TÀI LIỆU hoàn toàn không có thông tin liên quan đến câu hỏi, sau đó giải thích ngắn gọn rằng tài liệu không đề cập; khi đó tuyệt đối không ghi số nguồn [n].
3. Trả lời bằng tiếng Việt, ngắn gọn, chuẩn xác. Suy luận súc tích, đối chiếu nhanh câu hỏi với TÀI LIỆU và đưa ra câu trả lời ngay, không phân tích suy diễn lan man để tối ưu thời gian phản hồi.
4. Số nguồn [n] chỉ tham chiếu tới TÀI LIỆU của câu hỏi hiện tại (được đánh số [1], [2],...), không liên quan đến các số nguồn trong lượt trả lời trước."""


def extract_citations(text: str, num_contexts: int) -> list[int]:
    """Trích xuất danh sách các chỉ số trích dẫn [n] hợp lệ (1-indexed) theo thứ tự xuất hiện, không trùng lặp.

    Chấp nhận các định dạng trích dẫn như: [1], [1][2], [1, 2], [1, 2, 3].
    Bỏ qua các chỉ số không hợp lệ so với số đoạn đã gửi (<= 0 hoặc > num_contexts).
    """
    if num_contexts <= 0 or not text:
        return []

    # Tìm các cụm trong ngoặc vuông chỉ chứa chữ số, dấu phẩy và khoảng trắng
    matches = re.findall(r"\[([\d\s,]+)\]", text)
    cited_indices: list[int] = []
    seen: set[int] = set()

    for m in matches:
        # Tách các số nếu được viết gộp dạng [1, 2]
        for part in m.split(","):
            part = part.strip()
            if part.isdigit():
                idx = int(part)
                # Chỉ nhận các chỉ số hợp lệ trong phạm vi đoạn ngữ cảnh và chưa xuất hiện
                if 1 <= idx <= num_contexts and idx not in seen:
                    seen.add(idx)
                    cited_indices.append(idx)

    return cited_indices


_client_instance: OpenAI | None = None


def _client() -> OpenAI:
    """Tái sử dụng một instance OpenAI client duy nhất (Singleton) với Connection Pool (HTTP Keep-Alive).

    Tránh việc liên tục khởi tạo TCP/TLS handshake mới ở mỗi lượt gọi API, tối ưu độ trễ mạng khi deploy.
    """
    global _client_instance
    if _client_instance is None:
        if not settings.deepseek_api_key:
            raise HTTPException(500, "Chưa cấu hình DEEPSEEK_API_KEY trong file .env")
        _client_instance = OpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            timeout=90,
        )
    return _client_instance


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
    """Viết lại câu hỏi nối tiếp thành câu đầy đủ độc lập. Trả về (câu hỏi, token vào, token ra)."""
    transcript = "\n".join(
        f"{'Người dùng' if m['role'] == 'user' else 'Trợ lý'}: {m['content'][:500]}"
        for m in history[-4:]
    )
    messages = [
        {
            "role": "system",
            "content": (
                "Bạn là bộ xử lý làm rõ câu hỏi. Nhiệm vụ duy nhất là viết lại câu hỏi nối tiếp thành câu hỏi đầy đủ độc lập "
                "dựa vào hội thoại trước đó. Chỉ trả về đúng 1 câu hỏi hoàn chỉnh trên 1 dòng, tuyệt đối không suy luận, "
                "không giải thích và không tự trả lời câu hỏi."
            ),
        },
        {
            "role": "user",
            "content": (
                f"HỘI THOẠI:\n{transcript}\n\n"
                f"CÂU HỎI MỚI NHẤT: {question}\n\n"
                "Hãy viết lại câu hỏi mới nhất thành một câu hỏi độc lập (thay các từ như 'nó', 'trường hợp đó' bằng nội dung cụ thể). "
                "Nếu câu hỏi đã đầy đủ thì giữ nguyên. Chỉ xuất ra câu hỏi:"
            ),
        },
    ]
    try:
        text, p, c = _chat(messages, max_tokens=300)
        return (text or question), p, c
    except HTTPException:
        raise
    except Exception:
        return question, 0, 0


def answer_question(
    question: str, contexts: list[dict], history: list[dict] | None = None
) -> dict:
    """Gọi LLM trả lời câu hỏi và quyết định trạng thái `found` cùng danh sách nguồn `sources`.

    - Có ít nhất một trích dẫn hợp lệ: `found = True` (kể cả khi lỡ có nhãn), `sources` chỉ gồm các đoạn được trích dẫn theo thứ tự xuất hiện không trùng lặp.
    - Không có trích dẫn, có nhãn: `found = False`, `sources = None` (ghi UnansweredQuestion với lý do llm_not_found).
    - Không có trích dẫn, không có nhãn: `found = True`, `sources` là tối đa 3 đoạn điểm cao nhất (nguồn tham khảo).
    - Luôn loại bỏ nhãn [KHONG_CO_THONG_TIN] khỏi nội dung câu trả lời trước khi lưu và trả về.
    """
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history or [])
    messages.append(
        {
            "role": "user",
            "content": f"TÀI LIỆU:\n{_format_context(contexts)}\n\nCÂU HỎI: {question}",
        }
    )
    # Dùng max_tokens=4000 để mô hình suy luận (reasoning) có đủ dung lượng cho cả chuỗi suy luận và nội dung trả lời
    raw_text, prompt_tokens, completion_tokens = _chat(messages, max_tokens=4000)

    has_marker = NOT_FOUND_MARKER in raw_text
    cited_indices = extract_citations(raw_text, len(contexts))

    # Luôn loại nhãn khỏi nội dung câu trả lời trước khi lưu và trả về
    clean_text = raw_text.replace(NOT_FOUND_MARKER, "").strip()

    if not clean_text:
        clean_text = "Mô hình không trả về nội dung, vui lòng thử lại."
        found = False
        sources = None
    elif cited_indices:
        # Có ít nhất 1 trích dẫn hợp lệ: found = True, nguồn chỉ gồm các đoạn được trích dẫn theo thứ tự
        found = True
        sources = [contexts[i - 1] for i in cited_indices]
    elif has_marker:
        # Không có trích dẫn và có nhãn: không tìm thấy trong tài liệu
        found = False
        sources = None
    else:
        # Không có trích dẫn và không có nhãn: coi như found = True, lấy tối đa 3 đoạn điểm cao nhất làm nguồn tham khảo
        found = True
        sources = contexts[:3]

    return {
        "text": clean_text,
        "found": found,
        "cited_indices": cited_indices,
        "sources": sources,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
    }


def stream_answer_question(
    question: str, contexts: list[dict], history: list[dict] | None = None
):
    """Gọi LLM với stream=True để sinh câu trả lời từng token (SSE streaming).

    Yields:
        dict: {"type": "token", "text": str} trong suốt quá trình sinh.
        dict: {"type": "final", "text": str, "found": bool, "sources": list | None,
               "cited_indices": list, "prompt_tokens": int, "completion_tokens": int} khi kết thúc.
    """
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history or [])
    messages.append(
        {
            "role": "user",
            "content": f"TÀI LIỆU:\n{_format_context(contexts)}\n\nCÂU HỎI: {question}",
        }
    )

    try:
        response = _client().chat.completions.create(
            model=settings.llm_model,
            messages=messages,
            max_tokens=4000,
            stream=True,
            stream_options={"include_usage": True},
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Lỗi khi gọi DeepSeek API stream")
        raise

    full_text = ""
    prompt_tokens = 0
    completion_tokens = 0
    buffer = ""
    marker_checked = False
    has_marker = False

    for chunk in response:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if hasattr(chunk, "usage") and chunk.usage:
            prompt_tokens = chunk.usage.prompt_tokens or prompt_tokens
            completion_tokens = chunk.usage.completion_tokens or completion_tokens

        if not delta:
            continue

        full_text += delta

        if not marker_checked:
            buffer += delta
            if len(buffer) >= len(NOT_FOUND_MARKER):
                if buffer.startswith(NOT_FOUND_MARKER):
                    has_marker = True
                    remainder = buffer[len(NOT_FOUND_MARKER):]
                    if remainder:
                        yield {"type": "token", "text": remainder}
                else:
                    yield {"type": "token", "text": buffer}
                buffer = ""
                marker_checked = True
            elif not NOT_FOUND_MARKER.startswith(buffer):
                yield {"type": "token", "text": buffer}
                buffer = ""
                marker_checked = True
        else:
            yield {"type": "token", "text": delta}

    if buffer:
        if buffer.startswith(NOT_FOUND_MARKER):
            has_marker = True
            remainder = buffer[len(NOT_FOUND_MARKER):]
            if remainder:
                yield {"type": "token", "text": remainder}
        else:
            yield {"type": "token", "text": buffer}

    clean_text = full_text.replace(NOT_FOUND_MARKER, "").strip()
    cited_indices = extract_citations(full_text, len(contexts))

    if not clean_text:
        clean_text = "Mô hình không trả về nội dung, vui lòng thử lại."
        found = False
        sources = None
    elif cited_indices:
        found = True
        sources = [contexts[i - 1] for i in cited_indices]
    elif has_marker:
        found = False
        sources = None
    else:
        found = True
        sources = contexts[:3]

    yield {
        "type": "final",
        "text": clean_text,
        "found": found,
        "cited_indices": cited_indices,
        "sources": sources,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
    }
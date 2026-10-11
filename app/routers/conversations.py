import json
import logging

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import SessionLocal, get_db
from app.models import Conversation, Message, UnansweredQuestion, User
from app.services.llm import answer_question, rewrite_question, stream_answer_question
from app.services.retrieval import search_chunks

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/conversations", tags=["conversations"])

DEFAULT_TITLE = "Hội thoại mới"
NO_DOCS_TEXT = "Hiện chưa có tài liệu nào đang được bật trong hệ thống."
NOT_FOUND_TEXT = (
    "Mình không tìm thấy thông tin liên quan trong tài liệu hiện có. "
    "Bạn thử diễn đạt lại câu hỏi hoặc liên hệ quản trị viên để bổ sung tài liệu."
)


class CreateBody(BaseModel):
    title: str | None = Field(default=None, max_length=255)


class AskBody(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    stream: bool = False


def _get_owned(db: Session, conv_id: int, user: User) -> Conversation:
    conv = db.scalar(
        select(Conversation).where(
            Conversation.id == conv_id, Conversation.user_id == user.id
        )
    )
    if conv is None:
        raise HTTPException(404, "Không tìm thấy hội thoại")
    return conv


def _serialize_conv(c: Conversation) -> dict:
    return {"id": c.id, "title": c.title, "created_at": c.created_at}


def _serialize_msg(m: Message) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "sources": m.sources,
        "created_at": m.created_at,
    }


def _check_daily_limit(db: Session, user: User) -> None:
    if user.role == "admin":
        return
    limit = user.daily_limit if user.daily_limit is not None else settings.daily_question_limit
    offset_min = settings.display_utc_offset_minutes
    today = (datetime.now(timezone.utc) + timedelta(minutes=offset_min)).date()
    msg_date = func.date(func.date_add(Message.created_at, text(f"INTERVAL {offset_min} MINUTE")))
    used = db.scalar(
        select(func.count(Message.id))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.user_id == user.id,
            Message.role == "user",
            msg_date == today,
        )
    ) or 0
    if used >= limit:
        raise HTTPException(429, f"Bạn đã dùng hết {limit} câu hỏi hôm nay")


@router.get("")
def list_conversations(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = db.scalars(
        select(Conversation)
        .where(Conversation.user_id == user.id)
        .order_by(Conversation.id.desc())
    ).all()
    return [_serialize_conv(c) for c in rows]


@router.post("", status_code=201)
def create_conversation(
    body: CreateBody | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    title = body.title if body and body.title else DEFAULT_TITLE
    conv = Conversation(user_id=user.id, title=title)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _serialize_conv(conv)


@router.get("/{conv_id}/messages")
def get_messages(
    conv_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    conv = _get_owned(db, conv_id, user)
    messages = db.scalars(
        select(Message).where(Message.conversation_id == conv.id).order_by(Message.id)
    ).all()
    return [_serialize_msg(m) for m in messages]


@router.delete("/{conv_id}")
def delete_conversation(
    conv_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    conv = _get_owned(db, conv_id, user)
    db.delete(conv)
    db.commit()
    return {"deleted": conv_id}


def should_rewrite_question(question: str) -> bool:
    """Kiểm tra nhanh xem câu hỏi có chứa các dấu hiệu phụ thuộc ngữ cảnh hội thoại hay không.

    Nếu câu hỏi đã hoàn chỉnh độc lập, bỏ qua bước gọi LLM viết lại để tiết kiệm thời gian phản hồi.
    """
    q_lower = question.lower().strip()
    words = q_lower.split()

    # Nếu câu hỏi rất ngắn (<= 6 từ), khả năng cao là câu hỏi nối tiếp (ví dụ: "thế còn ô tô?", "phạt bao nhiêu?")
    if len(words) <= 6:
        return True

    # Danh sách các từ/cụm từ chỉ định tham chiếu tới ngữ cảnh trước
    context_keywords = [
        "nó", "đó", "này", "kia", "họ", "người này", "người đó",
        "thế còn", "vậy còn", "còn", "trường hợp đó", "trường hợp này",
        "như vậy", "sau đó", "trên", "dưới đây", "thì sao", "được không"
    ]
    return any(kw in q_lower for kw in context_keywords)


def generate_sse_stream(conv_id: int, user_id: int, question: str):
    """Generator sinh các sự kiện SSE phục vụ hiển thị câu trả lời streaming token-by-token."""
    stream_db = SessionLocal()
    try:
        conv = stream_db.get(Conversation, conv_id)
        if not conv:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Không tìm thấy hội thoại'}, ensure_ascii=False)}\n\n"
            return

        recent = stream_db.scalars(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .order_by(Message.id.desc())
            .limit(settings.history_messages)
        ).all()
        history = [{"role": m.role, "content": m.content} for m in reversed(recent)]
        while history and history[0]["role"] != "user":
            history.pop(0)

        prompt_tokens = completion_tokens = 0
        standalone = question
        if history and should_rewrite_question(question):
            try:
                standalone, p, c = rewrite_question(question, history)
                prompt_tokens += p
                completion_tokens += c
            except Exception:
                pass

        hits = search_chunks(stream_db, standalone)
        top_score = hits[0]["score"] if hits else None
        relevant = [h for h in hits if h["score"] >= settings.min_score]

        if not hits:
            answer = NO_DOCS_TEXT
            yield f"data: {json.dumps({'type': 'delta', 'text': answer}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'sources', 'sources': None}, ensure_ascii=False)}\n\n"
            ai_msg = Message(
                conversation_id=conv.id,
                role="assistant",
                content=answer,
                sources=None,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
            stream_db.add(Message(conversation_id=conv.id, role="user", content=question))
            stream_db.add(ai_msg)
            if conv.title == DEFAULT_TITLE:
                conv.title = question[:60]
            stream_db.commit()
            stream_db.refresh(ai_msg)
            yield f"data: {json.dumps({'type': 'done', 'message': _serialize_msg(ai_msg), 'conversation': _serialize_conv(conv)}, default=str, ensure_ascii=False)}\n\n"
            return

        if not relevant:
            answer = NOT_FOUND_TEXT
            yield f"data: {json.dumps({'type': 'delta', 'text': answer}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'sources', 'sources': None}, ensure_ascii=False)}\n\n"
            ai_msg = Message(
                conversation_id=conv.id,
                role="assistant",
                content=answer,
                sources=None,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
            stream_db.add(Message(conversation_id=conv.id, role="user", content=question))
            stream_db.add(ai_msg)
            stream_db.add(UnansweredQuestion(question=standalone, reason="low_score", top_score=top_score))
            if conv.title == DEFAULT_TITLE:
                conv.title = question[:60]
            stream_db.commit()
            stream_db.refresh(ai_msg)
            yield f"data: {json.dumps({'type': 'done', 'message': _serialize_msg(ai_msg), 'conversation': _serialize_conv(conv)}, default=str, ensure_ascii=False)}\n\n"
            return

        final_result = None
        for chunk in stream_answer_question(question, relevant, history):
            if chunk["type"] == "token":
                yield f"data: {json.dumps({'type': 'delta', 'text': chunk['text']}, ensure_ascii=False)}\n\n"
            elif chunk["type"] == "final":
                final_result = chunk

        if not final_result:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Không nhận được nội dung từ AI'}, ensure_ascii=False)}\n\n"
            return

        answer = final_result["text"]
        found = final_result["found"]
        sources = final_result["sources"]
        cited_indices = final_result.get("cited_indices", [])
        prompt_tokens += final_result["prompt_tokens"]
        completion_tokens += final_result["completion_tokens"]

        yield f"data: {json.dumps({'type': 'sources', 'sources': sources}, default=str, ensure_ascii=False)}\n\n"

        reason = "llm_not_found" if not found else None

        if settings.debug_rag:
            top_scores = [h["score"] for h in hits[:3]]
            logger.info(
                "DEBUG_RAG (Stream) - Câu hỏi gốc: %s | Câu viết lại: %s | Điểm 3 đoạn đầu: %s | found: %s | Trích dẫn: %s | 150 ký tự đầu: %s",
                question,
                standalone,
                top_scores,
                found,
                cited_indices,
                answer[:150],
            )

        ai_msg = Message(
            conversation_id=conv.id,
            role="assistant",
            content=answer,
            sources=sources,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
        stream_db.add(Message(conversation_id=conv.id, role="user", content=question))
        stream_db.add(ai_msg)
        if reason:
            stream_db.add(UnansweredQuestion(question=standalone, reason=reason, top_score=top_score))
        if conv.title == DEFAULT_TITLE:
            conv.title = question[:60]
        stream_db.commit()
        stream_db.refresh(ai_msg)

        yield f"data: {json.dumps({'type': 'done', 'message': _serialize_msg(ai_msg), 'conversation': _serialize_conv(conv)}, default=str, ensure_ascii=False)}\n\n"
    except Exception:
        logger.exception("Lỗi khi stream xử lý câu hỏi")
        yield f"data: {json.dumps({'type': 'error', 'message': 'Không xử lý được câu hỏi, vui lòng thử lại sau'}, ensure_ascii=False)}\n\n"
    finally:
        stream_db.close()


@router.post("/{conv_id}/ask")
def ask(
    conv_id: int,
    body: AskBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = _get_owned(db, conv_id, user)
    _check_daily_limit(db, user)
    question = body.question.strip()

    if body.stream:
        return StreamingResponse(
            generate_sse_stream(conv.id, user.id, question),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream; charset=utf-8",
                "X-Accel-Buffering": "no",
            },
        )

    recent = db.scalars(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.id.desc())
        .limit(settings.history_messages)
    ).all()
    history = [{"role": m.role, "content": m.content} for m in reversed(recent)]
    while history and history[0]["role"] != "user":
        history.pop(0)

    prompt_tokens = completion_tokens = 0
    sources = None
    reason = None
    standalone = question
    found = False
    cited_indices: list[int] = []
    hits: list[dict] = []

    try:
        if history and should_rewrite_question(question):
            standalone, p, c = rewrite_question(question, history)
            prompt_tokens += p
            completion_tokens += c


        hits = search_chunks(db, standalone)
        top_score = hits[0]["score"] if hits else None
        relevant = [h for h in hits if h["score"] >= settings.min_score]

        if not hits:
            answer = NO_DOCS_TEXT
        elif not relevant:
            answer, reason = NOT_FOUND_TEXT, "low_score"
        else:
            result = answer_question(question, relevant, history)
            answer = result["text"]
            found = result["found"]
            cited_indices = result.get("cited_indices", [])
            sources = result.get("sources")
            prompt_tokens += result["prompt_tokens"]
            completion_tokens += result["completion_tokens"]
            if not found:
                reason = "llm_not_found"
    except HTTPException:
        raise
    except Exception:
        logger.exception("Lỗi khi xử lý câu hỏi")
        raise HTTPException(502, "Không xử lý được câu hỏi, vui lòng thử lại sau")

    # Nhật ký chẩn đoán RAG khi bật DEBUG_RAG: chỉ ghi tóm tắt cần thiết, không ghi token hay API key
    if settings.debug_rag:
        top_scores = [h["score"] for h in hits[:3]]
        logger.info(
            "DEBUG_RAG - Câu hỏi gốc: %s | Câu viết lại: %s | Điểm 3 đoạn đầu: %s | found: %s | Trích dẫn: %s | 150 ký tự đầu câu trả lời: %s",
            question,
            standalone,
            top_scores,
            found,
            cited_indices,
            answer[:150],
        )

    ai_msg = Message(
        conversation_id=conv.id,
        role="assistant",
        content=answer,
        sources=sources,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )
    db.add(Message(conversation_id=conv.id, role="user", content=question))
    db.add(ai_msg)
    if reason:
        db.add(UnansweredQuestion(question=standalone, reason=reason, top_score=top_score))
    if conv.title == DEFAULT_TITLE:
        conv.title = question[:60]
    db.commit()
    db.refresh(ai_msg)

    return {"message": _serialize_msg(ai_msg), "conversation": _serialize_conv(conv)}
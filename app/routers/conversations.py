import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import Conversation, Message, UnansweredQuestion, User
from app.services.llm import answer_question, rewrite_question
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
    used = db.scalar(
        select(func.count(Message.id))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.user_id == user.id,
            Message.role == "user",
            func.date(Message.created_at) == func.curdate(),
        )
    )
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

    try:
        if history:
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
            prompt_tokens += result["prompt_tokens"]
            completion_tokens += result["completion_tokens"]
            if result["found"]:
                sources = relevant
            else:
                reason = "llm_not_found"
    except HTTPException:
        raise
    except Exception:
        logger.exception("Lỗi khi xử lý câu hỏi")
        raise HTTPException(502, "Không xử lý được câu hỏi, vui lòng thử lại sau")

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
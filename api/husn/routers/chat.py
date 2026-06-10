"""Chat endpoints — sessions + messages, backed by Groq via husn.agent.chat."""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import asc, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from husn.agent.chat import CHAT_HISTORY_TURNS, run_chat_turn
from husn.auth.deps import AuthContext, require_member
from husn.db.models import ChatMessage, ChatSession, Project
from husn.db.session import get_session
from husn.graph.projects import get_or_create_default_project

router = APIRouter(prefix="/api/chat", tags=["chat"])


async def _get_owned_session(
    session: AsyncSession, session_id: int, ctx: AuthContext
) -> ChatSession:
    """Fetch a chat session the caller owns, or 404.

    Chat is PER-USER (anti-monitoring, TENANCY.md §9): wrong tenant OR wrong
    user → 404, with no admin override. Bridge mode (tenant_id None) skips
    the ownership check so pre-cutover behavior is unchanged.
    """
    sess = await session.get(ChatSession, session_id)
    if not sess:
        raise HTTPException(404, "session not found")
    if ctx.tenant_id is not None and (
        sess.tenant_id != ctx.tenant_id or sess.user_id != ctx.user_id
    ):
        raise HTTPException(404, "session not found")
    return sess


@router.get("/sessions")
async def list_sessions(
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    stmt = select(ChatSession).order_by(desc(ChatSession.updated_at)).limit(50)
    if ctx.tenant_id is not None:
        # Per-user: members (and admins — no override) see only their own.
        stmt = stmt.where(
            ChatSession.tenant_id == ctx.tenant_id,
            ChatSession.user_id == ctx.user_id,
        )
    rows = (await session.execute(stmt)).scalars().all()
    return {
        "count": len(rows),
        "items": [
            {
                "id": s.id,
                "project_id": s.project_id,
                "title": s.title,
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat(),
            }
            for s in rows
        ],
    }


class CreateSessionBody(BaseModel):
    project_id: int | None = None
    title: str | None = None


@router.post("/sessions")
async def create_session(
    body: CreateSessionBody,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    project_id = body.project_id
    if project_id is None:
        project = await get_or_create_default_project(session, tenant_id=ctx.tenant_id)
        project_id = project.id
    else:
        project = await session.get(Project, project_id)
        if not project or (
            ctx.tenant_id is not None and project.tenant_id != ctx.tenant_id
        ):
            raise HTTPException(404, f"project {project_id} not found")

    sess = ChatSession(
        project_id=project_id,
        title=body.title or "(untitled)",
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
    )
    session.add(sess)
    await session.commit()
    return {"id": sess.id, "project_id": sess.project_id, "title": sess.title}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    sess = await _get_owned_session(session, session_id, ctx)
    # Delete messages too (no FK CASCADE on the table; do it explicitly)
    msgs = (
        await session.execute(select(ChatMessage).where(ChatMessage.session_id == session_id))
    ).scalars().all()
    for m in msgs:
        await session.delete(m)
    await session.delete(sess)
    await session.commit()
    return {"removed": True}


@router.get("/sessions/{session_id}/messages")
async def list_messages(
    session_id: int,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    sess = await _get_owned_session(session, session_id, ctx)
    rows = (
        await session.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(asc(ChatMessage.created_at))
        )
    ).scalars().all()
    return {
        "session": {
            "id": sess.id,
            "project_id": sess.project_id,
            "title": sess.title,
        },
        "count": len(rows),
        "items": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "cited_claim_ids": m.cited_claim_ids or [],
                "cited_artifact_ids": m.cited_artifact_ids or [],
                "model": m.model,
                "input_tokens": m.input_tokens,
                "output_tokens": m.output_tokens,
                "created_at": m.created_at.isoformat(),
            }
            for m in rows
        ],
    }


class SendMessageBody(BaseModel):
    content: str


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: int,
    body: SendMessageBody,
    session: AsyncSession = Depends(get_session),
    ctx: AuthContext = Depends(require_member),
) -> dict[str, Any]:
    """User sends a message → server saves it, builds dossier + recent history,
    calls the LLM, saves the assistant reply, returns the assistant turn.
    """
    sess = await _get_owned_session(session, session_id, ctx)
    if not body.content.strip():
        raise HTTPException(400, "empty message")

    # 1. Persist user turn
    user_msg = ChatMessage(session_id=session_id, role="user", content=body.content.strip())
    session.add(user_msg)
    await session.flush()

    # First-message → auto-title from the user's question
    if sess.title == "(untitled)":
        sess.title = body.content.strip()[:80]

    await session.commit()

    # 2. Build trimmed history for the LLM (most recent CHAT_HISTORY_TURNS turns,
    #    EXCLUDING the user message we just inserted — that goes in as `user_message`)
    history_rows = (
        await session.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id, ChatMessage.id < user_msg.id)
            .order_by(desc(ChatMessage.created_at))
            .limit(CHAT_HISTORY_TURNS)
        )
    ).scalars().all()
    history = [
        {"role": m.role, "content": m.content}
        for m in reversed(history_rows)
        if m.role in ("user", "assistant")
    ]

    # 3. Call the LLM
    try:
        result = await run_chat_turn(
            session,
            project_id=sess.project_id or (await get_or_create_default_project(session, tenant_id=ctx.tenant_id)).id,
            history=history,
            user_message=body.content.strip(),
        )
    except Exception as e:
        # Surface the failure as an assistant turn so the chat UX shows it
        assistant_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=f"_Sorry — the agent failed: {type(e).__name__}: {str(e)[:200]}_",
        )
        session.add(assistant_msg)
        await session.commit()
        raise HTTPException(502, f"agent failure: {type(e).__name__}: {str(e)[:300]}") from e

    # 4. Persist assistant turn with citations
    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=result["reply"],
        cited_claim_ids=result["cited_claim_ids"],
        cited_artifact_ids=result["cited_artifact_ids"],
        model=result["model"],
        input_tokens=result["input_tokens"],
        output_tokens=result["output_tokens"],
    )
    session.add(assistant_msg)
    sess.updated_at = datetime.now(UTC)
    await session.commit()

    return {
        "id": assistant_msg.id,
        "role": "assistant",
        "content": assistant_msg.content,
        "cited_claim_ids": assistant_msg.cited_claim_ids,
        "cited_artifact_ids": assistant_msg.cited_artifact_ids,
        "model": assistant_msg.model,
        "input_tokens": assistant_msg.input_tokens,
        "output_tokens": assistant_msg.output_tokens,
        "created_at": assistant_msg.created_at.isoformat(),
    }

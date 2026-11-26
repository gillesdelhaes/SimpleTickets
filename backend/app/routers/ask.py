"""
Ask: chat about the ticket data (technicians and admins).

  GET    /ask/status                  can Ask answer now, and how much is labelled
  GET    /ask/digest                  "This week" panel — tools only, no AI
  GET    /ask/threads                 my conversations
  GET    /ask/threads/{id}            one, with its messages
  PATCH  /ask/threads/{id}            change its period (days)
  DELETE /ask/threads/{id}
  POST   /ask/ask                     ask a question; streams progress, then the
                                      answer (server-sent events)
  POST   /ask/messages/{id}/feedback  thumbs up / down
  GET    /ask/pins                    my pinned answers
  POST   /ask/pins                    pin an answer (its tool calls are kept)
  GET    /ask/pins/{id}/run           re-run a pinned answer's tools — no AI
  DELETE /ask/pins/{id}

Changes Ask suggests are made only when someone confirms them in the UI:
  POST   /ask/actions/recategorize      move tickets to a category
  POST   /ask/actions/create-category   create a category and move every ticket of a topic into it, all time (admin)
  POST   /ask/actions/merge-category    move every ticket to another category and archive this one (admin)

Category moves apply to all of history and never reopen anything: closed
tickets only get their category changed. Each move is in the ticket's history
and the audit log; as data clean-up they don't post to Slack threads or show
in the dashboard's Recent activity.
"""
import asyncio
import json
import logging
from types import SimpleNamespace
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.ask import MAX_QUESTION_CHARS, run_ask
from app.ai.ask_tools import TOOLS_BY_NAME, AskDeps
from app.ai.client import AIError, tokens_used_today
from app.ai.config import load_config
from app.ai.labels import coverage
from app.auth.deps import require_technician
from app.database import AsyncSessionLocal, get_session
from app.dt import utcnow
from app.models import Category, Ticket, TicketHistory, User
from app.models.ask import AskMessage, AskPin, AskThread
from app.models.enums import Role
from app.models.insight import TicketInsight
from app.models.ticket_status_config import TicketStatusConfig
from app.services import reports as svc
from app.services.audit import write_audit
from app.services.rate_limit import RateLimiter
from app.utils import client_ip

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ask", tags=["ask"])

_ask_limiter = RateLimiter(limit=20, window_seconds=60)
_DAYS = Literal[7, 14, 30, 60, 90, 180, 365]
_MAX_MOVE = 200


# ── Serialising ───────────────────────────────────────────────────────────────


def _loads(raw: Optional[str], default):
    try:
        return json.loads(raw) if raw else default
    except ValueError:
        return default


def message_out(m: AskMessage) -> dict:
    return {
        "id": m.id, "role": m.role, "text": m.text, "error": m.error,
        "blocks": _loads(m.blocks, []), "follow_ups": _loads(m.follow_ups, []),
        "can_pin": bool(m.calls and _loads(m.calls, [])),
        "unverified": m.unverified, "helpful": m.helpful,
        "created_at": m.created_at.isoformat() + "Z",
    }


def thread_out(t: AskThread) -> dict:
    return {"id": t.id, "title": t.title, "days": t.days, "updated_at": t.updated_at.isoformat() + "Z"}


async def _own_thread(session: AsyncSession, thread_id: int, user: User) -> AskThread:
    thread = await session.get(AskThread, thread_id)
    if thread is None or thread.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return thread


# ── Status & digest ───────────────────────────────────────────────────────────


@router.get("/status")
async def ask_status(
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    cfg = await load_config(session)
    reason = None
    if not cfg.configured:
        reason = "The AI provider isn't set up yet."
    elif not cfg.enabled:
        reason = "The AI assistant is switched off."
    f = await svc.last_days(90, session)
    return {
        "available": reason is None,
        "reason": reason,
        "is_admin": user.role == Role.admin,
        "coverage_90_days": await coverage(session, f.start, f.end),
        "tokens_today": await tokens_used_today(),
        "daily_budget": cfg.daily_token_budget,
    }


def _ctx(days: int, is_admin: bool) -> SimpleNamespace:
    """What a tool needs when it's called directly, without a model."""
    return SimpleNamespace(deps=AskDeps(days=days, is_admin=is_admin))


@router.get("/digest")
async def digest(user: User = Depends(require_technician)) -> dict:
    """A few numbers worth a look, from the tools alone (no AI, no tokens)."""
    ctx = _ctx(30, user.role == Role.admin)
    out: dict = {}
    for key, tool, args in [
        ("rising", "top_topics", {"order": "growing", "limit": 3}),
        ("categories", "category_health", {}),
        ("backlog", "backlog", {}),
        ("suggestions", "category_suggestions", {"days": 90}),
    ]:
        try:
            await TOOLS_BY_NAME[tool](ctx, **args)
            out[key] = ctx.deps.results[-1]
        except Exception:  # noqa: BLE001
            logger.exception("Ask digest: %s failed", tool)
    return {
        "rising": [i["topic"] + f" ({i['last_14_days']} in 14 days)" for i in
                   (out.get("rising") or {}).get("data", {}).get("items", [])],
        "misfiled": (out.get("categories") or {}).get("summary", {}).get("likely_misfiled"),
        "stuck": (out.get("backlog") or {}).get("summary", {}).get("stuck_5_days"),
        "open": (out.get("backlog") or {}).get("summary", {}).get("open"),
        "suggestions": (out.get("suggestions") or {}).get("summary", {}).get("suggestions"),
    }


# ── Threads ───────────────────────────────────────────────────────────────────


@router.get("/threads")
async def list_threads(
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(
        select(AskThread).where(AskThread.user_id == user.id).order_by(AskThread.updated_at.desc()).limit(50)
    )).scalars().all()
    return [thread_out(t) for t in rows]


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: int,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    thread = await _own_thread(session, thread_id, user)
    messages = (await session.execute(
        select(AskMessage).where(AskMessage.thread_id == thread.id).order_by(AskMessage.id)
    )).scalars().all()
    return {**thread_out(thread), "messages": [message_out(m) for m in messages]}


class ThreadUpdate(BaseModel):
    days: _DAYS


@router.patch("/threads/{thread_id}")
async def update_thread(
    thread_id: int,
    body: ThreadUpdate,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    thread = await _own_thread(session, thread_id, user)
    thread.days = body.days
    await session.commit()
    return thread_out(thread)


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_thread(
    thread_id: int,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> None:
    thread = await _own_thread(session, thread_id, user)
    await session.delete(thread)
    await session.commit()


# ── Asking ────────────────────────────────────────────────────────────────────


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    thread_id: Optional[int] = None
    days: Optional[_DAYS] = None


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, default=str)}\n\n"


@router.post("/ask")
async def ask(body: AskRequest, user: User = Depends(require_technician)) -> StreamingResponse:
    _ask_limiter.check(f"ask:{user.id}")
    question = " ".join(body.question.split())
    if not question:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ask a question")

    async with AsyncSessionLocal() as session:
        cfg = await load_config(session)
        if not (cfg.enabled and cfg.configured):
            raise HTTPException(status.HTTP_409_CONFLICT, "The AI assistant is off or not set up.")
        if body.thread_id is not None:
            thread = await _own_thread(session, body.thread_id, user)
            if body.days:
                thread.days = body.days
        else:
            thread = AskThread(user_id=user.id, title=question[:80], days=body.days or 90)
            session.add(thread)
            await session.flush()
        earlier = (await session.execute(
            select(AskMessage).where(AskMessage.thread_id == thread.id).order_by(AskMessage.id)
        )).scalars().all()
        history, pending = [], None
        for m in earlier:
            if m.role == "user":
                pending = m.text
            elif pending is not None and not m.error:
                history.append((pending, m.text))
                pending = None
        user_msg = AskMessage(thread_id=thread.id, role="user", text=question)
        session.add(user_msg)
        thread.updated_at = utcnow()
        await session.commit()
        thread_id, days = thread.id, thread.days
        user_out = message_out(user_msg)

    queue: asyncio.Queue = asyncio.Queue()

    async def on_step(text: str) -> None:
        await queue.put(("step", {"text": text}))

    async def work() -> None:
        reply = AskMessage(thread_id=thread_id, role="assistant")
        try:
            run = await run_ask(cfg, question=question, days=days, history=history,
                                is_admin=user.role == Role.admin, on_step=on_step)
            reply.text = run.text
            reply.blocks = json.dumps(run.shown, default=str)
            reply.calls = json.dumps(run.calls, default=str)
            reply.follow_ups = json.dumps(run.follow_ups)
            reply.unverified = bool(run.unverified)
            reply.input_tokens, reply.output_tokens = run.input_tokens, run.output_tokens
            if run.unverified:
                logger.info("Ask: numbers not found in tool results: %s", run.unverified)
        except AIError as exc:
            reply.error = str(exc)
        except Exception:  # noqa: BLE001
            logger.exception("Ask: question failed")
            reply.error = "Something went wrong answering this. Try again."
        try:
            async with AsyncSessionLocal() as session:
                session.add(reply)
                t = await session.get(AskThread, thread_id)
                if t is not None:
                    t.updated_at = utcnow()
                await session.commit()
                await session.refresh(reply)
            await queue.put(("message", message_out(reply)))
        except Exception:  # noqa: BLE001
            logger.exception("Ask: saving the answer failed")
            await queue.put(("error", {"message": "The answer couldn't be saved."}))
        finally:
            await queue.put(None)

    async def stream():
        # The work carries on if the browser goes away; the answer is saved
        task = asyncio.create_task(work())
        yield _event("start", {"thread_id": thread_id, "days": days, "question": user_out})
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=15)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if item is None:
                break
            yield _event(*item)
        await task

    return StreamingResponse(
        stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class Feedback(BaseModel):
    helpful: Optional[bool]


@router.post("/messages/{message_id}/feedback")
async def feedback(
    message_id: int,
    body: Feedback,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    msg = await session.get(AskMessage, message_id)
    if msg is None or msg.role != "assistant":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")
    await _own_thread(session, msg.thread_id, user)
    msg.helpful = body.helpful
    await session.commit()
    return {"helpful": msg.helpful}


# ── Pins ──────────────────────────────────────────────────────────────────────


class PinCreate(BaseModel):
    message_id: int
    title: str = Field(min_length=1, max_length=120)


def pin_out(p: AskPin) -> dict:
    return {"id": p.id, "title": p.title, "question": p.question, "days": p.days,
            "created_at": p.created_at.isoformat() + "Z"}


@router.get("/pins")
async def list_pins(
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(
        select(AskPin).where(AskPin.user_id == user.id).order_by(AskPin.created_at.desc())
    )).scalars().all()
    return [pin_out(p) for p in rows]


@router.post("/pins", status_code=status.HTTP_201_CREATED)
async def create_pin(
    body: PinCreate,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    msg = await session.get(AskMessage, body.message_id)
    if msg is None or msg.role != "assistant" or not msg.calls:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")
    thread = await _own_thread(session, msg.thread_id, user)
    question = (await session.execute(
        select(AskMessage.text).where(AskMessage.thread_id == thread.id, AskMessage.role == "user",
                                      AskMessage.id < msg.id).order_by(AskMessage.id.desc()).limit(1)
    )).scalar() or ""
    if (await session.execute(select(func.count()).where(AskPin.user_id == user.id))).scalar() >= 30:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can pin up to 30 answers. Unpin one first.")
    pin = AskPin(user_id=user.id, title=body.title.strip(), question=question, calls=msg.calls, days=thread.days)
    session.add(pin)
    await session.commit()
    return pin_out(pin)


@router.get("/pins/{pin_id}/run")
async def run_pin(
    pin_id: int,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    pin = await session.get(AskPin, pin_id)
    if pin is None or pin.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pinned answer not found")
    ctx = _ctx(pin.days, user.role == Role.admin)
    for call in _loads(pin.calls, []):
        tool = TOOLS_BY_NAME.get(call.get("tool"))
        if tool is None:
            continue
        try:
            await tool(ctx, **(call.get("args") or {}))
        except Exception:  # noqa: BLE001
            logger.exception("Ask: pinned tool %s failed", call.get("tool"))
    return {**pin_out(pin), "blocks": ctx.deps.results}


@router.delete("/pins/{pin_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pin(
    pin_id: int,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> None:
    await session.execute(delete(AskPin).where(AskPin.id == pin_id, AskPin.user_id == user.id))
    await session.commit()


# ── Actions (always confirmed by a person in the UI) ──────────────────────────


class Recategorize(BaseModel):
    ticket_ids: list[int] = Field(min_length=1, max_length=_MAX_MOVE)
    category_id: int


class CreateCategory(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    # Every ticket with this topic, all time (what Ask's "add" suggestion uses)
    topic_id: Optional[int] = None
    ticket_ids: list[int] = Field(default_factory=list, max_length=_MAX_MOVE)


class MergeCategory(BaseModel):
    from_id: int
    into_id: int


# Shown in each ticket's history next to the person's name; kept out of the
# dashboard's Recent activity so a clean-up of hundreds of tickets doesn't
# bury the day's real work
CLEANUP_LABEL = "Category clean-up (Ask)"
_CHUNK = 1000


def _require_admin(user: User) -> None:
    if user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can change the category list.")


async def _move(session: AsyncSession, user: User, ticket_ids: list[int], category: Category,
                *, include_resolved: bool, topic_home: bool = False) -> dict:
    """Move tickets to `category`, whatever their age.

    Only the category changes. Resolved and closed tickets stay resolved and
    closed (no reopening, no survey, no Slack post) and keep their "last
    updated" time, so a clean-up of old tickets doesn't make them look
    active. Each move is in the ticket's history.

    Technicians can't change resolved tickets (as on the ticket page); admins
    can, so the whole history can be made consistent. With topic_home, the
    tickets were picked by topic for this category, so their labels are
    updated to say it's their best fit (no need to re-read them)."""
    resolved = set((await session.execute(
        select(TicketStatusConfig.name).where(TicketStatusConfig.is_resolved_state == True)  # noqa: E712
    )).scalars())
    wanted = list(dict.fromkeys(ticket_ids))
    rows = []
    for i in range(0, len(wanted), _CHUNK):
        rows += (await session.execute(
            select(Ticket.id, Ticket.category_id, Ticket.status).where(Ticket.id.in_(wanted[i:i + _CHUNK]))
        )).all()
    now = utcnow()
    active, closed = [], []
    unchanged = skipped_resolved = 0
    for r in rows:
        if r.category_id == category.id:
            unchanged += 1
            continue
        is_resolved = r.status in resolved
        if is_resolved and not include_resolved:
            skipped_resolved += 1
            continue
        session.add(TicketHistory(
            ticket_id=r.id, actor_id=user.id, actor_label=CLEANUP_LABEL, field_changed="category_id",
            old_value=str(r.category_id) if r.category_id else None, new_value=str(category.id), created_at=now,
        ))
        (closed if is_resolved else active).append(r.id)
    for ids, values in ((active, {"category_id": category.id, "updated_at": now}),
                        (closed, {"category_id": category.id})):
        for i in range(0, len(ids), _CHUNK):
            await session.execute(update(Ticket).where(Ticket.id.in_(ids[i:i + _CHUNK])).values(**values))
    moved = active + closed
    for i in range(0, len(moved), _CHUNK):
        chunk = moved[i:i + _CHUNK]
        if topic_home:
            await session.execute(update(TicketInsight).where(TicketInsight.ticket_id.in_(chunk)).values(
                best_category_id=category.id, labelled_category_id=category.id, fit="high"))
        else:
            # Where the label already said this is the right home, it still holds
            await session.execute(update(TicketInsight).where(
                TicketInsight.ticket_id.in_(chunk), TicketInsight.best_category_id == category.id,
            ).values(labelled_category_id=category.id, fit="high"))
    return {"moved": len(moved), "moved_closed": len(closed), "skipped_resolved": skipped_resolved,
            "unchanged": unchanged, "not_found": len(wanted) - len(rows)}


@router.post("/actions/recategorize")
async def recategorize(
    body: Recategorize,
    request: Request,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    category = await session.get(Category, body.category_id)
    if category is None or category.is_archived:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Category not found or archived")
    result = await _move(session, user, body.ticket_ids, category, include_resolved=user.role == Role.admin)
    await write_audit(session, actor_id=user.id, action="ask.recategorized", entity_type="category",
                      entity_id=category.id, payload={"category": category.name, **result},
                      ip_address=client_ip(request))
    await session.commit()
    return result


@router.post("/actions/create-category")
async def create_category(
    body: CreateCategory,
    request: Request,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_admin(user)
    name = " ".join(body.name.split())
    if (await session.execute(select(Category).where(func.lower(Category.name) == name.lower()))).scalars().first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"A category named '{name}' already exists")
    category = Category(name=name)
    session.add(category)
    await session.flush()
    await write_audit(session, actor_id=user.id, action="category.created", entity_type="category",
                      entity_id=category.id, payload={"name": name, "via": "ask"}, ip_address=client_ip(request))
    result = {"moved": 0, "moved_closed": 0, "skipped_resolved": 0, "unchanged": 0, "not_found": 0}
    ids = list(body.ticket_ids)
    if body.topic_id is not None:
        ids = list((await session.execute(
            select(TicketInsight.ticket_id).where(TicketInsight.topic_id == body.topic_id)
        )).scalars())
    if ids:
        result = await _move(session, user, ids, category, include_resolved=True,
                             topic_home=body.topic_id is not None)
        await write_audit(session, actor_id=user.id, action="ask.recategorized", entity_type="category",
                          entity_id=category.id, payload={"category": name, **result}, ip_address=client_ip(request))
    await session.commit()
    return {"category": {"id": category.id, "name": category.name}, **result}


@router.post("/actions/merge-category")
async def merge_category(
    body: MergeCategory,
    request: Request,
    user: User = Depends(require_technician),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_admin(user)
    if body.from_id == body.into_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick two different categories")
    source = await session.get(Category, body.from_id)
    target = await session.get(Category, body.into_id)
    if source is None or target is None or target.is_archived:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Category not found or archived")
    ids = list((await session.execute(select(Ticket.id).where(Ticket.category_id == source.id))).scalars())
    # Labels that pointed at the merged category now point at its successor
    await session.execute(update(TicketInsight).where(TicketInsight.best_category_id == source.id)
                          .values(best_category_id=target.id))
    result = await _move(session, user, ids, target, include_resolved=True) if ids else \
        {"moved": 0, "moved_closed": 0, "skipped_resolved": 0, "unchanged": 0, "not_found": 0}
    source.is_archived = True
    await write_audit(session, actor_id=user.id, action="category.updated", entity_type="category",
                      entity_id=source.id,
                      payload={"archived": {"from": False, "to": True}, "merged_into": target.name, "via": "ask", **result},
                      ip_address=client_ip(request))
    await session.commit()
    return {"archived": source.name, "into": target.name, **result}

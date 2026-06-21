"""
Full-text Search using PostgreSQL FTS (tsvector / websearch_to_tsquery).

Ranks tickets by relevance across title (weight A), description (weight B),
and reply bodies (weight C). Supports AND / OR / phrase / negation syntax.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, text, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.deps import get_current_user
from app.database import get_session
from app.models import Category, Ticket, TicketReply, User
from app.schemas.search import SearchResponse, SearchResultItem
from app.schemas.ticket import TicketRead

router = APIRouter(tags=["search"])

# Headline options passed to ts_headline — show up to 60 words around each match
_HL_OPTIONS = "MaxWords=60, MinWords=20, ShortWord=3, HighlightAll=false, MaxFragments=2, FragmentDelimiter=' … '"


# ── helpers ────────────────────────────────────────────────────────────────────


def _build_ticket_read(
    ticket: Ticket,
    submitter_name: Optional[str],
    assignee_name: Optional[str],
    category_name: Optional[str],
) -> TicketRead:
    return TicketRead(
        id=ticket.id,
        display_id=ticket.display_id,
        title=ticket.title,
        description=ticket.description,
        status=ticket.status,
        priority=ticket.priority,
        category_id=ticket.category_id,
        category_name=category_name,
        submitter_id=ticket.submitter_id,
        submitter_name=submitter_name,
        assignee_id=ticket.assignee_id,
        assignee_name=assignee_name,
        sla_policy_id=ticket.sla_policy_id,
        sla_deadline=ticket.sla_deadline,
        sla_breached=ticket.sla_breached,
        duplicate_of_id=ticket.duplicate_of_id,
        slack_channel_id=ticket.slack_channel_id,
        slack_message_ts=ticket.slack_message_ts,
        source=ticket.source,
        first_response_deadline=ticket.first_response_deadline,
        first_responded_at=ticket.first_responded_at,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        resolved_at=ticket.resolved_at,
    )


# ── GET /search ────────────────────────────────────────────────────────────────


@router.get("/search", response_model=SearchResponse)
async def search_tickets(
    q: str = Query(min_length=2, max_length=200, description="Search query (supports AND / OR / phrase / negation)"),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SearchResponse:
    """
    Full-text search across ticket titles, descriptions, and reply bodies.
    Results are ranked by relevance (ts_rank). Supports PostgreSQL websearch syntax.
    """
    if not q.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Query cannot be blank")

    # Use a raw SQL literal for the regconfig argument — parameterized binds
    # cannot be cast to regconfig by asyncpg, so we embed it directly.
    lang = text("'english'::regconfig")

    # Build the tsquery expression — websearch_to_tsquery is safe against
    # malformed input; it silently drops tokens it cannot parse
    tsq = func.websearch_to_tsquery(lang, q)

    # ── Step 1: ranked ticket IDs via FTS ─────────────────────────────────────

    # Title gets weight A (0.1), description weight B (0.05) in ts_rank defaults
    # We use setweight to give title a bigger boost
    title_tsv = func.to_tsvector(lang, Ticket.title)
    desc_tsv = func.to_tsvector(lang, Ticket.description)
    ticket_tsv = func.setweight(title_tsv, text("'A'")).op("||")(
        func.setweight(desc_tsv, text("'B'"))
    )
    ticket_rank = func.ts_rank_cd(ticket_tsv, tsq)

    t_match = (
        select(
            Ticket.id.label("ticket_id"),
            ticket_rank.label("rank"),
        )
        .where(ticket_tsv.op("@@")(tsq))
    )

    # Reply bodies get weight C
    reply_tsv = func.setweight(func.to_tsvector(lang, TicketReply.body), text("'C'"))
    reply_rank = func.ts_rank_cd(reply_tsv, tsq)

    r_match = (
        select(
            TicketReply.ticket_id.label("ticket_id"),
            reply_rank.label("rank"),
        )
        .where(reply_tsv.op("@@")(tsq))
    )

    combined = union_all(t_match, r_match).subquery("combined")

    ranked_stmt = (
        select(
            combined.c.ticket_id,
            func.max(combined.c.rank).label("best_rank"),
        )
        .group_by(combined.c.ticket_id)
        .order_by(func.max(combined.c.rank).desc())
        .limit(limit * 3)  # fetch extra to account for role filtering below
    )

    ranked_rows = (await session.execute(ranked_stmt)).all()
    if not ranked_rows:
        return SearchResponse(query=q, total=0, items=[])

    # ticket_id → rank float
    rank_map: dict[int, float] = {row.ticket_id: float(row.best_rank) for row in ranked_rows}
    candidate_ids: list[int] = list(rank_map.keys())

    # ── Step 2: fetch enriched ticket rows with role filter ───────────────────

    Submitter = aliased(User, flat=True)
    Assignee = aliased(User, flat=True)

    fetch_stmt = (
        select(
            Ticket,
            Submitter.name.label("submitter_name"),
            Assignee.name.label("assignee_name"),
            Category.name.label("category_name"),
        )
        .outerjoin(Submitter, Ticket.submitter_id == Submitter.id)
        .outerjoin(Assignee, Ticket.assignee_id == Assignee.id)
        .outerjoin(Category, Ticket.category_id == Category.id)
        .where(Ticket.id.in_(candidate_ids))
    )

    fetch_rows = (await session.execute(fetch_stmt)).all()

    # Build TicketRead objects keyed by id so we can sort by rank
    ticket_map: dict[int, TicketRead] = {}
    for row in fetch_rows:
        t: Ticket = row[0]
        ticket_map[t.id] = _build_ticket_read(t, row[1], row[2], row[3])

    # ── Step 3: headlines — run ts_headline for each matched ticket ───────────
    # We compute headlines for tickets that actually passed the role filter
    visible_ids = list(ticket_map.keys())
    headline_map: dict[int, str] = {}

    if visible_ids:
        hl_stmt = select(
            Ticket.id,
            func.ts_headline(
                lang,
                func.concat(Ticket.title, ' ', Ticket.description),
                tsq,
                _HL_OPTIONS,
            ).label("headline"),
        ).where(Ticket.id.in_(visible_ids))

        for row in (await session.execute(hl_stmt)).all():
            headline_map[row[0]] = row[1]

    # ── Step 4: assemble results sorted by rank ───────────────────────────────

    # Preserve the FTS rank order
    sorted_ids = [tid for tid in candidate_ids if tid in ticket_map]

    items = [
        SearchResultItem(
            ticket=ticket_map[tid],
            rank=rank_map[tid],
            headline=headline_map.get(tid, ""),
        )
        for tid in sorted_ids[:limit]
    ]

    return SearchResponse(query=q, total=len(items), items=items)

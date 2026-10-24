from pydantic import BaseModel

from app.schemas.ticket import TicketRead


class SearchResultItem(BaseModel):
    ticket: TicketRead
    rank: float
    headline: str  # ts_headline snippet with <b> highlights
    matched_requester: bool = False  # matched on who filed it, not the text


class SearchResponse(BaseModel):
    query: str
    total: int
    items: list[SearchResultItem]

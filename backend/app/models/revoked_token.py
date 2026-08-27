from datetime import datetime

from sqlmodel import Field, SQLModel


class RevokedToken(SQLModel, table=True):
    """
    JWT ids (jti) revoked by an explicit logout, checked on every request in
    get_current_user. Rows are safe to prune once expires_at (copied from the
    token's own exp claim) has passed — see auth.jwt.prune_revoked_tokens.
    """
    __tablename__ = "revoked_tokens"

    jti: str = Field(primary_key=True)
    expires_at: datetime

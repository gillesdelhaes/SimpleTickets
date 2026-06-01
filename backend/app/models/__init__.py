# Import all table models here so that:
#   1. SQLModel.metadata is fully populated before Alembic runs
#   2. A single `from app.models import ...` covers all models elsewhere
from app.models.enums import (  # noqa: F401
    AuthProvider,
    Priority,
    Role,
    TicketStatus,
)
from app.models.user import User  # noqa: F401
from app.models.category import Category  # noqa: F401
from app.models.sla_policy import SLAPolicy  # noqa: F401
from app.models.ticket import Ticket  # noqa: F401
from app.models.ticket_reply import TicketReply  # noqa: F401
from app.models.ticket_history import TicketHistory  # noqa: F401
from app.models.ticket_attachment import TicketAttachment  # noqa: F401
from app.models.audit_log import AuditLog  # noqa: F401
from app.models.app_setting import AppSetting  # noqa: F401
from app.models.ticket_read_marker import TicketReadMarker  # noqa: F401
from app.models.ticket_status_config import TicketStatusConfig  # noqa: F401

__all__ = [
    "AuthProvider",
    "Priority",
    "Role",
    "TicketStatus",
    "User",
    "Category",
    "SLAPolicy",
    "Ticket",
    "TicketReply",
    "TicketHistory",
    "TicketAttachment",
    "AuditLog",
    "AppSetting",
    "TicketReadMarker",
    "TicketStatusConfig",
]

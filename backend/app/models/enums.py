from enum import Enum


class Role(str, Enum):
    end_user = "end_user"
    technician = "technician"
    admin = "admin"


class TicketStatus(str, Enum):
    open = "open"
    in_progress = "in_progress"
    pending_user = "pending_user"
    resolved = "resolved"
    closed = "closed"


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Channel(str, Enum):
    web = "web"
    slack = "slack"
    email = "email"


class AuthProvider(str, Enum):
    google = "google"
    local = "local"


class NotificationEvent(str, Enum):
    ticket_created = "ticket_created"
    ticket_assigned = "ticket_assigned"
    reply_added = "reply_added"
    status_changed = "status_changed"
    ticket_resolved = "ticket_resolved"
    sla_breached = "sla_breached"
    ticket_duplicate = "ticket_duplicate"

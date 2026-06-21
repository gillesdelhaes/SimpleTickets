from enum import Enum


class Role(str, Enum):
    technician = "technician"
    admin = "admin"


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class AuthProvider(str, Enum):
    local = "local"

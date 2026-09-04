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
    local = "local"    # email + password (the break-glass path)
    google = "google"  # Sign in with Google (GIS); hashed_password stays NULL

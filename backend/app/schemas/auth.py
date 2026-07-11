from pydantic import BaseModel, field_validator

from app.schemas.fields import LooseEmail


class LoginRequest(BaseModel):
    email: LooseEmail
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CreateLocalUserRequest(BaseModel):
    name: str
    email: LooseEmail
    password: str
    role: str = "technician"

    @field_validator("password")
    @classmethod
    def min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be blank")
        return v.strip()

from typing import Optional

from pydantic import BaseModel, field_validator, model_validator

from app.schemas.fields import LooseEmail


class LoginRequest(BaseModel):
    email: LooseEmail
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ForgotPasswordRequest(BaseModel):
    email: LooseEmail


class ResetPasswordRequest(BaseModel):
    email: LooseEmail
    code: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class CreateLocalUserRequest(BaseModel):
    """Admin user creation. auth_provider 'local' needs a password;
    'google' accounts have none — they sign in via the GIS button only."""
    name: str
    email: LooseEmail
    password: Optional[str] = None
    role: str = "technician"
    auth_provider: str = "local"

    @field_validator("name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be blank")
        return v.strip()

    @model_validator(mode="after")
    def password_matches_provider(self) -> "CreateLocalUserRequest":
        if self.auth_provider == "local":
            if not self.password or len(self.password) < 8:
                raise ValueError("Password must be at least 8 characters")
        else:
            # Never accept a password for an SSO account — it would silently
            # re-enable the login path the provider choice is meant to close.
            self.password = None
        return self

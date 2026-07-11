"""Shared field types for request schemas."""
from typing import Annotated

from pydantic import AfterValidator


def _validate_loose_email(v: str) -> str:
    """
    Deliberately relaxed email check for self-hosted installs: accepts any
    name@host shape (fake domains, .local, no TLD) since the address is an
    identifier here, not a delivery target.
    """
    v = v.strip().lower()
    local, sep, domain = v.partition("@")
    if not sep or not local or not domain or " " in v:
        raise ValueError("Enter an address like name@host")
    return v


LooseEmail = Annotated[str, AfterValidator(_validate_loose_email)]

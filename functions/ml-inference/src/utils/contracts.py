"""Top-level invoke contract helpers for ml-inference.

This module validates and normalizes the Lambda-to-Lambda payload envelope
before operation-specific validation occurs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional

from src.utils.errors import MlInferenceError


JsonMap = Dict[str, Any]


@dataclass(frozen=True)
class Invocation:
    """Normalized top-level invocation envelope."""

    op: str
    pet_id: str
    body: Mapping[str, Any]
    request_id: Optional[str]


def _as_str(value: Any, field_name: str) -> str:
    """Validate required non-empty string field."""
    if not isinstance(value, str):
        raise MlInferenceError(400, "mlInference.invalidRequest", f"{field_name} must be a string")
    text = value.strip()
    if not text:
        raise MlInferenceError(400, "mlInference.invalidRequest", f"{field_name} is required")
    return text


def _as_body(value: Any) -> Mapping[str, Any]:
    """Validate request body object; allow omitted body as empty object."""
    if isinstance(value, Mapping):
        return value
    if value is None:
        return {}
    raise MlInferenceError(400, "mlInference.invalidRequest", "body must be an object")


def parse_invocation(event: Mapping[str, Any]) -> Invocation:
    """Parse raw event mapping into normalized Invocation object.

    Required fields:
    - op
    - petId
    Optional:
    - body (defaults to empty object)
    - requestId
    """
    op = _as_str(event.get("op"), "op")
    pet_id = _as_str(event.get("petId"), "petId")
    body = _as_body(event.get("body"))

    raw_request_id = event.get("requestId")
    request_id: Optional[str]
    if raw_request_id is None:
        request_id = None
    else:
        request_id = _as_str(raw_request_id, "requestId")

    return Invocation(op=op, pet_id=pet_id, body=body, request_id=request_id)

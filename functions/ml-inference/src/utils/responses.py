"""Response envelope helpers for ml-inference."""

from __future__ import annotations

from typing import Any, Dict, Optional


JsonMap = Dict[str, Any]


def error_response(status_code: int, error_key: str, message: str, *, op: Optional[str] = None) -> JsonMap:
    """Build a normalized error envelope for Lambda-to-Lambda responses."""
    payload: JsonMap = {
        "ok": False,
        "statusCode": status_code,
        "errorKey": error_key,
        "message": message,
    }
    if op:
        payload["op"] = op
    return payload


def success_response(op: str, data: Any) -> JsonMap:
    """Build a normalized success envelope for Lambda-to-Lambda responses."""
    return {
        "ok": True,
        "op": op,
        "data": data,
    }

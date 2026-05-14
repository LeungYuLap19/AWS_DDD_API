"""Routing layer for ml-inference Lambda invocations.

Responsibilities:
- Parse and validate top-level invoke payload structure.
- Dispatch operation handlers (`register` / `verify`).
- Convert domain exceptions into stable error envelopes.

This module should not contain ML model logic.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Mapping

from src.services import register_op, verify_op
from src.utils.contracts import Invocation, parse_invocation
from src.utils.errors import MlInferenceError
from src.utils.responses import JsonMap, error_response, success_response


OperationHandler = Callable[[Invocation], Any]


def _dispatch_table() -> Dict[str, OperationHandler]:
    """Return supported operation handlers by operation name."""
    return {
        "register": register_op,
        "verify": verify_op,
    }


def route_event(event: Mapping[str, Any], context: Any) -> JsonMap:
    """Route one Lambda invoke payload and return response envelope.

    Args:
        event: Lambda invoke payload (already decoded to a Python mapping).
        context: Lambda context object. Unused in this layer.

    Returns:
        A stable JSON-serializable envelope:
        - success: {"ok": true, "op": ..., "data": ...}
        - error:   {"ok": false, "statusCode": ..., "errorKey": ..., ...}
    """
    del context
    try:
        invocation = parse_invocation(event)
    except MlInferenceError as err:
        return error_response(err.status_code, err.error_key, err.message)

    handlers = _dispatch_table()
    handler = handlers.get(invocation.op)
    if not handler:
        return error_response(
            400,
            "mlInference.unsupportedOperation",
            f"unsupported op: {invocation.op}",
            op=invocation.op,
        )

    try:
        result = handler(invocation)
    except MlInferenceError as err:
        return error_response(err.status_code, err.error_key, err.message, op=invocation.op)
    except Exception:
        return error_response(
            500,
            "mlInference.internalError",
            "internal ml inference error",
            op=invocation.op,
        )

    return success_response(invocation.op, result)

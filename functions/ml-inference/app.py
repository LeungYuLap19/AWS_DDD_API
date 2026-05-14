"""Lambda entrypoint for the internal ml-inference service.

This module intentionally stays minimal and delegates all request handling to
the router layer.
"""

from src.router import route_event


def handler(event, context):
    """Handle a Lambda invocation and return a JSON-serializable response."""
    return route_event(event or {}, context)

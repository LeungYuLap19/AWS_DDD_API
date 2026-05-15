"""Error types for ml-inference domain and contract validation."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class MlInferenceError(Exception):
    """Structured domain exception mapped to API error envelope."""

    status_code: int
    error_key: str
    message: str

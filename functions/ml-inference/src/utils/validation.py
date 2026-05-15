"""Reusable validation helpers for ml-inference request payloads.

These helpers are shared by operation handlers and are intentionally
transport-agnostic.
"""

from __future__ import annotations

from typing import Any, List, Mapping, Sequence, TypedDict

from src.utils.errors import MlInferenceError


ANGLE_LABELS = ("front-face", "high-face", "left-face", "low-face", "right-face")
PET_TYPES = ("cat", "dog")
DEFAULT_VERIFY_THRESHOLD = 0.5


class Candidate(TypedDict):
    """One stored gallery embedding candidate used for verification."""

    angle: str
    embedding: List[float]


def require_string(mapping: Mapping[str, Any], key: str) -> str:
    """Require a non-empty string field from mapping."""
    value = mapping.get(key)
    if not isinstance(value, str):
        raise MlInferenceError(400, "mlInference.invalidRequest", f"{key} must be a string")
    value = value.strip()
    if not value:
        raise MlInferenceError(400, "mlInference.invalidRequest", f"{key} is required")
    return value


def require_object(mapping: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    """Require an object field from mapping."""
    value = mapping.get(key)
    if not isinstance(value, Mapping):
        raise MlInferenceError(400, "mlInference.invalidRequest", f"{key} must be an object")
    return value


def optional_number(mapping: Mapping[str, Any], key: str, default: float) -> float:
    """Read optional number field; return default when missing."""
    value = mapping.get(key)
    if value is None:
        return default
    if not isinstance(value, (int, float)):
        raise MlInferenceError(400, "mlInference.invalidRequest", f"{key} must be a number")
    return float(value)


def require_pet_type(mapping: Mapping[str, Any]) -> str:
    """Require and validate petType as one of supported types."""
    pet_type = require_string(mapping, "petType")
    if pet_type not in PET_TYPES:
        raise MlInferenceError(400, "mlInference.invalidRequest", "petType must be cat or dog")
    return pet_type


def require_angle(mapping: Mapping[str, Any], key: str = "angle") -> str:
    """Require and validate angle label."""
    angle = require_string(mapping, key)
    if angle not in ANGLE_LABELS:
        raise MlInferenceError(400, "mlInference.invalidRequest", f"{key} is invalid")
    return angle


def require_embedding(value: Any) -> List[float]:
    """Require non-empty numeric embedding array."""
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise MlInferenceError(400, "mlInference.invalidRequest", "embedding must be an array")

    embedding: List[float] = []
    for idx, item in enumerate(value):
        if not isinstance(item, (int, float)):
            raise MlInferenceError(
                400,
                "mlInference.invalidRequest",
                f"embedding[{idx}] must be a number",
            )
        embedding.append(float(item))

    if not embedding:
        raise MlInferenceError(400, "mlInference.invalidRequest", "embedding must not be empty")

    return embedding


def require_candidates(mapping: Mapping[str, Any], key: str = "candidates") -> List[Candidate]:
    """Require and validate candidate embedding list."""
    value = mapping.get(key)
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise MlInferenceError(400, "mlInference.invalidRequest", f"{key} must be an array")

    candidates: List[Candidate] = []
    for idx, entry in enumerate(value):
        if not isinstance(entry, Mapping):
            raise MlInferenceError(400, "mlInference.invalidRequest", f"{key}[{idx}] must be an object")
        angle = require_angle(entry, "angle")
        embedding = require_embedding(entry.get("embedding"))
        candidates.append({"angle": angle, "embedding": embedding})
    return candidates

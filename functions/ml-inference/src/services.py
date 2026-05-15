"""Operation handlers for ml-inference.

This layer defines request/response contracts for each operation and performs
semantic payload validation. ML core integration should be plugged into these
handlers without changing the external contract.
"""

from __future__ import annotations

from typing import Any, Mapping

from src.utils.errors import MlInferenceError
from src.utils.validation import (
    DEFAULT_VERIFY_THRESHOLD,
    optional_number,
    require_angle,
    require_candidates,
    require_object,
    require_pet_type,
    require_string,
)


def register_op(invocation: Any) -> Mapping[str, Any]:
    """Handle registration inference request.

    Expected body:
    - petType: "cat" | "dog"
    - image: { bucket: string, key: string }

    Returns:
    - ML_server-style enrollment response fields plus `embedding`, which the
      caller (`pet-biometric`) can persist to MongoDB.
    """
    body = invocation.body
    pet_type = require_pet_type(body)
    image = require_object(body, "image")
    bucket = require_string(image, "bucket")
    key = require_string(image, "key")

    # Stub response aligned with ML_server EnrollResponse shape (+ embedding for Mongo storage).
    # Keep embedding non-empty so pet-biometric persistence flow can be validated
    # before the real ML core is integrated.
    return {
        "status": "accepted",
        "angle": "front-face",
        "score": 100.0,
        "counts": {},
        "can_finish": False,
        "front_image": None,
        "embedding": [0.0],
        "petId": invocation.pet_id,
        "petType": pet_type,
        "image": {"bucket": bucket, "key": key},
    }


def verify_op(invocation: Any) -> Mapping[str, Any]:
    """Handle verification inference request.

    Expected body:
    - petType: "cat" | "dog"
    - image: { bucket: string, key: string } for query frame
    - candidates: [{ angle, embedding[] }, ...] loaded by caller from MongoDB
    - threshold?: number (defaults to DEFAULT_VERIFY_THRESHOLD)

    Returns:
    - ML_server-style verification response fields (`status`, `similarity`,
      `angle`) plus request context values for observability.
    """
    body = invocation.body
    pet_type = require_pet_type(body)
    image = require_object(body, "image")
    bucket = require_string(image, "bucket")
    key = require_string(image, "key")
    candidates = require_candidates(body, "candidates")
    threshold = optional_number(body, "threshold", DEFAULT_VERIFY_THRESHOLD)

    if threshold < 0:
        raise MlInferenceError(400, "mlInference.invalidRequest", "threshold must be >= 0")

    if not candidates:
        return {
            "status": "no_enrollment",
            "similarity": None,
            "angle": None,
            "threshold": threshold,
            "petId": invocation.pet_id,
            "petType": pet_type,
            "image": {"bucket": bucket, "key": key},
        }

    # Stub response aligned with ML_server VerifyResponse shape.
    # Replace these fixed values when ML core is plugged in.
    return {
        "status": "no_match",
        "similarity": 0.0,
        "angle": require_angle(candidates[0]),
        "threshold": threshold,
        "petId": invocation.pet_id,
        "petType": pet_type,
        "image": {"bucket": bucket, "key": key},
        "candidateCount": len(candidates),
    }

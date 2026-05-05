# TODO

- Claude opus 4.7 for a full scale locale keys standardization + response format standardization + error handling standardization

- mongodb indexing issue

- error keys standardization

- schema
  - userRegistrationBodySchema: subscribe, promotion, district, image, birthday, gender should not accepted on register

- sanitize PRIVATE_DETAIL_FIELDS in pet-profile need narrower the return fields

- consider move PATCH pet profile by {petId} to /pet-profile/me

- Replace current basic rate limiting with layered rate limiting:
  Add per-IP, per-identifier, and per-account limits.
  Add separate failure counters/cooldowns for login, OTP verify, refresh abuse, and destructive routes.
  Consider WAF rate-based rules later if infra scope allows.

- Add security regression tests:
  Broken authentication: protected routes must fail without valid JWT.
  IDOR / horizontal privilege escalation: cannot read/write another user's or NGO's data.
  Unauthorized delete: cannot delete accounts/pets without ownership checks.
  Account takeover: registration/auth flows must not issue tokens for the wrong identity.
  Enumeration: public auth endpoints should not leak whether user/phone/entity exists.
  Brute-force / automation abuse: login, registration, OTP, refresh, destructive routes need abuse tests.
  JWT tampering: expired token, bad signature, wrong secret, `alg:none`.
  Mass assignment: reject writes to governance fields like `role`, `deleted`, `owner`, `ngoId`, `tagId`.
  Sensitive data exposure: responses must not leak password hash, deleted flag, internal state, or raw documents.
  NoSQL-style payload abuse: object/operator payloads must be rejected for scalar fields.
  Session persistence after delete: old refresh/access tokens must stop working after account deletion.
  Cross-origin exposure: verify CORS behavior for allowed and disallowed origins.
  Raw error leakage: unhandled exceptions and validation failures must not expose internals.
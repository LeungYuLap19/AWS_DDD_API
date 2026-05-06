# TODO

- Claude opus 4.7 for a full scale locale keys standardization + response format standardization + error handling standardization

- mongodb indexing issues

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

- [logistics] SF address client uses `hksfaddsit.sf-express.com` (SIT/staging environment) for area, netCode, and address lookups. Only the login URL uses the production `hksfadd` subdomain. Carried over from legacy unchanged. Confirm with SF Express whether separate production URLs exist for these endpoints. Revisit after frontend integration tests.

- ~~[commerce-fulfillment] Collection name mismatch — fulfillment Lambda uses `order_verifications` and `orders` but the real data is in `orderVerification` and `order` (as used by commerce-orders). All fulfillment routes that touch OrderVerification or Order return empty/404 against real data. Fix: align collection names in `functions/commerce-fulfillment/src/config/db.ts` to `orderVerification` and `order`.~~ ✅ Fixed.

- [commerce-orders] POST /commerce/orders times out at 10 s (Lambda hard limit) on every valid payload (502 to client). Validation and shopCode DB lookup succeed. The hang occurs silently after both — no log output between START and END. Candidates: tagId uniqueness query, Order/OrderVerification write, or a missing timeout on the confirmation email or WhatsApp notification call. requestId: 3088d40e-bc04-45ec-83bb-90ae15f8d40a (2026-05-06T08:57:19Z). Fix the hang; also raise Lambda timeout above 10 s if side-effect calls (email, WhatsApp) are legitimately slow.
# AWS_DDD_API — Post-Migration Security Audition

> Codebase security audition based on repository inspection.
> Audit date: 2026-05-10.
> Scope: application-layer and infrastructure-as-code controls visible in this repository.
> This is not a formal penetration test or production configuration review.

---

## Table of Contents

1. [Scope](#1-scope)
2. [Confirmed Security Controls](#2-confirmed-security-controls)
3. [Attack Coverage Matrix](#3-attack-coverage-matrix)
4. [Evidence by Control Area](#4-evidence-by-control-area)
5. [Tests and Security Regression Coverage](#5-tests-and-security-regression-coverage)
6. [Deferred or Remaining Gaps](#6-deferred-or-remaining-gaps)
7. [Conclusion](#7-conclusion)

---

## 1. Scope

This audition answers one question:

> Which cyber vulnerabilities, abuse cases, and attack paths are already covered and handled by the current `AWS_DDD_API` codebase?

The conclusions below are based on:

- `template.yaml`
- shared runtime code in `layers/shared-runtime`
- domain service / schema / utility code in `functions/*`
- post-migration notes in [CHANGES.md](./CHANGES.md) and [TODO.md](../TODO.md)
- existing Jest / SAM tests in `__tests__/`

This document focuses on implemented controls, not theoretical best practices.

---

## 2. Confirmed Security Controls

The following control families are clearly implemented in the repo:

- API key gating on the REST API by default
- JWT Lambda authorizer with explicit `HS256` verification
- route-level auth, role, and ownership enforcement
- layered Mongo-backed rate limiting with failure cooldowns
- refresh-token hashing, rotation, and single-use invalidation
- secure refresh-token cookie attributes
- Zod-based request validation with strict schemas and shared validators
- ObjectId / temp-id validation for DB-facing path params
- free-text sanitization for stored user content
- upload MIME sniffing from magic bytes, file-count checks, and max-size enforcement
- upload folder allowlisting to prevent arbitrary S3 key writes
- least-privilege S3 IAM write scope by prefix
- duplicate-key handling and unique indexes for active account identity fields
- CORS allowlist behavior in production
- response sanitization / allowlisting to reduce sensitive-field leakage
- static-analysis and dependency-hardening follow-up recorded in post-migration docs

---

## 3. Attack Coverage Matrix

| Attack / vulnerability class | Status | Current handling |
|---|---|---|
| Unauthorized API access | Covered | Default API key requirement plus JWT authorizer on protected routes |
| JWT tampering / invalid token reuse | Covered | Bearer extraction + `jwt.verify(..., { algorithms: ['HS256'] })` |
| Missing-claim auth bypass | Covered | Authorizer denies tokens with no `userId` / `sub` |
| Role escalation | Covered | `requireRole()` guards admin / privileged routes |
| IDOR / broken object-level authorization | Covered | ownership checks by `userId`, `ngoId`, or owner email before read/write |
| Brute-force login | Covered | layered rate limit plus failure cooldown |
| OTP brute force | Covered | per-IP and per-identifier throttles plus failure cooldown |
| OTP replay | Covered | hashed code, expiry window, single-use `consumedAt` update |
| Email / SMS challenge bombing | Covered | per-target identifier throttles on challenge creation |
| Refresh-token replay | Covered | hashed token storage plus `findOneAndDelete` single-use rotation |
| Session-cookie theft impact reduction | Partially covered | `HttpOnly`, `Secure`, `SameSite=Strict`, path-scoped refresh cookie |
| CSRF on refresh endpoint | Partially covered | strict cookie attributes and path scoping reduce browser-driven cross-site abuse |
| Password-at-rest exposure | Covered | NGO passwords hashed with bcrypt before persistence |
| NoSQL operator injection | Covered | strict Zod body schemas and validated DB-facing ids |
| Path-param injection / malformed ObjectId abuse | Covered | shared `objectIdString` / `parseObjectIdParam` style validation |
| Stored XSS in free-text fields | Covered | `sanitizeText()` strips tags and control chars before persistence |
| Reflected XSS via server HTML templating | Partially covered | `escapeHtml()` exists; some tests verify escaped output |
| Malicious file upload by fake MIME / extension | Covered | magic-byte MIME detection, allowlist, and size cap |
| Oversized upload DoS | Covered | 4 MB cap plus binary-media sizing discipline |
| Multi-file abuse on single-file endpoints | Covered | explicit file-count rejection |
| Upload path traversal / arbitrary S3 key injection | Covered | top-level folder allowlist and `.` / `..` rejection |
| Sensitive data leakage in API responses | Covered | per-domain sanitizers / explicit allowlists |
| Duplicate-account / duplicate-resource abuse | Covered | unique indexes and duplicate-key handling |
| Pagination amplification / list-endpoint abuse | Covered | bounded `page` / `limit` shared schema |
| PII in rate-limit storage | Covered | SHA-256 hashing of rate-limit keys |
| Race on rate-limit upsert | Covered | duplicate-key retry path documented in post-migration notes |
| Dependency-level multipart DoS | Covered | vulnerable `lambda-multipart-parser` removed; `busboy` adopted |
| CORS origin abuse | Covered | exact-origin allowlist in production, deny on mismatch |
| Excessive S3 write scope | Covered | IAM restricted to explicit prefixes; ACL write removed |

---

## 4. Evidence by Control Area

### 4.1 Edge Protection

- REST API requires API keys by default in [template.yaml](../../template.yaml).
- Protected routes inherit the default Lambda authorizer.
- Authorizer identity validation requires `Authorization: Bearer ...` shape before invocation.

Primary evidence:

- [template.yaml](../../template.yaml)
- [functions/request-authorizer/index.ts](../../functions/request-authorizer/index.ts)

### 4.2 Authentication and Session Security

- Access tokens are signed JWTs with explicit `HS256`.
- Refresh tokens are random 32-byte secrets, stored only as SHA-256 hashes.
- Refresh flow deletes the old token before minting a new one, making replay fail.
- Refresh cookies are `HttpOnly`, `Secure`, `SameSite=Strict`, and path-scoped to `/auth/tokens/refresh`.

Primary evidence:

- [functions/auth/src/utils/token.ts](../../functions/auth/src/utils/token.ts)
- [functions/auth/src/services/refresh.ts](../../functions/auth/src/services/refresh.ts)
- [functions/auth/src/models/RefreshToken.ts](../../functions/auth/src/models/RefreshToken.ts)

### 4.3 Auth Abuse Throttling

- Login, OTP send, OTP verify, refresh, and registration flows use layered rate limits.
- Failure-only cooldown counters prevent repeated bad credentials from consuming normal quota.
- Rate-limit keys are hashed before persistence, avoiding raw email / phone / IP storage.

Primary evidence:

- [layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/rate-limit/mongo.ts](../../layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/rate-limit/mongo.ts)
- [functions/auth/src/services/challenge.ts](../../functions/auth/src/services/challenge.ts)
- [functions/auth/src/services/login.ts](../../functions/auth/src/services/login.ts)
- [functions/auth/src/services/refresh.ts](../../functions/auth/src/services/refresh.ts)

### 4.4 Authorization and Ownership

- Shared auth context helpers normalize identity claims and enforce 401 / 403 outcomes.
- Domain helpers load resources and reject cross-owner access.
- Admin-only actions explicitly use role guards.
- Commerce fulfillment self-access checks compare caller email with order owner email unless role is privileged.

Primary evidence:

- [layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/auth/context.ts](../../layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/auth/context.ts)
- [functions/pet-analysis/src/utils/auth.ts](../../functions/pet-analysis/src/utils/auth.ts)
- [functions/ngo/src/utils/access.ts](../../functions/ngo/src/utils/access.ts)
- [functions/commerce-fulfillment/src/utils/selfAccess.ts](../../functions/commerce-fulfillment/src/utils/selfAccess.ts)
- [functions/notifications/src/services/notifications.ts](../../functions/notifications/src/services/notifications.ts)

### 4.5 Input Validation and Injection Resistance

- Shared validators cover ObjectId, temp IDs, email, phone, URL, and bounded pagination.
- Domain schemas use `.strict()` and `.max()` to reject unknown keys and oversized fields.
- DB-facing path params are validated before query execution.
- User-controlled text fields are sanitized before storage in multiple domains.

Primary evidence:

- [layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/validation/common.ts](../../layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/validation/common.ts)
- [functions/user/src/zodSchema/userPatchBodySchema.ts](../../functions/user/src/zodSchema/userPatchBodySchema.ts)
- [functions/auth/src/zodSchema/userRegistrationBodySchema.ts](../../functions/auth/src/zodSchema/userRegistrationBodySchema.ts)
- [functions/commerce-orders/src/zodSchema/orderSchema.ts](../../functions/commerce-orders/src/zodSchema/orderSchema.ts)
- [layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/sanitization/text.ts](../../layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/sanitization/text.ts)

### 4.6 Upload Hardening

- Upload routes require auth.
- Multipart parsing is standardized through shared parsing.
- File type is detected from magic bytes, not just filename or header.
- File size is capped at 4 MB.
- Some routes reject more than one file.
- Folder inputs are allowlisted and path traversal segments are denied.

Primary evidence:

- [functions/pet-analysis/src/utils/upload.ts](../../functions/pet-analysis/src/utils/upload.ts)
- [functions/pet-analysis/src/services/upload.ts](../../functions/pet-analysis/src/services/upload.ts)

### 4.7 Data Exposure Reduction

- User responses strip password, deleted flag, credits, timestamps, and internal fields.
- Order and order-verification responses are explicit allowlists, not raw document dumps.
- Pet-profile responses expose different projections for owner vs public tag lookup.

Primary evidence:

- [functions/user/src/utils/sanitize.ts](../../functions/user/src/utils/sanitize.ts)
- [functions/commerce-orders/src/utils/sanitize.ts](../../functions/commerce-orders/src/utils/sanitize.ts)
- [functions/pet-profile/src/utils/sanitize.ts](../../functions/pet-profile/src/utils/sanitize.ts)

### 4.8 Infrastructure and Dependency Hardening

- S3 write permissions are restricted to explicit upload prefixes.
- `s3:PutObjectAcl` was removed for least privilege.
- multipart dependency hardening replaced a vulnerable parser chain.
- Checkov / semgrep / Snyk results were recorded during post-migration hardening.

Primary evidence:

- [template.yaml](../../template.yaml)
- [TODO.md](../TODO.md)
- [CHANGES.md](./CHANGES.md)

---

## 5. Tests and Security Regression Coverage

The repo already contains explicit security-oriented tests, including:

- invalid image URL rejection on `PATCH /user/me`
- NoSQL operator injection rejection with persisted state unchanged
- script injection rejection in `commerce/orders tempId`
- unsupported image format rejection on upload
- rate-limit `429` responses with `retry-after`
- forbidden non-admin notification dispatch
- invalid-session refresh after account deletion

Representative evidence:

- [__tests__/user.test.js](../../__tests__/user.test.js)
- [__tests__/commerce-orders.sam.test.js](../../__tests__/commerce-orders.sam.test.js)
- [__tests__/pet-analysis.test.js](../../__tests__/pet-analysis.test.js)
- [__tests__/pet-analysis.sam.test.js](../../__tests__/pet-analysis.sam.test.js)
- [__tests__/notifications.sam.test.js](../../__tests__/notifications.sam.test.js)

This means the security posture is not only implemented, but partially regression-tested.

---

## 6. Deferred or Remaining Gaps

The following items are explicitly not fully closed in the repo yet:

### 6.1 Infra gaps deferred for deploy-role / manager approval

- API Gateway access logging (`CKV_AWS_76`)
- Lambda dead-letter queue wiring (`CKV_AWS_116`)

Source:

- [TODO.md](../TODO.md)

### 6.2 Remaining rate-limit gaps documented in post-migration notes

The post-migration notes still call out some endpoints as needing stronger per-identifier write throttles or additional hardening review.

Examples listed there include:

- `POST /commerce/catalog/events`
- `PATCH /user/me`, `DELETE /user/me`
- `PATCH /ngo/me`
- `POST /pet/transfer/*`, `PATCH`, `DELETE`
- `POST /pet/adoption/{id}`
- `POST|PATCH /pet/source/{petId}`

Source:

- [CHANGES.md](./CHANGES.md)

### 6.3 Boundaries of this audition

This document does not verify:

- live AWS account settings outside source control
- production secret rotation practices
- WAF, Shield, CloudFront, or upstream network controls
- MongoDB server hardening outside application logic
- runtime behavior of external vendors such as Twilio, SF Express, WhatsApp, SMTP providers
- exploitability by active black-box attack against a deployed environment

---

## 7. Conclusion

The current `AWS_DDD_API` post-migration codebase already handles a broad set of common web/API attack classes:

- auth bypass
- role bypass
- IDOR
- brute force
- OTP abuse
- refresh-token replay
- NoSQL injection
- stored XSS in free-text fields
- malicious upload attempts
- path traversal into upload prefixes
- duplicate-resource abuse
- excessive list/query amplification
- broad S3-permission abuse

The strongest implemented areas are:

- auth / session handling
- abuse throttling
- request validation
- ownership enforcement
- upload hardening

The main unfinished areas are operational hardening at the infrastructure layer and some remaining rate-limit follow-up noted in the post-migration documents.

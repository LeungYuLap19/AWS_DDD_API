# AWS_DDD_API — Post-Migration Changes

> Covers standardization, optimization, and security hardening applied after the initial DDD migration.
> Audit date: 2026-05-08.

---

## Table of Contents

1. [Standardization](#1-standardization)
   - [Service Function Flow](#11-service-function-flow)
   - [Response Format](#12-response-format)
   - [Error Handling](#13-error-handling)
   - [Locale Keys](#14-locale-keys)
   - [Multipart & S3](#15-multipart--s3)
2. [Security Hardening](#2-security-hardening)
   - [Schema & Input Sanitizing](#21-schema--input-sanitizing)
   - [Rate Limiting](#22-rate-limiting)
   - [IAM & Infrastructure](#23-iam--infrastructure)
   - [Dependency Vulnerabilities](#24-dependency-vulnerabilities)
   - [Static Analysis](#25-static-analysis)
3. [Performance Optimization](#3-performance-optimization)
   - [Cold Start Reduction](#31-cold-start-reduction)

---

## 1. Standardization

### 1.1 Service Function Flow

All service handlers follow a strict, ordered pipeline. No step may be re-ordered without justification.

```
requireAuthContext / requireRole            ← auth guard (defense-in-depth, self-documenting)
  ↓
path/query param validation                 ← cheap, no I/O
  ↓
parseBody / parseMultipartBody              ← Zod, cheap, no I/O
  ↓
connectToMongoDB
  ↓
applyRateLimit                              ← DB-backed; identifier = userId/userEmail from auth context
  ↓
identity / ownership check                 ← DB query
  ↓
business logic / mutations
```

**Auth guard rules:**

| Scenario | Method |
|---|---|
| JWT-protected route | `requireAuthContext(event)` — called on every handler (defense-in-depth) |
| Role-specific route | `requireRole(event, roles)` |
| Public route that returns different shapes based on auth | `getAuthContext(event)` |
| Auth-domain challenge verify (no JWT yet) | Bespoke `getBearerToken` + `jwt.verify` |
| Compound ownership check repeated across N handlers in same domain | Local auth wrapper |

**`try/catch` rules — only three legitimate uses in service handlers:**

1. Duplicate-key (`11000`) errors that cannot be handled generically.
2. Non-fatal side-effects (WhatsApp dispatch, email notifications) — `catch + logWarn`, never rethrow.
3. Compensating rollback when a multi-step operation partially succeeds (e.g. delete `Order` if `OrderVerification` creation fails).

All other `try/catch` blocks were removed. Unexpected errors propagate naturally to the global handler.

---

### 1.2 Response Format

**Canonical shapes:**

| Operation | Shape |
|---|---|
| LIST | `{ message: 'success.retrieved', data: T[], pagination?: {...} }` |
| GET single | `{ message: 'success.retrieved', data: T }` |
| CREATE | `{ message: 'success.created', data: T }` |
| UPDATE | `{ message: 'success.updated', data: T }` (or `{ message }` if no body needed) |
| DELETE | `{ message: 'success.deleted' }` |

**Issues resolved:**

- **Duplicate IDs** — fields that appeared both inside `data` and at top level were removed from the top level.
- **Inconsistent wrapper field** — `form` / `result` / `user` / `pet` / `pets` / `items` / flat top-level across domains unified to `data`.
- **Raw English message strings** — `commerce-orders` and `commerce-fulfillment` used raw strings (`'Order placed successfully.'`, `'Email sent successfully.'`); replaced with locale keys.
- **Missing `message`** — `ngo`, `commerce-catalog`, `logistics`, `pet-analysis/eye` were missing a message field entirely; all now return a locale key.
- **Redundant `count` field** — `petLost`, `petFound`, and `notifications` LIST responses included a `count` alongside the array; removed (client can use `array.length`).
- **Inconsistent pagination metadata** — NGO list emitted `currentPage`/`perPage`; user list omitted them; standardized via shared `paginationQuerySchema`.
- **Junk / snake_case fields** — `status: 200` inside body (pet-analysis/eye), `purchase_code`, `_id`, `request_id`, `time_taken`, `bearer_token`, `area_list` renamed to camelCase and top-level duplication removed.
- **404 on empty list** — `commerce-orders handleGetOperations` was returning 404 for an empty result set; changed to 200 with an empty array.
- **No custom `httpError` responses** — no domain lambda may define or use its own response helper; all use `response.errorResponse` from the shared layer.

---

### 1.3 Error Handling

Error handling flows through `createApiGatewayHandler` (wraps every Lambda). The global handler converts:

- `error.statusCode` → HTTP status (defaults to `500` if missing/out-of-range).
- `error.errorKey` → used as-is for **4xx only**.
- **All 5xx throws** → locale key is **always discarded** → becomes `'common.internalError'`.

**Decision rules:**

| Situation | Action |
|---|---|
| Service handler — business logic error | `return response.errorResponse(statusCode, 'locale.key', event)` |
| Service handler — 5xx with specific locale key | `return response.errorResponse(...)` inline — **never throw** |
| Service handler — unexpected error | Let propagate (or `throw error` if already inside `catch`) |
| Helper/util — auth/domain validation failure | `throw new HttpError(key, status)` |
| Helper/util — unexpected error | Let propagate |
| Non-fatal side-effect | `catch + logWarn`; do **not** return or rethrow |

**`parseBody` rule:** always use `parseBody(ctx.body, schema)` from `@aws-ddd-api/shared` and check the discriminated-union result inline. Calling `schema.parse()` directly throws a raw Zod error that the global handler converts to a 500.

---

### 1.4 Locale Keys

**Naming convention:** `{domainKey}.errors.{subResource?}.{category}`

- Domain keys use camelCase (`petMedical`, not `petMedicalRecord`).
- Sub-resources are included when a domain manages multiple distinct record types (e.g. `petMedical.errors.bloodTest.notFound`).
- Success keys are not domain-specific (use `success.created`, `success.retrieved`, etc.).

**Consolidation rules:**

| Key type | Rule |
|---|---|
| `notFound` | Always domain-specific — identifies the resource in logs (`petProfile.errors.petNotFound` ≠ `common.notFound`) |
| `invalidXxxIdFormat` (ObjectId) | Use `common.invalidObjectId` |
| `invalidDateFormat` | Keep domain-specific (expected format may differ per domain) |
| `missingXxx` (required field) | Use `common.missingBodyParams` unless the absence is a business rule |
| Key redundancy | Do not repeat the namespace inside the key segment: inside `petMedical.errors.bloodTest.*`, use `invalidIdFormat` not `invalidBloodTestIdFormat` |

---

### 1.5 Multipart & S3

**Rule: multipart-only routes** — routes that accept file uploads use `multipart/form-data` only. No JSON fallback, no `Content-Type` branching. The `else parseBody` branches in `pet-profile/createProfile.ts` and `patchProfile.ts` were removed.

**Rule: always use `parseMultipartBody` from the shared layer** — direct `lambda-multipart-parser` imports in service files (`pet-analysis/upload.ts`, `pet-analysis/eye.ts`) were replaced.

**Normalize helpers (`utils/multipart.ts`):**

Each Lambda keeps its own `utils/multipart.ts` with canonical `normalizeBoolean` and `normalizeNumber` helpers:

```ts
function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function normalizeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
```

The `pet-profile` version (no null/empty guard, no `Number.isFinite`) was replaced with the canonical version from `pet-recovery`.

**Canonical upload helper (`utils/upload.ts` → `uploadImageFile`):**

```
1. Detect MIME from magic bytes (not filename / Content-Type header)
2. Reject if MIME not in ALLOWED_UPLOAD_MIME    → throw { code: 'INVALID_FILE_TYPE' }
3. Reject if buffer.length > MAX_UPLOAD_BYTES   → throw { code: 'FILE_TOO_LARGE' }
4. Create ImageCollection record (empty)
5. Derive extension from detected MIME via EXT_MAP
6. PutObjectCommand to S3
7. Update ImageCollection (fileName, url, fileSize, mimeType, owner)
8. Return url
```

- **Allowed MIME:** `image/jpeg`, `image/png`, `image/webp`, `image/gif`. TIFF, BMP, and PDF removed — inconsistent across Lambdas, not needed for pet images.
- **Max upload size:** `4 MB` (API Gateway base64-encodes binary: 4 MB raw → ~5.33 MB encoded, safely under Lambda's 6 MB synchronous limit).

**SF metadata endpoints** — all changed to `x-api-key` auth (no JWT, including token endpoints); all enforce rate limiting on `ip` scope only.

---

## 2. Security Hardening

### 2.1 Schema & Input Sanitizing

Four priority phases applied across all 18 domains:

#### P0 — Path-param injection (completed)

- Shared `objectIdString` and `tempIdString` validators in `bootstrap/validators/`.
- `parsePathParam(event, key, schema)` helper returns typed value or 400.
- Applied to every path parameter used in a DB query (covering `pet-profile`, `pet-medical`, `pet-transfer`, `pet-source`, `pet-recovery`, `notifications`, `pet-adoption`, `commerce-fulfillment`, `commerce-orders/tempId`, and others identified in the audit).

#### P1 — Schema tightening (completed)

- `.max()` added to all string fields: names ≤ 255, short codes ≤ 64, addresses ≤ 500, descriptions/remarks ≤ 2000.
- `.passthrough()` replaced with `.strict()` in `pet-profile/createPetSchemas.ts` and `pet-analysis/breedAnalysisSchema.ts`; `.strict()` added to `ngo/editNgoBodySchema.ts`.
- Shared `paginationQuerySchema` with `page` 1–10 000 and `limit` 1–100 (Zod `.coerce`); applied to all paginated `GET` endpoints.
- Enums for `gender`, `status`, `lang` standardized across domains.
- Array bounds: `pet-profile.breedimage` `.max(10)`, `logistics.netCodeList` `.max(100)`.
- Basic email regex replaced with `z.string().email()`; phone normalized to E.164 in `normalizePhone`.

#### P2 — Shared validation/sanitization infrastructure (completed)

| Module | Exports |
|---|---|
| `bootstrap/validators/index.ts` | `objectIdString`, `tempIdString`, `emailString`, `phoneE164`, `urlString`, `paginationQuerySchema`, `dateStringYYYYMMDD`, `dateStringDDMMYYYY` |
| `bootstrap/sanitizers/index.ts` | `sanitizeText`, `sanitizeHtml`, `sanitizeRichText`, `stripControlChars` |
| `bootstrap/http/parsePathParam.ts` | Uniform 400 response on invalid path params |

#### P3 — Integration tests (deferred)

Injection/XSS/oversize integration tests deferred until after all optimization and hardening passes are complete.

---

### 2.2 Rate Limiting

The old system used per-Lambda copies of `rateLimit.js` with a single composite `ip+identifier` bucket and plaintext PII stored in MongoDB. It had no failure cooldown, no `Retry-After` header, no race-condition safety, and no account- or global-scope caps.

The new system is a single shared implementation (`@aws-ddd-api/shared` → `rate-limit/mongo.ts`) with layered, independently-evaluated scopes:

| Scope | Key material | What it stops |
|---|---|---|
| `ip` | IP only | Single host flooding many targets |
| `identifier` | identifier only | Distributed-IP flooding against one victim |
| `ip+identifier` | IP + identifier | Narrow per-caller-per-target cap |
| `account` | accountId | Per-authenticated-account abuse post-login |
| `global` | none | Nuclear last-resort cap for any action |

**Key improvements:**

- **Key hashing** — all storage keys are SHA-256 hashed (salted). Raw emails, phones, and IPs are never persisted in MongoDB.
- **Retry-After header** — `429` responses include `retry-after: <seconds>`.
- **Race-condition safety** — duplicate-key (11000) errors on concurrent upsert are caught and retried with `$inc`.
- **`failOpen` flag** — transient DB errors in non-critical flows can be configured to pass through.
- **Legacy shim** — `{ limit, windowSeconds }` shorthand preserved for non-auth Lambdas.

**Failure cooldowns (auth only):**

`requireMongoRateLimitNotInCooldown` + `recordMongoRateLimitFailure` maintain a separate failure counter that does not consume legitimate-traffic quota. Applied to: NGO login, user login (OTP verify), email/SMS OTP verify, token refresh.

| Flow | Failure threshold |
|---|---|
| Login (user + ngo), OTP verify | 5 failures / 15 min |
| Token refresh | 10 failures / 30 min (ip-scoped) |

**Auth flow policy summary:**

| Flow | Throughput policies | Failure cooldown |
|---|---|---|
| NGO login | ip: 60/15m, identifier: 10/15m | 5 fails / 15 min |
| Email OTP send | ip: 20/5m, identifier: 3/5m | — |
| SMS OTP send | ip: 20/10m, identifier: 3/10m | — |
| Email OTP verify | ip: 30/5m, identifier: 5/5m | 5 fails / 15 min |
| SMS OTP verify | ip: 30/10m, identifier: 5/10m | 5 fails / 15 min |
| Token refresh | ip: 60/5m, identifier (token): env-driven | 10 fails / 30 min (ip) |
| User / NGO registration | ip: 10/60m, ip+identifier: 5/60m | — |

The redundant `ip+identifier` lane was removed from auth flows where the `identifier` lane was always strictly stricter — the composite lane could never trip first.

**Remaining gaps (not yet addressed):**

| Endpoint | Risk | Priority |
|---|---|---|
| `POST /commerce/catalog/events` | No rate limit; `x-api-key` gate reduces blast radius but key is semi-public in the frontend bundle | P1 |
| `PATCH /user/me`, `DELETE /user/me` | No per-identifier limit on authenticated free-text writes | P2 |
| `PATCH /ngo/me` | No per-identifier limit | P2 |
| `POST /pet/transfer/*`, `PATCH`, `DELETE` | Ownership-change endpoints; no limit | P2 |
| `POST /pet/adoption/{id}` | Creates adoption application; no limit | P2 |
| `POST|PATCH /pet/source/{petId}` | Write endpoints; no limit | P2 |

---

### 2.3 IAM & Infrastructure

Changes applied to `template.yaml`:

- **`s3:PutObjectAcl` removed** from all Lambda roles (least-privilege; ACL management is not required).
- **PetAnalysis S3 resources** tightened from `*` to explicit key prefixes.
- **`RoleName`** added to all 6 IAM roles (explicit naming, avoids CloudFormation-generated names in audit logs).

Items requiring manager / deploy-role approval before applying:

- **`CKV_AWS_76`** — API Gateway access logging: requires `AWS::Logs::LogGroup` + `AccessLogSetting` on `RestApi`; deploy role needs `logs:CreateLogGroup`, `logs:PutRetentionPolicy`; one-time per-account API GW CloudWatch role setup needed.
- **`CKV_AWS_116`** — Lambda DLQ: requires `AWS::SQS::Queue` + `AWS::IAM::ManagedPolicy` (`sqs:SendMessage`) attached to all 6 Lambda roles; deploy role needs `sqs:CreateQueue`, `sqs:SetQueueAttributes`, `iam:CreatePolicy`.

---

### 2.4 Dependency Vulnerabilities

| Finding | Resolution |
|---|---|
| Snyk HIGH — DoS in `dicer@0.3.0` via `lambda-multipart-parser` | Replaced `lambda-multipart-parser` with `busboy@1.6.0`; 0 vulnerabilities remaining |

---

### 2.5 Static Analysis

| Tool | Before | After |
|---|---|---|
| Checkov | 57 failures | 0 failures (see `.checkov.yaml` for skip justifications) |
| semgrep | 18 findings | 0 actionable findings — all false positives; body inputs guarded by Zod schemas; path-param ObjectId validation applied |
| snyk | 1 high | 0 vulnerabilities |

---

## 3. Performance Optimization

### 3.1 Cold Start Reduction

Baseline: `tsc` → `prepare-dist.cjs` copies source + `package.json` → `sam build` runs `npm install` per function, resulting in full unpacked `node_modules` inside each deployment package.

Notable function sizes before optimization:
- `request-authorizer`: ~892 KB (jsonwebtoken only)
- `auth`: ~26 MB (Twilio 18 MB, axios 2.9 MB, mongoose 928 KB, nodemailer 636 KB)

**Changes applied:**

| Change | Impact |
|---|---|
| **esbuild bundling** — replaces `tsc` + `sam npm install`; bundles, minifies, and tree-shakes to a single `.js` per function | `auth`: 26 MB → ~1–2 MB; all other functions: essentially code-only, no `node_modules` folder |
| **Lazy Twilio initialization** — moved client construction from module load time into `createSmsVerification` / `checkSmsVerification` (lazy singleton) | Eliminates 18 MB Twilio init penalty on non-challenge routes (`/tokens/refresh`, `/login/ngo`) |
| **arm64 architecture** — `Architectures: [arm64]` in `Globals.Function` | ~20% cost reduction; comparable or faster cold start; `bcrypt` native addon replaced with `bcryptjs` (pure JS, drop-in compatible) |
| **Memory increases** — `auth`, `pet-profile`, `pet-analysis`, `commerce-orders`, `pet-recovery`: 256 MB → 512 MB | More vCPU allocation proportional to memory; faster module initialization for CPU-bound (`bcrypt`) and module-heavy (`Twilio`) paths |
| **Lazy route imports** — `createRouter` (shared layer) accepts `RouteHandler \| (() => Promise<RouteHandler>)`; dynamic imports in each `router.ts` | Prevents loading unused service modules at cold start; highest ROI for `auth` (avoids Twilio/bcrypt on refresh/login) and `pet-medical` (16 handlers) |
| **`@aws-sdk/client-s3` moved to shared layer** — consolidated from per-function bundles (~3 MB each) in `pet-profile`, `pet-recovery`, `pet-analysis`, `commerce-orders` | One shared copy loaded once per execution environment |

**Recommended sequencing (for any remaining work):**

1. esbuild bundling — biggest size reduction
2. Lazy Twilio init — removes 18 MB init penalty
3. arm64 + memory bumps — cost + speed; resolve bcrypt → bcryptjs first
4. Lazy route imports — unused module elimination
5. `@aws-sdk/client-s3` to shared layer — lower priority with esbuild
6. Provisioned concurrency on `request-authorizer` — eliminates authorizer cold-start spikes (~$1.50/month at 256 MB)

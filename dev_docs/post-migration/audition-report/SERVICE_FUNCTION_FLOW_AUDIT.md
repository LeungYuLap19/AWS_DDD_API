# Service Function Flow Audit

Date: 2026-05-07

Scope: scanned `functions/**/src/services/*.ts` in `AWS_DDD_API` after the Lambda migration.

Mechanical scan coverage:

- 41 service files
- 91 exported handler-like functions
- Excluded non-service routing glue and pure helpers, except where helpers affect auth/error flow.

This is an inconsistency inventory only. No implementation pattern has been chosen yet.

## Existing Shared Baseline

The shared handler already has a top-level error boundary. `createApiGatewayHandler` wraps route dispatch in `try/catch` and converts thrown errors with `statusCode` / `errorKey` into `response.errorResponse(...)`: [layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/http/handler.ts](../layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/http/handler.ts#L111-L146).

The router only dispatches routes and returns 404/405. It does not standardize service handler errors: [layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/http/router.ts](../layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/http/router.ts#L73-L96).

Auth guards throw `AuthContextError` with 401/403 metadata, so protected handlers can either let these bubble to the shared handler or catch/map them locally: [layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/auth/context.ts](../layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/auth/context.ts#L150-L189).

`parseBody(...)` does not throw. It returns `{ ok: false, statusCode, errorKey }`, so validation placement is an explicit service-flow decision: [layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/validation/zod.ts](../layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/validation/zod.ts#L135-L166).

## Inconsistency Inventory

### 1. Local Try/Catch Policy Is Not Consistent

Current patterns are mixed:

- No local catch; services rely on the shared Lambda handler. Examples: `auth` login/refresh, `commerce-catalog`, `notifications`, `commerce-fulfillment` suppliers, many read endpoints.
- Full service-level catch wrapping auth/db/parse/business flow. Examples: `pet-source`, `pet-transfer`, `commerce-fulfillment` tags/cancel/verifications/commands, `logistics`, and parts of `pet-adoption`.
- Partial/local catch only around risky domain operations. Examples: `user` patch duplicate-key handling, `auth` registration duplicate-key handling, `commerce-orders` create cleanup/notification steps, `pet-profile` and `pet-medical` known domain errors.

Concrete examples:

- `handleCreateTransfer` wraps the whole flow and maps known errors locally: [functions/pet-transfer/src/services/transfer.ts](../functions/pet-transfer/src/services/transfer.ts#L29-L79).
- `handlePatchSupplierVerification` has no local catch and lets thrown auth/db errors bubble: [functions/commerce-fulfillment/src/services/suppliers.ts](../functions/commerce-fulfillment/src/services/suppliers.ts#L97-L135).
- `handleCreateBloodTestRecord` performs auth/db/rate-limit outside the local `try`, then catches only authorization/domain errors inside: [functions/pet-medical/src/services/bloodTest.ts](../functions/pet-medical/src/services/bloodTest.ts#L58-L117).
- `handlePatchTagVerification` catches the whole flow but maps only 401/403 specially and converts other failures to `common.internalError`: [functions/commerce-fulfillment/src/services/tags.ts](../functions/commerce-fulfillment/src/services/tags.ts#L223-L309).
- `createShipment` catches provider/domain errors and always responds with status 500, even when the error key may be domain-specific: [functions/logistics/src/services/sfShipment.ts](../functions/logistics/src/services/sfShipment.ts#L17-L160).

Standardization decision needed: decide whether service handlers should generally let unknown errors bubble to `createApiGatewayHandler`, and reserve local catch blocks only for known domain/provider translations and compensating actions.

### 2. Auth, DB Connect, and Body Validation Order Varies

Common protected flow variants found:

- `auth -> db -> parse`: `pet-profile` create/patch, `pet-medical` create/update, `pet-analysis` breed/upload/eye patch, `commerce-orders` create, `logistics` shipment/waybill, `pet-recovery` create.
- `auth -> parse -> db`: `user` patch, `pet-source` create/patch, `pet-transfer` create/update/NGO transfer, `pet-adoption` managed create/update, `commerce-fulfillment` tag patch.
- `role -> db`: `commerce-orders` list/operations, `commerce-fulfillment` cancel/verifications.
- `role -> parse -> db`: `notifications` dispatch.
- `parse -> db` with no auth: `auth` registration/login/challenge and `commerce-catalog` create.
- `db` with no auth: public reads such as catalog/storefront and adoption browse.

Concrete examples:

- Parse before DB: `handlePatchMe` authenticates, parses body, then connects to MongoDB: [functions/user/src/services/user.ts](../functions/user/src/services/user.ts#L45-L55).
- Parse after DB: `handleCreateOrder` authenticates, connects to MongoDB, applies rate limiting, then parses multipart/Zod payload: [functions/commerce-orders/src/services/orders.ts](../functions/commerce-orders/src/services/orders.ts#L77-L100).
- Parse before DB and identity check: `handleCreatePetSource` does auth, body parse, path validation, DB connect, then pet authorization: [functions/pet-source/src/services/source.ts](../functions/pet-source/src/services/source.ts#L58-L75).
- DB and identity before parse: `handleCreateBloodTestRecord` authenticates, connects, rate-limits, authorizes the pet, then parses body: [functions/pet-medical/src/services/bloodTest.ts](../functions/pet-medical/src/services/bloodTest.ts#L58-L86).
- Auth then DB then parse for an external provider route: `createShipment` authenticates, connects, rate-limits, then parses body: [functions/logistics/src/services/sfShipment.ts](../functions/logistics/src/services/sfShipment.ts#L17-L41).

Standardization decision needed: choose the default order and define exceptions. A practical default could be `auth/role -> path params -> body parse -> db connect -> DB-backed rate limit -> identity/ownership -> business logic`, with documented exceptions when rate limiting or multipart parsing must happen earlier/later.

### 3. Identity/Ownership Checks Are Placed Differently

Identity checks include account context checks, pet ownership checks, NGO membership checks, order ownership checks, and role checks. Their placement differs by domain.

Examples:

- `pet-transfer` validates path/body before DB and pet authorization: [functions/pet-transfer/src/services/transfer.ts](../functions/pet-transfer/src/services/transfer.ts#L29-L44).
- `pet-medical` authorizes the pet before parsing create/update body: [functions/pet-medical/src/services/bloodTest.ts](../functions/pet-medical/src/services/bloodTest.ts#L58-L86).
- `pet-source` validates/parses request body before loading the pet for authorization: [functions/pet-source/src/services/source.ts](../functions/pet-source/src/services/source.ts#L58-L75).
- `logistics` checks order ownership after body parse and DB order lookup: [functions/logistics/src/services/sfShipment.ts](../functions/logistics/src/services/sfShipment.ts#L41-L83).
- `ngo` uses a local `requireNgoContext` helper instead of direct `requireRole`, then performs DB lookups: [functions/ngo/src/services/ngo.ts](../functions/ngo/src/services/ngo.ts#L38-L51).

Standardization decision needed: define whether ownership checks happen before body parsing for protected resource routes. This affects security posture, invalid request behavior, and whether unauthorized callers can receive schema-specific validation errors.

### 4. Auth Guard Style Varies

Auth enforcement styles found:

- Direct shared `requireAuthContext(...)` in most domains.
- Direct shared `requireRole(...)` for privileged endpoints.
- Optional `getAuthContext(...)` for role/identity inspection.
- Domain-local auth wrappers/re-exports in `pet-profile`, `pet-analysis`, `pet-medical`, and `ngo`.
- Bespoke JWT parsing in `auth` challenge verification for optional linking flows.

Concrete examples:

- Direct role guard: `handleDispatchNotification` uses `requireRole` before parsing the body: [functions/notifications/src/services/notifications.ts](../functions/notifications/src/services/notifications.ts#L74-L82).
- Optional auth inspection: adoption detail chooses public vs managed flow with `getAuthContext`: [functions/pet-adoption/src/services/adoption.ts](../functions/pet-adoption/src/services/adoption.ts#L24-L36).
- Local pet authorization wrapper: `pet-profile` routes call domain helpers around `requireAuthContext`: [functions/pet-profile/src/utils/auth.ts](../functions/pet-profile/src/utils/auth.ts#L27-L61).
- Bespoke optional JWT parsing: auth challenge uses `getBearerToken` and `jwt.verify` directly: [functions/auth/src/services/challenge.ts](../functions/auth/src/services/challenge.ts#L31-L62).

Standardization decision needed: document when to use `requireAuthContext`, `requireRole`, `getAuthContext`, and domain-specific wrappers. Optional-auth flows should be named explicitly so they do not look like missing auth by accident.

### 5. Some Routes Look Accidentally Public Or Ambiguous

`logistics` metadata is inconsistent:

- `getToken` requires auth before DB/rate-limit: [functions/logistics/src/services/sfMetadata.ts](../functions/logistics/src/services/sfMetadata.ts#L24-L40).
- `getArea`, `getNetCode`, and `getPickupLocations` do not call `requireAuthContext`; they only use `getAuthContext` indirectly for a nullable rate-limit identifier: [functions/logistics/src/services/sfMetadata.ts](../functions/logistics/src/services/sfMetadata.ts#L49-L130).
- The router exposes all four lookup routes together: [functions/logistics/src/router.ts](../functions/logistics/src/router.ts#L8-L14).

Standardization decision needed: confirm whether those lookup routes are intended to be public. If protected, add the auth guard consistently. If public, document public flow and use a non-null IP/client identifier for rate limiting.

### 6. Validation Mechanism Varies Between Shared `parseBody` And Direct Zod

Most JSON routes use shared `parseBody`, but multipart and some transformed payloads use direct `schema.safeParse(...)` or mixed validation.

Examples:

- Shared `parseBody`: `handleCreatePetSource`: [functions/pet-source/src/services/source.ts](../functions/pet-source/src/services/source.ts#L62-L66).
- Direct Zod after multipart: `handleCreateOrder`: [functions/commerce-orders/src/services/orders.ts](../functions/commerce-orders/src/services/orders.ts#L90-L100).
- Direct Zod plus shared-style parsing/mapping appears in pet analysis uploads: [functions/pet-analysis/src/services/upload.ts](../functions/pet-analysis/src/services/upload.ts#L14-L43).
- Multipart parse catch style differs from JSON parse style in pet recovery create handlers: [functions/pet-recovery/src/services/petFound.ts](../functions/pet-recovery/src/services/petFound.ts#L29-L61).

Standardization decision needed: define a single validation flow for JSON and a parallel flow for multipart/transformed payloads, including standard error keys and whether malformed multipart errors are local 400s or shared handler errors.

### 7. Rate Limiting Placement Is Inconsistent

Rate limiting is usually DB-backed, so it often forces `connectToMongoDB()` earlier. However, invalid request bodies count against limits in some services and not in others.

Examples:

- Auth challenge parses body first, then helper connects and rate-limits by email/phone: [functions/auth/src/services/challenge.ts](../functions/auth/src/services/challenge.ts#L427-L452).
- `createShipment` connects and rate-limits before parsing the request body: [functions/logistics/src/services/sfShipment.ts](../functions/logistics/src/services/sfShipment.ts#L21-L41).
- `handleCreateOrder` connects and rate-limits before multipart/Zod validation: [functions/commerce-orders/src/services/orders.ts](../functions/commerce-orders/src/services/orders.ts#L77-L100).
- `handleCreateBloodTestRecord` connects and rate-limits before body parsing: [functions/pet-medical/src/services/bloodTest.ts](../functions/pet-medical/src/services/bloodTest.ts#L58-L86).

Standardization decision needed: decide whether invalid bodies should consume route-specific rate limits. If yes, use `auth -> db -> rateLimit -> parse`. If no, use `auth -> parse -> db -> rateLimit` where the rate-limit identifier does not depend on parsed body content.

## Domain Summary

| Domain | Main flow variants found | Notes |
| --- | --- | --- |
| `auth` | `parse -> db`, no top-level service catch | Challenge handlers parse first then delegate; optional verification uses bespoke JWT parsing. |
| `user` | `auth -> db` for get/delete, `auth -> parse -> db` for patch | Patch has local duplicate-key catch only. |
| `ngo` | local `requireNgoContext -> db`; patch parses before DB transaction | Uses local NGO context helper instead of shared `requireRole` directly. |
| `commerce-catalog` | public `db`, public `parse -> db` | No local catches. |
| `commerce-orders` | role reads use `role -> db`; create uses `auth -> db -> rateLimit -> multipart/direct Zod` | Heavy local cleanup catches in create only. |
| `commerce-fulfillment` | mixed `try -> auth/role -> db`, `auth -> db`, `auth -> parse -> db`, `role -> parse` | Most inconsistent domain for local catch policy. |
| `logistics` | protected routes use `auth -> try -> db -> rateLimit -> parse`; some metadata routes omit auth | Need confirm public/protected intent for lookup routes. |
| `notifications` | `auth/role -> db`, dispatch uses `role -> parse -> db` | No local catches. |
| `pet-adoption` | public browse uses local catches; managed uses `auth -> parse/db -> identity` in top catches | `adoption.ts` dispatches between public and managed using optional auth. |
| `pet-analysis` | `auth -> db -> parse/multipart`; mixed catch policy | Upload has no catch; eye post catches provider flow; breed parses after DB. |
| `pet-biometric` | trivial proxy response | No auth/db/parse flow. |
| `pet-medical` | mostly `auth -> db -> rateLimit/identity -> parse` | Consistent within domain, but differs from parse-before-DB domains. |
| `pet-profile` | mostly `auth -> db -> multipart/parse -> identity` with local known-error catches | Public tag lookup is `db` only. |
| `pet-recovery` | `auth -> db`, create uses multipart/direct Zod/shared parse mix | No broad service catch; multipart parse handled locally. |
| `pet-source` | `try -> auth -> parse -> db -> identity` for writes, `try -> auth -> db -> identity` for read | Local `toErrorResponse` pattern is clean but not shared by all domains. |
| `pet-transfer` | `try -> auth -> path/body validation -> db -> identity` | One of the more internally consistent domains. |

## Candidate Canonical Flow To Decide Next

Recommended discussion baseline:

1. `requireAuthContext` / `requireRole` first for protected routes.
2. Validate path/query params next when they do not need DB.
3. Parse/validate JSON body before DB by default.
4. Connect to MongoDB only after cheap auth and request-shape failures are handled.
5. Apply DB-backed rate limiting after DB connect; explicitly decide whether invalid bodies should count against the limiter.
6. Perform identity/ownership checks before business mutation; decide whether these should happen before or after body parsing for protected resource routes.
7. Use local `try/catch` only for known domain/provider translations and compensating actions; let unknown errors bubble to shared `createApiGatewayHandler`.
8. Keep multipart as a documented exception: auth first, multipart parse, normalize payload, shared-style Zod result mapping, then DB/identity/business flow unless DB-backed rate limiting must happen first.

Open decisions before implementation:

- Should unauthorized callers receive 401/403 before body validation errors on every protected route?
- Should invalid request bodies consume route-specific rate limits?
- Should all service-level catches rethrow unknown errors instead of returning local 500s?
- Should direct `schema.safeParse(...)` be wrapped behind a shared helper for transformed/multipart payloads?
- Are logistics lookup routes intentionally public?

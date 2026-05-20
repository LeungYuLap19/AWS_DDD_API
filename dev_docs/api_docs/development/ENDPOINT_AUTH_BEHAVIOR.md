# Endpoint Auth Behavior

**Stage:** `development`  
**Base URL:** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

## Purpose

This file is the single auth-behavior source of truth for `dev_docs/api_docs/development`.

Per-lambda docs in `development` must:

- reference this file for endpoint auth behavior
- not restate gateway `401` / `403` mechanics
- only document endpoint-specific business authorization rules when needed

## Source Of Truth

Auth behavior in this file is derived from:

- [template.yaml](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/template.yaml)
- [functions/request-authorizer/index.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/request-authorizer/index.ts)
- [functions/auth/src/services/challenge.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/auth/src/services/challenge.ts)
- live development-stage verification run on **2026-05-16**

## Global API Gateway Defaults

These defaults come from `template.yaml` API-level auth config and apply unless a route overrides them.

| Setting | Value |
| --- | --- |
| API key source | Header |
| Default API-key requirement | `true` |
| Default authorizer | `DddTokenAuthorizer` |
| Authorizer identity header | `Authorization` |
| Authorizer validation expression | `^Bearer .+$` |
| `OPTIONS` preflight default | `Authorizer: NONE`, `ApiKeyRequired: false` |

## Header Requirements By Class

| Auth class | Required headers | Optional headers | API Gateway authorizer | JWT validation owner |
| --- | --- | --- | --- | --- |
| Class A: `gateway-jwt` | `x-api-key`, `Authorization: Bearer <access-token>` | — | default `DddTokenAuthorizer` | API Gateway |
| Class B: `gateway-api-key-only` | `x-api-key` | `Authorization` does not change gateway behavior | `NONE` | not applicable |
| Class C: `lambda-optional-jwt` | `x-api-key` | `Authorization: Bearer <access-token>` | `NONE` | Lambda, when `Authorization` is sent |
| Class D: `preflight` | none | none | `NONE` | not applicable |

## Route Classes

Every documented route belongs to exactly one auth class.

### Class A: `gateway-jwt`

**Route inventory**

- `GET /user/me`
- `PATCH /user/me`
- `DELETE /user/me`
- `GET /ngo/me`
- `PATCH /ngo/me`
- `GET /ngo/me/members`
- `POST /pet/profile`
- `GET /pet/profile/{petId}`
- `PATCH /pet/profile/{petId}`
- `DELETE /pet/profile/{petId}`
- `GET /pet/profile/me`
- `GET /pet/source/{petId}`
- `POST /pet/source/{petId}`
- `PATCH /pet/source/{petId}`
- `POST /pet/transfer/{petId}`
- `PATCH /pet/transfer/{petId}/{transferId}`
- `DELETE /pet/transfer/{petId}/{transferId}`
- `POST /pet/transfer/{petId}/ngo-reassignment`
- `GET /pet/adoption/{petId}`
- `POST /pet/adoption/{petId}`
- `PATCH /pet/adoption/{petId}`
- `DELETE /pet/adoption/{petId}`
- `GET /pet/medical/{petId}/general`
- `POST /pet/medical/{petId}/general`
- `PATCH /pet/medical/{petId}/general/{medicalId}`
- `DELETE /pet/medical/{petId}/general/{medicalId}`
- `GET /pet/medical/{petId}/medication`
- `POST /pet/medical/{petId}/medication`
- `PATCH /pet/medical/{petId}/medication/{medicationId}`
- `DELETE /pet/medical/{petId}/medication/{medicationId}`
- `GET /pet/medical/{petId}/deworming`
- `POST /pet/medical/{petId}/deworming`
- `PATCH /pet/medical/{petId}/deworming/{dewormId}`
- `DELETE /pet/medical/{petId}/deworming/{dewormId}`
- `GET /pet/medical/{petId}/blood-test`
- `POST /pet/medical/{petId}/blood-test`
- `PATCH /pet/medical/{petId}/blood-test/{bloodTestId}`
- `DELETE /pet/medical/{petId}/blood-test/{bloodTestId}`
- `GET /pet/medical/{petId}/vaccination`
- `POST /pet/medical/{petId}/vaccination`
- `PATCH /pet/medical/{petId}/vaccination/{vaccineId}`
- `DELETE /pet/medical/{petId}/vaccination/{vaccineId}`
- `GET /pet/analysis/eye/{petId}`
- `POST /pet/analysis/eye/{petId}`
- `PATCH /pet/analysis/eye/{petId}`
- `POST /pet/analysis/breed`
- `POST /pet/analysis/uploads/image`
- `POST /pet/analysis/uploads/breed-image`
- `POST /pet/recovery/lost`
- `DELETE /pet/recovery/lost/{petLostID}`
- `DELETE /pet/recovery/found/{petFoundID}`
- `GET /pet/biometric/{petId}`
- `DELETE /pet/biometric/{petId}`
- `POST /pet/biometric/{petId}/registrations`
- `POST /pet/biometric/{petId}/verifications`
- `GET /notifications/me`
- `PATCH /notifications/me/{notificationId}`
- `POST /notifications/dispatch`
- `GET /commerce/orders`
- `GET /commerce/orders/operations`
- `GET /commerce/orders/{tempId}`
- `GET /commerce/fulfillment`
- `DELETE /commerce/fulfillment/{orderVerificationId}`
- `PATCH /commerce/fulfillment/tags/{tagId}`
- `GET /commerce/fulfillment/suppliers/{orderId}`
- `PATCH /commerce/fulfillment/suppliers/{orderId}`
- `POST /logistics/shipments`

### Class B: `gateway-api-key-only`

**Route inventory**

- `POST /auth/challenges`
- `POST /auth/login/ngo`
- `POST /auth/registrations/user`
- `POST /auth/registrations/ngo`
- `POST /auth/tokens/refresh`
- `GET /pet/profile/by-tag/{tagId}`
- `GET /pet/adoption`
- `GET /pet/adoption/detail/{adoptionId}`
- `GET /pet/analysis/eye/disease/{eyeDiseaseName}`
- `GET /pet/reference/breed/{animalType}`
- `GET /pet/reference/deworm`
- `GET /commerce/catalog`
- `POST /commerce/orders`
- `POST /commerce/catalog/events`
- `GET /commerce/catalog/ptag-products`
- `GET /commerce/catalog/ptag-products/{productId}`
- `GET /commerce/storefront`
- `POST /commerce/storefront/shop-code-verifications`
- `GET /pet/recovery/lost`
- `GET /pet/recovery/found`
- `POST /pet/recovery/found`
- `GET /commerce/fulfillment/tags/{tagId}`
- `GET /commerce/fulfillment/share-links/whatsapp/{verificationId}`
- `POST /commerce/commands/ptag-detection-email`
- `POST /logistics/token`
- `POST /logistics/cloud-waybill`
- `POST /logistics/lookups/areas`
- `POST /logistics/lookups/net-codes`
- `POST /logistics/lookups/pickup-locations`

### Class C: `lambda-optional-jwt`

**Route inventory**

- `POST /auth/challenges/verify`

### Class D: `preflight`

**Route inventory**

- every documented `OPTIONS` route

### Out Of Scope

These routes are not part of the product API docs rewrite and are not covered by this file:

- `/pipeline/smoke`

## Exact Behavior By Class

### Class A: `gateway-jwt`

Use this matrix for all Class A routes.

| Request shape | Result owner | Observed result |
| --- | --- | --- |
| both `x-api-key` and `Authorization` missing | API Gateway | `401 {"message":"Unauthorized"}` |
| `x-api-key` missing, `Authorization` present but not `Bearer <token>` | API Gateway | `401 {"message":"Unauthorized"}` |
| `x-api-key` present, `Authorization` missing | API Gateway | `401 {"message":"Unauthorized"}` |
| `x-api-key` present, `Authorization` present but not `Bearer <token>` | API Gateway | `401 {"message":"Unauthorized"}` |
| `x-api-key` present, `Authorization: Bearer <token>` present but token is not a JWT | domain Lambda | `401 common.unauthorized` |
| `x-api-key` present, Bearer JWT has invalid signature | domain Lambda | `401 common.unauthorized` |
| `x-api-key` present, Bearer JWT is expired | domain Lambda | `401 common.unauthorized` |
| `x-api-key` present, Bearer JWT omits both `userId` and `sub` | domain Lambda | `401 common.unauthorized` |
| `x-api-key` present, lowercase `bearer` scheme | API Gateway | `401 {"message":"Unauthorized"}` |
| `x-api-key` present, `Authorization: Bearer ` with no token | API Gateway | `401 {"message":"Unauthorized"}` |
| `x-api-key` present, `alg:none` token | domain Lambda | `401 common.unauthorized` |
| valid Bearer JWT present, `x-api-key` missing | API Gateway | `403 {"message":"Forbidden"}` |
| validly signed Bearer JWT with `userId` present | domain Lambda | request reaches the Lambda; final status becomes route-specific |
| validly signed Bearer JWT with `sub` present and no `userId` | domain Lambda | treated the same as `userId`; request reaches the Lambda |

**Notes**

- Gateway-generated failures (missing API key, missing/malformed `Authorization` header) do not use the shared `{ success, errorKey, requestId }` envelope.
- If both the API key and `Authorization` are missing, the observed response still follows the missing-authorization `401` path.
- An expired or invalid JWT passes through the authorizer (Allow with empty context) and is rejected by the domain Lambda with `401 common.unauthorized` including CORS headers.
- Once a JWT passes verification, the Lambda may still return route-level `403`, `404`, `409`, or success.
- A valid JWT does not imply business authorization.

### Class B: `gateway-api-key-only`

Use this matrix for all Class B routes.

| Request shape | Result owner | Observed result |
| --- | --- | --- |
| `x-api-key` missing | API Gateway | `403 {"message":"Forbidden"}` |
| valid `x-api-key`, malformed or garbage `Authorization` present | domain Lambda | same behavior as if `Authorization` were absent |
| valid `x-api-key`, lowercase `bearer` scheme | domain Lambda | same behavior as if `Authorization` were absent |
| valid `x-api-key`, `Authorization: Bearer ` with no token | domain Lambda | same behavior as if `Authorization` were absent |
| valid `x-api-key`, `alg:none` token | domain Lambda | same behavior as if `Authorization` were absent |
| valid `x-api-key` present | domain Lambda | final status becomes route-specific |

**Notes**

- API Gateway does not validate `Authorization` for this class.
- Sending an `Authorization` header does not change gateway behavior for this class.
- Gateway-generated API-key failures do not use the shared `{ success, errorKey, requestId }` envelope.

### Class C: `lambda-optional-jwt`

Use this matrix only for `/auth/challenges/verify`.

| Request shape | Result owner | Observed result |
| --- | --- | --- |
| `x-api-key` missing | API Gateway | `403 {"message":"Forbidden"}` |
| `x-api-key` missing, any `Authorization` header present | API Gateway | same `403 {"message":"Forbidden"}`; Lambda optional-JWT logic is not reached |
| valid `x-api-key`, `Authorization` missing | auth Lambda | request continues on unauthenticated branch |
| valid `x-api-key`, malformed `Authorization` header | auth Lambda | `401 common.unauthorized` |
| valid `x-api-key`, Bearer token is not a JWT | auth Lambda | `401 common.unauthorized` |
| valid `x-api-key`, Bearer JWT has invalid signature | auth Lambda | `401 common.unauthorized` |
| valid `x-api-key`, Bearer JWT is expired | auth Lambda | `401 common.unauthorized` |
| valid `x-api-key`, Bearer JWT omits both `userId` and `sub` | auth Lambda | `401 common.unauthorized` |
| valid `x-api-key`, lowercase `bearer` scheme | auth Lambda | `401 common.unauthorized` |
| valid `x-api-key`, `Authorization: Bearer ` with no token | auth Lambda | `401 common.unauthorized` |
| valid `x-api-key`, `alg:none` token | auth Lambda | `401 common.unauthorized` |
| valid `x-api-key`, valid JWT with `sub` only and real user | auth Lambda | `sub` is accepted the same as `userId`; route proceeds normally |
| valid `x-api-key`, valid JWT whose `userId` no longer exists | auth Lambda | `401 common.unauthorized` once the route reaches the linking branch |
| valid `x-api-key`, valid JWT whose `sub` no longer exists | auth Lambda | `401 common.unauthorized` once the route reaches the linking branch |
| valid `x-api-key`, repeated bad-code attempts on same identifier | auth Lambda | `429 common.rateLimited` can occur before optional JWT parsing matters |

**Notes**

- This class is the only documented exception to Class B.
- JWT parsing here is implemented inside the auth Lambda, not at API Gateway.
- An expired access JWT in this class does not produce `auth.expiredToken`; current shared-handler behavior returns `401 common.unauthorized`.

### Class D: `preflight`

Use this rule for all documented `OPTIONS` routes.

| Request shape | Result owner | Observed result |
| --- | --- | --- |
| `OPTIONS` request | API Gateway | no API key required; no JWT required |

## Request Authorizer Contract

When a Class A route reaches the request authorizer:

- token is read from `Authorization`
- JWT algorithm is HS256
- accepted identity claim is `userId` or `sub`
- authorizer **always returns Allow** — invalid/expired tokens pass through with empty context
- authorizer context on success includes:
  - `userId`
  - `userEmail`
  - `userRole`
  - `ngoId`
  - `ngoName`
- authorizer context on failure (expired, invalid, missing claims): empty (no `userId`)

The domain Lambda calls `requireAuthContext(event)` which returns `401 common.unauthorized` with CORS headers when no `userId` is present in the authorizer context. This ensures auth failures always include `Access-Control-Allow-Origin` in the response.

## What Per-Lambda Docs Must Still Document

This file does **not** replace endpoint-specific authorization rules such as:

- ownership checks
- role checks
- NGO access checks
- admin-only restrictions
- refresh-cookie requirements
- whether a valid JWT can still produce route-level `403 common.forbidden`

Per-lambda docs in `development` should document those rules, but should not restate the gateway mechanics defined here.

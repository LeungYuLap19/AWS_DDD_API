# Pet Source API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-pet-source`

Single-record rescue and origin metadata for a pet. Each pet can have at most one source record. This document reflects the current DDD handler contract and its Tier 2 integration tests rather than the legacy top-level `form` transport.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/pet/source/{petId}` | `x-api-key` + Bearer JWT | Return the source record for a pet, or `data: null` if none exists |
| POST | `/pet/source/{petId}` | `x-api-key` + Bearer JWT | Create the pet's source record |
| PATCH | `/pet/source/{petId}` | `x-api-key` + Bearer JWT | Update an existing source record |

### Contract Notes

| Topic | Current DDD behavior |
| --- | --- |
| Success wrapper | GET and POST return the record in `data`; PATCH returns only `success`, `message`, and `requestId` |
| Empty state | `GET` returns `200` with `data: null` when no source record exists |
| Record identity | Returned source records expose `id` inside `data`; internal `_id` is removed |
| One-record rule | `POST` returns `409 petSource.errors.duplicateRecord` if a record already exists for the pet |
| Allowed fields | `placeofOrigin`, `channel`, `rescueCategory`, `causeOfInjury` |
| Ownership model | Access is allowed when `pet.userId === jwt.userId` or `pet.ngoId === jwt.ngoId` |
| Write throttling | `POST` and `PATCH` are rate-limited at 120 requests per 5 minutes per IP and 60 requests per 5 minutes per authenticated user |

---

## API Gateway And Auth Rules

### API Gateway Requirements

`/pet/source/{petId}` routes inherit the API's default authorizer and API-key requirement.

| Route group | API key required at API Gateway | API Gateway authorizer |
| --- | --- | --- |
| `/pet/source/{petId}` GET, POST, PATCH | Yes | `DddTokenAuthorizer` |
| `/pet/source/{petId}` OPTIONS | No | None |

Required deployed headers:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
```

If the API key or Bearer JWT is missing/invalid, API Gateway can reject the request before the Lambda runs. In deployed environments, those auth failures are not guaranteed to use the shared `{ success, errorKey, requestId }` envelope.

For POST and PATCH, also send:

```http
Content-Type: application/json
```

### Authorization Rules

All routes require a valid Bearer JWT. The Lambda then loads the target pet and authorizes the caller when either condition is true:

- `pet.userId === jwt.userId`
- `pet.ngoId === jwt.ngoId`

If the pet does not exist or is soft-deleted, the route returns `404 petSource.errors.petNotFound`. If the pet exists but the caller does not own it, the route returns `403 common.forbidden`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale is `en`
- `errorKey` is the stable integration contract

### Authentication And Parse Behavior

- Missing/invalid API key or JWT can be rejected at API Gateway before Lambda parsing or authorization begins
- `POST` and `PATCH` use shared `parseBody` with strict Zod schemas
- Malformed JSON, unknown extra fields, and schema mismatches return `400 common.invalidBodyParams`
- Empty JSON bodies return `400 common.missingBodyParams`

---

## Response And Validation Rules

### Success Response Shape

GET and POST use the shared success envelope with `data`.

```json
{
  "success": true,
  "message": "localized success message",
  "data": {},
  "requestId": "aws-lambda-request-id"
}
```

PATCH returns the same envelope without `data`.

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petSource.errors.duplicateRecord",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

### Request Body Validation

POST and PATCH parse JSON through the shared `parseBody` helper.

Allowed fields:

| Field | Type | Notes |
| --- | --- | --- |
| `placeofOrigin` | string | Max 200 chars |
| `channel` | string | Max 200 chars |
| `rescueCategory` | string[] | Max 50 items |
| `causeOfInjury` | string | Max 200 chars |

Important validation behavior:

- `POST` requires at least one of `placeofOrigin` or `channel`
- Unknown fields are rejected because the schema is strict
- Empty PATCH bodies fail before update logic runs with `400 common.missingBodyParams`
- With the current strict schema and parseBody defaults, the internal `common.noFieldsToUpdate` branch is not normally reachable

Observed error keys in the current tested contract:

| Condition | `errorKey` |
| --- | --- |
| Malformed JSON | `common.invalidBodyParams` |
| Empty JSON body | `common.missingBodyParams` |
| Unknown field or schema mismatch | `common.invalidBodyParams` |
| POST missing both `placeofOrigin` and `channel` | `petSource.errors.missingRequiredFields` |
| Missing `petId` path param | `common.missingPathParams` |
| Invalid `petId` path param | `common.invalidObjectId` |

### Source Record Shape

GET and POST return the source record in `data` with internal `_id` removed and `id` added.

Typical returned fields:

- `id`
- `petId`
- `placeofOrigin`
- `channel`
- `rescueCategory`
- `causeOfInjury`
- `createdAt`
- `updatedAt`

---

## Endpoints

### GET /pet/source/{petId}

Return the source record for a pet.

**Lambda owner:** `pet-source`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Parameter | Type | Required |
| --- | --- | --- |
| `petId` | string | Yes |

#### Get Success (200)

Record exists:

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d",
    "petId": "665f0000000000000000abcd",
    "placeofOrigin": "Street rescue",
    "channel": "Volunteer",
    "rescueCategory": ["injured"],
    "causeOfInjury": "Leg wound"
  },
  "requestId": "aws-lambda-request-id"
}
```

No record exists yet:

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": null,
  "requestId": "aws-lambda-request-id"
}
```

#### Get Common Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingPathParams` | Missing `petId` |
| 400 | `common.invalidObjectId` | Invalid `petId` format |
| 401 / 403 | Gateway-generated; do not rely on unified `errorKey` | Missing/invalid API key or JWT can be rejected before Lambda runs |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petSource.errors.petNotFound` | Pet does not exist or is soft-deleted |
| 500 | `common.internalError` | Unexpected error |

### POST /pet/source/{petId}

Create the pet's single source record.

**Lambda owner:** `pet-source`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Post Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `placeofOrigin` | string | Conditional | One of `placeofOrigin` or `channel` is required |
| `channel` | string | Conditional | One of `placeofOrigin` or `channel` is required |
| `rescueCategory` | string[] | No | |
| `causeOfInjury` | string | No | |

#### Post Example Request

```json
{
  "placeofOrigin": "Shelter",
  "channel": "Referral",
  "rescueCategory": ["injured"],
  "causeOfInjury": "Leg wound"
}
```

#### Post Success (201)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d",
    "petId": "665f0000000000000000abcd",
    "placeofOrigin": "Shelter",
    "channel": "Referral",
    "rescueCategory": ["injured"],
    "causeOfInjury": null
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Post Common Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Malformed JSON or invalid field shape |
| 400 | `common.missingBodyParams` | Empty JSON body |
| 400 | `petSource.errors.missingRequiredFields` | Both `placeofOrigin` and `channel` missing |
| 400 | `common.missingPathParams` | Missing `petId` |
| 400 | `common.invalidObjectId` | Invalid `petId` |
| 401 / 403 | Gateway-generated; do not rely on unified `errorKey` | Missing/invalid API key or JWT can be rejected before Lambda runs |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petSource.errors.petNotFound` | Pet not found |
| 409 | `petSource.errors.duplicateRecord` | Record already exists for this pet |
| 429 | `common.rateLimited` | Write rate limit exceeded |
| 500 | `common.internalError` | Unexpected error |

### PATCH /pet/source/{petId}

Update an existing source record.

**Lambda owner:** `pet-source`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Patch Body

Any subset of the same allowed source fields may be supplied.

#### Patch Example Request

```json
{
  "causeOfInjury": "Recovered",
  "rescueCategory": ["rehomed"]
}
```

#### Patch Success (200)

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

Note: the current handler does not return updated source data on PATCH. Refetch with `GET /pet/source/{petId}` if the updated document is needed.

#### Patch Common Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Unknown field or invalid value |
| 400 | `common.missingBodyParams` | Empty JSON body |
| 400 | `common.missingPathParams` | Missing `petId` |
| 400 | `common.invalidObjectId` | Invalid `petId` |
| 401 / 403 | Gateway-generated; do not rely on unified `errorKey` | Missing/invalid API key or JWT can be rejected before Lambda runs |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petSource.errors.petNotFound` | Pet not found |
| 404 | `petSource.errors.recordNotFound` | Source record does not exist for this pet |
| 429 | `common.rateLimited` | Write rate limit exceeded |
| 500 | `common.internalError` | Unexpected error |

---

## Frontend Integration Guide

1. Load `GET /pet/source/{petId}` to determine whether a pet already has a source record. `data: null` is the normal empty state.
2. Use `POST /pet/source/{petId}` only for first-time creation. If the UI does not know whether a record exists, fetch first instead of optimistically posting.
3. On `409 petSource.errors.duplicateRecord`, switch the UI into edit mode and refetch with GET.
4. On PATCH success, refetch if the UI needs the updated source object because the current handler does not return it.
5. Surface `common.invalidObjectId`, `petSource.errors.petNotFound`, and `common.forbidden` distinctly because they represent different frontend recovery paths.

---

## Verification Snapshot

Current verification evidence for this domain is in [pet-source.test.js](../../../__tests__/pet-source.test.js). That Tier 2 suite proves the post-migration `data` wrapper, duplicate-record handling, strict body validation, and the no-payload PATCH success contract. A separate SAM suite exists at [pet-source.sam.test.js](../../../__tests__/pet-source.sam.test.js), but local SAM remains less meaningful than deployed development-stage verification for this repo's current environment constraints.

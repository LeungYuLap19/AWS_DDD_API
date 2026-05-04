<!-- markdownlint-disable MD024 -->
# Pet Source API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Rescue / origin record management for a pet. Each pet has at most one source record. All routes require an authenticated caller who is the individual owner or the NGO owner of the pet.

## Overview

| Method | Path | Auth | Lambda | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/pet/source/{petId}` | `x-api-key` + Bearer JWT | `pet-source` | Retrieve the rescue/origin record for a pet; returns `form: null` when none exists |
| POST | `/pet/source/{petId}` | `x-api-key` + Bearer JWT | `pet-source` | Create a new rescue/origin record for a pet |
| PATCH | `/pet/source/{petId}` | `x-api-key` + Bearer JWT | `pet-source` | Partially update an existing rescue/origin record |

## Integration-Critical Contract Notes

| Topic | Current DDD behavior |
| --- | --- |
| One record per pet | `pet_sources` has a unique index on `petId`. There is no replace or upsert path; POST returns `409` if a record already exists. |
| GET with no record | `GET` always returns `200`. When no source record exists, `form` is `null` and `sourceId` is absent from the response. |
| PATCH response | PATCH does **not** return the updated `form`. It returns `{ petId, sourceId }` only. Refetch via `GET /pet/source/{petId}` if the updated document is needed. |
| POST required fields | At least one of `placeofOrigin` or `channel` must be supplied. A body containing only `rescueCategory` or `causeOfInjury` is rejected with `400`. |
| `placeofOrigin` casing | The field name is `placeofOrigin` (lowercase `o`). Using `placeOfOrigin` is an unknown field and will trigger `400 common.invalidBodyParams`. |
| Unknown fields | Both POST and PATCH reject extra fields (mass-assignment protection). Any key not in the allowed set returns `400 common.invalidBodyParams`. |
| Ownership check | Lambda authorizes access by checking `pet.userId === jwt.userId` **or** `pet.ngoId === jwt.ngoId`. A non-owner caller receives `403 common.forbidden`. |
| Soft-deleted pets | Pets with `deleted: true` are treated as non-existent and return `404 petSource.errors.petNotFound`. |

## API Gateway And Auth Rules

### API Gateway Requirements

| Route group | API key required | API Gateway authorizer |
| --- | --- | --- |
| `GET /pet/source/{petId}` | Yes | `DddTokenAuthorizer` |
| `POST /pet/source/{petId}` | Yes | `DddTokenAuthorizer` |
| `PATCH /pet/source/{petId}` | Yes | `DddTokenAuthorizer` |
| `OPTIONS /pet/source/{petId}` | No | None |

All protected deployed requests must send:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
Content-Type: application/json
```

`OPTIONS` preflight does not require `x-api-key` and returns `204` with CORS headers.

### Authorization And Ownership

Protected routes require a valid Bearer JWT issued by the platform's token authorizer.

The Lambda authorizes pet access when either condition is true:

- `pet.userId === jwt.userId`
- `pet.ngoId` is set and `pet.ngoId === jwt.ngoId`

A caller that does not match either condition receives `403 common.forbidden`.

### Localization

- Locale priority: query `?lang`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale: `en`
- `errorKey` is the stable integration key; `error` and `message` are localized strings

### Success Response Shape

All Lambda-produced success responses include `success: true` and `requestId`.

```json
{
  "success": true,
  "message": "Rescue/origin information retrieved successfully",
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petSource.errors.petNotFound",
  "error": "Pet not found",
  "requestId": "aws-lambda-request-id"
}
```

### Request Body Validation

POST and PATCH bodies are parsed as `application/json`. The Lambda runs the body through Zod schemas via the shared `parseBody` helper.

Allowed fields for both POST and PATCH:

| Field | Type |
| --- | --- |
| `placeofOrigin` | string (optional) |
| `channel` | string (optional) |
| `rescueCategory` | string[] (optional) |
| `causeOfInjury` | string (optional) |

Any key outside this set is rejected with `400 common.invalidBodyParams` before ownership or DB checks run.

`parseBody` returns these standardized `400` `errorKey`s:

| Condition | `errorKey` |
| --- | --- |
| Malformed JSON (body is not valid JSON) | `common.invalidBodyParams` |
| Empty body (`{}`, `null`, or missing) | `common.missingParams` |
| Unknown field supplied | `common.invalidBodyParams` |
| Zod schema rejected the body and the first issue message is a dotted i18n key | that key |

After `parseBody` succeeds, the PATCH handler performs one additional check:

| Condition | `errorKey` |
| --- | --- |
| All supplied body fields resolve to `undefined` (none selected for `$set`) | `common.noFieldsToUpdate` |

---

## Source Record Shape

`__v` and `_id` are stripped before any record is returned. The MongoDB `_id` of the source record is always available as the top-level `sourceId` field instead.

### GET form shape (when a record exists)

The GET handler selects only these fields from MongoDB: `_id placeofOrigin channel rescueCategory causeOfInjury createdAt updatedAt`. Neither `_id` nor `petId` is present inside `form`. Both are returned as top-level fields (`sourceId` and `petId`).

| Field | Type | Notes |
| --- | --- | --- |
| `placeofOrigin` | string or null | Default `null` |
| `channel` | string or null | Default `null` |
| `rescueCategory` | string[] | Default `[]` |
| `causeOfInjury` | string or null | Default `null` |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |

### POST form shape

The POST handler returns the created Mongoose document after stripping `__v` and `_id`. `petId` **is** present inside `form` (as well as in the top-level `petId` field). The record's `_id` is returned as the top-level `sourceId`.

| Field | Type | Notes |
| --- | --- | --- |
| `petId` | string | MongoDB ObjectId of the pet |
| `placeofOrigin` | string or null | Stored value or `null` |
| `channel` | string or null | Stored value or `null` |
| `rescueCategory` | string[] | Stored value or `[]` |
| `causeOfInjury` | string or null | Stored value or `null` |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |

---

## Endpoints

### GET /pet/source/{petId}

Retrieve the rescue/origin record for a pet. Returns `form: null` when no record exists — this is a normal state, not an error.

**Lambda:** `pet-source`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId of the pet |

#### Success — record exists (200)

```json
{
  "success": true,
  "message": "Rescue/origin information retrieved successfully",
  "petId": "6820000000000000000abc01",
  "sourceId": "6820000000000000000def01",
  "form": {
    "placeofOrigin": "Street rescue",
    "channel": "Volunteer",
    "rescueCategory": ["injured"],
    "causeOfInjury": "Leg wound",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-02T00:00:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

Note: `form` does not contain `_id` or `petId`. The source record identity is `sourceId` and the pet identity is `petId`, both at the top level.

#### Success — no record yet (200)

```json
{
  "success": true,
  "message": "Rescue/origin information retrieved successfully",
  "petId": "6820000000000000000abc01",
  "form": null,
  "requestId": "aws-lambda-request-id"
}
```

Note: `sourceId` is absent when `form` is `null`.

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petSource.errors.missingPetId` | `petId` path parameter absent |
| 400 | `petSource.errors.invalidPetId` | `petId` is not a valid MongoDB ObjectId |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petSource.errors.petNotFound` | Pet does not exist or is soft-deleted |
| 500 | `common.internalError` | Unexpected error (e.g., DB connection failure) |

---

### POST /pet/source/{petId}

Create a rescue/origin record for a pet. A pet can have at most one source record.

**Lambda:** `pet-source`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId of the pet |

#### Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `placeofOrigin` | string | Conditional | At least one of `placeofOrigin` or `channel` must be provided |
| `channel` | string | Conditional | At least one of `placeofOrigin` or `channel` must be provided |
| `rescueCategory` | string[] | No | Defaults to `[]` in the stored record |
| `causeOfInjury` | string | No | Defaults to `null` in the stored record |

At least one of `placeofOrigin` or `channel` must be non-empty. A body with only `rescueCategory` or `causeOfInjury` is rejected.

**Example request:**

```json
{
  "placeofOrigin": "Street rescue",
  "channel": "Volunteer",
  "rescueCategory": ["injured"],
  "causeOfInjury": "Leg wound"
}
```

#### Success (201)

```json
{
  "success": true,
  "message": "Rescue/origin record created successfully",
  "petId": "6820000000000000000abc01",
  "sourceId": "6820000000000000000def01",
  "form": {
    "petId": "6820000000000000000abc01",
    "placeofOrigin": "Street rescue",
    "channel": "Volunteer",
    "rescueCategory": ["injured"],
    "causeOfInjury": "Leg wound",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petSource.errors.missingPetId` | `petId` path parameter absent |
| 400 | `petSource.errors.invalidPetId` | `petId` is not a valid MongoDB ObjectId |
| 400 | `petSource.errors.missingRequiredFields` | Both `placeofOrigin` and `channel` are absent or empty |
| 400 | `common.invalidBodyParams` | Malformed JSON, unknown fields, or Zod schema rejection |
| 400 | `common.missingParams` | Empty or missing body (`{}`, `null`, or absent) |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petSource.errors.petNotFound` | Pet does not exist or is soft-deleted |
| 409 | `petSource.errors.duplicateRecord` | A source record already exists for this pet |
| 500 | `common.internalError` | Unexpected error |

---

### PATCH /pet/source/{petId}

Partially update an existing rescue/origin record. Only the fields provided in the body are written. PATCH does not return the updated document — use `GET /pet/source/{petId}` to retrieve it.

**Lambda:** `pet-source`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId of the pet |

#### Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `placeofOrigin` | string | No | Replaces the stored value |
| `channel` | string | No | Replaces the stored value |
| `rescueCategory` | string[] | No | Replaces the stored array entirely |
| `causeOfInjury` | string | No | Replaces the stored value |

At least one recognized field must be provided. A body that is empty or contains only unknown fields is rejected.

**Example request:**

```json
{
  "causeOfInjury": "Recovered"
}
```

#### Success (200)

PATCH returns `petId` and `sourceId` only. The updated document is not included.

```json
{
  "success": true,
  "message": "Rescue/origin record updated successfully",
  "petId": "6820000000000000000abc01",
  "sourceId": "6820000000000000000def01",
  "requestId": "aws-lambda-request-id"
}
```

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petSource.errors.missingPetId` | `petId` path parameter absent |
| 400 | `petSource.errors.invalidPetId` | `petId` is not a valid MongoDB ObjectId |
| 400 | `common.invalidBodyParams` | Malformed JSON, unknown fields, or Zod schema rejection |
| 400 | `common.missingParams` | Empty or missing body (`{}`, `null`, or absent) |
| 400 | `common.noFieldsToUpdate` | Body is valid but every supplied field resolved to `undefined` in the update |  
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petSource.errors.petNotFound` | Pet does not exist or is soft-deleted |
| 404 | `petSource.errors.recordNotFound` | No source record exists for this pet; call POST first |
| 500 | `common.internalError` | Unexpected error |

---

## Frontend Integration Guide

### Typical flow

```
1. GET /pet/source/{petId}
   → form: null          → show empty form; user fills in origin data → POST
   → form: { ... }       → populate form fields; allow editing → PATCH

2. POST /pet/source/{petId}
   → 201 { form, sourceId }  → cache sourceId for future PATCH calls
   → 409 duplicateRecord     → source record already exists; switch to PATCH flow

3. PATCH /pet/source/{petId}
   → 200 { sourceId }        → refetch with GET if updated form data is needed
   → 404 recordNotFound      → source record missing; switch to POST flow
```

### Branch conditions

| `errorKey` on POST | Frontend action |
| --- | --- |
| `petSource.errors.duplicateRecord` | Switch to PATCH |
| `petSource.errors.missingRequiredFields` | Show field-level error: at least one of `placeofOrigin` or `channel` is required |
| `common.invalidBodyParams` | Validate field names — check that `placeofOrigin` uses lowercase `o` |

| `errorKey` on PATCH | Frontend action |
| --- | --- |
| `petSource.errors.recordNotFound` | Source record does not exist yet; switch to POST |
| `common.noFieldsToUpdate` | At least one field must be changed |
| `common.invalidBodyParams` | An unknown field was sent; check field names |

### Field name gotcha

The field is `placeofOrigin` (lowercase `o`), **not** `placeOfOrigin`. Sending `placeOfOrigin` will trigger `400 common.invalidBodyParams` because it is treated as an unknown field.

---

## Error Key Reference

| `errorKey` | HTTP status | Meaning |
| --- | --- | --- |
| `petSource.errors.missingPetId` | 400 | `petId` path param absent |
| `petSource.errors.invalidPetId` | 400 | `petId` is not a valid MongoDB ObjectId |
| `petSource.errors.missingRequiredFields` | 400 | POST requires at least one of `placeofOrigin` or `channel` |
| `petSource.errors.petNotFound` | 404 | Pet does not exist or is soft-deleted |
| `petSource.errors.recordNotFound` | 404 | No source record exists for this pet |
| `petSource.errors.duplicateRecord` | 409 | A source record already exists for this pet |
| `common.invalidBodyParams` | 400 | Malformed JSON, unknown field, or Zod schema rejection |
| `common.missingParams` | 400 | Empty or missing body (`{}`, `null`, or absent) on POST or PATCH |
| `common.noFieldsToUpdate` | 400 | PATCH body is valid but every supplied field resolved to `undefined` in the update |
| `common.forbidden` | 403 | Caller is not the pet owner or NGO owner |
| `common.unauthorized` | 401 | Missing or invalid Bearer token |
| `common.routeNotFound` | 404 | Unknown path |
| `common.methodNotAllowed` | 405 | Wrong HTTP method for this path |
| `common.rateLimited` | 429 | Rate limit exceeded |
| `common.internalError` | 500 | Unexpected server error |

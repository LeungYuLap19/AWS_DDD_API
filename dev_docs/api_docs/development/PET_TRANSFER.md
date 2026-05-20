# Pet Transfer API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-pet-transfer`

Transfer-history management for pets plus NGO-to-user reassignment. Transfer records are stored inside the `Pet` document, not in a separate top-level collection. All routes in this document require `x-api-key`. All routes also require a Bearer JWT, and the NGO reassignment route additionally requires an NGO-scoped caller.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/pet/transfer/{petId}` | `x-api-key` + Bearer JWT | Append a transfer-history row to the pet |
| PATCH | `/pet/transfer/{petId}/{transferId}` | `x-api-key` + Bearer JWT | Update one transfer-history row |
| DELETE | `/pet/transfer/{petId}/{transferId}` | `x-api-key` + Bearer JWT | Remove one transfer-history row |
| POST | `/pet/transfer/{petId}/ngo-reassignment` | `x-api-key` + Bearer JWT with `admin` role | Reassign NGO-owned pet ownership to an existing user |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Success wrapper | All success responses use the shared `{ success, message, data?, requestId }` envelope |
| Create response | Create returns `data: { id, petId, regDate, regPlace, transferOwner, transferContact, transferRemark }` |
| Update response | PATCH returns no `data`; the handler only returns success metadata |
| Delete response | DELETE returns no `data` |
| Strict schemas | Transfer create, update, and NGO reassignment request bodies are strict; extra fields are rejected with `common.invalidBodyParams` |
| Empty update body | Empty `{}` body is rejected by shared body parsing before update logic runs |
| No-op PATCH | The handler has an internal `common.noFieldsToUpdate` fallback, but with current strict schemas and shared parse defaults it is not the normal outcome for `{}` |
| NGO reassignment side effect | Reassignment changes `pet.userId`, clears `pet.ngoId`, updates `transferNGO.0`, and mirrors transfer fields into `transfer.0` |

---

## Auth Reference

Gateway/API-key/JWT behavior for pet-transfer routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization

The Lambda authorizes access when either condition is true:

- `pet.userId === jwt.userId`
- `pet.ngoId === jwt.ngoId`

If neither matches, the route returns `403 common.forbidden`.

For `POST /pet/transfer/{petId}/ngo-reassignment`, the caller must have `admin` role. That role check runs before body validation and before reassignment logic.

### Rate Limits

| Route | Policy |
| --- | --- |
| Create transfer | IP 120 / 5 min, identifier 60 / 5 min |
| Update transfer | IP 120 / 5 min, identifier 60 / 5 min |
| Delete transfer | IP 120 / 5 min, identifier 60 / 5 min |
| NGO reassignment | IP 30 / 60 min, identifier 15 / 60 min |

Rate-limit failures return `429 common.rateLimited`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale is `en`
- Use `errorKey` for frontend branching

### Request Body Validation

- POST and PATCH routes use shared `parseBody` with strict Zod schemas
- Malformed JSON, unknown extra fields, and schema mismatches return `400 common.invalidBodyParams`
- Empty JSON bodies return `400 common.missingBodyParams`

---

## Success And Error Conventions

### Success Response Shape

Create:

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d",
    "petId": "665f0000000000000000abcd",
    "regDate": "2024-01-15T00:00:00.000Z",
    "regPlace": "Hong Kong",
    "transferOwner": "Alice",
    "transferContact": "+85291234567",
    "transferRemark": "Rehomed"
  },
  "requestId": "aws-lambda-request-id"
}
```

Update/delete/NGO reassignment:

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petTransfer.errors.transfer.notFound",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

### Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId |
| `transferId` | string | Route-dependent | MongoDB ObjectId for transfer subdocument |

Invalid ObjectId path parameters return `400 common.invalidObjectId`.

### Date Rules

`regDate` accepts the flexible transfer date parser used by the handler. Invalid dates return:

- `petTransfer.errors.transfer.invalidDateFormat` on create/update
- `petTransfer.errors.ngoTransfer.invalidDateFormat` on NGO reassignment

---

## Endpoints

### POST /pet/transfer/{petId}

Append a transfer-history row to the pet.

**Lambda owner:** `pet-transfer`  
**Auth:** `x-api-key` + Bearer JWT required

#### Create Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `regDate` | string or `null` | No | Flexible date string; `null` resets stored date |
| `regPlace` | string | No | Max 200 chars |
| `transferOwner` | string | No | Max 200 chars |
| `transferContact` | string | No | Max 50 chars |
| `transferRemark` | string | No | Max 2000 chars |

#### Update Reset Payloads

Use these payloads to reset fields:

| Field | Reset payload |
| --- | --- |
| `regDate` | `null` |
| `transferContact` | `""` |
| `regPlace` | `""` |
| `transferRemark` | `""` |
| `transferOwner` | `""` |

**Important:** the schema is strict. Unknown fields are rejected.

#### Create Example Request

```json
{
  "regDate": "2024-01-15",
  "regPlace": "Hong Kong",
  "transferOwner": "Alice",
  "transferContact": "+85291234567",
  "transferRemark": "Rehomed"
}
```

#### Create Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `petTransfer.errors.transfer.invalidDateFormat` | Invalid `regDate` |
| 400 | `common.invalidObjectId` | Invalid `petId` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petTransfer.errors.petNotFound` | Pet does not exist or is deleted |
| 429 | `common.rateLimited` | Create rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### PATCH /pet/transfer/{petId}/{transferId}

Update one transfer-history row.

**Lambda owner:** `pet-transfer`  
**Auth:** `x-api-key` + Bearer JWT required

#### Update Request Body

Any subset of the same fields accepted by create may be supplied.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `regDate` | string or `null` | No | Flexible date string; `null` resets stored date |
| `regPlace` | string | No | Max 200 chars |
| `transferOwner` | string | No | Max 200 chars |
| `transferContact` | string | No | Max 50 chars |
| `transferRemark` | string | No | Max 2000 chars |

#### Update Reset Payloads

Use these payloads to reset fields:

| Field | Reset payload |
| --- | --- |
| `regDate` | `null` |
| `transferContact` | `""` |
| `regPlace` | `""` |
| `transferRemark` | `""` |
| `transferOwner` | `""` |

#### Update Example Request

```json
{
  "regPlace": "Tsuen Wan",
  "transferRemark": "Updated contact"
}
```

#### Update Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `petTransfer.errors.transfer.invalidDateFormat` | Invalid `regDate` |
| 400 | `common.invalidObjectId` | Invalid `petId` or `transferId` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petTransfer.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petTransfer.errors.transfer.notFound` | Transfer record does not exist on that pet |
| 429 | `common.rateLimited` | Update rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### DELETE /pet/transfer/{petId}/{transferId}

Delete one transfer-history row.

**Lambda owner:** `pet-transfer`  
**Auth:** `x-api-key` + Bearer JWT required

#### Delete Request Body

None.

#### Delete Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `petId` or `transferId` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petTransfer.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petTransfer.errors.transfer.notFound` | Transfer record does not exist on that pet |
| 429 | `common.rateLimited` | Delete rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### POST /pet/transfer/{petId}/ngo-reassignment

Reassign NGO-owned pet ownership to an existing active user.

**Lambda owner:** `pet-transfer`  
**Auth:** `x-api-key` + Bearer JWT required with `admin` role

#### NGO Reassignment Request Body

At least one of `UserEmail` or `UserContact` is required.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `UserEmail` | string | Conditional | Valid email format if provided |
| `UserContact` | string | Conditional | Valid phone format if provided |
| `regDate` | string | No | Flexible date string |
| `regPlace` | string | No | Max 200 chars |
| `transferOwner` | string | No | Max 200 chars |
| `transferContact` | string | No | Max 50 chars |
| `transferRemark` | string | No | Max 2000 chars |
| `isTransferred` | boolean | No | Stored on `transferNGO.0` |

When both `UserEmail` and `UserContact` are provided, both must resolve to the same active user.

#### NGO Reassignment Example Request

```json
{
  "UserEmail": "newowner@example.com",
  "UserContact": "+85291234567",
  "regDate": "2024-03-01",
  "transferRemark": "Transferred out from NGO",
  "isTransferred": true
}
```

#### NGO Reassignment Side Effects

- Validates the target user from email and/or phone
- Sets `pet.userId` to the resolved user id
- Clears `pet.ngoId` to an empty string
- Writes reassignment metadata into `transferNGO.0`
- Mirrors the transfer fields into `transfer.0`

#### NGO Reassignment Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `petTransfer.errors.ngoTransfer.missingRequiredFields` | Neither `UserEmail` nor `UserContact` provided |
| 400 | `petTransfer.errors.ngoTransfer.invalidEmailFormat` | Invalid `UserEmail` |
| 400 | `petTransfer.errors.ngoTransfer.invalidPhoneFormat` | Invalid `UserContact` |
| 400 | `petTransfer.errors.ngoTransfer.invalidDateFormat` | Invalid `regDate` |
| 400 | `petTransfer.errors.ngoTransfer.userIdentityMismatch` | Email and phone resolve to different users |
| 400 | `common.invalidObjectId` | Invalid `petId` |
| 403 | `common.forbidden` | Caller does not have `admin` role, does not own the pet |
| 404 | `petTransfer.errors.ngoTransfer.targetUserNotFound` | No active user matches the supplied identifier(s) |
| 404 | `petTransfer.errors.petNotFound` | Pet does not exist or is deleted |
| 429 | `common.rateLimited` | NGO reassignment rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Frontend Integration Guide

1. Treat transfer create as append-only history creation and PATCH as metadata correction. The current PATCH response does not return the updated record.
2. For NGO reassignment, validate email and phone client-side before submission, but still branch on the backend keys because cross-identifier mismatch can only be proven server-side.
3. After NGO reassignment succeeds, refetch the pet profile immediately because ownership changes and the current caller may lose access on subsequent requests.
4. Treat empty edit submissions as `common.missingBodyParams`; `common.noFieldsToUpdate` is an internal fallback, not the normal current PATCH response for `{}`.
5. Treat `petTransfer.errors.transfer.notFound` as a stale-client condition and refresh pet detail/history state.

---

## Verification Snapshot

This document is grounded in the current DDD handlers in `functions/pet-transfer/src/services/transfer.ts`, the strict request schemas in `functions/pet-transfer/src/zodSchema/transferSchema.ts`, and the Tier 2 assertions in `__tests__/pet-transfer.test.js`. The previous legacy doc version that described top-level `form`, `petId`, and `transferId` success payloads is no longer accurate for the current wrapper-based implementation.

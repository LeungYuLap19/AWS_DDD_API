# Pet Recovery API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-pet-recovery`

Lost and found recovery listings and submissions. All routes are authenticated. POST routes use `multipart/form-data` and the current DDD implementation returns shared `data` and `pagination` wrappers instead of the legacy top-level `pets`, `count`, or `id` fields.

---

## Overview

### Route Summary

| Method | Path | Auth | Content-Type | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/pet/recovery/lost` | `x-api-key` only | — | List lost-pet reports |
| POST | `/pet/recovery/lost` | `x-api-key` + Bearer JWT | `multipart/form-data` | Create a lost-pet report |
| DELETE | `/pet/recovery/lost/{petLostID}` | `x-api-key` + Bearer JWT | — | Delete caller-owned lost-pet report |
| GET | `/pet/recovery/found` | `x-api-key` only | — | List found-pet reports |
| POST | `/pet/recovery/found` | `x-api-key` only | `multipart/form-data` | Create a found-pet report |
| DELETE | `/pet/recovery/found/{petFoundID}` | `x-api-key` + Bearer JWT | — | Delete caller-owned found-pet report |

### Contract Notes

| Topic | Current DDD behavior |
| --- | --- |
| List wrapper | GET routes return `data: []` plus `pagination`, not top-level `pets` or `count` |
| List sanitization | `userId` and `__v` are removed from all list responses; lost-report list items also omit linked `petId` |
| Create wrapper | POST routes return `data: { id }` |
| Delete wrapper | DELETE routes return success envelope with no `data` |
| Multipart numeric handling | `weight` and `ownerContact1` are normalized to numbers when valid; invalid numeric strings survive as strings and fail schema validation |
| Multipart boolean handling | `sterilization` becomes `true` only for string/boolean `true`; other non-empty values normalize to `false` |
| File upload failures | Invalid file types return `400 petRecovery.errors.invalidFileType`; oversized files return `413 petRecovery.errors.fileTooLarge` |
| Lost-pet linking | When `petId` is supplied on lost-post creation, caller must own that pet; optional `status` also updates the linked `Pet.status` |
| Upload size limit | Recovery uploads currently allow JPEG, PNG, GIF, and WebP up to 4 MB |

---

## Auth Reference

Gateway/API-key/JWT behavior for pet-recovery routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization

Additional route-specific checks:

- DELETE routes require `record.userId === jwt.userId`
- Lost-report creation with `petId` requires linked-pet ownership
- Found-report creation accepts optional multipart `userId` and does not require JWT
- There is no public list endpoint in the current DDD implementation

### Rate Limits

Current create-route limits are enforced by the shared rate-limit layer.

| Route | Policy set |
| --- | --- |
| `POST /pet/recovery/lost` | IP 15/min, identifier 8/min, IP+identifier 5/min |
| `POST /pet/recovery/found` | IP 15/min, identifier 8/min when `userId` is present, IP+identifier 5/min |

Exceeded limits return `429 common.rateLimited`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale is `en`
- `errorKey` is the stable integration key

### Request Body Validation

- POST routes are multipart-only and use `parseMultipartBody` with strict schemas plus route-specific normalization
- Multipart parse failures, malformed normalized field types, and unknown extra text fields return `400 common.invalidBodyParams`

---

## Response And Validation Rules

### Success Response Shape

List routes:

```json
{
  "success": true,
  "message": "localized success message",
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 30,
    "total": 0,
    "totalPages": 0
  },
  "requestId": "aws-lambda-request-id"
}
```

Create routes:

```json
{
  "success": true,
  "message": "localized success message",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d"
  },
  "requestId": "aws-lambda-request-id"
}
```

Delete routes return the shared success envelope without `data`.

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petRecovery.errors.petLost.lostDateRequired",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

### Multipart Validation Rules

POST routes are validated with `parseMultipartBody` plus route-specific Zod schemas.

Lost-post fields:

| Field | Type | Required |
| --- | --- | --- |
| `petId` | string | No |
| `name` | string | Yes |
| `birthday` | string | No |
| `weight` | number | No |
| `sex` | string | Yes |
| `sterilization` | boolean | No |
| `animal` | string | Yes |
| `breed` | string | No |
| `description` | string | No |
| `remarks` | string | No |
| `status` | string | No |
| `owner` | string | No |
| `ownerContact1` | number | No |
| `lostDate` | string | Yes |
| `lostLocation` | string | Yes |
| `lostDistrict` | string | Yes |

Found-post fields:

| Field | Type | Required |
| --- | --- | --- |
| `animal` | string | Yes |
| `breed` | string | No |
| `description` | string | No |
| `remarks` | string | No |
| `status` | string | No |
| `owner` | string | No |
| `ownerContact1` | number | No |
| `foundDate` | string | Yes |
| `foundLocation` | string | Yes |
| `foundDistrict` | string | Yes |

Observed validation and parse behavior:

- Invalid numeric strings such as `weight=heavy` or `ownerContact1=not-a-number` return `400 common.invalidBodyParams`
- Invalid linked `petId` format returns `400 common.invalidObjectId`
- Missing required lost/found fields return route-specific `petRecovery.errors.*Required` keys
- Invalid multipart file type returns `400 petRecovery.errors.invalidFileType`
- Oversized file returns `413 petRecovery.errors.fileTooLarge`
- Invalid list pagination returns `400 common.invalidQueryParams`

### Sanitized List Item Shape

List routes sanitize records before returning them.

Removed from list items:

- `userId`
- `petId`
- `__v`

Returned fields vary by lost vs found record, but commonly include:

- `_id`
- `name` for lost records
- `animal`
- `breed`
- `description`
- `remarks`
- `status`
- `owner`
- `ownerContact1`
- `lostDate` or `foundDate`
- `lostLocation` or `foundLocation`
- `lostDistrict` or `foundDistrict`
- `serial_number`
- `breedimage`
- `createdAt`
- `updatedAt`

---

## Endpoints

### GET /pet/recovery/lost

List lost-pet reports sorted by `lostDate` descending.

**Lambda owner:** `pet-recovery`  
**Auth:** `x-api-key` only

#### Query Parameters

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | integer | 1 | Shared pagination schema |
| `limit` | integer | shared default | Shared pagination schema |

#### Lost List Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "name": "Mochi",
      "animal": "Dog",
      "ownerContact1": 91234567
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 30,
    "total": 1,
    "totalPages": 1
  },
  "requestId": "aws-lambda-request-id"
}
```

If a lost report was created with a linked `petId`, that link is used only for
ownership/status handling on write. The list response does not expose `petId`.

#### Lost List Common Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid `page` or `limit` |
| 500 | `common.internalError` | Unexpected error |

### POST /pet/recovery/lost

Create a lost-pet report using `multipart/form-data`.

**Lambda owner:** `pet-recovery`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `multipart/form-data`

#### Lost Create Form Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | No | Linked pet id; must belong to caller if present |
| `name` | string | Yes | |
| `birthday` | string | No | Flexible date string |
| `weight` | number | No | Multipart numeric normalization applies |
| `sex` | string | Yes | |
| `sterilization` | boolean | No | Multipart boolean normalization applies |
| `animal` | string | Yes | |
| `breed` | string | No | |
| `description` | string | No | |
| `remarks` | string | No | |
| `status` | string | No | Also updates linked `Pet.status` when `petId` is present |
| `owner` | string | No | |
| `ownerContact1` | number | No | Multipart numeric normalization applies |
| `lostDate` | string | Yes | Flexible date string |
| `lostLocation` | string | Yes | |
| `lostDistrict` | string | Yes | |
| file parts | file | No | Uploaded to S3 and stored in `breedimage[]` |

#### Lost Create Example Request

Use `multipart/form-data`. Example with linked `petId` plus file uploads:

```bash
curl -X POST 'https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development/pet/recovery/lost' \
  -H 'x-api-key: <api-key>' \
  -H 'Authorization: Bearer <jwt>' \
  -F 'name=Mochi' \
  -F 'sex=Female' \
  -F 'animal=Dog' \
  -F 'lostDate=01/02/2025' \
  -F 'lostLocation=Kowloon' \
  -F 'lostDistrict=Mong Kok' \
  -F 'weight=12.5' \
  -F 'sterilization=true' \
  -F 'ownerContact1=91234567' \
  -F 'petId=665f0000000000000000abcd' \
  -F 'file=@/path/to/lost-1.jpg;type=image/jpeg' \
  -F 'file=@/path/to/lost-2.png;type=image/png'
```

When `petId` is provided, backend copies the linked pet profile `breedimage[]`
internally and merges those URLs with uploaded file URLs.

#### Lost Create Success (201)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Lost Create Common Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Multipart parse failure or invalid field type |
| 400 | `common.invalidObjectId` | Invalid linked `petId` |
| 400 | `petRecovery.errors.petLost.nameRequired` | Missing `name` |
| 400 | `petRecovery.errors.petLost.sexRequired` | Missing `sex` |
| 400 | `petRecovery.errors.petLost.animalRequired` | Missing `animal` |
| 400 | `petRecovery.errors.petLost.lostDateRequired` | Missing or invalid `lostDate` |
| 400 | `petRecovery.errors.petLost.lostLocationRequired` | Missing `lostLocation` |
| 400 | `petRecovery.errors.petLost.lostDistrictRequired` | Missing `lostDistrict` |
| 400 | `petRecovery.errors.invalidFileType` | Unsupported file extension or content type |
| 403 | `common.forbidden` | Linked `petId` belongs to another user |
| 404 | `petRecovery.errors.petLost.petNotFound` | Linked pet does not exist |
| 413 | `petRecovery.errors.fileTooLarge` | Uploaded file exceeds the 4 MB limit |
| 429 | `common.rateLimited` | Shared create-route rate limit exceeded |
| 500 | `common.internalError` | Unexpected error |

### DELETE /pet/recovery/lost/{petLostID}

Delete a caller-owned lost-pet report.

**Lambda owner:** `pet-recovery`  
**Auth:** `x-api-key` + Bearer JWT required

#### Lost Delete Success (200)

```json
{
  "success": true,
  "message": "Deleted successfully",
  "requestId": "aws-lambda-request-id"
}
```

#### Lost Delete Common Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `petLostID` |
| 403 | `common.forbidden` | Caller does not own the record |
| 404 | `petRecovery.errors.petLost.notFound` | Record not found |
| 500 | `common.internalError` | Unexpected error |

### GET /pet/recovery/found

List found-pet reports sorted by `foundDate` descending.

**Lambda owner:** `pet-recovery`  
**Auth:** `x-api-key` only

#### Found List Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0e",
      "animal": "Cat",
      "foundDistrict": "Central"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 30,
    "total": 1,
    "totalPages": 1
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Found List Common Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid `page` or `limit` |
| 500 | `common.internalError` | Unexpected error |

### POST /pet/recovery/found

Create a found-pet report using `multipart/form-data`.

**Lambda owner:** `pet-recovery`  
**Auth:** `x-api-key` only  
**Content-Type:** `multipart/form-data`

#### Found Create Form Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userId` | string | No | Optional ObjectId; stored as record owner id when provided |
| `animal` | string | Yes | |
| `breed` | string | No | |
| `description` | string | No | |
| `remarks` | string | No | |
| `status` | string | No | |
| `owner` | string | No | |
| `ownerContact1` | number | No | Multipart numeric normalization applies |
| `foundDate` | string | Yes | Flexible date string |
| `foundLocation` | string | Yes | |
| `foundDistrict` | string | Yes | |
| file parts | file | No | Uploaded to S3 and stored in `breedimage[]` |

#### Found Create Example Request

Use multipart form-data with `x-api-key`. Representative `curl` request:

```bash
curl -X POST 'https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development/pet/recovery/found' \
  -H 'x-api-key: <api-key>' \
  -F 'animal=Cat' \
  -F 'foundDate=2025-03-15' \
  -F 'foundLocation=HK Island' \
  -F 'foundDistrict=Central' \
  -F 'ownerContact1=98765432' \
  -F 'userId=665f0000000000000000abcd'
```

#### Found Create Success (201)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0e"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Found Create Common Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Multipart parse failure or invalid field type |
| 400 | `petRecovery.errors.petFound.animalRequired` | Missing `animal` |
| 400 | `petRecovery.errors.petFound.foundDateRequired` | Missing or invalid `foundDate` |
| 400 | `petRecovery.errors.petFound.foundLocationRequired` | Missing `foundLocation` |
| 400 | `petRecovery.errors.petFound.foundDistrictRequired` | Missing `foundDistrict` |
| 400 | `petRecovery.errors.invalidFileType` | Unsupported file extension or content type |
| 413 | `petRecovery.errors.fileTooLarge` | Uploaded file exceeds the 4 MB limit |
| 429 | `common.rateLimited` | Shared create-route rate limit exceeded |
| 500 | `common.internalError` | Unexpected error |

### DELETE /pet/recovery/found/{petFoundID}

Delete a caller-owned found-pet report.

**Lambda owner:** `pet-recovery`  
**Auth:** `x-api-key` + Bearer JWT required

#### Found Delete Success (200)

```json
{
  "success": true,
  "message": "Deleted successfully",
  "requestId": "aws-lambda-request-id"
}
```

#### Found Delete Common Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `petFoundID` |
| 403 | `common.forbidden` | Caller does not own the record |
| 404 | `petRecovery.errors.petFound.notFound` | Record not found |
| 500 | `common.internalError` | Unexpected error |

---

## Frontend Integration Guide

1. Treat both list routes as authenticated feeds. There is no public lost/found browse route in the current DDD implementation.
2. Read list items from `data` and pagination controls from `pagination`; do not use legacy `pets` or `count` keys.
3. Build create forms as multipart requests even when no images are attached.
4. For lost-pet create, only send `petId` when the UI intends to link the report to an owned pet; `403 common.forbidden` means the caller does not own that pet.
5. On `400 common.invalidBodyParams` for multipart creates, validate numeric fields like `weight` and `ownerContact1` before retrying.
6. On delete success, remove the item locally; the backend returns no `data` payload.

---

## Verification Snapshot

Current verification evidence for this domain is in [pet-recovery.test.js](../../../__tests__/pet-recovery.test.js). That Tier 2 suite proves the list `data` + `pagination` wrapper, multipart normalization behavior, lost-pet ownership checks, delete ownership checks, and the current create/delete success envelopes. A separate SAM suite exists at [pet-recovery.sam.test.js](../../../__tests__/pet-recovery.sam.test.js), but deployed development-stage verification remains the meaningful runtime check for this repo.

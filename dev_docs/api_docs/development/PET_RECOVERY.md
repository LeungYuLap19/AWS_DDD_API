<!-- markdownlint-disable MD024 -->
# Pet Recovery API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Lost and found pet posts. Authenticated users can list all lost/found reports, submit their own, and delete records they created. POST requests use `multipart/form-data` to support optional image uploads.

> Conventions: [README.md](../../api_docs/development/../../../AWS_API/dev_docs/api_docs/README.md)

---

## Overview

| Method | Path | Content-Type | Purpose |
| --- | --- | --- | --- |
| GET | `/pet/recovery/lost` | — | List all lost pet reports |
| POST | `/pet/recovery/lost` | `multipart/form-data` | Submit a lost pet report |
| DELETE | `/pet/recovery/lost/{petLostID}` | — | Delete own lost pet report |
| GET | `/pet/recovery/found` | — | List all found pet reports |
| POST | `/pet/recovery/found` | `multipart/form-data` | Submit a found pet report |
| DELETE | `/pet/recovery/found/{petFoundID}` | — | Delete own found pet report |

**Lambda:** `pet-recovery`

---

## Integration-Critical Contract Notes

| Topic | Current DDD behavior |
| --- | --- |
| Request format for POST | Both POST endpoints are **multipart/form-data only**. There is no JSON body path. |
| Image upload | Images are optional. Files attached to the multipart request are uploaded to S3 and their public URLs are stored in `breedimage[]`. |
| `userId` suppressed | The creator's `userId` is **stripped from all GET list responses**. It is not exposed to callers. |
| Global list — no filter | GET lists return **all** records across all users, sorted newest first. There is no per-user or per-district filter. |
| `petId` linking (lost only) | If `petId` is included in a lost report, the Lambda validates that the caller owns that pet and optionally updates `Pet.status`. If the caller does not own the pet the request is rejected `403`. |
| Serial numbers | Each created record receives an auto-incremented `serial_number` from a shared counter document. |
| Delete ownership | Only the record creator (`userId` match) can delete. No admin bypass is documented in this Lambda's service code. |
| Multipart field types | All multipart form fields arrive as strings. `weight` and `ownerContact1` are coerced to numbers; `sterilization` is coerced to boolean (`"true"` → `true`, any other value → `false`). This normalization happens before Zod validation. |
| Error key namespace | Errors use `petRecovery.*` not the legacy `petLostAndFound.*`. |
| Route paths | Paths changed from legacy `/v2/pets/pet-lost` → `/pet/recovery/lost`, `/v2/pets/pet-found` → `/pet/recovery/found`. |

---

## API Gateway And Auth Rules

### API Gateway Requirements

All routes require a valid API Gateway API key.

| Route group | API key required | Authorizer |
| --- | --- | --- |
| All `GET`, `POST`, `DELETE` routes | Yes | `DddTokenAuthorizer` |
| `OPTIONS` preflight routes | No | None |

Protected deployed requests must include:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
```

POST endpoints must send `multipart/form-data`. Do not set `Content-Type` manually — let the HTTP client set it so the boundary is included automatically.

`OPTIONS` preflight requests return `204` with CORS headers and do not require `x-api-key`.

### Authorization

All routes require a valid Bearer JWT. There is no public access — even GET list endpoints require authentication.

| Route | Auth requirement | Notes |
| --- | --- | --- |
| `GET /pet/recovery/lost` | Bearer JWT | Returns all records across all users |
| `POST /pet/recovery/lost` | Bearer JWT | Creator is set to `jwt.userId` |
| `DELETE /pet/recovery/lost/{petLostID}` | Bearer JWT | Caller must be the record creator |
| `GET /pet/recovery/found` | Bearer JWT | Returns all records across all users |
| `POST /pet/recovery/found` | Bearer JWT | Creator is set to `jwt.userId` |
| `DELETE /pet/recovery/found/{petFoundID}` | Bearer JWT | Caller must be the record creator |

### Localization

- Locale priority: `?lang` / `?locale` query param → `language` / `lang` cookie → `Accept-Language` header → default `en`
- `errorKey` is always stable — use it for integration logic

### Rate Limits

Limits are per `userId`.

| Action | Limit | Window |
| --- | --- | --- |
| `POST /pet/recovery/lost` | 5 requests | 60 s |
| `POST /pet/recovery/found` | 5 requests | 60 s |

Exceeded limits return `429 common.rateLimited`.

### S3 Image Upload

- Images attached to POST requests are uploaded to S3: `user-uploads/pets/{recordId}/<imageId>.<ext>`
- Public URLs are written into `breedimage[]` on the created record
- Max file size: **10 MB per file** (files exceeding this limit are silently skipped — no error)
- Accepted formats: `jpg`, `jpeg`, `png`, `gif`, `tif`, `tiff`, `webp`, `bmp`
- Files with empty content are silently skipped

---

## Shared Error Behavior

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Multipart body could not be parsed |
| 401 / 403 | `common.unauthorized` | Missing or invalid Bearer token |
| 429 | `common.rateLimited` | Rate limit exceeded |
| 500 | `common.internalError` | Unhandled server error — inspect CloudWatch by `requestId` |

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petRecovery.errors.petLost.nameRequired",
  "error": "Pet name is required",
  "requestId": "abc123"
}
```

### Success Response Shape

```json
{
  "success": true,
  "message": "All lost pets retrieved successfully",
  "requestId": "abc123"
}
```

---

## Lost Pet Routes

### GET `/pet/recovery/lost`

Return all lost pet reports, sorted by `lostDate` descending.

**Auth:** Bearer JWT

**Success (200):**

```json
{
  "success": true,
  "message": "All lost pets retrieved successfully",
  "count": 42,
  "pets": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "petId": "665f0000000000000000abcd",
      "name": "Buddy",
      "birthday": "2022-01-01T00:00:00.000Z",
      "weight": 12.5,
      "sex": "Male",
      "sterilization": true,
      "animal": "Dog",
      "breed": "Golden Retriever",
      "description": "Brown collar, very friendly",
      "remarks": "Microchipped",
      "status": "Lost",
      "owner": "John Doe",
      "ownerContact1": 91234567,
      "lostDate": "2025-05-01T00:00:00.000Z",
      "lostLocation": "Victoria Park",
      "lostDistrict": "Causeway Bay",
      "serial_number": "42",
      "breedimage": [
        "https://bucket.s3.ap-southeast-1.amazonaws.com/user-uploads/pets/665f1a2b.../abc.jpg"
      ],
      "createdAt": "2025-05-01T08:00:00.000Z",
      "updatedAt": "2025-05-01T08:00:00.000Z"
    }
  ],
  "requestId": "abc123"
}
```

Note: `userId` is stripped from each record — it is not present in the response.

**Errors:** Missing JWT → `401 / 403`

---

### POST `/pet/recovery/lost`

Submit a lost pet report. Accepts `multipart/form-data`.

**Auth:** Bearer JWT  
**Rate limit:** 5 / 60 s per `userId`

**Form fields:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | Yes | Pet name |
| `sex` | string | Yes | |
| `animal` | string | Yes | E.g., `Dog`, `Cat` |
| `lostDate` | string | Yes | `DD/MM/YYYY` or ISO date |
| `lostLocation` | string | Yes | |
| `lostDistrict` | string | Yes | |
| `petId` | string (ObjectId) | No | If provided: validates caller owns the linked pet; if `status` is also provided, updates `Pet.status` |
| `birthday` | string | No | `DD/MM/YYYY` or ISO date |
| `weight` | number | No | |
| `sterilization` | boolean | No | |
| `breed` | string | No | |
| `description` | string | No | |
| `remarks` | string | No | |
| `status` | string | No | E.g., `"Lost"` — also applied to linked `petId` if provided |
| `owner` | string | No | Owner's display name |
| `ownerContact1` | number | No | Phone number |
| *(file fields)* | file | No | Any number of image files; each up to 10 MB |

**`petId` linking behavior:**

1. If `petId` is absent: report is created as a standalone record, `petId` stored as `null`
2. If `petId` is present and caller owns the pet: report is linked, `Pet.status` is updated to `status` if `status` is also provided
3. If `petId` is present but caller does not own the pet: `403 common.forbidden`, no record created

**Success (201):**

```json
{
  "success": true,
  "message": "Successfully added lost pet",
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petRecovery.errors.petLost.nameRequired` | `name` field missing or empty |
| 400 | `petRecovery.errors.petLost.sexRequired` | `sex` field missing or empty |
| 400 | `petRecovery.errors.petLost.animalRequired` | `animal` field missing or empty |
| 400 | `petRecovery.errors.petLost.lostDateRequired` | `lostDate` missing or not a valid date |
| 400 | `petRecovery.errors.petLost.lostLocationRequired` | `lostLocation` missing or empty |
| 400 | `petRecovery.errors.petLost.lostDistrictRequired` | `lostDistrict` missing or empty |
| 400 | `petRecovery.errors.petLost.invalidPetId` | `petId` provided but not a valid ObjectId |
| 400 | `common.invalidBodyParams` | Multipart parse failure |
| 403 | `common.forbidden` | `petId` provided but caller does not own that pet |
| 404 | `petRecovery.errors.petLost.petNotFound` | `petId` provided but pet does not exist or is deleted |
| 429 | `common.rateLimited` | |

---

### DELETE `/pet/recovery/lost/{petLostID}`

Delete a lost pet report. Only the record creator can delete.

**Auth:** Bearer JWT

**Path params:**

| Param | Type | Required |
| --- | --- | --- |
| `petLostID` | MongoDB ObjectId string | Yes |

**Success (200):**

```json
{
  "success": true,
  "message": "Pet lost record deleted successfully",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petRecovery.errors.petLost.invalidId` | `{petLostID}` is not a valid ObjectId |
| 403 | `common.forbidden` | Caller is not the record creator |
| 404 | `petRecovery.errors.petLost.notFound` | Record not found |

---

## Found Pet Routes

### GET `/pet/recovery/found`

Return all found pet reports, sorted by `foundDate` descending.

**Auth:** Bearer JWT

**Success (200):**

```json
{
  "success": true,
  "message": "All found pets retrieved successfully",
  "count": 17,
  "pets": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0e",
      "animal": "Cat",
      "breed": "Unknown",
      "description": "Orange tabby, no collar",
      "remarks": "",
      "status": "Found",
      "owner": "Jane Smith",
      "ownerContact1": 98765432,
      "foundDate": "2025-05-02T00:00:00.000Z",
      "foundLocation": "Mong Kok",
      "foundDistrict": "Kowloon",
      "serial_number": "17",
      "breedimage": [],
      "createdAt": "2025-05-02T09:30:00.000Z",
      "updatedAt": "2025-05-02T09:30:00.000Z"
    }
  ],
  "requestId": "abc123"
}
```

Note: `userId` is stripped from each record — it is not present in the response.

**Errors:** Missing JWT → `401 / 403`

---

### POST `/pet/recovery/found`

Submit a found pet report. Accepts `multipart/form-data`.

**Auth:** Bearer JWT  
**Rate limit:** 5 / 60 s per `userId`

**Form fields:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `animal` | string | Yes | E.g., `Dog`, `Cat` |
| `foundDate` | string | Yes | `DD/MM/YYYY` or ISO date |
| `foundLocation` | string | Yes | |
| `foundDistrict` | string | Yes | |
| `breed` | string | No | |
| `description` | string | No | |
| `remarks` | string | No | |
| `status` | string | No | |
| `owner` | string | No | Finder's display name |
| `ownerContact1` | number | No | Phone number |
| *(file fields)* | file | No | Any number of image files; each up to 10 MB |

There is no `petId` field on found reports. The `petId` link is a lost-only feature.

**Success (201):**

```json
{
  "success": true,
  "message": "Successfully added found pet",
  "id": "665f1a2b3c4d5e6f7a8b9c0e",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petRecovery.errors.petFound.animalRequired` | `animal` field missing or empty |
| 400 | `petRecovery.errors.petFound.foundDateRequired` | `foundDate` missing or not a valid date |
| 400 | `petRecovery.errors.petFound.foundLocationRequired` | `foundLocation` missing or empty |
| 400 | `petRecovery.errors.petFound.foundDistrictRequired` | `foundDistrict` missing or empty |
| 400 | `common.invalidBodyParams` | Multipart parse failure |
| 429 | `common.rateLimited` | |

---

### DELETE `/pet/recovery/found/{petFoundID}`

Delete a found pet report. Only the record creator can delete.

**Auth:** Bearer JWT

**Path params:**

| Param | Type | Required |
| --- | --- | --- |
| `petFoundID` | MongoDB ObjectId string | Yes |

**Success (200):**

```json
{
  "success": true,
  "message": "Pet found record deleted successfully",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petRecovery.errors.petFound.invalidId` | `{petFoundID}` is not a valid ObjectId |
| 403 | `common.forbidden` | Caller is not the record creator |
| 404 | `petRecovery.errors.petFound.notFound` | Record not found |

---

## Frontend Integration Guide

### Submitting a Lost / Found Report

1. Build a `FormData` object — do not manually set `Content-Type`; let the HTTP client include the boundary
2. Append text fields as strings
3. Append image files with `fd.append('file', fileObject)` or equivalent
4. Send with `Authorization: Bearer <token>` and `x-api-key` headers
5. On `201`, save the returned `id` if you need to enable deletion later

### petId Linking (lost reports only)

If the user is reporting one of their own registered pets:

- Include `petId` in the form
- Optionally include `status: "Lost"` to update the pet's status automatically
- If `petId` belongs to a different user, the API returns `403 common.forbidden`

### Displaying Lists

- GET list returns all reports platform-wide — no pagination, no user filter
- Sort is by `lostDate` / `foundDate` descending
- `userId` is not in the response — you cannot determine the creator from the list response

### Deletion

Only the creator can delete. If your frontend allows deletion, gate the delete button to the currently authenticated user and compare against the record's ownership. Since `userId` is stripped from the list, you should track which record IDs the current user created (e.g., from the POST response `id`) to determine delete eligibility.

### Rate Limit Handling

POST endpoints are limited to 5 per 60 seconds per user. If you receive `429 common.rateLimited`, tell the user to wait before retrying.

---

## Contract Deltas from Legacy (`AWS_API`)

| Topic | Legacy (`PetLostandFound` Lambda) | DDD (`pet-recovery` Lambda) |
| --- | --- | --- |
| Base paths | `/v2/pets/pet-lost`, `/v2/pets/pet-found` | `/pet/recovery/lost`, `/pet/recovery/found` |
| Error key namespace | `petLostAndFound.*` | `petRecovery.*` |
| Ownership error key | `common.selfAccessDenied` | `common.forbidden` |
| Notifications sub-routes | Included in the same Lambda (`/v2/account/{userId}/notifications`) | **Not present** — notifications are a separate domain |
| `petId` field type stored | Cast to ObjectId by mongoose | Stored as the raw string value from the multipart field |

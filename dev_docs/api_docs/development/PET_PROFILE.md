# Pet Profile API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Protected pet-profile CRUD endpoints plus one public tag-lookup endpoint owned by the `pet-profile` Lambda.

## Overview

| Method | Path | Auth | Lambda | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/pet/profile` | `x-api-key` + Bearer JWT | `pet-profile` | Create a pet profile from JSON or multipart/form-data |
| GET | `/pet/profile/me` | `x-api-key` + Bearer JWT | `pet-profile` | Return the caller's pet list; envelope changes for user vs NGO caller |
| GET | `/pet/profile/{petId}` | `x-api-key` + Bearer JWT | `pet-profile` | Return one authorized pet's private detail profile |
| PATCH | `/pet/profile/{petId}` | `x-api-key` + Bearer JWT | `pet-profile` | Update one authorized pet from JSON or multipart/form-data |
| DELETE | `/pet/profile/{petId}` | `x-api-key` + Bearer JWT | `pet-profile` | Soft-delete one authorized pet and clear its `tagId` |
| GET | `/pet/profile/by-tag/{tagId}` | No API key, no Bearer JWT | `pet-profile` | Public-safe tag lookup |

## Integration-Critical Contract Notes

| Topic | Current DDD behavior |
| --- | --- |
| `GET /pet/profile/me` | Branches by JWT claims. Normal user callers get `{ form, total }`. NGO-scoped callers get `{ pets, total, currentPage, perPage }`. |
| Empty pet lists | User branch returns `200` with `form: []` and `total: 0`. NGO branch returns `404 petProfile.errors.noPetsFound`. |
| Create success shape | JSON create returns `{ id, result }`. Multipart create returns only `{ id }`. |
| Patch success shape | JSON patch returns `{ id, form }`. Multipart patch returns only `{ id }`. |
| Multipart create vs JSON create | JSON create accepts `tagId` and requires `birthday`. Multipart create does not accept `tagId`, makes `birthday` optional, and is the only create flow that can upload files. |
| Multipart patch vs JSON patch | Multipart patch can upload/remove `breedimage` files and can update `tagId` / `ngoId` / `ngoPetId`. JSON patch cannot. JSON patch can update `location`, `position`, `chipId`, `placeOfBirth`, and parent fields. Multipart patch cannot. |
| Multipart booleans | Current multipart normalization treats only the literal string `true` as `true`. Any other supplied string becomes `false` before schema validation. |
| Public tag lookup | `/pet/profile/by-tag/{tagId}` is public at API Gateway: no authorizer and no `x-api-key`. Missing match is still `200` with all documented fields set to `null`. |

## API Gateway And Auth Rules

### API Gateway Requirements

| Route group | API key required at API Gateway | API Gateway authorizer |
| --- | --- | --- |
| `POST /pet/profile` | Yes | `DddTokenAuthorizer` |
| `GET /pet/profile/me` | Yes | `DddTokenAuthorizer` |
| `GET/PATCH/DELETE /pet/profile/{petId}` | Yes | `DddTokenAuthorizer` |
| `GET /pet/profile/by-tag/{tagId}` | No | None |

Protected deployed requests must send:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
```

JSON requests should also send:

```http
Content-Type: application/json
```

Multipart requests should send:

```http
Content-Type: multipart/form-data; boundary=...
```

`OPTIONS` preflight routes for all `pet-profile` paths are public and do not require `x-api-key`.

Deployment note:

- `POST /pet/profile` and `PATCH /pet/profile/{petId}` have an API Gateway request model (`GenericJsonObjectRequest`) for JSON requests.
- On deployed API Gateway, malformed JSON or non-object JSON may be rejected before Lambda with an API Gateway-generated `400`.
- In direct Lambda execution and local tests, malformed JSON is normalized into a non-500 client error response.

### Authorization And Ownership

Protected routes require a valid Bearer JWT.

The Lambda authorizes pet access when either condition matches:

- `pet.userId === jwt.userId`
- `pet.ngoId === jwt.ngoId`

For multipart create requests that include `ngoId`, additional rules apply:

- `jwt.userRole` must be `ngo`
- JWT must include `ngoId`
- body `ngoId` must equal JWT `ngoId`

Auth failure note:

- In direct Lambda execution and local handler tests, missing auth context becomes `401 common.unauthorized`
- In deployed API Gateway flows, missing or invalid auth may be rejected by the authorizer before Lambda code runs

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale in the shared runtime is `en`
- `errorKey` is the stable integration key; `error` and `message` are localized strings

### Dates

- Pet-profile input date fields accept either `DD/MM/YYYY` or ISO-like values such as `YYYY-MM-DD` / full ISO 8601
- Returned dates are JSON date strings from Mongo / JavaScript `Date` serialization

### Success Response Shape

All Lambda-produced success responses include `success: true` and `requestId`.

```json
{
  "success": true,
  "message": "Pet profile retrieved successfully",
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petProfile.errors.petNotFound",
  "error": "Pet not found",
  "requestId": "aws-lambda-request-id"
}
```

### Rate Limiting

When a rate limit is exceeded, the Lambda returns `429 common.rateLimited`. Current implemented limits:

| Route branch | Limit |
| --- | --- |
| JSON create | `20 / 300s` per authenticated `userId` |
| Multipart create | `20 / 300s` per authenticated `userId` |
| Multipart patch | `30 / 300s` per authenticated `userId` |
| Delete | `10 / 60s` per authenticated `userId` |

`429` responses may include a `retry-after` header.

## Returned Pet Shapes

### Private Detail Shape

`GET /pet/profile/{petId}`, JSON `POST /pet/profile`, and JSON `PATCH /pet/profile/{petId}` use the private detail allowlist below. Fields are returned when present; many nullable model fields may appear as `null`.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | string | Owner user id |
| `name` | string or null | |
| `breedimage` | string[] | Image URLs |
| `animal` | string or null | |
| `birthday` | string or null | ISO date string when present |
| `weight` | number or null | |
| `sex` | string or null | |
| `sterilization` | boolean or null | |
| `sterilizationDate` | string or null | ISO date string when present |
| `adoptionStatus` | string or null | Stored as a string in the current DDD model |
| `breed` | string or null | |
| `bloodType` | string or null | |
| `features` | string or null | |
| `info` | string or null | |
| `status` | string or null | |
| `owner` | string or null | |
| `ngoId` | string or null | NGO owner id when present |
| `ownerContact1` | number or null | |
| `ownerContact2` | number or null | |
| `contact1Show` | boolean | Defaults to `false` in the model |
| `contact2Show` | boolean | Defaults to `false` in the model |
| `tagId` | string or null | |
| `isRegistered` | boolean | |
| `receivedDate` | string or null | ISO date string when present |
| `ngoPetId` | string or null | Auto-generated on NGO multipart create when `ngoId` is supplied |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |
| `location` | string | Returned from stored `locationName` |
| `position` | string | |
| `chipId` | string or null | |
| `placeOfBirth` | string or null | |
| `transfer` | array | Current model stores mixed values |
| `transferNGO` | array | NGO transfer rows |
| `motherName` | string or null | |
| `motherBreed` | string or null | |
| `motherDOB` | string or null | ISO date string when present |
| `motherChip` | string or null | |
| `motherPlaceOfBirth` | string or null | |
| `motherParity` | number or null | |
| `fatherName` | string or null | |
| `fatherBreed` | string or null | |
| `fatherDOB` | string or null | ISO date string when present |
| `fatherChip` | string or null | |
| `fatherPlaceOfBirth` | string or null | |

Not returned by this allowlist:

- `deleted`
- `eyeimages`
- `medicationRecordsCount`
- `medicalRecordsCount`
- `dewormRecordsCount`
- `vaccineRecordsCount`
- `latestDewormRecords`
- `latestVaccineRecords`
- `__v`

### List Summary Shape

`GET /pet/profile/me` returns sanitized list items:

| Field | Type |
| --- | --- |
| `name` | string or null |
| `breedimage` | string[] |
| `animal` | string or null |
| `birthday` | string or null |
| `weight` | number or null |
| `sex` | string or null |
| `sterilization` | boolean or null |
| `adoptionStatus` | string or null |
| `breed` | string or null |
| `status` | string or null |
| `receivedDate` | string or null |
| `ngoPetId` | string or null |
| `createdAt` | string |
| `updatedAt` | string |
| `location` | string |
| `position` | string |

Not returned in list summaries:

- `userId`
- `ownerContact1`
- `ownerContact2`
- `tagId`
- `info`
- `features`

### Public Tag Lookup Shape

`GET /pet/profile/by-tag/{tagId}` always returns these fields inside `form`. When no pet matches, every field is `null`.

| Field | Type |
| --- | --- |
| `name` | string or null |
| `breedimage` | string[] or null |
| `animal` | string or null |
| `birthday` | string or null |
| `weight` | number or null |
| `sex` | string or null |
| `sterilization` | boolean or null |
| `breed` | string or null |
| `features` | string or null |
| `info` | string or null |
| `status` | string or null |
| `receivedDate` | string or null |

## Endpoints

### POST /pet/profile

Create a pet profile. This endpoint supports two materially different request contracts based on `Content-Type`.

**Lambda:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required  
**Rate limit:** `20 / 300s` per authenticated `userId`

#### JSON create

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `lang` | string | No | Accepted by schema but not used for shared response locale resolution |
| `name` | string | Yes | Non-empty after trim |
| `birthday` | string | Yes | `DD/MM/YYYY` or ISO-like date |
| `weight` | number | No | Finite number |
| `sex` | string | Yes | Non-empty after trim |
| `sterilization` | boolean | No | |
| `animal` | string | Yes | Non-empty after trim |
| `breed` | string | No | |
| `features` | string | No | |
| `info` | string | No | |
| `status` | string | No | |
| `breedimage` | string[] | No | Each element must be a valid URL |
| `tagId` | string | No | Must be unique among non-deleted pets |
| `receivedDate` | string | No | `DD/MM/YYYY` or ISO-like date |

Unknown fields are rejected with `400 petProfile.errors.invalidBodyParams`.

**Example**

```json
{
  "name": "Mochi",
  "birthday": "2024-01-01",
  "sex": "Female",
  "animal": "Dog",
  "tagId": "TAG-001"
}
```

**Behavior notes**

- caller's active `User` record must still exist, otherwise `404 petProfile.errors.userNotFound`
- duplicate `tagId` returns `409 petProfile.errors.duplicatePetTag`
- stored `transferNGO` is seeded with one placeholder row on this JSON create branch

**Success (201)**

```json
{
  "success": true,
  "message": "Pet profile created successfully",
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "result": {
    "userId": "665f1a2b3c4d5e6f7a8b9c0c",
    "name": "Mochi",
    "breedimage": [],
    "animal": "Dog",
    "birthday": "2024-01-01T00:00:00.000Z",
    "sex": "Female",
    "tagId": "TAG-001",
    "transferNGO": [
      {
        "regDate": null,
        "regPlace": null,
        "transferOwner": null,
        "UserContact": null,
        "UserEmail": null,
        "transferContact": null,
        "transferRemark": null,
        "isTransferred": false
      }
    ]
  },
  "requestId": "aws-lambda-request-id"
}
```

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petProfile.errors.nameRequired` | Missing or empty `name` |
| 400 | `petProfile.errors.birthdayRequired` | Missing or empty `birthday` |
| 400 | `petProfile.errors.sexRequired` | Missing or empty `sex` |
| 400 | `petProfile.errors.animalRequired` | Missing or empty `animal` |
| 400 | `petProfile.errors.invalidDateFormat` | `birthday` or `receivedDate` failed date validation |
| 400 | `petProfile.errors.invalidImageUrl` | A `breedimage` entry is not a valid URL |
| 400 | `petProfile.errors.invalidBodyParams` | Unknown or disallowed request field |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts |
| 404 | `petProfile.errors.userNotFound` | Caller's active user record does not exist |
| 409 | `petProfile.errors.duplicatePetTag` | `tagId` already belongs to another non-deleted pet |
| 429 | `common.rateLimited` | Create rate limit exceeded |
| 500 | `common.internalError` | Unexpected error |

#### Multipart create

Use this branch when uploading image files.

**Body fields**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | Yes | |
| `animal` | string | Yes | |
| `sex` | string | Yes | |
| `breed` | string | No | |
| `birthday` | string | No | `DD/MM/YYYY` or ISO-like date |
| `weight` | number | No | Sent as form-data text; parsed into a number |
| `sterilization` | boolean | No | Sent as form-data text; `"true"` becomes `true` |
| `sterilizationDate` | string | No | `DD/MM/YYYY` or ISO-like date |
| `adoptionStatus` | string | No | Stored as a string in the current DDD model |
| `bloodType` | string | No | |
| `features` | string | No | |
| `info` | string | No | |
| `status` | string | No | |
| `owner` | string | No | |
| `ngoId` | string | No | Requires NGO caller rules documented above |
| `ownerContact1` | number | No | Sent as form-data text; parsed into a number |
| `ownerContact2` | number | No | Sent as form-data text; parsed into a number |
| `contact1Show` | boolean | No | Sent as form-data text |
| `contact2Show` | boolean | No | Sent as form-data text |
| `receivedDate` | string | No | `DD/MM/YYYY` or ISO-like date |
| `location` | string | No | Stored as `locationName` |
| `position` | string | No | |
| `breedimage` | string | No | Fallback single URL when no uploaded file is provided |
| `files[]` | file parts | No | Uploaded image files |

Current multipart create contract does **not** accept:

- `tagId`
- `ngoPetId`

Unknown fields are rejected with `400 petProfile.errors.invalidBodyParams`.

**Behavior notes**

- each uploaded file is written to S3 under `user-uploads/pets/<generated-object-id>/...`
- the Lambda also creates / updates an `ImageCollection` record for each uploaded file
- multipart boolean fields use `String(value).toLowerCase() === "true"` normalization
- if no files are uploaded and `breedimage` is provided, the pet stores that single URL as its `breedimage` array
- if `ngoId` is present, the Lambda auto-generates `ngoPetId = <ngoPrefix><seq padded to 5>`
- generated `ngoPetId` must still be unique; collision returns `409 petProfile.errors.duplicateNgoPetId`

**Success (201)**

```json
{
  "success": true,
  "message": "Pet profile created successfully",
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "aws-lambda-request-id"
}
```

**Additional multipart create errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petProfile.errors.invalidSterilizationDateFormat` | Bad `sterilizationDate` |
| 400 | `petProfile.errors.invalidReceivedDateFormat` | Bad `receivedDate` |
| 403 | `petProfile.errors.ngoRoleRequired` | Non-NGO caller tried to create with `ngoId` |
| 403 | `petProfile.errors.ngoIdClaimRequired` | NGO caller sent `ngoId` but JWT had no `ngoId` claim |
| 403 | `common.forbidden` | Body `ngoId` did not match JWT `ngoId` |
| 409 | `petProfile.errors.duplicateNgoPetId` | Auto-generated `ngoPetId` collided |

### GET /pet/profile/me

Return the current caller's pet list. This route has two response branches.

**Lambda:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required

#### User-scoped branch

This branch is used when the auth context does not carry `ngoId`.

**Query params**

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | number | `1` when omitted | 1-indexed; page size is fixed at `10`; send numeric values only |

**Behavior notes**

- query is always `{ userId: jwt.userId, deleted: false }`
- sort is always `updatedAt: -1`
- response does not include `currentPage` or `perPage`
- empty result is still `200`
- current implementation does not safely normalize non-numeric `page` strings before passing them into pagination math

**Success (200)**

```json
{
  "success": true,
  "message": "Pet profiles retrieved successfully",
  "form": [
    {
      "name": "Mochi",
      "animal": "Dog",
      "location": "Shelter A"
    }
  ],
  "total": 1,
  "requestId": "aws-lambda-request-id"
}
```

#### NGO-scoped branch

This branch is used when the auth context includes `ngoId`.

**Query params**

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | number | `1` when omitted | 1-indexed; page size is fixed at `30`; send numeric values only |
| `search` | string | none | Regex-escaped before use |
| `sortBy` | string | `updatedAt` | Allowlist: `updatedAt`, `createdAt`, `name`, `animal`, `breed`, `birthday`, `receivedDate`, `ngoPetId` |
| `sortOrder` | string | `desc` | `asc` or `desc`; anything else falls back to `desc` |

**Behavior notes**

- base query is `{ ngoId: jwt.ngoId, deleted: false }`
- `search` is matched case-insensitively against `name`, `animal`, `breed`, `ngoPetId`, `locationName`, and `owner`
- sort always includes `_id: -1` as a tiebreaker
- empty result returns `404 petProfile.errors.noPetsFound`
- current implementation does not safely normalize non-numeric `page` strings before passing them into pagination math

**Success (200)**

```json
{
  "success": true,
  "message": "Pet profiles retrieved successfully",
  "pets": [
    {
      "name": "Mochi",
      "animal": "Dog",
      "ngoPetId": "NGO00001"
    }
  ],
  "total": 1,
  "currentPage": 2,
  "perPage": 30,
  "requestId": "aws-lambda-request-id"
}
```

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts |
| 404 | `petProfile.errors.noPetsFound` | NGO branch only; no matching pets |
| 500 | `common.internalError` | Unexpected error |

### GET /pet/profile/{petId}

Return one authorized pet's private detail profile.

**Lambda:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required

**Path params**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | Must be a valid Mongo ObjectId |

**Success (200)**

```json
{
  "success": true,
  "message": "Pet profile retrieved successfully",
  "form": {
    "userId": "665f1a2b3c4d5e6f7a8b9c0c",
    "name": "Mochi",
    "animal": "Dog",
    "sex": "Female",
    "birthday": "2024-01-01T00:00:00.000Z",
    "tagId": "TAG-001",
    "ownerContact1": 91234567
  },
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "aws-lambda-request-id"
}
```

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petProfile.errors.invalidPetId` | `petId` is not a valid ObjectId |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts |
| 403 | `common.forbidden` | Caller is not the pet owner and does not share the pet's `ngoId` |
| 404 | `petProfile.errors.petNotFound` | Pet does not exist or is already deleted |
| 500 | `common.internalError` | Unexpected error |

### PATCH /pet/profile/{petId}

Update one authorized pet. JSON and multipart requests have different allowed fields and success envelopes.

**Lambda:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required
**Rate limit:** multipart branch only: `30 / 300s` per authenticated `userId`

**Path params**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | Must be a valid Mongo ObjectId |

#### JSON patch

**Body**

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | |
| `breedimage` | string[] | Each element must be a valid URL |
| `animal` | string | |
| `birthday` | string | `DD/MM/YYYY` or ISO-like date |
| `weight` | number | |
| `sex` | string | |
| `sterilization` | boolean | |
| `sterilizationDate` | string | `DD/MM/YYYY` or ISO-like date |
| `adoptionStatus` | string | Stored as a string in the current DDD model |
| `breed` | string | |
| `bloodType` | string | |
| `features` | string | |
| `info` | string | |
| `status` | string | |
| `ownerContact1` | number | |
| `ownerContact2` | number | |
| `contact1Show` | boolean | |
| `contact2Show` | boolean | |
| `receivedDate` | string | `DD/MM/YYYY` or ISO-like date |
| `location` | string | Stored as `locationName` |
| `position` | string | |
| `chipId` | string | |
| `placeOfBirth` | string | |
| `motherName` | string | |
| `motherBreed` | string | |
| `motherDOB` | string | `DD/MM/YYYY` or ISO-like date |
| `motherChip` | string | |
| `motherPlaceOfBirth` | string | |
| `motherParity` | number | Coerced from numeric input |
| `fatherName` | string | |
| `fatherBreed` | string | |
| `fatherDOB` | string | `DD/MM/YYYY` or ISO-like date |
| `fatherChip` | string | |
| `fatherPlaceOfBirth` | string | |

Current JSON patch contract does **not** accept:

- `owner`
- `tagId`
- `ngoId`
- `ngoPetId`
- `isRegistered`
- arbitrary Mongo operators or extra fields

Unknown fields are rejected with `400 petProfile.errors.invalidBodyParams`.

**Example**

```json
{
  "name": "Updated Mochi",
  "location": "Shelter A",
  "motherParity": 2
}
```

**Success (200)**

```json
{
  "success": true,
  "message": "Pet profile updated successfully",
  "form": {
    "name": "Updated Mochi",
    "location": "Shelter A",
    "motherParity": 2
  },
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "aws-lambda-request-id"
}
```

**JSON patch errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.noFieldsToUpdate` | Empty object body |
| 400 | `petProfile.errors.invalidBodyParams` | Unknown field or mass-assignment attempt |
| 400 | `petProfile.errors.invalidImageUrl` | Bad `breedimage` URL |
| 400 | `petProfile.errors.invalidBirthdayFormat` | Bad `birthday` |
| 400 | `petProfile.errors.invalidWeightType` | Non-numeric `weight` |
| 400 | `petProfile.errors.invalidSterilizationType` | Non-boolean `sterilization` |
| 400 | `petProfile.errors.invalidSterilizationDateFormat` | Bad `sterilizationDate` |
| 400 | `petProfile.errors.invalidOwnerContact1Type` | Non-numeric `ownerContact1` |
| 400 | `petProfile.errors.invalidOwnerContact2Type` | Non-numeric `ownerContact2` |
| 400 | `petProfile.errors.invalidContact1ShowType` | Non-boolean `contact1Show` |
| 400 | `petProfile.errors.invalidContact2ShowType` | Non-boolean `contact2Show` |
| 400 | `petProfile.errors.invalidReceivedDateFormat` | Bad `receivedDate` |
| 400 | `petProfile.errors.invalidParentDateFormat` | Bad `motherDOB` or `fatherDOB` |
| 400 | `petProfile.errors.invalidMotherParity` | Bad `motherParity` |
| 400 | `petProfile.errors.invalidPetId` | Bad `petId` |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petProfile.errors.petNotFound` | Pet missing or deleted |
| 500 | `common.internalError` | Unexpected error |

#### Multipart patch

Use this branch when uploading or removing pet images, or when updating `tagId` / `ngoId` / `ngoPetId`.

**Body fields**

| Field | Type | Notes |
| --- | --- | --- |
| `removedIndices` | string | JSON array string of integer indices to remove from current `breedimage`, e.g. `"[0,2]"` |
| `name` | string | |
| `animal` | string | |
| `birthday` | string | `DD/MM/YYYY` or ISO-like date |
| `weight` | number | Sent as form-data text |
| `sex` | string | |
| `sterilization` | boolean | Sent as form-data text; only literal `true` becomes `true` |
| `sterilizationDate` | string | `DD/MM/YYYY` or ISO-like date |
| `adoptionStatus` | string | Stored as a string in the current DDD model |
| `breed` | string | |
| `bloodType` | string | |
| `features` | string | |
| `info` | string | |
| `status` | string | |
| `owner` | string | |
| `tagId` | string | Must remain unique among non-deleted pets |
| `ownerContact1` | number | Sent as form-data text |
| `ownerContact2` | number | Sent as form-data text |
| `contact1Show` | boolean | Sent as form-data text |
| `contact2Show` | boolean | Sent as form-data text |
| `receivedDate` | string | `DD/MM/YYYY` or ISO-like date |
| `ngoId` | string | Only allowed when caller is the matching NGO owner |
| `ngoPetId` | string | Only allowed when caller is the matching NGO owner; must remain unique |
| `files[]` | file parts | Appended to `breedimage` after any removals |

Current multipart patch contract does **not** accept:

- `location`
- `position`
- `chipId`
- `placeOfBirth`
- parent fields such as `motherName` / `fatherName`
- deprecated body `petId`

Unknown fields are rejected with `400 petProfile.errors.invalidBodyParams`.

**Behavior notes**

- current pet is loaded first with ownership enforcement
- `removedIndices` is applied in descending index order
- each uploaded file is stored in S3 under `user-uploads/pets/<petId>/...`
- uploaded file URLs are appended to `breedimage`
- multipart boolean fields use `String(value).toLowerCase() === "true"` normalization
- non-NGO owners cannot set `ngoPetId`
- `ngoId` can only be set when it matches both the pet's current NGO ownership context and the caller's JWT `ngoId`

**Success (200)**

```json
{
  "success": true,
  "message": "Pet profile updated successfully",
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "aws-lambda-request-id"
}
```

**Additional multipart patch errors**

Multipart patch also shares these base protected-route errors with JSON patch:

- `400 petProfile.errors.invalidPetId`
- `401/403 common.unauthorized`
- `403 common.forbidden`
- `404 petProfile.errors.petNotFound`
- `500 common.internalError`

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petProfile.errors.invalidRemovedIndices` | `removedIndices` is not valid JSON array of integers |
| 403 | `common.forbidden` | `ngoId` mismatch or non-NGO caller tried to set `ngoPetId` |
| 409 | `petProfile.errors.duplicatePetTag` | Requested `tagId` already belongs to another non-deleted pet |
| 409 | `petProfile.errors.duplicateNgoPetId` | Requested `ngoPetId` already belongs to another non-deleted pet |

### DELETE /pet/profile/{petId}

Soft-delete one authorized pet and clear its `tagId`.

**Lambda:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required  
**Rate limit:** `10 / 60s` per authenticated `userId`

**Path params**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | Must be a valid Mongo ObjectId |

**Side effects**

- sets `deleted: true`
- sets `tagId: null`

**Success (200)**

```json
{
  "success": true,
  "message": "Pet profile deleted successfully",
  "petId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "aws-lambda-request-id"
}
```

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petProfile.errors.invalidPetId` | `petId` is not a valid ObjectId |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petProfile.errors.petNotFound` | Pet missing or lost after the authorization read |
| 409 | `petProfile.errors.petAlreadyDeleted` | Pet was already deleted before the write stage |
| 429 | `common.rateLimited` | Delete rate limit exceeded |
| 500 | `common.internalError` | Unexpected error |

### GET /pet/profile/by-tag/{tagId}

Public-safe tag lookup. This route is intentionally public at API Gateway.

**Lambda:** `pet-profile`  
**Auth:** none  
**API key:** not required

**Path params**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `tagId` | string | Yes | Arbitrary tag string |

**Success (200, match found)**

```json
{
  "success": true,
  "message": "Pet tag lookup processed successfully",
  "form": {
    "name": "Mochi",
    "breedimage": [
      "https://cdn.example.test/pet.jpg"
    ],
    "animal": "Dog",
    "birthday": "2024-01-01T00:00:00.000Z",
    "weight": 4.2,
    "sex": "Female",
    "sterilization": true,
    "breed": "Mixed",
    "features": "White paws",
    "info": "Friendly",
    "status": "active",
    "receivedDate": null
  },
  "requestId": "aws-lambda-request-id"
}
```

**Success (200, no match)**

```json
{
  "success": true,
  "message": "Pet tag lookup processed successfully",
  "form": {
    "name": null,
    "breedimage": null,
    "animal": null,
    "birthday": null,
    "weight": null,
    "sex": null,
    "sterilization": null,
    "breed": null,
    "features": null,
    "info": null,
    "status": null,
    "receivedDate": null
  },
  "requestId": "aws-lambda-request-id"
}
```

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petProfile.errors.missingTagId` | Missing route parameter |
| 500 | `common.internalError` | Unexpected error |

## Frontend Integration Guide

1. Use JSON `POST` / `PATCH` when no file upload is involved and the UI needs the updated pet payload immediately.
2. Use multipart `POST` / `PATCH` when uploading images. These branches only return `{ success, message, id, requestId }`, so refetch `GET /pet/profile/{petId}` if the UI needs the full updated profile.
3. Treat `GET /pet/profile/me` as a two-envelope route. User callers should read `form`; NGO callers should read `pets`.
4. For public tag scanning, call `GET /pet/profile/by-tag/{tagId}` without auth or API key and treat the all-`null` response as "no pet matched this tag".
5. If the client needs to edit `tagId` or `ngoPetId`, it must use multipart patch. Current JSON patch does not accept those fields.

## Verification Sources

This doc was derived from:

- `template.yaml`
- `functions/pet-profile/src/router.ts`
- `functions/pet-profile/src/services/*.ts`
- `functions/pet-profile/src/utils/auth.ts`
- `functions/pet-profile/src/utils/sanitize.ts`
- `functions/pet-profile/src/zodSchema/*.ts`
- `__tests__/pet-profile.test.js`
- legacy reference `../AWS_API/dev_docs/api_docs/PET_PROFILE_API.md`

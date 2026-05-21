# Pet Profile API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-pet-profile`

Pet profile creation, list/read, update, delete, and public tag lookup. The current DDD implementation uses the shared `{ success, message, data, pagination?, requestId }` contract. Older docs that describe top-level `pets`, `result`, or `form` payloads are no longer accurate.

---

## Overview

### Route Summary

| Method | Path | Auth | Content-Type | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/pet/profile` | `x-api-key` + Bearer JWT | `multipart/form-data` | Create a pet profile |
| GET | `/pet/profile/me` | `x-api-key` + Bearer JWT | — | List the caller's pets |
| GET | `/pet/profile/{petId}` | `x-api-key` + Bearer JWT | — | Get one authorized pet profile |
| PATCH | `/pet/profile/{petId}` | `x-api-key` + Bearer JWT | `multipart/form-data` | Update one authorized pet profile |
| DELETE | `/pet/profile/{petId}` | `x-api-key` + Bearer JWT | — | Soft-delete one authorized pet profile |
| GET | `/pet/profile/by-tag/{tagId}` | `x-api-key` only | — | Public tag-based profile lookup |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Success wrapper | All successful routes return the shared wrapper; list routes include `pagination` |
| Create response | Create returns `data: { id, ...sanitizedFullPet }` |
| Single-pet response | `GET /pet/profile/{petId}` returns `data: { id, ...selectedViewFields }`; `view=basic` additionally includes `latestPetLostId` |
| List response | `GET /pet/profile/me` returns `data: PetSummary[]` plus `pagination` for both user and NGO callers |
| Patch response | PATCH returns no `data`; refetch if the updated pet document is needed |
| Empty PATCH | An empty multipart PATCH is accepted as a `200` no-op and still saves the authorized pet document |
| Delete response | DELETE returns no `data` |
| Public tag lookup | Tag lookup returns a fixed public field set inside `data`; when no pet matches, it returns `404 common.notFound` |
| View selector | `GET /pet/profile/{petId}` supports `?view=basic`, `?view=detail`, or `?view=full` with `full` as the default |
| Update transport | PATCH uses multipart parsing, including typed normalization and optional file uploads |
| List mode switch | `GET /pet/profile/me` scopes by `ngoId` when present, otherwise by `userId`; search and sort apply in both cases |

---

## Auth Reference

Gateway/API-key/JWT behavior for pet-profile routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization

Protected routes authorize access when either condition is true:

- `pet.userId === jwt.userId`
- `pet.ngoId === jwt.ngoId`

Additional NGO rules apply when the request body includes `ngoId` or `ngoPetId`:

- the caller must be NGO-scoped
- the JWT must contain `ngoId`
- body `ngoId` must match JWT `ngoId`

### Rate Limits

| Route | Policy |
| --- | --- |
| Create pet profile | IP 60 / 300s, identifier 30 / 300s, IP+identifier 20 / 300s |
| Patch pet profile | IP 90 / 300s, identifier 45 / 300s, IP+identifier 30 / 300s |
| Delete pet profile | IP 30 / 60s, identifier 15 / 60s, IP+identifier 10 / 60s |

Rate-limit failures return `429 common.rateLimited`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale is `en`
- Use `errorKey` for integration logic

### Request Body Validation

`POST /pet/profile` and `PATCH /pet/profile/{petId}` both parse `multipart/form-data`, normalize typed fields, and then validate against strict Zod schemas.

Current multipart normalization includes:

- `weight`, `ownerContact1`, and `ownerContact2` string values to numbers
- `sterilization`, `contact1Show`, and `contact2Show` string values to booleans
- single-string `breedimage` fallback values to a one-item array
- PATCH-only reset normalization for selected fields:
  - `weight`: multipart text `null` (or empty string) maps to `null`
  - `ownerContact2`: multipart text `null` maps to `null`
  - `motherDOB` / `fatherDOB`: empty string or multipart text `null` maps to `null`
  - `motherParity`: multipart text `null` maps to `null`

Current validation behavior:

| Condition | `errorKey` |
| --- | --- |
| Multipart parse failure or malformed typed value normalization | `common.invalidBodyParams` |
| Unknown field supplied | `common.invalidBodyParams` |
| Create body fails required-field validation | First schema issue key, for example `petProfile.errors.nameRequired` |
| Patch body contains only known-but-omitted fields / no updates | No validation error; handler continues and returns `200` |

---

## Success And Error Conventions

### Success Response Shape

Single-record success:

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d"
  },
  "requestId": "aws-lambda-request-id"
}
```

List success:

```json
{
  "success": true,
  "message": "Retrieved successfully",
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

Patch success:

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

Delete success:

```json
{
  "success": true,
  "message": "Deleted successfully",
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petProfile.errors.petNotFound",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

### View-Specific Returned Shapes

#### Basic View Fields

`GET /pet/profile/{petId}?view=basic` returns `id` plus these fields when present:

- `userId`
- `name`
- `breedimage`
- `animal`
- `birthday`
- `weight`
- `sex`
- `sterilization`
- `sterilizationDate`
- `adoptionStatus`
- `breed`
- `bloodType`
- `features`
- `info`
- `status`
- `owner`
- `ngoId`
- `ownerContact1`
- `ownerContact2`
- `contact1Show`
- `contact2Show`
- `tagId`
- `isRegistered`
- `receivedDate`
- `ngoPetId`
- `createdAt`
- `updatedAt`
- `location`
- `position`
- `latestPetLostId`

`latestPetLostId` is the newest linked lost-report id for this pet, selected by
`createdAt` descending. It is `null` when no linked lost report exists.

#### Detail View Fields

`GET /pet/profile/{petId}?view=detail` returns `id` plus lineage/transfer fields:

- `chipId`
- `placeOfBirth`
- `motherName`
- `motherBreed`
- `motherDOB`
- `motherChip`
- `motherPlaceOfBirth`
- `motherParity`
- `fatherName`
- `fatherBreed`
- `fatherDOB`
- `fatherChip`
- `fatherPlaceOfBirth`
- `transfer`
- `transferNGO`

#### Full View Fields

`GET /pet/profile/{petId}?view=full` returns `id` plus the union of basic and detail fields.

#### List Summary Fields

`GET /pet/profile/me` returns an array of summary objects inside `data`. Each item may include:

- `_id`
- `name`
- `breedimage`
- `animal`
- `birthday`
- `weight`
- `sex`
- `sterilization`
- `adoptionStatus`
- `breed`
- `status`
- `receivedDate`
- `ngoPetId`
- `createdAt`
- `updatedAt`
- `location`
- `position`

The list summary intentionally does not include `userId`, contact fields, `tagId`, `info`, or `features`.

#### Public Tag Lookup Fields

`GET /pet/profile/by-tag/{tagId}` returns `data` with this fixed shape:

- `name`
- `breedimage`
- `animal`
- `birthday`
- `weight`
- `sex`
- `sterilization`
- `breed`
- `features`
- `info`
- `status`
- `receivedDate`
- `ownerEmail`
- `ownerPhoneNumber`

---

## Endpoints

### POST /pet/profile

Create a pet profile.

**Lambda owner:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `multipart/form-data`

#### Create Form Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | Yes | |
| `animal` | string | Yes | |
| `sex` | string | Yes | |
| `birthday` | string | Yes | Flexible date string |
| `breed` | string | No | |
| `weight` | number | No | Multipart numeric normalization applies |
| `sterilization` | boolean | No | Multipart boolean normalization applies |
| `sterilizationDate` | string | No | Flexible date string |
| `adoptionStatus` | string | No | |
| `bloodType` | string | No | |
| `features` | string | No | |
| `info` | string | No | |
| `status` | string | No | |
| `owner` | string | No | |
| `ngoId` | string | No | NGO-scoped create only |
| `ownerContact1` | number | No | Multipart numeric normalization applies |
| `ownerContact2` | number | No | Multipart numeric normalization applies |
| `contact1Show` | boolean | No | Multipart boolean normalization applies |
| `contact2Show` | boolean | No | Multipart boolean normalization applies |
| `receivedDate` | string | No | Flexible date string |
| `location` | string | No | Stored as `locationName` |
| `position` | string | No | |
| `tagId` | string | No | Must be unique among non-deleted pets |
| `breedimage` | string[] | No | Fallback URL array when no image files are uploaded; a single string form value is normalized to a one-item array |
| file parts | file | No | Uploaded images |

`ngoPetId` is not accepted on create. The handler generates it when needed for NGO-owned pets.

#### Create Example Request

Use multipart form-data. Representative text fields:

```text
name=Mochi
animal=Dog
sex=Female
birthday=2024-01-01
weight=12.5
sterilization=true
location=Shelter A
tagId=TAG-001
```

#### Create Side Effects

- Verifies the caller's active user record still exists
- Enforces unique `tagId`
- Generates `ngoPetId` when `ngoId` is supplied by an authorized NGO caller
- Enforces unique generated `ngoPetId`
- Uploads image files to storage and stores resulting URLs in `breedimage`
- Seeds `transferNGO` with the initial placeholder row

#### Create Success (201)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d",
    "name": "Mochi",
    "animal": "Dog",
    "sex": "Female",
    "birthday": "2024-01-01T00:00:00.000Z",
    "breedimage": []
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Create Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Multipart parse failure, strict-schema violation, unknown field, or invalid field type |
| 400 | `petProfile.errors.nameRequired` | Missing `name` |
| 400 | `petProfile.errors.animalRequired` | Missing `animal` |
| 400 | `petProfile.errors.sexRequired` | Missing `sex` |
| 400 | `petProfile.errors.birthdayRequired` | Missing `birthday` |
| 400 | `petProfile.errors.invalidDateFormat` | Invalid `birthday` |
| 400 | `petProfile.errors.invalidSterilizationDateFormat` | Invalid `sterilizationDate` |
| 400 | `petProfile.errors.invalidReceivedDateFormat` | Invalid `receivedDate` |
| 400 | `petProfile.errors.invalidImageUrl` | Invalid fallback `breedimage` URL |
| 400 | `petProfile.errors.invalidFileType` | Unsupported upload file type |
| 403 | `petProfile.errors.ngoRoleRequired` | Non-NGO caller supplied `ngoId` |
| 403 | `petProfile.errors.ngoIdClaimRequired` | NGO caller supplied `ngoId` but JWT lacks `ngoId` |
| 403 | `common.forbidden` | Body `ngoId` does not match JWT `ngoId` |
| 404 | `petProfile.errors.userNotFound` | Caller's user record is missing or deleted |
| 409 | `petProfile.errors.duplicatePetTag` | `tagId` already belongs to another non-deleted pet |
| 409 | `petProfile.errors.duplicateNgoPetId` | Generated NGO pet id collides |
| 413 | `petProfile.errors.fileTooLarge` | Uploaded file exceeds size limit |
| 429 | `common.rateLimited` | Create rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### GET /pet/profile/me

List the caller's pets.

**Lambda owner:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required

#### List Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Shared pagination schema |
| `limit` | integer | No | Shared pagination schema |
| `search` | string | No | Filters the caller's scoped pet list by `name`, `animal`, `breed`, `ngoPetId`, `location`, and `owner` |
| `sortBy` | string | No | Allowlist: `updatedAt`, `createdAt`, `name`, `animal`, `breed`, `birthday`, `receivedDate`, `ngoPetId` |
| `sortOrder` | `asc` or `desc` | No | Defaults to `desc` when omitted or invalid |

Current implementation note: the handler scopes the list by `ngoId` whenever the auth context contains `ngoId`; otherwise it scopes by `userId`. `search`, `sortBy`, and `sortOrder` work in either scope.

#### List Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "name": "Mochi",
      "animal": "Dog",
      "location": "Shelter A"
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

#### List Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid pagination query values |
| 500 | `common.internalError` | Unexpected internal error |

### GET /pet/profile/{petId}

Get one authorized pet profile.

**Lambda owner:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required

#### Get Path And Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId |
| `view` | `basic`, `detail`, or `full` | No | Defaults to `full` |

#### Get Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d",
    "name": "Mochi",
    "animal": "Dog",
    "status": "available",
    "latestPetLostId": "665f1a2b3c4d5e6f7a8b9c9a"
  },
  "requestId": "aws-lambda-request-id"
}
```

For `view=basic`, `latestPetLostId` is the newest linked lost-report id for the
pet, or `null` when no linked lost report exists. `view=detail` and `view=full`
do not add this helper field.

#### Get Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petProfile.errors.invalidView` | Invalid `view` query value |
| 400 | `common.invalidObjectId` | Invalid `petId` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petProfile.errors.petNotFound` | Pet does not exist or is deleted |
| 500 | `common.internalError` | Unexpected internal error |

### PATCH /pet/profile/{petId}

Update one authorized pet profile.

**Lambda owner:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `multipart/form-data`

#### Patch Form Fields

Any subset of these fields may be supplied:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `removedIndices` | string | No | JSON array of breedimage indexes to remove |
| `name` | string | No | |
| `animal` | string | No | |
| `birthday` | string | No | Flexible date string |
| `weight` | number or `null` | No | Multipart numeric normalization applies; patch reset accepts empty string or text `null` |
| `sex` | string | No | |
| `sterilization` | boolean | No | Multipart boolean normalization applies |
| `sterilizationDate` | string | No | Flexible date string |
| `adoptionStatus` | string | No | |
| `breed` | string | No | |
| `bloodType` | string | No | |
| `features` | string | No | |
| `info` | string | No | |
| `status` | string | No | |
| `owner` | string | No | |
| `tagId` | string | No | Unique among non-deleted pets |
| `ownerContact1` | number | No | Multipart numeric normalization applies |
| `ownerContact2` | number or `null` | No | Multipart numeric normalization applies; patch reset accepts text `null` |
| `contact1Show` | boolean | No | Multipart boolean normalization applies |
| `contact2Show` | boolean | No | Multipart boolean normalization applies |
| `receivedDate` | string | No | Flexible date string |
| `ngoId` | string | No | NGO-owner only |
| `ngoPetId` | string | No | NGO-owner only; uniqueness enforced |
| `location` | string | No | Stored as `locationName` |
| `position` | string | No | |
| `chipId` | string | No | |
| `placeOfBirth` | string | No | |
| `motherName` | string | No | |
| `motherBreed` | string | No | |
| `motherDOB` | string or `null` | No | Flexible date string; patch reset accepts empty string or text `null` |
| `motherChip` | string | No | |
| `motherPlaceOfBirth` | string | No | |
| `motherParity` | number or `null` | No | Coerced numeric input; patch reset accepts text `null` |
| `fatherName` | string | No | |
| `fatherBreed` | string | No | |
| `fatherDOB` | string or `null` | No | Flexible date string; patch reset accepts empty string or text `null` |
| `fatherChip` | string | No | |
| `fatherPlaceOfBirth` | string | No | |
| file parts | file | No | Additional uploaded images |

#### Patch Reset Payloads

For the following resettable fields, use these multipart field values:

| Field | Reset payload |
| --- | --- |
| `weight` | `null` |
| `features` | `""` |
| `info` | `""` |
| `tagId` | `""` |
| `ownerContact2` | `null` |
| `chipId` | `""` |
| `placeOfBirth` | `""` |
| `motherName` | `""` |
| `motherBreed` | `""` |
| `motherDOB` | `null` |
| `motherChip` | `""` |
| `motherPlaceOfBirth` | `""` |
| `motherParity` | `null` |
| `fatherName` | `""` |
| `fatherBreed` | `""` |
| `fatherDOB` | `null` |
| `fatherChip` | `""` |
| `fatherPlaceOfBirth` | `""` |

`null` above means multipart text value `null` (for example via `formData.append('motherDOB', 'null')`).

#### Patch Example Request

Use multipart form-data. Representative text fields:

```text
name=Mochi Updated
removedIndices=[0]
motherName=Lucy
motherParity=2
ngoPetId=HP00042
```

#### Patch Success (200)

PATCH always returns the shared success wrapper without `data`, including no-op updates.

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

If the multipart body contains no allowlisted changes, the current handler still returns `200` and persists the document unchanged.

#### Patch Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `petId` |
| 400 | `common.invalidBodyParams` | Multipart parse failure, unknown field, strict-schema violation, or invalid field type |
| 400 | `petProfile.errors.invalidBirthdayFormat` | Invalid `birthday` |
| 400 | `petProfile.errors.invalidWeightType` | Invalid `weight` |
| 400 | `petProfile.errors.invalidSterilizationDateFormat` | Invalid `sterilizationDate` |
| 400 | `petProfile.errors.invalidReceivedDateFormat` | Invalid `receivedDate` |
| 400 | `petProfile.errors.invalidParentDateFormat` | Invalid `motherDOB` or `fatherDOB` |
| 400 | `petProfile.errors.invalidMotherParity` | Invalid `motherParity` |
| 400 | `petProfile.errors.invalidRemovedIndices` | `removedIndices` is not a valid JSON integer array |
| 400 | `petProfile.errors.invalidFileType` | Unsupported upload file type |
| 403 | `common.forbidden` | Caller does not own the pet or tried unauthorized NGO field changes |
| 404 | `petProfile.errors.petNotFound` | Pet does not exist or is deleted |
| 409 | `petProfile.errors.duplicatePetTag` | `tagId` already belongs to another pet |
| 409 | `petProfile.errors.duplicateNgoPetId` | Requested NGO pet id already belongs to another pet |
| 413 | `petProfile.errors.fileTooLarge` | Uploaded file exceeds size limit |
| 429 | `common.rateLimited` | Patch rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### DELETE /pet/profile/{petId}

Soft-delete one authorized pet profile.

**Lambda owner:** `pet-profile`  
**Auth:** `x-api-key` + Bearer JWT required

#### Delete Side Effects

- sets `deleted: true`
- clears `tagId` to `null`

#### Delete Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `petId` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petProfile.errors.petNotFound` | Pet does not exist |
| 409 | `petProfile.errors.petAlreadyDeleted` | Pet was already deleted |
| 429 | `common.rateLimited` | Delete rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### GET /pet/profile/by-tag/{tagId}

Public tag-based lookup.

**Lambda owner:** `pet-profile`  
**Auth:** `x-api-key` only

#### Tag Lookup Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `tagId` | string | Yes | Temporary-id/path-string validation, not Mongo ObjectId |

#### Tag Lookup Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "name": "Mochi",
    "breedimage": ["https://cdn.example.com/pet.jpg"],
    "animal": "Dog",
    "birthday": "2024-01-01T00:00:00.000Z",
    "weight": 12.5,
    "sex": "Female",
    "sterilization": true,
    "breed": "Mixed",
    "features": "Brown ears",
    "info": "Friendly",
    "status": "available",
    "receivedDate": "2024-01-02T00:00:00.000Z",
    "ownerEmail": "owner@example.com",
    "ownerPhoneNumber": "91234567"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Tag Lookup Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidPathParams` or shared path-validation key | Invalid `tagId` path value |
| 404 | `common.notFound` | No non-deleted pet matches the supplied `tagId` |
| 500 | `common.internalError` | Unexpected internal error |

---

## Frontend Integration Guide

1. Build create and update forms as multipart submissions, even when no images are attached.
2. Read pet lists from `data` and pagination state from `pagination`; do not rely on legacy top-level `pets`, `total`, or `result` keys.
3. Use `GET /pet/profile/{petId}?view=basic|detail|full` to fetch only the slice the screen needs.
4. After PATCH or DELETE, refetch or update local state explicitly because those routes return no `data` payload.
5. For NGO-managed pets, treat `ngoId` and `ngoPetId` as privileged fields; non-NGO callers should never send them.
6. Use the public tag lookup only for the small public field set. It is not a full replacement for the authenticated pet detail route.

---

## Verification Snapshot

This document is grounded in the current handlers in `functions/pet-profile/src/services/createProfile.ts`, `getProfile.ts`, `patchProfile.ts`, and `deleteProfile.ts`, plus the sanitizers and schemas under `functions/pet-profile/src/utils` and `functions/pet-profile/src/zodSchema`. Error keys like `petProfile.errors.invalidView`, `petProfile.errors.duplicatePetTag`, `petProfile.errors.duplicateNgoPetId`, and `petProfile.errors.petAlreadyDeleted` are additionally evidenced in `__tests__/pet-profile.test.js`.

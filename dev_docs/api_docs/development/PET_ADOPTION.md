# Pet Adoption API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-pet-adoption`

This domain serves two different systems on the same path space:

- public browse data from the adoption listing database
- managed post-adoption records linked to owned pets in the main database

The current DDD implementation uses the shared `{ success, message, data, pagination?, requestId }` envelope. Older docs that describe top-level `adoptionList`, `pet`, `form`, `petId`, or `adoptionId` payloads are stale.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/pet/adoption` | `x-api-key` only | Browse public adoption listings |
| GET | `/pet/adoption/detail/{adoptionId}` | `x-api-key` only | Browse public adoption detail |
| GET | `/pet/adoption/{petId}` | `x-api-key` + Bearer JWT | Read managed adoption record for pet `{petId}` |
| POST | `/pet/adoption/{petId}` | `x-api-key` + Bearer JWT | Create managed adoption record for pet `{petId}` |
| PATCH | `/pet/adoption/{petId}` | `x-api-key` + Bearer JWT | Update managed adoption record for pet `{petId}` |
| DELETE | `/pet/adoption/{petId}` | `x-api-key` + Bearer JWT | Delete managed adoption record for pet `{petId}` |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Split public vs managed reads | Public detail is `GET /pet/adoption/detail/{adoptionId}`; managed reads are `GET /pet/adoption/{petId}` and require auth |
| Managed GET empty state | Managed record GET returns `200` with `data: null` when no record exists yet |
| One record per pet | Managed create returns `409 petAdoption.errors.managed.duplicateRecord` if a record already exists for that pet |
| Managed PATCH response | PATCH returns no `data` payload |
| Managed DELETE response | DELETE returns no `data` payload |
| Strict schemas | Managed create and update bodies are strict; extra fields are rejected with `common.invalidBodyParams` |
| Empty PATCH body | Normal empty JSON update bodies are rejected earlier with `400 common.missingBodyParams` |
| `noFieldsToUpdate` branch | The source still contains a `common.noFieldsToUpdate` branch, but with the current strict schema and default shared `parseBody` behavior it is not normally reached by standard JSON requests |

---

## Auth Reference

Gateway/API-key/JWT behavior for adoption routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization For Managed Operations

Managed operations authorize access when either condition is true:

- `pet.userId === jwt.userId`
- `pet.ngoId === jwt.ngoId`

If the pet is missing or soft-deleted, managed operations return `404 petAdoption.errors.managed.petNotFound`.

If the caller does not own the pet, managed operations return `403 common.forbidden`.

### Rate Limits

| Route | Policy |
| --- | --- |
| Create managed record | IP 120 / 5 min, identifier 60 / 5 min |
| Update managed record | IP 120 / 5 min, identifier 60 / 5 min |
| Delete managed record | IP 60 / 5 min, identifier 30 / 5 min |

Rate-limit failures return `429 common.rateLimited`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Browse handlers read `lang` from the query string
- Use `errorKey` for integration logic

### Request Body Validation (Managed JSON Routes)

`POST /pet/adoption/{petId}` and `PATCH /pet/adoption/{petId}` both pass the decoded JSON body through the shared `parseBody` helper with the strict adoption schemas.

Current practical behavior:

| Condition | `errorKey` |
| --- | --- |
| Malformed JSON body | `common.invalidBodyParams` |
| Missing body, `null`, or empty object `{}` | `common.missingBodyParams` |
| Unknown field supplied | `common.invalidBodyParams` |
| Wrong field type | First schema issue key when defined, otherwise `common.invalidBodyParams` |

After parsing succeeds, the managed handlers run additional checks for invalid date strings, ownership, duplicate-record conflicts, and missing managed records.

---

## Success And Error Conventions

### Success Response Shape

Browse list:

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

Single-record success:

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {},
  "requestId": "aws-lambda-request-id"
}
```

Managed patch success:

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

Managed delete success:

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
  "errorKey": "petAdoption.errors.managed.recordNotFound",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

---

## Public Browse Data

### Browse List Item Shape

`GET /pet/adoption` returns `data` as an array of listing items with these fields:

- `_id`
- `Name`
- `Age`
- `Sex`
- `Breed`
- `Image_URL`

### Browse Detail Item Shape

`GET /pet/adoption/detail/{adoptionId}` returns the browse detail object with:

- `_id`
- `Name`
- `Age`
- `Sex`
- `Breed`
- `Image_URL`
- `Remark`
- `AdoptionSite`
- `URL`

Internal fields like `__v` and `parsedDate` are removed.

---

## Managed Adoption Record Data

Managed create and managed GET return the record inside `data` with these fields:

- `_id`
- `petId`
- `postAdoptionName`
- `isNeutered`
- `NeuteredDate`
- `firstVaccinationDate`
- `secondVaccinationDate`
- `thirdVaccinationDate`
- `followUpMonth1`
- `followUpMonth2`
- `followUpMonth3`
- `followUpMonth4`
- `followUpMonth5`
- `followUpMonth6`
- `followUpMonth7`
- `followUpMonth8`
- `followUpMonth9`
- `followUpMonth10`
- `followUpMonth11`
- `followUpMonth12`
- `createdAt`
- `updatedAt`

---

## Endpoints

### GET /pet/adoption

Browse public adoption listings.

**Lambda owner:** `pet-adoption`  
**Auth:** `x-api-key` only

#### Browse List Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Shared pagination schema |
| `limit` | integer | No | Shared pagination schema |
| `search` | string | No | Max 100 chars; regex against `Breed`, `Animal_Type`, and `Remark` |
| `animal_type` | CSV string | No | Normalized to trimmed values |
| `location` | CSV string | No | Normalized to trimmed values |
| `sex` | CSV string | No | Normalized to trimmed values |
| `age` | CSV string | No | Supported labels: `幼年`, `青年`, `成年`, `老年` |
| `lang` | string | No | Locale hint |

The browse list excludes adoption sites `Arc Dog Shelter`, `Tolobunny`, and `HKRABBIT`, and excludes rows with empty `Image_URL`.

#### Browse List Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "Name": "Lucky",
      "Age": 24,
      "Sex": "M",
      "Breed": "Mixed",
      "Image_URL": "https://example.com/image.jpg"
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

#### Browse List Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid shared pagination params |
| 400 | `petAdoption.errors.browse.invalidSearch` | `search` exceeds 100 characters |
| 500 | `common.internalError` | Unexpected internal error |

### GET /pet/adoption/detail/{adoptionId}

Get one public adoption browse listing by adoption id.

**Lambda owner:** `pet-adoption`  
**Auth:** `x-api-key` only

#### Browse Detail Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "Name": "Lucky",
    "Remark": "Friendly and vaccinated",
    "AdoptionSite": "SPCA"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Browse Detail Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{adoptionId}` |
| 404 | `petAdoption.errors.browse.petNotFound` | Browse listing not found |
| 500 | `common.internalError` | Unexpected internal error |

### GET /pet/adoption/{petId}

Get the managed adoption record for an owned pet.

**Lambda owner:** `pet-adoption`  
**Auth:** `x-api-key` + Bearer JWT required

#### Managed Detail Success With Record (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0e",
    "petId": "665f1a2b3c4d5e6f7a8b9c0d",
    "postAdoptionName": "Buddy",
    "isNeutered": true
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Managed Detail Success Empty State (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": null,
  "requestId": "aws-lambda-request-id"
}
```

#### Managed Detail Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petAdoption.errors.managed.petNotFound` | Pet does not exist or is deleted |
| 500 | `common.internalError` | Unexpected internal error |

### POST /pet/adoption/{petId}

Create the managed adoption record for pet `{petId}`.

**Lambda owner:** `pet-adoption`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Managed Create Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `postAdoptionName` | string or `null` | No | Max 100 chars |
| `isNeutered` | boolean or `null` | No | |
| `NeuteredDate` | string or `null` | No | Flexible date string |
| `firstVaccinationDate` | string or `null` | No | Flexible date string |
| `secondVaccinationDate` | string or `null` | No | Flexible date string |
| `thirdVaccinationDate` | string or `null` | No | Flexible date string |
| `followUpMonth1` through `followUpMonth12` | boolean | No | Defaults to `false` on create when omitted |

The body schema is strict. Extra keys are rejected.

#### Managed Create Example Request

```json
{
  "postAdoptionName": "Buddy",
  "isNeutered": true,
  "NeuteredDate": "2025-03-01",
  "firstVaccinationDate": "2025-01-15",
  "followUpMonth1": true
}
```

#### Managed Create Success (201)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0e",
    "petId": "665f1a2b3c4d5e6f7a8b9c0d",
    "postAdoptionName": "Buddy",
    "isNeutered": true
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Managed Create Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{id}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petAdoption.errors.managed.invalidDateFormat` | Invalid date in one of the managed date fields |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petAdoption.errors.managed.petNotFound` | Pet does not exist or is deleted |
| 409 | `petAdoption.errors.managed.duplicateRecord` | Managed record already exists for the pet |
| 429 | `common.rateLimited` | Create rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### PATCH /pet/adoption/{petId}

Update the managed adoption record for pet `{id}`.

**Lambda owner:** `pet-adoption`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Managed Update Request Body

Any subset of the same fields accepted by managed create may be supplied.

#### Managed Update Example Request

```json
{
  "secondVaccinationDate": "2025-02-15",
  "followUpMonth2": true
}
```

#### Managed Update Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{id}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petAdoption.errors.managed.invalidDateFormat` | Invalid date in one of the managed date fields |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petAdoption.errors.managed.petNotFound` | Pet does not exist or is deleted |
| 404 | `petAdoption.errors.managed.recordNotFound` | No managed adoption record exists for that pet |
| 429 | `common.rateLimited` | Update rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

Current implementation note: empty `{}` update bodies fail at shared JSON parsing with `common.missingBodyParams`, and unknown-field bodies fail schema validation with `common.invalidBodyParams`, so the internal `common.noFieldsToUpdate` branch is not part of the normal deployed contract.

### DELETE /pet/adoption/{petId}

Delete the managed adoption record for pet `{id}`.

**Lambda owner:** `pet-adoption`  
**Auth:** `x-api-key` + Bearer JWT required

#### Managed Delete Request Body

None.

#### Managed Delete Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{id}` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petAdoption.errors.managed.petNotFound` | Pet does not exist or is deleted |
| 404 | `petAdoption.errors.managed.recordNotFound` | No managed adoption record exists for that pet |
| 429 | `common.rateLimited` | Delete rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Frontend Integration Guide

1. Treat browse and managed adoption as separate features even though they share the same path prefix.
2. Use `GET /pet/adoption/detail/{adoptionId}` for public browse detail and `GET /pet/adoption/{petId}` for protected managed record reads.
3. For managed create and patch, send only documented keys because the schema is strict.
4. Use `data: null` from managed GET as the normal “record not created yet” state.
5. After managed PATCH or DELETE, refresh the record state explicitly because those routes return no `data` payload.

---

## Verification Snapshot

This document is grounded in `functions/pet-adoption/src/services/adoption.ts`, `browse.ts`, `managed.ts`, `functions/pet-adoption/src/zodSchema/adoptionSchema.ts`, and the route wiring in `template.yaml`. The most important post-migration correction is that the current implementation returns wrapped `data` payloads rather than the legacy top-level browse or managed keys.

# Pet Reference API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-pet-reference`

Public reference data for breed lookups and dewormer brands.

The shared response helper localizes the `message` field from the request locale; `errorKey` stays stable.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/pet/reference/breed/{animalType}?lang={lang}` | `x-api-key` only | Returns the nested breed payload stored under `animal_list.breeds[animalType][lang]` |
| GET | `/pet/reference/deworm` | `x-api-key` only | Returns the curated deworm reference list |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Breed lookup | Reads `animal_list` and returns the nested `breeds[animalType][lang]` payload directly |
| Deworm lookup | Reads `anthelmintic` and returns `_id` + `brandName` only |
| Response envelope | Shared `{ success, message, data, requestId }` envelope |
| Rate limiting | Per-IP only, no JWT identifier is available |

---

## Auth Reference

Gateway/API-key/JWT behavior for pet-reference routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Rate Limits

| Route / Action | Policy |
| --- | --- |
| `GET /pet/reference/breed/{animalType}` | IP 60 / 60s |
| `GET /pet/reference/deworm` | IP 60 / 60s |

Rate-limit failures return `429 common.rateLimited`.

---

## Success And Error Conventions

### Success Response Shape

Breed lookup success:

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    { "name": "柴犬" }
  ],
  "requestId": "aws-lambda-request-id"
}
```

Deworm lookup success:

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    { "_id": "665f1a2b3c4d5e6f7a8b9c0d", "brandName": "Bravecto" }
  ],
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petReference.errors.invalidLang",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

### Shared Query / Path Validation

| Condition | `errorKey` |
| --- | --- |
| Missing or blank `{animalType}` | `petReference.errors.invalidAnimalType` |
| Missing or malformed `lang` query | `petReference.errors.invalidLang` |
| Breed payload missing or empty | `petReference.errors.breedListNotFound` |

---

## Breed Reference

### GET /pet/reference/breed/{animalType}?lang={lang}

Returns the nested breed payload stored under `animal_list.breeds[animalType][lang]`.

**Lambda owner:** `pet-reference`  
**Auth:** `x-api-key` only — no `Authorization` header required  
**Rate limits:** IP 60 / 60s

The API does not reshape the nested breed payload. Whatever is stored in the collection for that key is returned in `data`.

Supported `lang` values are `en`, `zh`, and `cn`.

#### Breed Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petReference.errors.invalidAnimalType` | `{animalType}` missing or blank |
| 400 | `petReference.errors.invalidLang` | `lang` missing or not `en` / `zh` / `cn` |
| 404 | `petReference.errors.breedListNotFound` | No breed payload stored for that animalType/lang |
| 429 | `common.rateLimited` | Per-IP limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Deworm Reference

### GET /pet/reference/deworm

Returns the full list of curated dewormer brand names.

**Lambda owner:** `pet-reference`  
**Auth:** `x-api-key` only — no `Authorization` header required  
**Rate limits:** IP 60 / 60s

The response uses `_id` and `brandName` only.

#### Deworm Reference Example Response

```json
{
  "success": true,
  "message": "success.retrieved",
  "data": [
    { "_id": "665f1a2b3c4d5e6f7a8b9c0d", "brandName": "Bravecto" },
    { "_id": "665f1a2b3c4d5e6f7a8b9c0e", "brandName": "NexGard" }
  ],
  "requestId": "aws-lambda-request-id"
}
```

`data` is an empty array `[]` when no brands have been added.

#### Deworm Reference Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 429 | `common.rateLimited` | Per-IP limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

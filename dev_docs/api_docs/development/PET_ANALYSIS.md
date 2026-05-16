# Pet Analysis API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-pet-analysis`

Eye analysis, breed analysis, and supporting image uploads. The current DDD implementation uses the shared `{ success, message, data, pagination?, requestId }` envelope, with one important exception: public eye-disease lookups return raw disease documents inside `data` while the synthetic `Normal` branch returns a normalized null payload.

---

## Overview

### Route Summary

| Method | Path | Auth | Content-Type | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/pet/analysis/eye/disease/{eyeDiseaseName}` | `x-api-key` only | — | Public eye-disease lookup |
| GET | `/pet/analysis/eye/{petId}` | `x-api-key` + Bearer JWT | — | Paginated eye-analysis history list for an owned pet |
| POST | `/pet/analysis/eye/{petId}` | `x-api-key` + Bearer JWT | `multipart/form-data` | Run eye analysis for a pet |
| PATCH | `/pet/analysis/eye/{petId}` | `x-api-key` + Bearer JWT | `application/json` | Append left/right eye image URLs to a pet |
| POST | `/pet/analysis/breed` | `x-api-key` + Bearer JWT | `application/json` | Run breed analysis using an image URL |
| POST | `/pet/analysis/uploads/image` | `x-api-key` + Bearer JWT | `multipart/form-data` | Upload one image to S3 for analysis flows |
| POST | `/pet/analysis/uploads/breed-image` | `x-api-key` + Bearer JWT | `multipart/form-data` | Upload one image to an allowed S3 folder |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Split eye reads | Disease lookup uses `/eye/disease/{eyeDiseaseName}`; pet history uses `/eye/{petId}` and requires ownership |
| Post-eye response | Eye analysis POST returns `data: { result, heatmap, requestId }`, where `requestId` is the activity-log id, not the Lambda request id |
| Patch-eye response | PATCH returns a sanitized pet object in `data` |
| Upload responses | Both upload endpoints return `data: { url }` |
| Breed analysis transport | Breed analysis calls the external VM with URL-encoded form data, not JSON |
| Folder restrictions | Breed-image uploads only allow top folders `breed_analysis`, `pets`, `eye`, or `profile` |
| Breed-image file count | The breed-image upload handler requires at least one file but does not currently reject multiple files; it uploads the first file only |

---

## Auth Reference

Gateway/API-key/JWT behavior for pet-analysis routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization

- `GET /pet/analysis/eye/{petId}` and `POST /pet/analysis/eye/{petId}` allow direct owner access and NGO-owner access
- `PATCH /pet/analysis/eye/{petId}` requires direct `userId` ownership; NGO ownership does not authorize this update
- `POST /pet/analysis/breed` and both upload routes do not enforce pet ownership

### Rate Limits

| Route | Policy |
| --- | --- |
| POST eye analysis | IP 30 / 300s, identifier 15 / 300s, IP+identifier 10 / 300s |
| PATCH pet eye images | IP 30 / 60s, identifier 15 / 60s, IP+identifier 10 / 60s |
| POST breed analysis | IP 60 / 300s, identifier 30 / 300s, IP+identifier 20 / 300s |
| POST upload image | IP 90 / 300s, identifier 45 / 300s, IP+identifier 30 / 300s |
| POST upload breed-image | IP 90 / 300s, identifier 45 / 300s, IP+identifier 30 / 300s |

Rate-limit failures return `429 common.rateLimited`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Use `errorKey` for integration logic

### Request Body Validation

| Route | Current validation behavior |
| --- | --- |
| `POST /pet/analysis/eye/{petId}` | Multipart body is parsed with a strict schema allowing only optional `image_url`; extra text fields fail with `common.invalidBodyParams` before the handler checks whether a file or URL is present |
| `PATCH /pet/analysis/eye/{petId}` | JSON body is parsed through the strict `updatePetEyeSchema`; missing required fields return `petAnalysis.errors.updatePetEye.missingRequiredFields`, while unknown fields or malformed JSON fail earlier with `common.invalidBodyParams` |
| `POST /pet/analysis/breed` | JSON body is parsed through the strict `breedAnalysisSchema`; malformed JSON or unknown extra fields return `common.invalidBodyParams` |
| Upload routes | Multipart text fields are validated by strict schemas; `POST /pet/analysis/uploads/image` allows no text fields, while `POST /pet/analysis/uploads/breed-image` requires only `url` |

---

## Success And Error Conventions

### Success Response Shape

Paginated list success:

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

Single-result success:

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {},
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petAnalysis.errors.eyeDiseaseNotFound",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

---

## Endpoints

### GET /pet/analysis/eye/disease/{eyeDiseaseName}

Public eye disease lookup.

**Lambda owner:** `pet-analysis`  
**Auth:** `x-api-key` only

#### Disease Lookup Success

- Known disease: returns the raw disease document inside `data`
- `Normal`: returns

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "id": null,
    "eyeDiseaseEng": null,
    "eyeDiseaseChi": null,
    "eyeDiseaseCause": null,
    "eyeDiseaseSolution": null
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Disease Lookup Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.missingEyeDiseaseName` | Missing or empty disease name |
| 404 | `petAnalysis.errors.eyeDiseaseNotFound` | Disease name not found |

### GET /pet/analysis/eye/{petId}

Returns paginated eye-analysis history for an owned pet.

**Lambda owner:** `pet-analysis`  
**Auth:** `x-api-key` + Bearer JWT required

#### Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Shared pagination schema |
| `limit` | integer | No | Shared pagination schema |

#### Returned Eye Log Shape

Each list item may include:

- `_id`
- `petId`
- `image`
- `eyeSide`
- `result`
- `createdAt`
- `updatedAt`

#### History Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` |
| 400 | `common.invalidQueryParams` | Invalid pagination query |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petAnalysis.errors.petNotFound` | Pet not found or deleted |
| 500 | `common.internalError` | Unexpected internal error |

### POST /pet/analysis/eye/{petId}

Run eye analysis for a pet using an image URL or uploaded file.

**Lambda owner:** `pet-analysis`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `multipart/form-data`

#### Request Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `image_url` | string | Conditional | Required if no file is attached |
| file part | file | Conditional | Required if `image_url` is absent |

`{petId}` must be a valid pet ObjectId.

#### Post-Eye Success (200)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "result": {
      "disease": "Cataract",
      "confidence": 0.92
    },
    "heatmap": "https://example.com/heatmap.png",
    "requestId": "665f1a2b3c4d5e6f7a8b9c0d"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Post-Eye Side Effects

- creates an `ApiLog` entry
- creates an `EyeAnalysisRecord`
- uploads the file to S3 first when a file is supplied
- calls external analysis and heatmap VM endpoints

#### Post-Eye Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid pet id in path |
| 400 | `petAnalysis.errors.missingArguments` | Neither `image_url` nor file supplied |
| 400 | `common.invalidBodyParams` | Strict-schema violation on multipart text fields |
| 400 | `petAnalysis.errors.unsupportedFormat` | Unsupported file type |
| 400 | `petAnalysis.errors.analysisError` | External analysis service returned error payload |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petAnalysis.errors.userNotFound` | Caller user record missing or deleted |
| 404 | `petAnalysis.errors.petNotFound` | Pet not found or deleted |
| 413 | `petAnalysis.errors.fileTooLarge` | Uploaded file too large |
| 429 | `common.rateLimited` | Analysis rate limit exceeded |
| 500 | `petAnalysis.errors.analysisError` | External analysis call failed |

### PATCH /pet/analysis/eye/{petId}

Append one left/right eye image pair to a pet.

**Lambda owner:** `pet-analysis`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Patch-Eye Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | Must match path `{petId}` |
| `date` | string | Yes | Date string parseable by the handler |
| `leftEyeImage1PublicAccessUrl` | string | Yes | Valid image URL |
| `rightEyeImage1PublicAccessUrl` | string | Yes | Valid image URL |

The body schema is strict. Extra keys are rejected.

#### Patch-Eye Success (200)

Returns the sanitized pet object in `data`. Fields may include:

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

#### Patch-Eye Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.updatePetEye.missingRequiredFields` | Missing any required field |
| 400 | `common.invalidObjectId` | Invalid `petId` or path/body mismatch |
| 400 | `common.invalidBodyParams` | Malformed JSON body or unknown extra field |
| 400 | `petAnalysis.errors.updatePetEye.invalidDateFormat` | Invalid `date` |
| 400 | `petAnalysis.errors.updatePetEye.invalidImageUrlFormat` | Invalid image URL |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petAnalysis.errors.updatePetEye.petNotFound` | Pet not found |
| 410 | `petAnalysis.errors.updatePetEye.petDeleted` | Pet already deleted |
| 429 | `common.rateLimited` | Patch rate limit exceeded |

### POST /pet/analysis/breed

Run breed analysis using an uploaded image URL.

**Lambda owner:** `pet-analysis`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Breed Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `species` | string | Yes | Max 100 chars |
| `url` | string | Yes | Valid URL, max 2048 chars |

#### Breed Example Request

```json
{
  "species": "dog",
  "url": "https://cdn.example.com/breed-image.jpg"
}
```

#### Breed Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON body or unknown extra field |
| 400 | `petAnalysis.errors.speciesRequired` | Missing `species` |
| 400 | `petAnalysis.errors.urlRequired` | Missing `url` |
| 400 | `petAnalysis.errors.invalidUrl` | Invalid URL |
| 400 | `petAnalysis.errors.fieldTooLong` | `species` too long |
| 429 | `common.rateLimited` | Breed analysis rate limit exceeded |
| 502 | `petAnalysis.errors.analysisError` | External breed-analysis request failed at the network/request layer |

Current implementation note: if the external breed-analysis service responds with a JSON payload successfully, the handler returns `200` with that payload inside `data` without additional error-shape validation.

### POST /pet/analysis/uploads/image

Upload one image for analysis workflows.

**Lambda owner:** `pet-analysis`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `multipart/form-data`

#### Upload-Image Rules

- no text fields required
- exactly one file must be supplied
- multiple files return `petAnalysis.errors.tooManyFiles`
- allowed uploaded image types are JPEG, PNG, WebP, and GIF
- file-size limit is 4 MB

#### Upload-Image Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.noFilesUploaded` | No file supplied |
| 400 | `petAnalysis.errors.tooManyFiles` | More than one file supplied |
| 400 | `petAnalysis.errors.invalidImageFormat` | Unsupported file type |
| 413 | `petAnalysis.errors.fileTooLarge` | File too large |
| 429 | `common.rateLimited` | Upload rate limit exceeded |

### POST /pet/analysis/uploads/breed-image

Upload one image to an allowed folder path.

**Lambda owner:** `pet-analysis`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `multipart/form-data`

#### Breed-Image Request Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | string | Yes | Folder path under `user-uploads/` |
| file part | file | Yes | At least one file; current handler uses the first uploaded file |

Allowed top-level folder segments:

- `breed_analysis`
- `pets`
- `eye`
- `profile`

`.` and `..` path segments are rejected.

Allowed uploaded image types are JPEG, PNG, WebP, and GIF. File-size limit is 4 MB.

#### Breed-Image Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.invalidFolder` | Missing or invalid folder path |
| 400 | `petAnalysis.errors.noFilesUploaded` | No file supplied |
| 400 | `petAnalysis.errors.invalidImageFormat` | Unsupported file type |
| 413 | `petAnalysis.errors.fileTooLarge` | File too large |
| 429 | `common.rateLimited` | Upload rate limit exceeded |

---

## Frontend Integration Guide

1. Use `GET /pet/analysis/eye/disease/{eyeDiseaseName}` for public disease lookup and `GET /pet/analysis/eye/{petId}` for protected pet history.
2. Use the image upload endpoints first when the client needs a stable URL before analysis.
3. For eye analysis POST, read the ML result from `data.result` and the stored activity-log id from `data.requestId`; the top-level `requestId` is still the Lambda request id.
4. Do not assume eye-history GET is owner-protected today. If that is a privacy concern, frontend usage should be conservative until backend auth changes.
5. For `PATCH /pet/analysis/eye/{petId}`, send matching path and body `petId` values or the request will fail.

---

## Verification Snapshot

This document is grounded in `functions/pet-analysis/src/services/eye.ts`, `breed.ts`, `upload.ts`, the route wiring in `functions/pet-analysis/src/router.ts`, and the current schemas and sanitizers under `functions/pet-analysis/src/zodSchema` and `functions/pet-analysis/src/utils`.

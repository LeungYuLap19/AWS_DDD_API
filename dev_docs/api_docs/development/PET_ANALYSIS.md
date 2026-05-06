# Pet Analysis API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

AI-powered pet health analysis for the PetPetClub platform. Covers eye disease detection via external ML, breed identification, and image uploads to S3. Eye analysis results are stored per-pet and retrievable as a historical log. Disease details are publicly queryable by name.

## Overview

### Route Summary

| Method | Path | Auth | Lambda | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/pet/analysis/eye/{identifier}` | `x-api-key`, no JWT; Lambda-level auth for ObjectId branch | `pet-analysis` | Look up eye disease by name or retrieve pet eye analysis log (authenticated) |
| POST | `/pet/analysis/eye/{identifier}` | `x-api-key` + Bearer JWT | `pet-analysis` | Submit eye image for ML analysis |
| PATCH | `/pet/analysis/eye/{identifier}` | `x-api-key` + Bearer JWT | `pet-analysis` | Append left/right eye image URLs to pet record |
| POST | `/pet/analysis/breed` | `x-api-key` + Bearer JWT | `pet-analysis` | Identify breed from image URL via ML |
| POST | `/pet/analysis/uploads/image` | `x-api-key` + Bearer JWT | `pet-analysis` | Upload single image to S3 |
| POST | `/pet/analysis/uploads/breed-image` | `x-api-key` + Bearer JWT | `pet-analysis` | Upload image to S3 under a caller-specified folder |

### Flow Summary

Eye analysis:

1. `POST /pet/analysis/uploads/image` to upload an eye photo and receive a public S3 URL
2. `POST /pet/analysis/eye/{identifier}` with the URL (or a file) to run ML analysis; result is persisted
3. `PATCH /pet/analysis/eye/{identifier}` to save left/right image URLs to the pet's `eyeimages` array
4. `GET /pet/analysis/eye/{identifier}` to retrieve the pet's historical eye analysis log (pass the petId as `identifier`)

Breed analysis:

1. `POST /pet/analysis/uploads/breed-image` to upload a pet photo
2. `POST /pet/analysis/breed` with `species` and the image URL to get a breed prediction

Disease lookup (no JWT; `x-api-key` required):

1. `GET /pet/analysis/eye/{diseaseName}` with an English disease name string

## API Gateway And Auth Rules

### API Gateway Requirements

| Route group | API key required at API Gateway | API Gateway authorizer |
| --- | --- | --- |
| `GET /pet/analysis/eye/{identifier}` | Yes | None (`Authorizer: NONE`) |
| All other `POST` / `PATCH` routes | Yes (default) | `DddTokenAuthorizer` (default) |

`OPTIONS` preflight routes (`/pet/analysis/eye/{proxy+}`, `/pet/analysis/breed`, `/pet/analysis/uploads/{proxy+}`) remain public and do not require `x-api-key`. They return `204` with CORS headers.

### Authentication

| Scenario | Requirement |
| --- | --- |
| Disease lookup (GET with non-ObjectId identifier) | `x-api-key` required, no Bearer JWT |
| Eye log retrieval (GET with ObjectId identifier) | `x-api-key` required, no Bearer JWT |
| Eye analysis POST, eye PATCH | `x-api-key` + `Authorization: Bearer <access-token>` + pet ownership |
| Breed analysis POST | `x-api-key` + `Authorization: Bearer <access-token>` |
| Upload POST routes | `x-api-key` + `Authorization: Bearer <access-token>` |

### Required Headers

| Scenario | Headers |
| --- | --- |
| JSON body routes (PATCH eye, POST breed) | `Content-Type: application/json`, `x-api-key: <key>`, `Authorization: Bearer <token>` |
| Multipart routes (POST eye, POST uploads) | `Content-Type: multipart/form-data`, `x-api-key: <key>`, `Authorization: Bearer <token>` |
| Disease lookup | `x-api-key: <key>` |
| Eye log retrieval | `x-api-key: <key>` |

### Authorization Model

Eye analysis endpoints enforce **pet ownership** inside the Lambda:

- `POST` eye: caller's `userId` or `ngoId` must match the pet
- `PATCH` eye: caller's `userId` must match the pet (NGO access is **not** supported)
- `GET` eye log (ObjectId branch): no ownership check — any caller with the petId can retrieve the log

Breed and upload endpoints require authentication but do **not** enforce pet ownership.

Accessing another user's or NGO's pet returns `403` with `common.unauthorized`.

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petAnalysis.errors.invalidObjectId",
  "error": "Invalid ID format",
  "requestId": "aws-lambda-request-id"
}
```

| Field | Type | Purpose |
| --- | --- | --- |
| `success` | `boolean` | Always `false` for errors |
| `errorKey` | `string` | Machine-readable key for UI logic and test assertions |
| `error` | `string` | Localized message string |
| `requestId` | `string` | AWS Lambda request ID for CloudWatch lookup |

### Success Response Shape

All Lambda-produced success responses include `success: true` and `requestId`. `message` is present on most routes (see per-endpoint docs).

```json
{
  "success": true,
  "message": "Retrieve eye disease detail successfully",
  "requestId": "aws-lambda-request-id"
}
```

### Request Body Validation

JSON-body routes (`PATCH /pet/analysis/eye/{identifier}`, `POST /pet/analysis/breed`) and multipart routes pass through the shared `parseBody` helper or multipart parser before business logic. Note: all three eye routes share the same `{identifier}` path parameter at the API Gateway level — POST and PATCH treat it as a petId (must be a valid ObjectId), while GET dispatches on whether it's an ObjectId or a disease name string.

JSON-body routes have an API Gateway request model (`GenericJsonObjectRequest`, `ValidateBody: true`, `Required: false`). On deployed API Gateway, malformed JSON can be rejected before Lambda with an API Gateway-generated `400`.

### Localization

`error` is localized. `errorKey` is the stable integration key.

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale in the shared runtime is `en`
- Success `message` values are translated using the same request-locale resolution

## Endpoints

### GET /pet/analysis/eye/{identifier}

Dual-purpose endpoint. When `{identifier}` is a disease name string (not a valid MongoDB ObjectId), returns disease details (public). When `{identifier}` is a valid ObjectId, returns the pet's eye analysis log (authenticated, ownership-checked).

**Lambda:** `pet-analysis`
**Auth:** Public for disease lookup; Bearer JWT + pet ownership for eye log
**Rate limit:** None

#### Branch 1: Disease Name Lookup (Public)

The identifier is treated as a disease name when it is **not** a valid MongoDB ObjectId. Looked up by `eyeDisease_eng` (case-sensitive, URL-decoded).

**Path params:**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `identifier` | string | Yes | English disease name, URL-encoded if needed. e.g. `Cataract`, `Normal` |

**Example**

```http
GET /pet/analysis/eye/Cataract
```

**Success: known disease (201)**

```json
{
  "success": true,
  "message": "Retrieve eye disease detail successfully",
  "result": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "eyeDisease_eng": "Cataract",
    "eyeDisease_chi": "白內障",
    "eyeDisease_issue": "晶體混濁",
    "eyeDisease_care": "定期檢查",
    "eyeDisease_issue_en": "Lens opacity",
    "eyeDisease_care_en": "Regular checkups",
    "eyeDisease_medication": []
  },
  "requestId": "aws-lambda-request-id"
}
```

The `result` is a raw MongoDB lean document — all persisted fields on the `eye_diseases` document are returned.

**Success: "Normal" (201)**

```json
{
  "success": true,
  "message": "Retrieve eye disease detail successfully",
  "result": {
    "id": null,
    "eyeDiseaseEng": null,
    "eyeDiseaseChi": null,
    "eyeDiseaseCause": null,
    "eyeDiseaseSolution": null
  },
  "requestId": "aws-lambda-request-id"
}
```

Contract delta: the "Normal" case returns camelCase field names (`eyeDiseaseEng`) while real diseases return snake_case MongoDB field names (`eyeDisease_eng`). "Normal" is a synthetic placeholder, not a DB document.

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.missingEyeDiseaseName` | Empty or missing identifier in path |
| 404 | `petAnalysis.errors.eyeDiseaseNotFound` | No disease found with that English name |

#### Branch 2: Eye Analysis Log (Authenticated)

The identifier is treated as a pet ID when it **is** a valid MongoDB ObjectId. No authentication required.

**Path params:**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `identifier` | string (ObjectId) | Yes | The pet's `_id` |

**Example**

```http
GET /pet/analysis/eye/665f1a2b3c4d5e6f7a8b9c0d
```

**Success (200)**

```json
{
  "success": true,
  "message": "Retrieve eye analysis log list successfully!",
  "result": [
    {
      "_id": "66a1b2c3d4e5f6a7b8c9d0e1",
      "petId": "665f1a2b3c4d5e6f7a8b9c0d",
      "image": "https://bucket.example/user-uploads/eye/665f.../abc123.jpg",
      "result": { "disease": "Normal", "confidence": 0.98 },
      "createdAt": "2025-01-15T08:30:00.000Z",
      "updatedAt": "2025-01-15T08:30:00.000Z"
    }
  ],
  "requestId": "aws-lambda-request-id"
}
```

Returns up to 100 records sorted newest-first. Empty array if no records exist. Each record is sanitized to: `_id`, `petId`, `image`, `result`, `createdAt`, `updatedAt`. The `heatmap` field stored on `EyeAnalysisRecord` is not included in the log response. The `eyeSide` field is selected by the query and mapped by the sanitizer, but the underlying model field is `side` — due to this mismatch the field is always absent from the response.

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.missingEyeDiseaseName` | Empty or missing identifier in path |

### POST /pet/analysis/eye/{identifier}

Submit an eye image for AI disease detection. Accepts a file upload (multipart) or an image URL. The image is sent to an external ML VM. Results are persisted to `eyeanalysisrecords` and `api_logs`.

**Lambda:** `pet-analysis`
**Auth:** `x-api-key` + Bearer JWT + pet ownership (userId or ngoId)
**Rate limit:** 10 requests / 300 s per userId

**Path params:**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `identifier` | string (ObjectId) | Yes | Must be a valid MongoDB ObjectId (used as petId) |

**Body (multipart/form-data):**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `image_url` | string | Conditional | Public URL of the eye image. Required if no file is attached. |
| `file` | binary | Conditional | Image file upload. Required if `image_url` is not provided. |

At least one of `image_url` or `file` must be present. If a file is provided, it is uploaded to S3 first and the resulting URL is used for analysis.

**File constraints:**

| Constraint | Value |
| --- | --- |
| Allowed MIME types | `image/jpeg`, `image/jpg`, `image/png`, `image/gif`, `image/tiff` |
| Max file size | 30 MB |
| Min file size | > 0 bytes |

**Example**

```http
POST /pet/analysis/eye/665f1a2b3c4d5e6f7a8b9c0d
Authorization: Bearer <access-token>
Content-Type: multipart/form-data
x-api-key: <key>

image_url=https://example.com/eye-photo.jpg
```

**Success (200)**

```json
{
  "success": true,
  "result": {
    "disease": "Cataract",
    "confidence": 0.92
  },
  "heatmap": "https://vm.example/heatmap/abc123.png",
  "request_id": "66a1b2c3d4e5f6a7b8c9d0e1",
  "time_taken": "1523.45 ms",
  "status": 200,
  "requestId": "aws-lambda-request-id"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `result` | object | Raw ML analysis output. Shape depends on the external ML VM. |
| `heatmap` | string \| null | Heatmap image URL if the heatmap service succeeded; `null` otherwise |
| `request_id` | string | `ApiLog._id` — distinct from `requestId` (the Lambda request ID) |
| `time_taken` | string | End-to-end processing time including ML VM round-trip |
| `status` | number | Always `200` on success |

No `message` field is returned on this endpoint.

**Side effects**

- Creates an `EyeAnalysisRecord` document (`image`, `result`, `petId`, `heatmap`)
- Creates an `ApiLog` document (`userId`, `image_url`, `result`)
- If file uploaded: creates an `ImageCollection` record and puts the object in S3 under `user-uploads/eye/{petId}/`

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.invalidObjectId` | `petId` is not a valid ObjectId |
| 400 | `petAnalysis.errors.missingArguments` | Neither `image_url` nor file provided |
| 400 | `petAnalysis.errors.unsupportedFormat` | File MIME type not in allowed set |
| 400 | `petAnalysis.errors.analysisError` | ML VM returned an error payload |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.unauthorized` | Caller does not own the pet |
| 404 | `petAnalysis.errors.userNotFound` | Authenticated user not found or soft-deleted |
| 404 | `petAnalysis.errors.petNotFound` | Pet not found or soft-deleted |
| 413 | `petAnalysis.errors.fileTooLarge` | File exceeds 30 MB |
| 413 | `petAnalysis.errors.fileTooSmall` | File is 0 bytes |
| 429 | `common.rateLimited` | Rate limit exceeded (`retry-after` header included) |
| 500 | `petAnalysis.errors.analysisError` | ML VM unreachable or returned no result |

### PATCH /pet/analysis/eye/{identifier}

Append a pair of left/right eye image URLs to the pet's `eyeimages` array. Each call pushes a new entry — does not replace existing entries.

**Lambda:** `pet-analysis`
**Auth:** `x-api-key` + Bearer JWT + pet ownership (userId only; NGO not supported)
**Rate limit:** 10 requests / 60 s per userId

**Path params:**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `identifier` | string (ObjectId) | Yes | Must match `petId` in body |

**Body (JSON):**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | Must be a valid ObjectId and match path param |
| `date` | string | Yes | Any `new Date()`-parseable string (e.g. `YYYY-MM-DD`). See Known Contract Edges. |
| `leftEyeImage1PublicAccessUrl` | string | Yes | Valid HTTP/HTTPS URL |
| `rightEyeImage1PublicAccessUrl` | string | Yes | Valid HTTP/HTTPS URL |

Schema uses `.strict()` — unknown fields are rejected with `400`.

**Example**

```json
{
  "petId": "665f1a2b3c4d5e6f7a8b9c0d",
  "date": "2025-01-15",
  "leftEyeImage1PublicAccessUrl": "https://bucket.example/eye/left.jpg",
  "rightEyeImage1PublicAccessUrl": "https://bucket.example/eye/right.jpg"
}
```

**Success (201)**

```json
{
  "success": true,
  "message": "Successfully updated pet eye image",
  "result": {
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "name": "Buddy",
    "animal": "dog",
    "sex": "male",
    "breed": "Golden Retriever",
    "birthday": "2022-03-15T00:00:00.000Z",
    "createdAt": "2024-06-01T10:00:00.000Z",
    "updatedAt": "2025-01-15T08:30:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

The `result` is the updated pet passed through `sanitizePet`, which whitelists: `userId`, `name`, `breedimage`, `animal`, `birthday`, `weight`, `sex`, `sterilization`, `sterilizationDate`, `adoptionStatus`, `breed`, `bloodType`, `features`, `info`, `status`, `owner`, `ngoId`, `ownerContact1`, `ownerContact2`, `contact1Show`, `contact2Show`, `tagId`, `isRegistered`, `receivedDate`, `ngoPetId`, `createdAt`, `updatedAt`, `location`, `position`. Fields not in this list (including `_id` and `eyeimages`) are stripped. The `location` field is mapped from `locationName` on the source document.

**Side effects**

- Pushes `{ date, eyeimage_left1, eyeimage_right1 }` to the pet's `eyeimages` array in MongoDB

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.updatePetEye.missingRequiredFields` | Missing any required field |
| 400 | `petAnalysis.errors.updatePetEye.invalidPetIdFormat` | `petId` is not a valid ObjectId or does not match path |
| 400 | `petAnalysis.errors.updatePetEye.invalidDateFormat` | Date string is not parseable by `new Date()` |
| 400 | `petAnalysis.errors.updatePetEye.invalidImageUrlFormat` | Either image URL is not a valid HTTP/HTTPS URL |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.unauthorized` | Caller does not own the pet (userId mismatch) |
| 404 | `petAnalysis.errors.updatePetEye.petNotFound` | Pet not found |
| 410 | `petAnalysis.errors.updatePetEye.petDeleted` | Pet is soft-deleted |
| 429 | `common.rateLimited` | Rate limit exceeded (`retry-after` header included) |

### POST /pet/analysis/breed

Identify the breed of a pet from an image URL using an external ML service.

**Lambda:** `pet-analysis`
**Auth:** `x-api-key` + Bearer JWT
**Rate limit:** 20 requests / 300 s per userId

**Body (JSON):**

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `species` | string | Yes | 1–100 characters |
| `url` | string | Yes | Valid URL (Zod `.url()`) |

Schema uses mass-assignment prevention via `superRefine` — unknown fields are rejected.

**Example**

```json
{
  "species": "dog",
  "url": "https://bucket.example/user-uploads/breed_analysis/abc123.jpg"
}
```

**Success (200)**

```json
{
  "success": true,
  "message": "Successfully analyze breed",
  "result": {
    "breed": "Golden Retriever",
    "confidence": 0.95
  },
  "requestId": "aws-lambda-request-id"
}
```

The `result` object is the raw ML VM response. The shape shown above is representative but may vary depending on the external service.

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.speciesRequired` | Missing or empty `species` |
| 400 | `petAnalysis.errors.fieldTooLong` | `species` exceeds 100 characters |
| 400 | `petAnalysis.errors.urlRequired` | Missing or empty `url` |
| 400 | `petAnalysis.errors.invalidUrl` | `url` is not a valid URL |
| 400 | `petAnalysis.errors.unknownField` | Body contains unexpected fields |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 429 | `common.rateLimited` | Rate limit exceeded (`retry-after` header included) |

### POST /pet/analysis/uploads/image

Upload a single image file to S3. Stores the file under `user-uploads/breed_analysis/` with an auto-generated filename based on `ImageCollection._id`.

**Lambda:** `pet-analysis`
**Auth:** `x-api-key` + Bearer JWT
**Rate limit:** 30 requests / 300 s per userId

**Body (multipart/form-data):**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | binary | Yes | Exactly one file. JPEG or PNG only. |

**Example**

```http
POST /pet/analysis/uploads/image
Authorization: Bearer <access-token>
Content-Type: multipart/form-data
x-api-key: <key>

[file binary data]
```

**Success (200)**

```json
{
  "success": true,
  "message": "Successfully uploaded images of pet",
  "url": "https://bucket.example/user-uploads/breed_analysis/66a1b2c3d4e5f6a7b8c9d0e1.jpg",
  "requestId": "aws-lambda-request-id"
}
```

**Side effects**

- Creates an `ImageCollection` record in MongoDB
- Puts the object in S3 with `public-read` ACL

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.noFilesUploaded` | No file in the request |
| 400 | `petAnalysis.errors.tooManyFiles` | More than one file attached |
| 400 | `petAnalysis.errors.invalidImageFormat` | File is not JPEG or PNG |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 429 | `common.rateLimited` | Rate limit exceeded (`retry-after` header included) |

### POST /pet/analysis/uploads/breed-image

Upload a single image file to S3 under a caller-specified folder path. The folder prefix is validated against an allowlist.

**Lambda:** `pet-analysis`
**Auth:** `x-api-key` + Bearer JWT
**Rate limit:** 30 requests / 300 s per userId

**Body (multipart/form-data):**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | binary | Yes | Exactly one file. JPEG or PNG only. |
| `url` | string | Yes | Target folder path. First segment must be an allowed prefix. |

**Allowed folder prefixes:**

| Prefix |
| --- |
| `breed_analysis` |
| `pets` |
| `eye` |
| `profile` |

The `url` value becomes the folder under `user-uploads/`. For example, `url=breed_analysis/my-pet` stores the file at `user-uploads/breed_analysis/my-pet/{imageId}.jpg`. Path traversal segments (`.` and `..`) are rejected.

**Example**

```http
POST /pet/analysis/uploads/breed-image
Authorization: Bearer <access-token>
Content-Type: multipart/form-data
x-api-key: <key>

url=breed_analysis
[file binary data]
```

**Success (200)**

```json
{
  "success": true,
  "message": "Successfully uploaded images of pet",
  "url": "https://bucket.example/user-uploads/breed_analysis/66a1b2c3d4e5f6a7b8c9d0e1.png",
  "requestId": "aws-lambda-request-id"
}
```

**Side effects**

- Creates an `ImageCollection` record in MongoDB
- Puts the object in S3 with `public-read` ACL

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAnalysis.errors.noFilesUploaded` | No file in the request |
| 400 | `petAnalysis.errors.invalidImageFormat` | File is not JPEG or PNG |
| 400 | `petAnalysis.errors.invalidFolder` | Missing folder path, prefix not in allowlist, or path traversal detected |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 429 | `common.rateLimited` | Rate limit exceeded (`retry-after` header included) |

## Frontend Integration Guide

### Eye Analysis

1. Upload the eye photo via `POST /pet/analysis/uploads/image`
2. Take the returned `url` and call `POST /pet/analysis/eye/{identifier}` with `image_url=<url>`
3. Display the `result` (disease + confidence) and optional `heatmap` to the user
4. Call `PATCH /pet/analysis/eye/{identifier}` to persist left/right eye image URLs to the pet record
5. Call `GET /pet/analysis/eye/{identifier}` to display the pet's eye analysis history (pass the petId as `identifier`)

### Breed Analysis

1. Upload the pet photo via `POST /pet/analysis/uploads/breed-image` with `url=breed_analysis`
2. Take the returned `url` and call `POST /pet/analysis/breed` with `species` and the image URL
3. Display the breed prediction result to the user

### Disease Lookup

1. Call `GET /pet/analysis/eye/{diseaseName}` with an English disease name
2. Special case: `Normal` returns null fields with camelCase keys (different shape from real diseases)

### Error Handling

- On `401`, refresh the access token via `POST /auth/tokens/refresh`
- On `403`, the user does not own the pet — do not retry
- On `429`, read the `retry-after` header and wait before retrying
- On `410` (PATCH only), the pet has been soft-deleted — inform the user
- Use `errorKey` (not the localized `error` string) for branching logic

## Testing Notes

Unit tests (Tier 2, mocked dependencies):

```bash
npx jest --runInBand --testPathPattern=pet-analysis.test --no-coverage
```

Integration tests (Tier 3/4, requires `sam local start-api` + MongoDB):

```bash
npx jest --runInBand --testPathPattern=pet-analysis.sam.test --no-coverage
```

- The `GET /pet/analysis/eye/{identifier}` dual-dispatch is the trickiest route to test; exercise both the disease-name and ObjectId branches separately
- PATCH append behavior should be tested with sequential calls to verify `eyeimages` accumulates (not replaces)
- Upload folder validation should be tested with path traversal payloads (`..`, `.`)

## Known Contract Edges

- The `GET /pet/analysis/eye/{identifier}` endpoint dispatches on `mongoose.isValidObjectId(identifier)`. A 24-character hex string that happens to look like a disease name will be treated as an ObjectId and trigger the authenticated branch
- Disease lookup returns a raw MongoDB lean document (all persisted fields). The "Normal" special case returns a hardcoded object with different field names (camelCase vs snake_case) and all-null values
- `POST /pet/analysis/eye/{identifier}` has two response ID fields: `request_id` (ApiLog `_id`, underscore) and `requestId` (AWS Lambda request ID, camelCase)
- `POST /pet/analysis/eye/{identifier}` does not return a `message` field, unlike all other success responses in this domain
- `PATCH /pet/analysis/eye/{identifier}` returns the sanitized pet via `sanitizePet`, which does **not** include `eyeimages` or `_id`. The frontend cannot confirm the pushed eye images from the PATCH response — use `GET` or query the pet profile separately
- `PATCH /pet/analysis/eye/{identifier}` only checks `userId` ownership, not `ngoId`. NGO staff managing NGO-owned pets cannot use this endpoint
- The breed and upload endpoints have `GenericJsonObjectRequest` as the API Gateway request model with `Required: false`. This model targets JSON bodies and should not block multipart requests, but the interaction between request model validation and `multipart/form-data` on deployed API Gateway is an edge worth monitoring
- ML VM `result` shapes for eye analysis and breed analysis are opaque to the Lambda — they are forwarded as-is from the external service. Field names and structure may change if the ML model is updated
- The `EyeAnalysisRecord` model defines the field as `side`, but the eye log query `.select()` and `sanitizeEyeLog` both reference `eyeSide`. Because the names do not match, the field is always absent from the log response. `POST /pet/analysis/eye/{identifier}` also never sets `side` or `userId` when creating the record, so these model fields are always `null`
- The PATCH `date` field's error message claims `YYYY-MM-DD` format, but the `isValidDateFormat` validator uses `new Date(value)` internally, which accepts many other formats (ISO 8601, RFC 2822, epoch strings, etc.). Frontends should send `YYYY-MM-DD` for consistency, but the server does not enforce it strictly
- `POST /pet/analysis/uploads/breed-image` silently takes only the first file when multiple are attached, while `POST /pet/analysis/uploads/image` explicitly rejects requests with more than one file (`tooManyFiles`)
- Upload endpoints (`/uploads/image` and `/uploads/breed-image`) do not enforce a maximum file size. Only `POST /pet/analysis/eye/{identifier}` enforces the 30 MB limit

<!-- markdownlint-disable MD024 -->
# Pet Adoption API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Two separate subsystems share the `/pet/adoption` path:

- **Public browse** — paginated listing and detail view of adoption listings sourced from an external shelter database (`ADOPTION_MONGODB_URI`). No auth required.
- **Managed adoption records** — post-adoption tracking records linked to a pet in the main database (`MONGODB_URI`). Requires ownership auth.

## Overview

| Method | Path | Auth | Lambda | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/pet/adoption` | None | `pet-adoption` | Browse paginated adoption listing (public) |
| GET | `/pet/adoption/{id}` | None (deployed) | `pet-adoption` | Browse detail (no auth) or managed record GET (SAM local + JWT only) |
| POST | `/pet/adoption/{id}` | `x-api-key` + Bearer JWT | `pet-adoption` | Create a managed post-adoption record (id = petId) |
| PATCH | `/pet/adoption/{id}` | `x-api-key` + Bearer JWT | `pet-adoption` | Update a managed post-adoption record (id = petId) |
| DELETE | `/pet/adoption/{id}` | `x-api-key` + Bearer JWT | `pet-adoption` | Delete a managed post-adoption record (id = petId) |

## Integration-Critical Contract Notes

| Topic | Current DDD behavior |
| --- | --- |
| Dual-mode GET dispatch | `GET /pet/adoption/{id}` dispatches based on auth context. In production (API Gateway), the route uses `Authorizer: NONE`, so no claims are injected and the handler always routes to browse detail. Managed record GET via this route is only reachable in SAM local (with a valid JWT in the Authorization header) or in direct test invocation. |
| One record per pet | `pet_adoptions` collection stores at most one record per `petId`. POST returns `409` if a record already exists. There is no upsert path. |
| GET with no managed record | `GET /pet/adoption/{id}` (managed path) returns `200` with `form: null` when no adoption record exists for the pet. This is a normal state, not an error. |
| PATCH response | PATCH does **not** return the updated `form`. It returns `{ petId }` only. Re-fetch via managed GET if the updated document is needed. |
| Date format | Date fields accept `DD/MM/YYYY` or ISO 8601 (`YYYY-MM-DD` or `YYYY-MM-DDThh:mm:ssZ`). Any date field that is present but fails both formats returns `400 petAdoption.errors.managed.invalidDateFormat`. |
| Unknown POST/PATCH fields | The adoption Zod schema uses `z.object()` without `.strict()`, so unknown fields are **stripped silently** rather than rejected. If all supplied fields are stripped (only unknown keys were sent), PATCH returns `400 petAdoption.errors.managed.noFieldsToUpdate`. |
| Empty body behavior | POST accepts an empty `{}` body — all fields are optional, so `{}` creates a record with all null/default values. A `null`/absent body (no body sent) returns `400 common.invalidBodyParams` (Zod rejects null). PATCH with `{}` body returns `400 petAdoption.errors.managed.noFieldsToUpdate`. The key `common.missingBodyParams` is never returned by this Lambda. |
| Ownership check | The Lambda checks `pet.userId === jwt.userId` **or** `pet.ngoId === jwt.ngoId`. A non-owner caller receives `403 common.forbidden`. Soft-deleted pets (`deleted: true`) return `404 petAdoption.errors.managed.petNotFound`. |
| Browse exclusions | The listing excludes adoption sites `["Arc Dog Shelter", "Tolobunny", "HKRABBIT"]` and documents with an empty `Image_URL`. |
| Page size | Browse list is paginated at **16** records per page. |
| Search cap | The `search` query param is trimmed and capped at **100 characters**. Longer values return `400 petAdoption.errors.browse.invalidSearch`. |
| Age range values | `age` filter accepts comma-separated Chinese labels: `幼年` (<12 months), `青年` (12–36 months), `成年` (48–72 months), `老年` (>84 months). Values not in this set are silently ignored. |

## API Gateway And Auth Rules

### API Gateway Requirements

| Route | API key required | API Gateway authorizer |
| --- | --- | --- |
| `GET /pet/adoption` | No | None |
| `GET /pet/adoption/{id}` | No | None |
| `POST /pet/adoption/{id}` | Yes | `DddTokenAuthorizer` |
| `PATCH /pet/adoption/{id}` | Yes | `DddTokenAuthorizer` |
| `DELETE /pet/adoption/{id}` | Yes | `DddTokenAuthorizer` |
| `OPTIONS /pet/adoption` | No | None |
| `OPTIONS /pet/adoption/{id}` | No | None |

Public browse requests (`GET /pet/adoption`, `GET /pet/adoption/{id}`) require neither an API key nor an Authorization header when hitting the deployed gateway.

Protected managed requests must send:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
Content-Type: application/json
```

`OPTIONS` preflight returns `204` with CORS headers and requires no key or token.

### Authorization And Ownership

Protected routes require a valid Bearer JWT validated by the `DddTokenAuthorizer` Lambda authorizer.

The Lambda authorizes pet access when either condition is true:

- `pet.userId === jwt.userId`
- `pet.ngoId` is set and `pet.ngoId === jwt.ngoId`

A caller that does not match either condition receives `403 common.forbidden`.

### Localization

- Locale priority: query `?lang`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale: `zh` (Traditional Chinese) for browse routes, `en` for managed routes
- `errorKey` is the stable integration key; `error` and `message` are localized strings

### Success Response Shape

All Lambda-produced success responses include `success: true` and `requestId`.

```json
{
  "success": true,
  "message": "...",
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petAdoption.errors.managed.recordNotFound",
  "error": "Post-adoption record not found",
  "requestId": "aws-lambda-request-id"
}
```

### Request Body Validation (POST and PATCH)

Bodies are parsed as `application/json`. The Lambda runs the body through `parseBody` with the adoption Zod schema.

Allowed fields for both POST and PATCH:

| Field | Type |
| --- | --- |
| `postAdoptionName` | string \| null (optional) |
| `isNeutered` | boolean \| null (optional) |
| `NeuteredDate` | string \| null (optional) — date string |
| `firstVaccinationDate` | string \| null (optional) — date string |
| `secondVaccinationDate` | string \| null (optional) — date string |
| `thirdVaccinationDate` | string \| null (optional) — date string |
| `followUpMonth1` … `followUpMonth12` | boolean (optional) |

Unknown fields are stripped silently (schema does not use `.strict()`).

`parseBody` returns these standardized `400` `errorKey`s:

| Condition | `errorKey` |
| --- | --- |
| Malformed JSON (body arrives as unparsed string) | `common.invalidBodyParams` |
| Null or absent body (no body sent) | `common.invalidBodyParams` (Zod rejects null; `requireNonEmpty` is not set) |
| Zod schema rejection | `common.invalidBodyParams` (or the first Zod issue if it is a dotted i18n key) |

After `parseBody` succeeds, the PATCH handler performs one additional check:

| Condition | `errorKey` |
| --- | --- |
| All supplied fields resolve to `undefined` (no known update fields present, or `{}` body) | `petAdoption.errors.managed.noFieldsToUpdate` |

---

## Browse Record Shape

The public browse database is separate from the main database. Fields are projected from the `adoption_list` collection in `ADOPTION_MONGODB_URI`.

### Browse list item (GET /pet/adoption)

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | MongoDB ObjectId of the listing |
| `Name` | string \| null | Pet name |
| `Age` | number \| null | Age in months |
| `Sex` | string \| null | e.g. `"M"`, `"F"` |
| `Breed` | string \| null | Breed string |
| `Image_URL` | string \| string[] \| null | Photo URL(s) |

`__v` and the internal `parsedDate` field are stripped before the response is sent.

### Browse detail item (GET /pet/adoption/{id} — no auth)

All list fields plus:

| Field | Type | Notes |
| --- | --- | --- |
| `Remark` | string \| null | Description or notes |
| `AdoptionSite` | string \| null | Name of adoption site |
| `URL` | string \| null | Link to original listing |

---

## Managed Adoption Record Shape

The managed record is stored in `pet_adoptions` collection in `MONGODB_URI` and linked to a pet by `petId`.

`__v` is stripped before any record is returned.

### GET / POST form shape

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | MongoDB ObjectId of the adoption record |
| `petId` | string | MongoDB ObjectId of the pet |
| `postAdoptionName` | string \| null | Name given after adoption |
| `isNeutered` | boolean \| null | Neutered status |
| `NeuteredDate` | string \| null | ISO date string or null |
| `firstVaccinationDate` | string \| null | ISO date string or null |
| `secondVaccinationDate` | string \| null | ISO date string or null |
| `thirdVaccinationDate` | string \| null | ISO date string or null |
| `followUpMonth1` … `followUpMonth12` | boolean | Monthly follow-up flags; default `false` |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |

---

## Endpoints

### GET /pet/adoption

Browse the paginated adoption listing. Public — no auth or API key required.

**Lambda:** `pet-adoption`  
**Auth:** None

#### Query Parameters

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | number | `1` | Positive integer; invalid value returns `400` |
| `search` | string | — | Trimmed; max 100 characters; regex on `Breed`, `Animal_Type`, `Remark` |
| `animal_type` | string | — | Comma-separated; matches `Animal_Type` field |
| `location` | string | — | Comma-separated; matches `AdoptionSite` field |
| `sex` | string | — | Comma-separated; matches `Sex` field |
| `age` | string | — | Comma-separated; valid values: `幼年`, `青年`, `成年`, `老年` |
| `lang` | string | `zh` | Locale hint |

#### Success (200)

```json
{
  "success": true,
  "message": "Adoption listings retrieved",
  "adoptionList": [
    {
      "_id": "6820000000000000000abc01",
      "Name": "Lucky",
      "Age": 24,
      "Sex": "M",
      "Breed": "Mixed",
      "Image_URL": "https://example.com/image.jpg"
    }
  ],
  "maxPage": 8,
  "totalResult": 128,
  "requestId": "aws-lambda-request-id"
}
```

`adoptionList` is empty (`[]`) when no matching records exist. `maxPage` is `0` when `totalResult` is `0`.

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAdoption.errors.browse.invalidPage` | `page` is present but not a positive integer |
| 400 | `petAdoption.errors.browse.invalidSearch` | `search` exceeds 100 characters |
| 500 | `common.internalError` | Unexpected error (e.g. DB connection failure) |

---

### GET /pet/adoption/{id}

**Deployed behavior (API Gateway `Authorizer: NONE`):** Routes to public browse detail. Auth context is never injected, so the managed path is unreachable via this endpoint in production.

**SAM local behavior (`AWS_SAM_LOCAL=true` + valid Bearer JWT):** The Lambda fallback JWT decode runs. If the token is valid, the handler routes to the managed record GET (id = petId). If no token is present, routes to browse detail.

---

#### Browse detail (no auth — deployed production path)

Returns the full detail document for a single adoption listing.

**Lambda:** `pet-adoption`  
**Auth:** None

##### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | Yes | MongoDB ObjectId of the adoption listing |

##### Query Parameters

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `lang` | string | `zh` | Locale hint |

##### Success (200)

```json
{
  "success": true,
  "message": "Adoption listing retrieved",
  "pet": {
    "_id": "6820000000000000000abc01",
    "Name": "Lucky",
    "Age": 24,
    "Sex": "M",
    "Breed": "Mixed",
    "Image_URL": "https://example.com/image.jpg",
    "Remark": "Friendly and vaccinated",
    "AdoptionSite": "SPCA",
    "URL": "https://example.com/listing/lucky"
  },
  "requestId": "aws-lambda-request-id"
}
```

##### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAdoption.errors.browse.invalidIdFormat` | `id` is not a valid MongoDB ObjectId |
| 404 | `petAdoption.errors.browse.petNotFound` | No adoption listing found for this id |
| 500 | `common.internalError` | Unexpected error |

---

#### Managed record GET (SAM local + valid JWT only)

Returns the managed post-adoption record linked to a pet. This path is only reachable in SAM local or direct Lambda invocation with a valid auth context.

**Lambda:** `pet-adoption`  
**Auth:** Bearer JWT (via SAM local fallback decode)

##### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | Yes | MongoDB ObjectId of the **pet** (`petId`) |

##### Success — record exists (200)

```json
{
  "success": true,
  "message": "Post-adoption record retrieved",
  "petId": "6820000000000000000abc01",
  "adoptionId": "6820000000000000000def01",
  "form": {
    "_id": "6820000000000000000def01",
    "petId": "6820000000000000000abc01",
    "postAdoptionName": "Buddy",
    "isNeutered": true,
    "NeuteredDate": "2025-03-01T00:00:00.000Z",
    "firstVaccinationDate": "2025-01-15T00:00:00.000Z",
    "secondVaccinationDate": "2025-02-15T00:00:00.000Z",
    "thirdVaccinationDate": null,
    "followUpMonth1": true,
    "followUpMonth2": false,
    "followUpMonth3": false,
    "followUpMonth4": false,
    "followUpMonth5": false,
    "followUpMonth6": false,
    "followUpMonth7": false,
    "followUpMonth8": false,
    "followUpMonth9": false,
    "followUpMonth10": false,
    "followUpMonth11": false,
    "followUpMonth12": false,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-04-01T00:00:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

##### Success — no record yet (200)

```json
{
  "success": true,
  "message": "Post-adoption record retrieved",
  "petId": "6820000000000000000abc01",
  "form": null,
  "requestId": "aws-lambda-request-id"
}
```

`adoptionId` is absent when `form` is `null`.

##### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAdoption.errors.managed.invalidPetId` | `id` is not a valid MongoDB ObjectId |
| 401 | `common.unauthorized` | No valid auth context (e.g. missing JWT in SAM local) |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petAdoption.errors.managed.petNotFound` | Pet does not exist or is soft-deleted |
| 500 | `common.internalError` | Unexpected error |

---

### POST /pet/adoption/{id}

Creates a managed post-adoption record for a pet. The `{id}` path segment is the `petId`.

**Lambda:** `pet-adoption`  
**Auth:** `x-api-key` + Bearer JWT required  
**One record per pet:** returns `409` if a record already exists.

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | Yes | MongoDB ObjectId of the **pet** |

#### Body

All fields are optional and nullable. An empty `{}` body is accepted and creates a record with all null/default values.

| Field | Type | Notes |
| --- | --- | --- |
| `postAdoptionName` | string \| null | Name given to the pet after adoption |
| `isNeutered` | boolean \| null | Neutered status |
| `NeuteredDate` | string \| null | `DD/MM/YYYY` or ISO 8601 |
| `firstVaccinationDate` | string \| null | `DD/MM/YYYY` or ISO 8601 |
| `secondVaccinationDate` | string \| null | `DD/MM/YYYY` or ISO 8601 |
| `thirdVaccinationDate` | string \| null | `DD/MM/YYYY` or ISO 8601 |
| `followUpMonth1` … `followUpMonth12` | boolean | Default `false` when omitted |

**Example request:**

```json
{
  "postAdoptionName": "Buddy",
  "isNeutered": true,
  "NeuteredDate": "15/03/2025",
  "firstVaccinationDate": "2025-01-15",
  "followUpMonth1": true
}
```

#### Success (201)

```json
{
  "success": true,
  "message": "Post-adoption record created",
  "petId": "6820000000000000000abc01",
  "adoptionId": "6820000000000000000def01",
  "form": {
    "_id": "6820000000000000000def01",
    "petId": "6820000000000000000abc01",
    "postAdoptionName": "Buddy",
    "isNeutered": true,
    "NeuteredDate": "2025-03-15T00:00:00.000Z",
    "firstVaccinationDate": "2025-01-15T00:00:00.000Z",
    "secondVaccinationDate": null,
    "thirdVaccinationDate": null,
    "followUpMonth1": true,
    "followUpMonth2": false,
    "followUpMonth3": false,
    "followUpMonth4": false,
    "followUpMonth5": false,
    "followUpMonth6": false,
    "followUpMonth7": false,
    "followUpMonth8": false,
    "followUpMonth9": false,
    "followUpMonth10": false,
    "followUpMonth11": false,
    "followUpMonth12": false,
    "createdAt": "2025-05-04T00:00:00.000Z",
    "updatedAt": "2025-05-04T00:00:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAdoption.errors.managed.invalidPetId` | `id` is not a valid MongoDB ObjectId |
| 400 | `common.invalidBodyParams` | Malformed JSON, Zod schema rejection, or null/absent body |
| 400 | `petAdoption.errors.managed.invalidDateFormat` | A date field is present but fails format validation |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petAdoption.errors.managed.petNotFound` | Pet does not exist or is soft-deleted |
| 409 | `petAdoption.errors.managed.duplicateRecord` | A record already exists for this pet (including race-condition duplicate key `11000`) |
| 500 | `common.internalError` | Unexpected error |

---

### PATCH /pet/adoption/{id}

Partially updates the managed post-adoption record for a pet. The `{id}` path segment is the `petId`. Only the fields supplied in the body are written — omitted fields are left unchanged.

PATCH does **not** return the updated `form`. Re-fetch via managed `GET /pet/adoption/{id}` (SAM local / direct invocation) if the updated document is needed.

**Lambda:** `pet-adoption`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | Yes | MongoDB ObjectId of the **pet** |

#### Body

Same schema as POST. At least one known field must be present.

**Example request:**

```json
{
  "postAdoptionName": "Max",
  "followUpMonth2": true
}
```

#### Success (200)

```json
{
  "success": true,
  "message": "Post-adoption record updated",
  "petId": "6820000000000000000abc01",
  "requestId": "aws-lambda-request-id"
}
```

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAdoption.errors.managed.invalidPetId` | `id` is not a valid MongoDB ObjectId |
| 400 | `common.invalidBodyParams` | Malformed JSON, Zod schema rejection, or null/absent body |
| 400 | `petAdoption.errors.managed.invalidDateFormat` | A date field is present but fails format validation |
| 400 | `petAdoption.errors.managed.noFieldsToUpdate` | Body contains no recognized update fields after Zod parse (`{}` or only unknown fields) |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petAdoption.errors.managed.petNotFound` | Pet does not exist or is soft-deleted |
| 404 | `petAdoption.errors.managed.recordNotFound` | No adoption record exists for this petId |
| 500 | `common.internalError` | Unexpected error |

---

### DELETE /pet/adoption/{id}

Deletes the managed post-adoption record for a pet. The `{id}` path segment is the `petId`.

**Lambda:** `pet-adoption`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | Yes | MongoDB ObjectId of the **pet** |

#### Success (200)

```json
{
  "success": true,
  "message": "Post-adoption record deleted",
  "petId": "6820000000000000000abc01",
  "requestId": "aws-lambda-request-id"
}
```

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petAdoption.errors.managed.invalidPetId` | `id` is not a valid MongoDB ObjectId |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petAdoption.errors.managed.petNotFound` | Pet does not exist or is soft-deleted |
| 404 | `petAdoption.errors.managed.recordNotFound` | No adoption record exists for this petId |
| 500 | `common.internalError` | Unexpected error |

---

## Frontend Integration Guide

### Public browse flow

```
GET /pet/adoption?page=1&animal_type=Dog&location=SPCA&age=幼年,青年
→ 200 { adoptionList, maxPage, totalResult }

GET /pet/adoption/{listingId}
→ 200 { pet: { _id, Name, Age, Sex, Breed, Image_URL, Remark, AdoptionSite, URL } }
```

- No `x-api-key` or `Authorization` header is required.
- Use `?lang=en` for English error messages.
- `adoptionList` is empty when filters produce no results.
- Stop pagination when `page > maxPage`.

### Managed adoption record flow (owner / NGO)

```
# Check whether a record exists for a pet (SAM local only via GET)
# In production, manage record state via POST / PATCH / DELETE only

POST /pet/adoption/{petId}   → 201 { form, petId, adoptionId }   — create
PATCH /pet/adoption/{petId}  → 200 { petId }                     — partial update
DELETE /pet/adoption/{petId} → 200 { petId }                     — delete
```

- All managed routes require `x-api-key` and `Authorization: Bearer <token>`.
- `{petId}` is the MongoDB ObjectId of the pet, not the adoption record's own `_id`.
- Each pet has at most one adoption record. POST returns `409` if one already exists.
- PATCH returns only `petId`. If the updated form is needed, re-fetch via direct Lambda (SAM local) or use the response from the prior GET.
- Date fields accept `DD/MM/YYYY` or ISO 8601. Store the value the user provides; the Lambda normalizes it to a JS `Date` before persisting.

### Ownership rules

The caller must be either:
- The individual owner: `pet.userId === jwt.userId`
- The NGO owner: `pet.ngoId` is set and `pet.ngoId === jwt.ngoId`

A mismatch returns `403 common.forbidden`. A non-existent or soft-deleted pet returns `404 petAdoption.errors.managed.petNotFound`.

---

## Delta From Legacy (`AWS_API`)

| Area | Legacy (`AWS_API` / `PetDetailInfo`) | Current DDD (`pet-adoption`) |
| --- | --- | --- |
| Route shape | `/v2/pets/{petID}/pet-adoption`, `/v2/pets/{petID}/pet-adoption/{adoptionId}` | `/pet/adoption/{id}` (id = petId for all managed ops) |
| Update method | `PUT /v2/pets/{petID}/pet-adoption/{adoptionId}` | `PATCH /pet/adoption/{id}` (id = petId, no adoptionId in path) |
| Lambda owner | `PetDetailInfo` | `pet-adoption` |
| Browse routes | Separate lambda `GetAdoption` at `/adoption` and `/adoption/{id}` | Same lambda `pet-adoption` at `/pet/adoption` and `/pet/adoption/{id}` |
| Error key namespace | `petDetailInfo.errors.petAdoption.*` | `petAdoption.errors.managed.*` / `petAdoption.errors.browse.*` |
| Empty body behavior | POST: `{}` accepted (creates null-field record); null body → `common.invalidBodyParams`. PATCH: `{}` → `petAdoption.errors.managed.noFieldsToUpdate`; null body → `common.invalidBodyParams`. Key `common.missingBodyParams` is never returned. | n/a (`common.missingParams` on null body) |
| PATCH response | `{ petId, adoptionId }` | `{ petId }` only |

---

## Testing

Tests live at [`__tests__/pet-adoption.test.js`](../../../__tests__/pet-adoption.test.js).

Run:

```sh
npx jest pet-adoption
```

The test file covers:

| Suite | Cases |
| --- | --- |
| `GET /pet/adoption` (browse list) | Returns list with pagination; 400 on invalid page; 400 on long search |
| `GET /pet/adoption/{id}` (no auth — browse detail) | 400 invalid ObjectId; 404 not found; 200 found |
| `GET /pet/adoption/{id}` (with auth — managed GET) | 400 invalid petId; 403 non-owner; 200 form=null; 200 form populated |
| `POST /pet/adoption/{id}` | 401 no auth; 400 invalid petId; 409 duplicate; 403 non-owner; 409 race condition; 201 success |
| `PATCH /pet/adoption/{id}` | 401 no auth; 403 non-owner; 400 empty body; 404 no record; 200 success |
| `DELETE /pet/adoption/{id}` | 401 no auth; 403 non-owner; 404 no record; 200 success |

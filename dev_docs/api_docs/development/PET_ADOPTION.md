# Pet Adoption API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Two independent sub-domains share the `/pet/adoption` path prefix:

- **Public adoption browse** — unauthenticated listings sourced from external shelter feeds. No API key required.
- **Owner-side managed records** — post-adoption placement records linked to a specific pet. Requires JWT auth and API key.

> Global conventions: see `dev_docs/api_docs/development/` README or `../../README.md`.

---

## Route Summary

| Method | Path | Auth | API Key | Lambda | Purpose |
| --- | --- | --- | --- | --- | --- |
| GET | `/pet/adoption` | None | Not required | `pet-adoption` | Browse public adoption listings |
| GET | `/pet/adoption/{id}` | None (see note) | Not required | `pet-adoption` | Browse detail for one adoption listing |
| POST | `/pet/adoption/{id}` | Bearer JWT (owner/NGO) | Required | `pet-adoption` | Create managed adoption record for a pet |
| PATCH | `/pet/adoption/{id}` | Bearer JWT (owner/NGO) | Required | `pet-adoption` | Update managed adoption record for a pet |
| DELETE | `/pet/adoption/{id}` | Bearer JWT (owner/NGO) | Required | `pet-adoption` | Delete managed adoption record for a pet |

> **`{id}` semantics differ by sub-domain.** For public browse routes, `{id}` is the MongoDB ObjectId of the adoption listing document (from the external feed database). For managed record routes (POST / PATCH / DELETE), `{id}` is the `petId` — the ObjectId of the pet in the main database.

---

## API Gateway and Auth Rules

### API Gateway Requirements

Browse routes (`GET /pet/adoption`, `GET /pet/adoption/{id}`) are configured with `ApiKeyRequired: false` in the deployed template. No `x-api-key` header is needed.

Managed mutation routes (POST, PATCH, DELETE) use the default API Gateway settings — `x-api-key` is required.

`OPTIONS` preflight routes are public and do not require `x-api-key`.

| Route | API key at Gateway | Authorizer at Gateway |
| --- | --- | --- |
| GET `/pet/adoption` | Not required | NONE |
| GET `/pet/adoption/{id}` | Not required | NONE |
| POST `/pet/adoption/{id}` | **Required** | DddTokenAuthorizer |
| PATCH `/pet/adoption/{id}` | **Required** | DddTokenAuthorizer |
| DELETE `/pet/adoption/{id}` | **Required** | DddTokenAuthorizer |
| OPTIONS `/pet/adoption`, `/pet/adoption/{id}` | Not required | NONE |

### Authentication

| Route group | Requirement |
| --- | --- |
| Browse routes | No `Authorization` header needed. The Lambda authorizer does not run on these routes. |
| Managed record mutations | `Authorization: Bearer <access-token>` required. Missing or invalid token → `401 common.unauthorized`. |

**Ownership check**: the handler resolves the pet from the main database and confirms that either `pet.userId === callerId.userId` (individual user owns the pet) or `pet.ngoId === callerId.ngoId` (calling user is a member of the NGO that owns the pet). Neither admin nor developer roles bypass this check — they must be the actual owner.

### Required Headers

| Scenario | Headers |
| --- | --- |
| Browse requests | `Content-Type: application/json` |
| Managed mutation — deployed | `Content-Type: application/json`, `x-api-key: <key>`, `Authorization: Bearer <access-token>` |
| Managed mutation — local SAM | `Content-Type: application/json`, `Authorization: Bearer <access-token>` |

---

## Public Adoption Browse

Reads from a **separate** database (`ADOPTION_MONGODB_URI`). Data is sourced from external shelter feeds and is read-only from the API perspective.

---

### GET /pet/adoption

Paginated adoption listing with filters. Results are sorted by `Creation_Date` descending (newest first).

**Auth:** None  
**API key:** Not required

**Hard-coded exclusions:** records where `AdoptionSite` is any of `["Arc Dog Shelter", "Tolobunny", "HKRABBIT"]` are always excluded. Records where `Image_URL` is a literal empty array (`[]`) are excluded by the MongoDB query — records with `null` or an empty string `Image_URL` are **not** excluded by this filter.

**Page size:** 16

#### Query Parameters

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | integer | `1` | Must be a positive integer. Non-numeric or ≤ 0 → `400`. |
| `search` | string | — | Max 100 characters. Matches against `Breed`, `Animal_Type`, and `Remark` (case-insensitive regex). Exceeding 100 chars → `400`. |
| `animal_type` | string | — | Comma-separated values, max 20 items. Matches `Animal_Type` field with `$in`. |
| `location` | string | — | Comma-separated values, max 20 items. Matches `AdoptionSite` with `$in`. |
| `sex` | string | — | Comma-separated values, max 20 items. Matches `Sex` field with `$in`. |
| `age` | string | — | Comma-separated age-band labels, max 20 items. Valid values: `幼年` (< 12 months), `青年` (12–36 months), `成年` (48–72 months), `老年` (> 84 months). Ages in the gap ranges (37–47 months, 73–84 months) do not match any band. |
| `lang` | string | `zh` | Language for localized message. `zh` or `en`. |

#### Example Request

```http
GET /pet/adoption?page=1&animal_type=Dog&sex=Male&lang=en
```

#### Success (200)

```json
{
  "success": true,
  "message": "Adoption listings retrieved",
  "adoptionList": [
    {
      "_id": "664a1b2c3d4e5f6a7b8c9d00",
      "Name": "Lucky",
      "Age": 24,
      "Sex": "Male",
      "Breed": "Mixed",
      "Image_URL": "https://example.com/lucky.jpg"
    }
  ],
  "maxPage": 8,
  "totalResult": 128
}
```

`maxPage` is `0` when no results match. `adoptionList` is an empty array.

#### Errors

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAdoption.errors.browse.invalidPage` | `page` is not a positive integer |
| 400 | `petAdoption.errors.browse.invalidSearch` | `search` exceeds 100 characters |
| 500 | `common.internalError` | Unexpected server error |

---

### GET /pet/adoption/{id}

Returns the full detail record for a single adoption listing.

**Auth:** None  
**API key:** Not required

> The Lambda handler contains auth-dispatch logic that would route authenticated callers to the managed record GET. However, since the API Gateway route uses `Authorizer: NONE`, the authorizer never runs and `requestContext.authorizer` is never populated. In production this endpoint **always** serves browse detail. The managed GET path is unreachable through the deployed API Gateway for this route.

#### Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | ObjectId string | Yes | MongoDB ObjectId of the adoption listing document |

#### Query Parameters

| Param | Type | Default |
| --- | --- | --- |
| `lang` | string | `zh` |

#### Example Request

```http
GET /pet/adoption/664a1b2c3d4e5f6a7b8c9d00?lang=en
```

#### Success (200)

```json
{
  "success": true,
  "message": "Adoption listing retrieved",
  "pet": {
    "_id": "664a1b2c3d4e5f6a7b8c9d00",
    "Name": "Lucky",
    "Age": 24,
    "Sex": "Male",
    "Breed": "Mixed",
    "Image_URL": "https://example.com/lucky.jpg",
    "Remark": "Friendly with children",
    "AdoptionSite": "SPCA",
    "URL": "https://spca.org.hk/lucky"
  }
}
```

#### Errors

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAdoption.errors.browse.invalidIdFormat` | `id` is not a valid MongoDB ObjectId |
| 404 | `petAdoption.errors.browse.petNotFound` | No matching adoption listing found |
| 500 | `common.internalError` | Unexpected server error |

---

## Managed Adoption Records

Owner-side records linked to a specific pet. These are internal placement / follow-up records (e.g. post-adoption neutering, vaccination, monthly check-ins).

Reads and writes to the **main** database (`MONGODB_URI`). Collection: `pet_adoptions`.

Each pet has at most one managed adoption record. Addressed by `petId` only — there is no separate `adoptionId` in the path.

**Common path parameter for all managed routes:**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `{id}` | ObjectId string | Yes | `petId` — the MongoDB ObjectId of the pet in the main database |

**Common error rows (apply to all managed routes):**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `petAdoption.errors.managed.invalidPetId` | `{id}` is not a valid ObjectId |
| 401 | `common.unauthorized` | Missing or invalid Bearer JWT |
| 403 | `common.forbidden` | Caller is not the pet owner or the owning NGO |
| 404 | `petAdoption.errors.managed.petNotFound` | Pet not found or soft-deleted |
| 500 | `common.internalError` | Unexpected server error |

---

### POST /pet/adoption/{id}

Creates a new managed adoption record for the pet. Fails with `409` if a record already exists.

**Auth:** Bearer JWT (owner/NGO)  
**API key:** Required

#### Request Body

All fields are optional. A body with no recognized fields creates a record with all values set to their defaults.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `postAdoptionName` | string \| null | `null` | Name given to the pet post-adoption |
| `isNeutered` | boolean \| null | `null` | |
| `NeuteredDate` | string \| null | `null` | `DD/MM/YYYY` or ISO 8601 (`YYYY-MM-DD` or full datetime) |
| `firstVaccinationDate` | string \| null | `null` | Same date formats |
| `secondVaccinationDate` | string \| null | `null` | Same date formats |
| `thirdVaccinationDate` | string \| null | `null` | Same date formats |
| `followUpMonth1` | boolean | `false` | Monthly follow-up check — month 1 |
| `followUpMonth2` | boolean | `false` | |
| … | … | … | Same pattern through `followUpMonth12` |
| `followUpMonth12` | boolean | `false` | Monthly follow-up check — month 12 |

#### Example Request

```http
POST /pet/adoption/664b2c3d4e5f6a7b8c9d0001
Authorization: Bearer <access-token>
x-api-key: <api-gateway-api-key>
Content-Type: application/json

{
  "postAdoptionName": "Buddy",
  "isNeutered": true,
  "NeuteredDate": "01/06/2025",
  "followUpMonth1": true,
  "followUpMonth2": true
}
```

#### Success (201)

```json
{
  "success": true,
  "message": "Post-adoption record created",
  "form": {
    "_id": "664c3d4e5f6a7b8c9d000001",
    "petId": "664b2c3d4e5f6a7b8c9d0001",
    "postAdoptionName": "Buddy",
    "isNeutered": true,
    "NeuteredDate": "2025-06-01T00:00:00.000Z",
    "firstVaccinationDate": null,
    "secondVaccinationDate": null,
    "thirdVaccinationDate": null,
    "followUpMonth1": true,
    "followUpMonth2": true,
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
    "createdAt": "2025-06-01T10:00:00.000Z",
    "updatedAt": "2025-06-01T10:00:00.000Z"
  },
  "petId": "664b2c3d4e5f6a7b8c9d0001",
  "adoptionId": "664c3d4e5f6a7b8c9d000001"
}
```

#### Extra Errors

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Malformed JSON body or body fails Zod schema validation |
| 400 | `petAdoption.errors.managed.invalidDateFormat` | Any date field fails `DD/MM/YYYY` or ISO 8601 validation |
| 409 | `petAdoption.errors.managed.duplicateRecord` | A record already exists for this pet |

---

### PATCH /pet/adoption/{id}

Updates one or more fields on the existing managed adoption record. Only fields present in the request body are updated — absent fields are unchanged.

**Auth:** Bearer JWT (owner/NGO)  
**API key:** Required

#### Request Body

Same field set as POST. All fields optional. At least one recognized field must resolve to a non-undefined value after Zod parsing, otherwise `400 common.noFieldsToUpdate`.

#### Example Request

```http
PATCH /pet/adoption/664b2c3d4e5f6a7b8c9d0001
Authorization: Bearer <access-token>
x-api-key: <api-gateway-api-key>
Content-Type: application/json

{
  "followUpMonth3": true,
  "NeuteredDate": "2025-06-15"
}
```

#### Success (200)

```json
{
  "success": true,
  "message": "Post-adoption record updated",
  "petId": "664b2c3d4e5f6a7b8c9d0001"
}
```

> No `form` or `adoptionId` is returned on successful PATCH. Issue a GET if the updated record is needed.

#### Extra Errors

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Malformed JSON body or body fails Zod schema validation |
| 400 | `petAdoption.errors.managed.invalidDateFormat` | Any date field fails format validation |
| 400 | `common.noFieldsToUpdate` | No recognized fields resolved from body |
| 404 | `petAdoption.errors.managed.recordNotFound` | No adoption record found for this pet |

---

### DELETE /pet/adoption/{id}

Deletes the managed adoption record for the pet.

**Auth:** Bearer JWT (owner/NGO)  
**API key:** Required

#### Example Request

```http
DELETE /pet/adoption/664b2c3d4e5f6a7b8c9d0001
Authorization: Bearer <access-token>
x-api-key: <api-gateway-api-key>
```

#### Success (200)

```json
{
  "success": true,
  "message": "Post-adoption record deleted",
  "petId": "664b2c3d4e5f6a7b8c9d0001"
}
```

#### Extra Errors

| Status | errorKey | Cause |
| --- | --- | --- |
| 404 | `petAdoption.errors.managed.recordNotFound` | No adoption record found for this pet |

---

## Frontend Integration Guide

### Browse flow (unauthenticated)

1. Call `GET /pet/adoption` with desired filters to display the listing page. Paginate using `?page=`.
2. Call `GET /pet/adoption/{id}` with the `_id` from the listing to show the detail view.
3. No `x-api-key` header is needed for either request.

### Managed record flow (pet owner / NGO)

The user must be authenticated and own the pet.

1. **Check for existing record** — `GET /pet/adoption` is public browse only. There is no standalone GET route for the managed record accessible via the deployed API Gateway (the `Authorizer: NONE` on `GET /pet/adoption/{id}` means the authorizer never runs on that route, making the managed GET path unreachable in production). The frontend should cache the `adoptionId` returned in the POST response or track record existence via the `form` field.

2. **Create** — `POST /pet/adoption/{petId}`. On success, store `adoptionId` from the response for future reference.

3. **Update** — `PATCH /pet/adoption/{petId}` with only the fields to change. No `adoptionId` is needed in the path — the record is looked up by `petId`. Response does not include the updated form; fetch state from local cache or re-fetch the resource if a round-trip is needed.

4. **Delete** — `DELETE /pet/adoption/{petId}`.

### Date field handling

Date fields (`NeuteredDate`, `firstVaccinationDate`, `secondVaccinationDate`, `thirdVaccinationDate`) accept either:
- `DD/MM/YYYY` (e.g. `"01/06/2025"`)
- ISO 8601 date string (e.g. `"2025-06-01"` or `"2025-06-01T00:00:00.000Z"`)

Responses return dates as ISO 8601 datetime strings (stored as MongoDB `Date` type).

To clear a date field, send it as `null`.

---

## Contract Deltas vs Legacy (AWS_API)

The following changes are intentional. Frontend integrators migrating from the legacy `AWS_API` must account for all of them.

| Delta | Legacy (`AWS_API`) | DDD (`AWS_DDD_API`) |
| --- | --- | --- |
| **Managed record path** | `/v2/pets/{petID}/pet-adoption` and `/v2/pets/{petID}/pet-adoption/{adoptionId}` | `/pet/adoption/{id}` where `{id}` = `petId` for mutations, `adoptionId` for browse |
| **No adoptionId in PATCH/DELETE path** | DELETE `/v2/pets/{petID}/pet-adoption/{adoptionId}` required an `adoptionId` path segment | PATCH and DELETE use `petId` only — one record per pet |
| **No managed GET via GET route** | `GET /v2/pets/{petID}/pet-adoption` was a protected owner-only route | `GET /pet/adoption/{id}` is public-only in deployment; managed GET is unreachable via API Gateway |
| **browse errorKey namespace** | `getAdoption.errors.*` | `petAdoption.errors.browse.*` |
| **managed errorKey namespace** | `petDetailInfo.errors.petAdoption.*` | `petAdoption.errors.managed.*` |
| **No API key on browse routes** | Browse routes used default API key enforcement | `GET /pet/adoption` and `GET /pet/adoption/{id}` are configured with `ApiKeyRequired: false` |
| **PATCH returns only petId** | PUT returned the full updated `form` | PATCH returns `{ success, message, petId }` — no `form` in response |
| **Lambda owner changed** | Browse = `GetAdoption` Lambda; managed = `PetDetailInfo` Lambda | Both = `pet-adoption` Lambda |
| **`noFieldsToUpdate` errorKey** | `petDetailInfo.errors.petAdoption.noFieldsToUpdate` | `common.noFieldsToUpdate` |

---

## Error Key Reference

### Browse

| errorKey | Status | Meaning |
| --- | --- | --- |
| `petAdoption.errors.browse.invalidPage` | 400 | `page` query param is not a positive integer |
| `petAdoption.errors.browse.invalidSearch` | 400 | `search` query param exceeds 100 characters |
| `petAdoption.errors.browse.invalidIdFormat` | 400 | `{id}` path param is not a valid MongoDB ObjectId |
| `petAdoption.errors.browse.petNotFound` | 404 | No adoption listing found for this `id` |

### Managed

| errorKey | Status | Meaning |
| --- | --- | --- |
| `petAdoption.errors.managed.invalidPetId` | 400 | `{id}` path param is not a valid MongoDB ObjectId |
| `petAdoption.errors.managed.invalidDateFormat` | 400 | A date field is present but does not match `DD/MM/YYYY` or ISO 8601 |
| `petAdoption.errors.managed.duplicateRecord` | 409 | An adoption record already exists for this pet (POST only) |
| `petAdoption.errors.managed.recordNotFound` | 404 | No adoption record found for this pet (PATCH / DELETE) |
| `petAdoption.errors.managed.petNotFound` | 404 | Pet not found in main DB or is soft-deleted |

### Cross-cutting (applies to managed routes)

| errorKey | Status | Meaning |
| --- | --- | --- |
| `common.unauthorized` | 401 | Missing or invalid Bearer JWT |
| `common.forbidden` | 403 | Caller does not own the pet and is not in the owning NGO |
| `common.invalidBodyParams` | 400 | Malformed JSON body or body fails Zod schema validation |
| `common.noFieldsToUpdate` | 400 | PATCH body contained no updatable fields |
| `common.internalError` | 500 | Unhandled server error — use `requestId` for CloudWatch lookup |

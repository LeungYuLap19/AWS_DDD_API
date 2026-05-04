<!-- markdownlint-disable MD024 -->
# Pet Transfer API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Ownership-transfer record management for a pet. Transfer history is stored as subdocuments within the `Pet` document — there is no separate collection. All routes require an authenticated caller who is the individual owner or the NGO owner of the pet. The NGO reassignment route additionally requires the caller's `userRole` to be `ngo`.

## Overview

| Method | Path | Auth | Lambda | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/pet/transfer/{petId}` | `x-api-key` + Bearer JWT | `pet-transfer` | Append a new transfer history record to the pet |
| PATCH | `/pet/transfer/{petId}/{transferId}` | `x-api-key` + Bearer JWT | `pet-transfer` | Partially update an existing transfer record |
| DELETE | `/pet/transfer/{petId}/{transferId}` | `x-api-key` + Bearer JWT | `pet-transfer` | Remove a transfer record |
| POST | `/pet/transfer/{petId}/ngo-reassignment` | `x-api-key` + Bearer JWT (role: `ngo`) | `pet-transfer` | Validate a target user by email + phone and reassign pet ownership from NGO to that user |

## Integration-Critical Contract Notes

| Topic | Current DDD behavior |
| --- | --- |
| Subdocument storage | Transfer records are stored inside `Pet.transfer[]`. There is no separate collection. Each record has a MongoDB-generated `_id` which serves as the `transferId`. |
| POST with empty body | `POST /pet/transfer/{petId}` accepts an empty `{}` body and creates a record with all fields set to `null` (or `""` for `transferRemark`). This is intentional — all body fields are optional. |
| Unknown fields in POST/PATCH | POST and PATCH schemas are **not** strict. Unknown fields are silently stripped and do not cause a `400`. This differs from `pet-source`. |
| PATCH response | PATCH returns `form: data` where `data` is the parsed request body, **not** the full stored record. Fields not included in the request are absent from `form`. Refetch via a separate GET endpoint if the full updated record is needed. |
| PATCH noFieldsToUpdate | A 400 `common.noFieldsToUpdate` is returned when a non-empty body is submitted whose fields are all stripped by Zod (i.e., all fields are unknown). An empty `{}` body returns `400 common.missingParams` before reaching that check. |
| DELETE method | DELETE does not require a body. The transfer record identity is supplied via `{transferId}` in the path. |
| NGO transfer side effects | `POST /pet/transfer/{petId}/ngo-reassignment` writes data to both `Pet.transferNGO[0]` **and** `Pet.transfer[0]` (using `$set` with index notation — existing first elements are overwritten). `pet.userId` is set to the target user's `_id` and `pet.ngoId` is cleared to `""`. |
| NGO role check order | `requireNGORole` fires **before** pet ownership checks and `parseBody`. A non-NGO caller receives `403` regardless of whether the pet exists or the body is valid. |
| Dual-identity user lookup | The NGO reassignment validates the target user by **both** `UserEmail` and `UserContact`. Both must resolve to the same `User` document. A generic `404` is returned when either lookup fails (anti-enumeration). |
| Email normalization | `UserEmail` is trimmed and lowercased before lookup. The lookup queries `User.email` which is stored with `trim` and `lowercase` Mongoose options. |
| Phone format | `UserContact` must be E.164 format (`+[country code][number]`, e.g. `+85291234567`). A local number without the `+` prefix will fail validation. |
| Date format | `regDate` accepts `DD/MM/YYYY` or ISO 8601 (`YYYY-MM-DD` or with time component). Separate `errorKey`s apply in the `transfer` and `ngoTransfer` namespaces. |
| Ownership model | Lambda authorizes access via `pet.userId === jwt.userId` **or** `pet.ngoId === jwt.ngoId`. Soft-deleted pets (`deleted: true`) are treated as non-existent. |

## API Gateway And Auth Rules

### API Gateway Requirements

| Route group | API key required | API Gateway authorizer |
| --- | --- | --- |
| `POST /pet/transfer/{petId}` | Yes | `DddTokenAuthorizer` |
| `PATCH /pet/transfer/{petId}/{transferId}` | Yes | `DddTokenAuthorizer` |
| `DELETE /pet/transfer/{petId}/{transferId}` | Yes | `DddTokenAuthorizer` |
| `POST /pet/transfer/{petId}/ngo-reassignment` | Yes | `DddTokenAuthorizer` |
| `OPTIONS /pet/transfer/{petId}` | No | None |
| `OPTIONS /pet/transfer/{petId}/{transferId}` | No | None |
| `OPTIONS /pet/transfer/{petId}/ngo-reassignment` | No | None |

All protected deployed requests must send:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
Content-Type: application/json
```

`OPTIONS` preflight does not require `x-api-key` and returns `204` with CORS headers.

### Authorization And Ownership

Protected routes require a valid Bearer JWT issued by the platform's token authorizer.

The Lambda authorizes pet access when either condition is true:

- `pet.userId === jwt.userId`
- `pet.ngoId` is set and `pet.ngoId === jwt.ngoId`

A caller that does not match either condition receives `403 common.forbidden`.

For `POST /pet/transfer/{petId}/ngo-reassignment`, the caller's `userRole` must additionally be `ngo` (case-insensitive). This check fires **before** pet ownership authorization.

### Localization

- Locale priority: query `?lang`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale: `en`
- `errorKey` is the stable integration key; `error` and `message` are localized strings

### Success Response Shape

All Lambda-produced success responses include `success: true` and `requestId`.

```json
{
  "success": true,
  "message": "Transfer record created successfully",
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petTransfer.errors.petNotFound",
  "error": "Pet not found",
  "requestId": "aws-lambda-request-id"
}
```

### Request Body Validation

POST and PATCH bodies are parsed as `application/json` via the shared `parseBody` helper with Zod schemas. DELETE has no body.

**`POST /pet/transfer/{petId}` and `PATCH /pet/transfer/{petId}/{transferId}` allowed fields:**

| Field | Type | Notes |
| --- | --- | --- |
| `regDate` | string (optional) | `DD/MM/YYYY` or ISO 8601 |
| `regPlace` | string (optional) | |
| `transferOwner` | string (optional) | |
| `transferContact` | string (optional) | |
| `transferRemark` | string (optional) | Defaults to `""` on create |

**`POST /pet/transfer/{petId}/ngo-reassignment` allowed fields:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `UserEmail` | string | Yes | Email of the target user; trimmed and lowercased |
| `UserContact` | string | Yes | Phone number of the target user; E.164 format |
| `regDate` | string | No | `DD/MM/YYYY` or ISO 8601 |
| `regPlace` | string | No | |
| `transferOwner` | string | No | |
| `transferContact` | string | No | |
| `transferRemark` | string | No | |
| `isTransferred` | boolean | No | Stored in `transferNGO[0]` only |

**Unknown fields are silently stripped** in POST and PATCH transfer schemas. No error is returned for extra keys.

`parseBody` returns these standardized `400` `errorKey`s:

| Condition | `errorKey` |
| --- | --- |
| Malformed JSON (body is not valid JSON) | `common.invalidBodyParams` |
| Empty body (`{}`, `null`, or missing) when `requireNonEmpty: true` applies | `common.missingParams` |
| Zod schema rejected the body and the first issue message is a dotted i18n key | that key |

Note: `POST /pet/transfer/{petId}` uses `requireNonEmpty: false` — an empty `{}` body is allowed and creates a record with all null fields. `PATCH` and `POST /ngo-reassignment` use `requireNonEmpty: true`.

---

## Transfer Record Shape

Transfer records are stored as subdocuments in `Pet.transfer[]`. Each record has its own `_id` field (used as `transferId` in path parameters and responses).

### POST create — `form` shape

The `form` in the `201` response is the constructed subdocument before it is written to MongoDB:

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | MongoDB ObjectId — this becomes `transferId` |
| `regDate` | string (ISO) or null | Parsed from input; `null` when not provided |
| `regPlace` | string or null | `null` when not provided |
| `transferOwner` | string or null | `null` when not provided |
| `transferContact` | string or null | `null` when not provided |
| `transferRemark` | string | `""` (empty string) when not provided |

### PATCH update — `form` shape

The `form` in the `200` response is the **submitted request body** after Zod parsing — not the full stored record. Only fields present in the request appear in `form`. To retrieve the full updated document, call the GET endpoint (outside this Lambda — see legacy API or a separate read path).

### NGO transfer — `form` shape

The `form` in the `200` response is the Zod-parsed request body. It contains `UserEmail`, `UserContact`, and any optional fields that were provided.

---

## Endpoints

### POST /pet/transfer/{petId}

Append a new transfer history record to a pet's `transfer[]` array. All body fields are optional — an empty body creates a record with all null fields.

**Lambda:** `pet-transfer`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId of the pet |

#### Body

All fields optional. An empty `{}` body is valid.

| Field | Type | Notes |
| --- | --- | --- |
| `regDate` | string | `DD/MM/YYYY` or ISO 8601; validated after Zod parse |
| `regPlace` | string | |
| `transferOwner` | string | |
| `transferContact` | string | |
| `transferRemark` | string | Stored as `""` when absent |

Unknown extra fields are silently stripped.

**Example request:**

```json
{
  "regDate": "2024-01-15",
  "regPlace": "Hong Kong",
  "transferOwner": "Alice",
  "transferContact": "+85291234567",
  "transferRemark": "Rehomed"
}
```

#### Success (201)

```json
{
  "success": true,
  "message": "Transfer record created successfully",
  "petId": "6820000000000000000abc01",
  "transferId": "6820000000000000000def01",
  "form": {
    "_id": "6820000000000000000def01",
    "regDate": "2024-01-15T00:00:00.000Z",
    "regPlace": "Hong Kong",
    "transferOwner": "Alice",
    "transferContact": "+85291234567",
    "transferRemark": "Rehomed"
  },
  "requestId": "aws-lambda-request-id"
}
```

Empty-body create (201):

```json
{
  "success": true,
  "petId": "6820000000000000000abc01",
  "transferId": "6820000000000000000def01",
  "form": {
    "_id": "6820000000000000000def01",
    "regDate": null,
    "regPlace": null,
    "transferOwner": null,
    "transferContact": null,
    "transferRemark": ""
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petTransfer.errors.missingPetId` | `petId` path parameter absent |
| 400 | `petTransfer.errors.invalidPetId` | `petId` is not a valid MongoDB ObjectId |
| 400 | `common.invalidBodyParams` | Malformed JSON body |
| 400 | `petTransfer.errors.transfer.invalidDateFormat` | `regDate` is not `DD/MM/YYYY` or ISO 8601 |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petTransfer.errors.petNotFound` | Pet does not exist or is soft-deleted |
| 500 | `common.internalError` | Unexpected error (e.g., DB connection failure) |

---

### PATCH /pet/transfer/{petId}/{transferId}

Partially update an existing transfer record. The handler verifies the subdocument exists before writing. Only supplied fields are updated. An empty `{}` body or a body with only unknown fields is rejected.

**Lambda:** `pet-transfer`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId of the pet |
| `transferId` | string | Yes | MongoDB ObjectId of the transfer subdocument |

#### Body

At least one recognized field must be provided.

| Field | Type | Notes |
| --- | --- | --- |
| `regDate` | string | `DD/MM/YYYY` or ISO 8601 |
| `regPlace` | string | |
| `transferOwner` | string | |
| `transferContact` | string | |
| `transferRemark` | string | |

**Example request:**

```json
{
  "regPlace": "Tsuen Wan",
  "transferRemark": "Updated contact"
}
```

#### Success (200)

`form` contains only the fields that were submitted in the request — not the full stored record.

```json
{
  "success": true,
  "message": "Transfer record updated successfully",
  "petId": "6820000000000000000abc01",
  "transferId": "6820000000000000000def01",
  "form": {
    "regPlace": "Tsuen Wan",
    "transferRemark": "Updated contact"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petTransfer.errors.missingPetId` | `petId` path parameter absent |
| 400 | `petTransfer.errors.invalidPetId` | `petId` is not a valid MongoDB ObjectId |
| 400 | `petTransfer.errors.transfer.missingTransferId` | `transferId` path parameter absent |
| 400 | `petTransfer.errors.transfer.invalidTransferId` | `transferId` is not a valid MongoDB ObjectId |
| 400 | `common.missingParams` | Body is empty (`{}`, `null`, or absent) |
| 400 | `common.invalidBodyParams` | Malformed JSON body |
| 400 | `common.noFieldsToUpdate` | Non-empty body but all fields were stripped by Zod (only unknown fields sent) |
| 400 | `petTransfer.errors.transfer.invalidDateFormat` | `regDate` is not `DD/MM/YYYY` or ISO 8601 |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petTransfer.errors.petNotFound` | Pet does not exist or is soft-deleted |
| 404 | `petTransfer.errors.transfer.notFound` | Transfer subdocument does not exist on this pet |
| 500 | `common.internalError` | Unexpected error |

---

### DELETE /pet/transfer/{petId}/{transferId}

Remove a transfer record from a pet's `transfer[]` array. No body is required.

**Lambda:** `pet-transfer`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId of the pet |
| `transferId` | string | Yes | MongoDB ObjectId of the transfer subdocument to remove |

#### Body

None.

#### Success (200)

```json
{
  "success": true,
  "message": "Transfer record deleted successfully",
  "petId": "6820000000000000000abc01",
  "transferId": "6820000000000000000def01",
  "requestId": "aws-lambda-request-id"
}
```

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petTransfer.errors.missingPetId` | `petId` path parameter absent |
| 400 | `petTransfer.errors.invalidPetId` | `petId` is not a valid MongoDB ObjectId |
| 400 | `petTransfer.errors.transfer.missingTransferId` | `transferId` path parameter absent |
| 400 | `petTransfer.errors.transfer.invalidTransferId` | `transferId` is not a valid MongoDB ObjectId |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller is not the pet owner or NGO owner |
| 404 | `petTransfer.errors.petNotFound` | Pet does not exist or is soft-deleted |
| 404 | `petTransfer.errors.transfer.notFound` | `$pull` matched no document — transfer record not found on this pet |
| 500 | `common.internalError` | Unexpected error |

---

### POST /pet/transfer/{petId}/ngo-reassignment

Transfer a pet from NGO ownership to a target individual user. The caller must have `userRole: ngo`. The target user is verified by both email **and** phone — both must exist and resolve to the same `User` document (anti-enumeration 404 if either is missing).

On success:
- `Pet.transferNGO[0]` is set with the submitted fields (overwrites index 0)
- `Pet.transfer[0]` is updated with the optional shared fields (overwrites index 0)
- `pet.userId` is set to the target user's `_id`
- `pet.ngoId` is cleared to `""`

**Lambda:** `pet-transfer`  
**Auth:** `x-api-key` + Bearer JWT required (caller `userRole` must be `ngo`)

#### Path Parameters

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId of the pet |

#### Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `UserEmail` | string | Yes | Email of the target user; trimmed and lowercased before lookup |
| `UserContact` | string | Yes | Phone of the target user; must be E.164 (e.g. `+85291234567`) |
| `regDate` | string | No | `DD/MM/YYYY` or ISO 8601 |
| `regPlace` | string | No | |
| `transferOwner` | string | No | |
| `transferContact` | string | No | |
| `transferRemark` | string | No | |
| `isTransferred` | boolean | No | Stored in `transferNGO[0]` only |

**Example request:**

```json
{
  "UserEmail": "adopter@example.com",
  "UserContact": "+85291234567",
  "regDate": "2024-03-01",
  "regPlace": "Mong Kok",
  "transferOwner": "Bob",
  "isTransferred": true
}
```

#### Success (200)

`form` is the Zod-parsed request body. Ownership has been reassigned at this point.

```json
{
  "success": true,
  "message": "NGO transfer completed successfully",
  "petId": "6820000000000000000abc01",
  "form": {
    "UserEmail": "adopter@example.com",
    "UserContact": "+85291234567",
    "regDate": "2024-03-01",
    "regPlace": "Mong Kok",
    "transferOwner": "Bob",
    "isTransferred": true
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petTransfer.errors.missingPetId` | `petId` path parameter absent |
| 400 | `petTransfer.errors.invalidPetId` | `petId` is not a valid MongoDB ObjectId |
| 400 | `common.missingParams` | Body is empty (`{}`, `null`, or absent) |
| 400 | `common.invalidBodyParams` | Malformed JSON body |
| 400 | `petTransfer.errors.ngoTransfer.missingRequiredFields` | `UserEmail` or `UserContact` absent or empty string |
| 400 | `petTransfer.errors.ngoTransfer.invalidEmailFormat` | `UserEmail` fails regex validation or exceeds 254 characters |
| 400 | `petTransfer.errors.ngoTransfer.invalidPhoneFormat` | `UserContact` is not E.164 format (must start with `+`) |
| 400 | `petTransfer.errors.ngoTransfer.invalidDateFormat` | `regDate` is not `DD/MM/YYYY` or ISO 8601 |
| 400 | `petTransfer.errors.ngoTransfer.userIdentityMismatch` | Email and phone resolve to different `User` documents |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller role is not `ngo`, or caller does not own the pet |
| 404 | `petTransfer.errors.petNotFound` | Pet does not exist or is soft-deleted |
| 404 | `petTransfer.errors.ngoTransfer.targetUserNotFound` | Target user not found by email or phone (generic — anti-enumeration) |
| 500 | `common.internalError` | Unexpected error |

---

## Frontend Integration Guide

### Typical flow — individual owner managing transfer history

```
1. POST /pet/transfer/{petId}
   → 201 { form, petId, transferId }  → store transferId for future PATCH or DELETE

2. PATCH /pet/transfer/{petId}/{transferId}
   → 200 { form, petId, transferId }  → form shows submitted fields only; refetch full record
                                         from a read endpoint if needed

3. DELETE /pet/transfer/{petId}/{transferId}
   → 200 { petId, transferId }        → record removed
```

### Typical flow — NGO reassigning pet to a user

```
1. POST /pet/transfer/{petId}/ngo-reassignment
   → 200 { form, petId }  → pet ownership transferred; pet.ngoId is now ""; pet.userId is the
                             target user's _id
   → 403 common.forbidden  → caller is not NGO, or does not own the pet
   → 404 targetUserNotFound → email or phone not found in User collection
   → 400 userIdentityMismatch → email and phone point to different accounts
```

### Branch conditions

| `errorKey` on POST `/ngo-reassignment` | Frontend action |
| --- | --- |
| `petTransfer.errors.ngoTransfer.missingRequiredFields` | Show field-level error: `UserEmail` and `UserContact` are required |
| `petTransfer.errors.ngoTransfer.invalidEmailFormat` | Show: "Invalid email address format" |
| `petTransfer.errors.ngoTransfer.invalidPhoneFormat` | Show: "Phone must be E.164 format (e.g. +85291234567)" |
| `petTransfer.errors.ngoTransfer.targetUserNotFound` | Show: "No account found with these contact details" — do not specify which field failed |
| `petTransfer.errors.ngoTransfer.userIdentityMismatch` | Show: "Email and phone do not belong to the same account" |

| `errorKey` on PATCH | Frontend action |
| --- | --- |
| `common.missingParams` | At least one field must be provided |
| `common.noFieldsToUpdate` | Body contained only unrecognized fields; check field names |
| `petTransfer.errors.transfer.notFound` | The transfer record no longer exists; refresh the list |

### Important notes for frontend

- `POST /pet/transfer/{petId}` accepts `{}` as a valid body — an empty transfer record is created. Submit a populated body only when the user has entered data.
- The `PATCH` response `form` contains only the fields submitted, not the full stored record. If a complete updated view is required, call a read endpoint after the PATCH succeeds.
- For NGO reassignment, both `UserEmail` and `UserContact` must be provided together. There is no partial lookup path.
- Phone numbers must include the country code prefix (`+852...`). Local formats without `+` will be rejected.

---

## Delta vs Legacy AWS\_API

The `pet-transfer` Lambda replaces the transfer and NGO-transfer routes previously housed in the legacy `PetDetailInfo` Lambda (`functions/PetDetailInfo/`).

| Aspect | Legacy (`PetDetailInfo`) | DDD (`pet-transfer`) |
| --- | --- | --- |
| Transfer create | `POST /pets/{petID}/detail-info/transfer` → 200 | `POST /pet/transfer/{petId}` → **201** |
| Transfer update | `PUT /pets/{petID}/detail-info/transfer/{transferId}` | `PATCH /pet/transfer/{petId}/{transferId}` (method changed) |
| NGO transfer | `PUT /pets/{petID}/detail-info/NGOtransfer` | `POST /pet/transfer/{petId}/ngo-reassignment` (method + path changed) |
| Error namespace | `petDetailInfo.errors.transferPath.*` | `petTransfer.errors.transfer.*` |
| NGO error namespace | `petDetailInfo.errors.ngoTransfer.*` | `petTransfer.errors.ngoTransfer.*` |
| Empty body on create | Not documented | Explicitly allowed; creates null-field record |
| Unknown fields | Rejected (strict schema) | **Silently stripped** |

---

## Error Key Reference

| `errorKey` | HTTP status | Meaning |
| --- | --- | --- |
| `petTransfer.errors.missingPetId` | 400 | `petId` path param absent |
| `petTransfer.errors.invalidPetId` | 400 | `petId` is not a valid MongoDB ObjectId |
| `petTransfer.errors.petNotFound` | 404 | Pet does not exist or is soft-deleted |
| `petTransfer.errors.transfer.missingTransferId` | 400 | `transferId` path param absent |
| `petTransfer.errors.transfer.invalidTransferId` | 400 | `transferId` is not a valid MongoDB ObjectId |
| `petTransfer.errors.transfer.notFound` | 404 | Transfer subdocument not found on this pet |
| `petTransfer.errors.transfer.invalidDateFormat` | 400 | `regDate` in POST/PATCH is not `DD/MM/YYYY` or ISO 8601 |
| `petTransfer.errors.ngoTransfer.missingRequiredFields` | 400 | `UserEmail` or `UserContact` absent or empty |
| `petTransfer.errors.ngoTransfer.invalidEmailFormat` | 400 | `UserEmail` fails regex or exceeds 254 chars |
| `petTransfer.errors.ngoTransfer.invalidPhoneFormat` | 400 | `UserContact` is not E.164 |
| `petTransfer.errors.ngoTransfer.invalidDateFormat` | 400 | `regDate` in NGO transfer is not `DD/MM/YYYY` or ISO 8601 |
| `petTransfer.errors.ngoTransfer.targetUserNotFound` | 404 | Target user not found by email or phone (anti-enumeration) |
| `petTransfer.errors.ngoTransfer.userIdentityMismatch` | 400 | Email and phone resolve to different users |
| `common.missingParams` | 400 | Empty body when one is required |
| `common.invalidBodyParams` | 400 | Malformed JSON body |
| `common.noFieldsToUpdate` | 400 | Valid body but all fields stripped (only unknown fields sent) |
| `common.forbidden` | 403 | Caller is not the pet owner/NGO owner, or role is not `ngo` |
| `common.unauthorized` | 401 | Missing or invalid Bearer token |
| `common.routeNotFound` | 404 | Path/method not registered in the Lambda router |
| `common.methodNotAllowed` | 405 | Known path but wrong HTTP method |
| `common.internalError` | 500 | Unhandled error |

<!-- markdownlint-disable MD024 -->
# Pet Medical API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Clinical record management for a pet across four sub-domains: general medical visits, medications, deworming, and blood tests. All endpoints are protected. Callers must be the pet owner or the NGO associated with the pet.

> Conventions: [README.md](../../api_docs/development/../../../AWS_API/dev_docs/api_docs/README.md)

---

## Overview

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/pet/medical/{petId}/general` | List general medical records |
| POST | `/pet/medical/{petId}/general` | Create a general medical record |
| PATCH | `/pet/medical/{petId}/general/{medicalId}` | Update a general medical record |
| DELETE | `/pet/medical/{petId}/general/{medicalId}` | Delete a general medical record |
| GET | `/pet/medical/{petId}/medication` | List medication records |
| POST | `/pet/medical/{petId}/medication` | Create a medication record |
| PATCH | `/pet/medical/{petId}/medication/{medicationId}` | Update a medication record |
| DELETE | `/pet/medical/{petId}/medication/{medicationId}` | Delete a medication record |
| GET | `/pet/medical/{petId}/deworming` | List deworming records |
| POST | `/pet/medical/{petId}/deworming` | Create a deworming record |
| PATCH | `/pet/medical/{petId}/deworming/{dewormId}` | Update a deworming record |
| DELETE | `/pet/medical/{petId}/deworming/{dewormId}` | Delete a deworming record |
| GET | `/pet/medical/{petId}/blood-test` | List blood test records |
| POST | `/pet/medical/{petId}/blood-test` | Create a blood test record |
| PATCH | `/pet/medical/{petId}/blood-test/{bloodTestId}` | Update a blood test record |
| DELETE | `/pet/medical/{petId}/blood-test/{bloodTestId}` | Delete a blood test record |

**Lambda:** `pet-medical`

---

## Integration-Critical Contract Notes

| Topic | Current DDD behavior |
| --- | --- |
| Route paths | Paths use `/pet/medical/{petId}/{sub-domain}`, not the legacy `/pets/{petID}/medical-record` etc. |
| HTTP methods | PATCH is used for updates. PUT is not wired. `PUT` requests will receive `403` or `405`. |
| All routes protected | Every route requires `x-api-key` + Bearer JWT. There are no public routes in this Lambda. |
| Pet sync counters | The DDD implementation does **not** increment `Pet.medicationRecordsCount`, `dewormRecordsCount`, `bloodTestRecordsCount`, or related fields on the Pet document. This is a deliberate delta from legacy behavior. |
| Strict body schema | All POST and PATCH bodies are validated with strict Zod schemas. Unknown fields cause `400`. |
| Date input | Accepts `DD/MM/YYYY`, `YYYY-MM-DD`, or full ISO 8601. Both date formats produce an ISO `Date` in the DB. |
| Date output | Stored dates are returned as ISO 8601 strings from MongoDB. |
| List response envelope | GET list responses wrap records inside `form.medical`, `form.medication`, `form.deworm`, or `form.blood_test` depending on sub-domain. |
| Create response | Returns `201` with `medicalRecordId` / `medicationRecordId` / `dewormRecordId` / `bloodTestRecordId` and a `form` object with the newly created record. |
| Update response | Returns `200` with the updated record in `form`. |
| Delete response | Returns `200`. No record body is returned — only `petId` and the record ID. |
| Sanitization | `__v`, `createdAt`, and `updatedAt` are stripped from all returned records. |

---

## API Gateway And Auth Rules

### API Gateway Requirements

All routes require a valid API Gateway API key.

| Route group | API key required | Authorizer |
| --- | --- | --- |
| All `GET`, `POST`, `PATCH`, `DELETE` routes | Yes | `DddTokenAuthorizer` |
| `OPTIONS` preflight routes | No | None |

Protected deployed requests must include:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
Content-Type: application/json
```

`OPTIONS` preflight requests return `204` with CORS headers and do not require `x-api-key`.

### Authorization and Ownership

All routes require a valid Bearer JWT. The Lambda authorizes access when either condition is met:

- `pet.userId === jwt.userId`
- `pet.ngoId === jwt.ngoId`

`admin` and `developer` roles are privileged and bypass ownership checks.

Auth failure behavior:

- Missing or invalid JWT: `401 common.unauthorized` (or `403` depending on API Gateway authorizer flow)
- JWT valid but caller does not own the pet: `403 common.forbidden`
- Pet not found or soft-deleted: `404 petMedicalRecord.errors.petNotFound`

### Localization

- Locale priority: `?lang` / `?locale` query param → `language` / `lang` cookie → `Accept-Language` header → default `en`
- `errorKey` is always stable and language-independent — use it for integration logic

### Rate Limits

Limits are per `userId`.

| Action | Limit | Window |
| --- | --- | --- |
| Create (any sub-domain) | 20 requests | 300 s |
| Update (any sub-domain) | 30 requests | 300 s |
| Delete (any sub-domain) | 10 requests | 60 s |

Exceeded limits return `429 common.rateLimited`.

---

## Shared Error Behavior

These apply to every endpoint in this Lambda.

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.invalidPetIdFormat` | `{petId}` path param is empty or not a valid MongoDB ObjectId |
| 401 / 403 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Valid token but caller is not the pet owner or NGO |
| 404 | `petMedicalRecord.errors.petNotFound` | Pet not found or has `deleted: true` |
| 429 | `common.rateLimited` | Rate limit exceeded |
| 500 | `common.internalError` | Unhandled server error — inspect CloudWatch by `requestId` |

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "petMedicalRecord.errors.petNotFound",
  "error": "Pet not found",
  "requestId": "abc123"
}
```

### Success Response Shape

```json
{
  "success": true,
  "message": "Pet medical record retrieved successfully",
  "form": { "...": "endpoint-specific" },
  "petId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

---

## General Medical Records

**Sub-resource:** `general` — MongoDB collection: `Medical_Records`

### GET `/pet/medical/{petId}/general`

List all general medical records for the specified pet.

**Auth:** Bearer JWT + pet ownership

**Path params:**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | MongoDB ObjectId string | Yes | |

**Success (200):**

```json
{
  "success": true,
  "message": "Pet medical record retrieved successfully",
  "form": {
    "medical": [
      {
        "_id": "665f1a2b3c4d5e6f7a8b9c0d",
        "medicalDate": "2024-06-15T00:00:00.000Z",
        "medicalPlace": "PetCare Hospital",
        "medicalDoctor": "Dr. Wong",
        "medicalResult": "Healthy",
        "medicalSolution": "Vitamins",
        "petId": "665f0000000000000000abcd"
      }
    ]
  },
  "petId": "665f0000000000000000abcd",
  "requestId": "abc123"
}
```

Empty list returns `200` with `form.medical: []`.

**Errors:** See [Shared Error Behavior](#shared-error-behavior).

---

### POST `/pet/medical/{petId}/general`

Create a general medical record.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 20 / 300 s per `userId`

**Path params:**

| Param | Type | Required |
| --- | --- | --- |
| `petId` | MongoDB ObjectId string | Yes |

**Request body** (`application/json`, all fields optional, strict — unknown fields rejected):

| Field | Type | Notes |
| --- | --- | --- |
| `medicalDate` | string | `DD/MM/YYYY` or ISO date |
| `medicalPlace` | string | |
| `medicalDoctor` | string | |
| `medicalResult` | string | |
| `medicalSolution` | string | |

```json
{
  "medicalDate": "15/06/2024",
  "medicalPlace": "PetCare Hospital",
  "medicalDoctor": "Dr. Wong",
  "medicalResult": "Healthy",
  "medicalSolution": "Vitamins"
}
```

**Success (201):**

```json
{
  "success": true,
  "message": "Pet medical record created successfully",
  "form": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "medicalDate": "2024-06-15T00:00:00.000Z",
    "medicalPlace": "PetCare Hospital",
    "medicalDoctor": "Dr. Wong",
    "medicalResult": "Healthy",
    "medicalSolution": "Vitamins",
    "petId": "665f0000000000000000abcd"
  },
  "petId": "665f0000000000000000abcd",
  "medicalRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.medicalRecord.invalidDateFormat` | `medicalDate` is not a valid date string |
| 400 | `common.invalidBodyParams` | Malformed JSON body, or unknown/extra fields (strict schema) |

---

### PATCH `/pet/medical/{petId}/general/{medicalId}`

Update an existing general medical record. Only provided fields are updated (partial update).

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 30 / 300 s per `userId`

**Path params:**

| Param | Type | Required |
| --- | --- | --- |
| `petId` | MongoDB ObjectId string | Yes |
| `medicalId` | MongoDB ObjectId string | Yes |

**Request body** (`application/json`, all fields optional, strict):

Same fields as POST.

**Success (200):**

```json
{
  "success": true,
  "message": "Pet medical record updated successfully",
  "petId": "665f0000000000000000abcd",
  "medicalRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "form": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "medicalDate": "2024-06-15T00:00:00.000Z",
    "medicalPlace": "Updated Clinic",
    "medicalDoctor": "Dr. Wong",
    "medicalResult": "Healthy",
    "medicalSolution": "Vitamins",
    "petId": "665f0000000000000000abcd"
  },
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.medicalRecord.invalidMedicalIdFormat` | `{medicalId}` is not a valid ObjectId |
| 400 | `petMedicalRecord.errors.medicalRecord.invalidDateFormat` | `medicalDate` is not a valid date string |
| 404 | `petMedicalRecord.errors.medicalRecord.notFound` | Record not found (wrong `medicalId` or wrong `petId`) |

---

### DELETE `/pet/medical/{petId}/general/{medicalId}`

Delete a general medical record.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 10 / 60 s per `userId`

**Path params:**

| Param | Type | Required |
| --- | --- | --- |
| `petId` | MongoDB ObjectId string | Yes |
| `medicalId` | MongoDB ObjectId string | Yes |

**Success (200):**

```json
{
  "success": true,
  "message": "Medical record deleted successfully",
  "petId": "665f0000000000000000abcd",
  "medicalRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.medicalRecord.invalidMedicalIdFormat` | `{medicalId}` is not a valid ObjectId |
| 404 | `petMedicalRecord.errors.medicalRecord.notFound` | Record not found |

---

## Medication Records

**Sub-resource:** `medication` — MongoDB collection: `Medication_Records`

### GET `/pet/medical/{petId}/medication`

List all medication records for the specified pet.

**Auth:** Bearer JWT + pet ownership

**Success (200):**

```json
{
  "success": true,
  "message": "Pet medication record retrieved successfully",
  "form": {
    "medication": [
      {
        "_id": "665f1a2b3c4d5e6f7a8b9c0d",
        "medicationDate": "2024-06-01T00:00:00.000Z",
        "drugName": "Apoquel",
        "drugPurpose": "Allergy relief",
        "drugMethod": "Oral",
        "drugRemark": "Once daily",
        "allergy": false,
        "petId": "665f0000000000000000abcd"
      }
    ]
  },
  "petId": "665f0000000000000000abcd",
  "requestId": "abc123"
}
```

---

### POST `/pet/medical/{petId}/medication`

Create a medication record.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 20 / 300 s per `userId`

**Request body** (`application/json`, all fields optional, strict):

| Field | Type | Notes |
| --- | --- | --- |
| `medicationDate` | string | `DD/MM/YYYY` or ISO date |
| `drugName` | string | |
| `drugPurpose` | string | |
| `drugMethod` | string | |
| `drugRemark` | string | |
| `allergy` | boolean | Defaults `false` if omitted |

**Success (201):**

```json
{
  "success": true,
  "message": "Pet medication record created successfully",
  "form": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "medicationDate": "2024-06-01T00:00:00.000Z",
    "drugName": "Apoquel",
    "drugPurpose": "Allergy relief",
    "drugMethod": "Oral",
    "drugRemark": "Once daily",
    "allergy": false,
    "petId": "665f0000000000000000abcd"
  },
  "petId": "665f0000000000000000abcd",
  "medicationRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.medicationRecord.invalidDateFormat` | `medicationDate` is not a valid date string |
| 400 | `common.invalidBodyParams` | Unknown or extra fields (strict schema) |

---

### PATCH `/pet/medical/{petId}/medication/{medicationId}`

Update a medication record. Partial update — only provided fields are changed.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 30 / 300 s per `userId`

**Request body:** Same fields as POST.

**Success (200):**

```json
{
  "success": true,
  "message": "Pet medication record updated successfully",
  "petId": "665f0000000000000000abcd",
  "medicationRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "form": { "...": "updated medication record" },
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.medicationRecord.invalidMedicationIdFormat` | `{medicationId}` is not a valid ObjectId |
| 400 | `petMedicalRecord.errors.medicationRecord.invalidDateFormat` | `medicationDate` is not a valid date string |
| 404 | `petMedicalRecord.errors.medicationRecord.notFound` | Record not found |

---

### DELETE `/pet/medical/{petId}/medication/{medicationId}`

Delete a medication record.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 10 / 60 s per `userId`

**Success (200):**

```json
{
  "success": true,
  "message": "Medication record deleted successfully",
  "petId": "665f0000000000000000abcd",
  "medicationRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.medicationRecord.invalidMedicationIdFormat` | `{medicationId}` is not a valid ObjectId |
| 404 | `petMedicalRecord.errors.medicationRecord.notFound` | Record not found |

---

## Deworming Records

**Sub-resource:** `deworming` — MongoDB collection: `Deworm_Records`

### GET `/pet/medical/{petId}/deworming`

List all deworming records for the specified pet.

**Auth:** Bearer JWT + pet ownership

**Success (200):**

```json
{
  "success": true,
  "message": "Pet deworm record retrieved successfully",
  "form": {
    "deworm": [
      {
        "_id": "665f1a2b3c4d5e6f7a8b9c0d",
        "date": "2024-03-01T00:00:00.000Z",
        "vaccineBrand": "NexGard",
        "vaccineType": "External",
        "typesOfInternalParasites": [],
        "typesOfExternalParasites": ["Fleas", "Ticks"],
        "frequency": 30,
        "nextDewormDate": "2024-04-01T00:00:00.000Z",
        "notification": true,
        "petId": "665f0000000000000000abcd"
      }
    ]
  },
  "petId": "665f0000000000000000abcd",
  "requestId": "abc123"
}
```

---

### POST `/pet/medical/{petId}/deworming`

Create a deworming record.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 20 / 300 s per `userId`

**Request body** (`application/json`, all fields optional, strict):

| Field | Type | Notes |
| --- | --- | --- |
| `date` | string | `DD/MM/YYYY` or ISO date |
| `vaccineBrand` | string | |
| `vaccineType` | string | |
| `typesOfInternalParasites` | string[] | |
| `typesOfExternalParasites` | string[] | |
| `frequency` | number | Interval in days |
| `nextDewormDate` | string | `DD/MM/YYYY` or ISO date |
| `notification` | boolean | Defaults `false` if omitted |

**Success (201):**

```json
{
  "success": true,
  "message": "Pet deworm record created successfully",
  "form": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "date": "2024-03-01T00:00:00.000Z",
    "vaccineBrand": "NexGard",
    "vaccineType": "External",
    "typesOfInternalParasites": [],
    "typesOfExternalParasites": ["Fleas", "Ticks"],
    "frequency": 30,
    "nextDewormDate": "2024-04-01T00:00:00.000Z",
    "notification": true,
    "petId": "665f0000000000000000abcd"
  },
  "petId": "665f0000000000000000abcd",
  "dewormRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.dewormRecord.invalidDateFormat` | `date` or `nextDewormDate` is not a valid date string |
| 400 | `common.invalidBodyParams` | Unknown or extra fields (strict schema) |

---

### PATCH `/pet/medical/{petId}/deworming/{dewormId}`

Update a deworming record. Partial update.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 30 / 300 s per `userId`

**Request body:** Same fields as POST.

**Success (200):**

```json
{
  "success": true,
  "message": "Pet deworm record updated successfully",
  "petId": "665f0000000000000000abcd",
  "dewormRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "form": { "...": "updated deworming record" },
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.dewormRecord.invalidDewormIdFormat` | `{dewormId}` is not a valid ObjectId |
| 400 | `petMedicalRecord.errors.dewormRecord.invalidDateFormat` | `date` or `nextDewormDate` invalid |
| 404 | `petMedicalRecord.errors.dewormRecord.notFound` | Record not found |

---

### DELETE `/pet/medical/{petId}/deworming/{dewormId}`

Delete a deworming record.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 10 / 60 s per `userId`

**Success (200):**

```json
{
  "success": true,
  "message": "Deworm record deleted successfully",
  "petId": "665f0000000000000000abcd",
  "dewormRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.dewormRecord.invalidDewormIdFormat` | `{dewormId}` is not a valid ObjectId |
| 404 | `petMedicalRecord.errors.dewormRecord.notFound` | Record not found |

---

## Blood Test Records

**Sub-resource:** `blood-test` — MongoDB collection: `blood_tests`

### GET `/pet/medical/{petId}/blood-test`

List all blood test records for the specified pet.

**Auth:** Bearer JWT + pet ownership

**Success (200):**

```json
{
  "success": true,
  "message": "Pet blood test records retrieved successfully",
  "form": {
    "blood_test": [
      {
        "_id": "665f1a2b3c4d5e6f7a8b9c0d",
        "bloodTestDate": "2024-05-10T00:00:00.000Z",
        "heartworm": "Negative",
        "lymeDisease": "Negative",
        "ehrlichiosis": "Negative",
        "anaplasmosis": "Negative",
        "babesiosis": "Negative",
        "petId": "665f0000000000000000abcd"
      }
    ]
  },
  "petId": "665f0000000000000000abcd",
  "requestId": "abc123"
}
```

---

### POST `/pet/medical/{petId}/blood-test`

Create a blood test record.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 20 / 300 s per `userId`

**Request body** (`application/json`, all fields optional, strict):

| Field | Type | Notes |
| --- | --- | --- |
| `bloodTestDate` | string | `DD/MM/YYYY` or ISO date |
| `heartworm` | string | Free-form result text |
| `lymeDisease` | string | |
| `ehrlichiosis` | string | |
| `anaplasmosis` | string | |
| `babesiosis` | string | |

**Success (201):**

```json
{
  "success": true,
  "message": "Blood test record created successfully",
  "form": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "bloodTestDate": "2024-05-10T00:00:00.000Z",
    "heartworm": "Negative",
    "lymeDisease": "Negative",
    "ehrlichiosis": "Negative",
    "anaplasmosis": "Negative",
    "babesiosis": "Negative",
    "petId": "665f0000000000000000abcd"
  },
  "petId": "665f0000000000000000abcd",
  "bloodTestRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.bloodTest.invalidDateFormat` | `bloodTestDate` is not a valid date string |
| 400 | `common.invalidBodyParams` | Unknown or extra fields (strict schema) |

---

### PATCH `/pet/medical/{petId}/blood-test/{bloodTestId}`

Update a blood test record. Partial update.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 30 / 300 s per `userId`

**Request body:** Same fields as POST.

**Success (200):**

```json
{
  "success": true,
  "message": "Blood test record updated successfully",
  "petId": "665f0000000000000000abcd",
  "bloodTestRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "form": { "...": "updated blood test record" },
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.bloodTest.invalidBloodTestIdFormat` | `{bloodTestId}` is not a valid ObjectId |
| 400 | `petMedicalRecord.errors.bloodTest.invalidDateFormat` | `bloodTestDate` invalid |
| 404 | `petMedicalRecord.errors.bloodTest.notFound` | Record not found |

---

### DELETE `/pet/medical/{petId}/blood-test/{bloodTestId}`

Delete a blood test record.

**Auth:** Bearer JWT + pet ownership  
**Rate limit:** 10 / 60 s per `userId`

**Success (200):**

```json
{
  "success": true,
  "message": "Blood test record deleted successfully",
  "petId": "665f0000000000000000abcd",
  "bloodTestRecordId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "abc123"
}
```

**Domain errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `petMedicalRecord.errors.bloodTest.invalidBloodTestIdFormat` | `{bloodTestId}` is not a valid ObjectId |
| 404 | `petMedicalRecord.errors.bloodTest.notFound` | Record not found |

---

## Frontend Integration Guide

### Standard CRUD Pattern

All four sub-domains follow the same pattern:

1. **GET** the list — use `form.medical` / `form.medication` / `form.deworm` / `form.blood_test` from the response
2. **POST** to create — save `medicalRecordId` / `medicationRecordId` / `dewormRecordId` / `bloodTestRecordId` from the response
3. **PATCH** to update — pass the saved record ID in the path, send only changed fields
4. **DELETE** to remove — pass the saved record ID in the path

### Ownership Enforcement

The frontend must always pass both `petId` and the Bearer JWT. The backend enforces ownership — sending a `petId` the caller does not own returns `403 common.forbidden`.

### Date Fields

- Send dates as `DD/MM/YYYY` (e.g., `"15/06/2024"`) or ISO format (e.g., `"2024-06-15"`)
- Received dates are ISO strings — parse them with `new Date(value)` or your preferred library

### Handling Partial Records

All body fields are optional. You can POST with only one field (e.g., `{ "medicalPlace": "Clinic A" }`) and it will create a record with only that field populated and others as `null`.

### Rate Limit Handling

If you receive `429 common.rateLimited`, back off and retry after the window. Display a user-facing message — do not silently retry in a tight loop.

---

## Contract Deltas from Legacy (`AWS_API`)

| Topic | Legacy (`PetMedicalRecord` Lambda) | DDD (`pet-medical` Lambda) |
| --- | --- | --- |
| Base path | `/pets/{petID}/medical-record` | `/pet/medical/{petId}/general` |
| Update method | `PUT` | `PATCH` |
| Pet stat sync | POST updates `Pet.medicationRecordsCount`, `dewormRecordsCount`, `bloodTestRecordsCount`, `latestDewormDate`, `latestBloodTestDate` | **Not implemented.** These fields are not updated by this Lambda. |
| Blood test path | `/v2/pets/{petID}/blood-test-record` | `/pet/medical/{petId}/blood-test` |
| Unknown field behavior | Varies | Strict Zod — `400 common.invalidBodyParams` |

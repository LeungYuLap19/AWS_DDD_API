# Pet Medical API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-pet-medical`

Medical record management for pets across four sub-domains:

- general medical records
- medication records
- deworming records
- blood test records

All routes in this document require `x-api-key` and a Bearer JWT. The current DDD implementation uses the shared `{ success, message, data, pagination?, requestId }` envelope. Older docs that describe `form.medical`, `form.medication`, or delete responses with record ids are stale.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/pet/medical/{petId}/general` | `x-api-key` + Bearer JWT | List general medical records |
| POST | `/pet/medical/{petId}/general` | `x-api-key` + Bearer JWT | Create general medical record |
| PATCH | `/pet/medical/{petId}/general/{medicalId}` | `x-api-key` + Bearer JWT | Update general medical record |
| DELETE | `/pet/medical/{petId}/general/{medicalId}` | `x-api-key` + Bearer JWT | Delete general medical record |
| GET | `/pet/medical/{petId}/medication` | `x-api-key` + Bearer JWT | List medication records |
| POST | `/pet/medical/{petId}/medication` | `x-api-key` + Bearer JWT | Create medication record |
| PATCH | `/pet/medical/{petId}/medication/{medicationId}` | `x-api-key` + Bearer JWT | Update medication record |
| DELETE | `/pet/medical/{petId}/medication/{medicationId}` | `x-api-key` + Bearer JWT | Delete medication record |
| GET | `/pet/medical/{petId}/deworming` | `x-api-key` + Bearer JWT | List deworming records |
| POST | `/pet/medical/{petId}/deworming` | `x-api-key` + Bearer JWT | Create deworming record |
| PATCH | `/pet/medical/{petId}/deworming/{dewormId}` | `x-api-key` + Bearer JWT | Update deworming record |
| DELETE | `/pet/medical/{petId}/deworming/{dewormId}` | `x-api-key` + Bearer JWT | Delete deworming record |
| GET | `/pet/medical/{petId}/blood-test` | `x-api-key` + Bearer JWT | List blood test records |
| POST | `/pet/medical/{petId}/blood-test` | `x-api-key` + Bearer JWT | Create blood test record |
| PATCH | `/pet/medical/{petId}/blood-test/{bloodTestId}` | `x-api-key` + Bearer JWT | Update blood test record |
| DELETE | `/pet/medical/{petId}/blood-test/{bloodTestId}` | `x-api-key` + Bearer JWT | Delete blood test record |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Shared CRUD pattern | All four sub-domains use the same list/create/update/delete contract shape |
| List response | Every GET list route returns `data: Record[]` plus `pagination` |
| Create response | Every POST route returns the created record in `data` |
| Update response | Every PATCH route returns the updated record in `data` |
| Delete response | Every DELETE route returns success metadata only, with no `data` |
| Record sanitization | `__v`, `createdAt`, and `updatedAt` are stripped before records are returned |
| Strict schemas | All POST and PATCH bodies are strict; extra fields are rejected with `common.invalidBodyParams` |
| Date validation | Date strings are validated separately after body parsing; invalid values return sub-domain-specific `invalidDateFormat` keys |

---

## API Gateway And Auth Rules

### API Gateway Requirements

All `pet-medical` routes inherit the API-key requirement and token authorizer.

| Route group | API key required at API Gateway | API Gateway authorizer |
| --- | --- | --- |
| All GET / POST / PATCH / DELETE `pet-medical` routes | Yes | `DddTokenAuthorizer` |
| All `OPTIONS` `pet-medical` routes | No | None |

Protected deployed requests must send:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
```

POST and PATCH requests must also send:

```http
Content-Type: application/json
```

### Authorization Rules

The handler loads the target pet and authorizes the caller when either condition is true:

- `pet.userId === jwt.userId`
- `pet.ngoId === jwt.ngoId`

If `{petId}` is missing or invalid, the route returns `400 common.invalidObjectId`.

If the pet does not exist or is soft-deleted, the route returns `404 petMedical.errors.petNotFound`.

If the pet exists but the caller does not own it, the route returns `403 common.forbidden`.

### Rate Limits

| Action | Policy |
| --- | --- |
| Create any medical record | IP 60 / 300s, identifier 30 / 300s, IP+identifier 20 / 300s |
| Update any medical record | IP 90 / 300s, identifier 45 / 300s, IP+identifier 30 / 300s |
| Delete any medical record | IP 30 / 60s, identifier 15 / 60s, IP+identifier 10 / 60s |

Rate-limit failures return `429 common.rateLimited`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale is `en`
- Use `errorKey` for integration logic

### Request Body Validation

All POST and PATCH routes use the shared `parseBody` helper with strict Zod schemas.

Current shared behavior:

| Condition | `errorKey` |
| --- | --- |
| Malformed JSON body | `common.invalidBodyParams` |
| Missing body, `null`, or empty object `{}` | `common.missingBodyParams` |
| Unknown field supplied | `common.invalidBodyParams` |
| Wrong field type or schema violation without a more specific field key | `common.invalidBodyParams` |

After body parsing succeeds, each sub-domain validates its date fields separately and returns the corresponding sub-domain-specific `invalidDateFormat` key when needed.

---

## Success And Error Conventions

### Success Response Shape

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

Create success:

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "petId": "665f0000000000000000abcd"
  },
  "requestId": "aws-lambda-request-id"
}
```

Update success:

```json
{
  "success": true,
  "message": "Updated successfully",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "petId": "665f0000000000000000abcd"
  },
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
  "errorKey": "petMedical.errors.medicalRecord.notFound",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

### Shared Query Parameters

All list routes use shared pagination query validation.

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Shared pagination schema |
| `limit` | integer | No | Shared pagination schema |

Invalid pagination values return `400 common.invalidQueryParams`.

---

## Record Shapes

### General Medical Record Shape

- `_id`
- `medicalDate`
- `medicalPlace`
- `medicalDoctor`
- `medicalResult`
- `medicalSolution`
- `petId`

### Medication Record Shape

- `_id`
- `medicationDate`
- `drugName`
- `drugPurpose`
- `drugMethod`
- `drugRemark`
- `allergy`
- `petId`

### Deworm Record Shape

- `_id`
- `date`
- `vaccineBrand`
- `vaccineType`
- `typesOfInternalParasites`
- `typesOfExternalParasites`
- `frequency`
- `nextDewormDate`
- `notification`
- `petId`

### Blood Test Record Shape

- `_id`
- `bloodTestDate`
- `heartworm`
- `lymeDisease`
- `ehrlichiosis`
- `anaplasmosis`
- `babesiosis`
- `petId`

---

## General Medical Records

### GET /pet/medical/{petId}/general

List general medical records.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required

#### General List Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` |
| 400 | `common.invalidQueryParams` | Invalid pagination query |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 500 | `common.internalError` | Unexpected internal error |

### POST /pet/medical/{petId}/general

Create a general medical record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### General Create Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `medicalDate` | string | No | Flexible date string |
| `medicalPlace` | string | No | Max 200 chars |
| `medicalDoctor` | string | No | Max 100 chars |
| `medicalResult` | string | No | Max 2000 chars |
| `medicalSolution` | string | No | Max 2000 chars |

#### General Create Example Request

```json
{
  "medicalDate": "2024-06-15",
  "medicalPlace": "PetCare Hospital",
  "medicalDoctor": "Dr. Wong",
  "medicalResult": "Healthy",
  "medicalSolution": "Vitamins"
}
```

#### General Create Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petMedical.errors.medicalRecord.invalidDateFormat` | Invalid `medicalDate` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 429 | `common.rateLimited` | Create rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### PATCH /pet/medical/{petId}/general/{medicalId}

Update a general medical record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### General Update Request Body

Any subset of the general medical create fields may be supplied.

#### General Update Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` or `{medicalId}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petMedical.errors.medicalRecord.invalidDateFormat` | Invalid `medicalDate` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petMedical.errors.medicalRecord.notFound` | Record does not exist for that pet |
| 429 | `common.rateLimited` | Update rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### DELETE /pet/medical/{petId}/general/{medicalId}

Delete a general medical record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required

#### General Delete Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` or `{medicalId}` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petMedical.errors.medicalRecord.notFound` | Record does not exist for that pet |
| 429 | `common.rateLimited` | Delete rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Medication Records

### GET /pet/medical/{petId}/medication

List medication records.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required

### POST /pet/medical/{petId}/medication

Create a medication record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Medication Create Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `medicationDate` | string | No | Flexible date string |
| `drugName` | string | No | Max 200 chars |
| `drugPurpose` | string | No | Max 500 chars |
| `drugMethod` | string | No | Max 500 chars |
| `drugRemark` | string | No | Max 2000 chars |
| `allergy` | boolean | No | Defaults to `false` on create when omitted |

#### Medication Create Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petMedical.errors.medicationRecord.invalidDateFormat` | Invalid `medicationDate` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 429 | `common.rateLimited` | Create rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### PATCH /pet/medical/{petId}/medication/{medicationId}

Update a medication record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Medication Update Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` or `{medicationId}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petMedical.errors.medicationRecord.invalidDateFormat` | Invalid `medicationDate` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petMedical.errors.medicationRecord.notFound` | Record does not exist for that pet |
| 429 | `common.rateLimited` | Update rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### DELETE /pet/medical/{petId}/medication/{medicationId}

Delete a medication record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required

#### Medication Delete Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` or `{medicationId}` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petMedical.errors.medicationRecord.notFound` | Record does not exist for that pet |
| 429 | `common.rateLimited` | Delete rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Deworming Records

### GET /pet/medical/{petId}/deworming

List deworming records.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required

### POST /pet/medical/{petId}/deworming

Create a deworming record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Deworming Create Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `date` | string | No | Flexible date string |
| `vaccineBrand` | string | No | Max 100 chars |
| `vaccineType` | string | No | Max 100 chars |
| `typesOfInternalParasites` | string[] | No | Max 50 items |
| `typesOfExternalParasites` | string[] | No | Max 50 items |
| `frequency` | integer | No | 0 to 3650 |
| `nextDewormDate` | string | No | Flexible date string |
| `notification` | boolean | No | Defaults to `false` on create when omitted |

#### Deworming Create Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petMedical.errors.dewormRecord.invalidDateFormat` | Invalid `date` or `nextDewormDate` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 429 | `common.rateLimited` | Create rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### PATCH /pet/medical/{petId}/deworming/{dewormId}

Update a deworming record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Deworming Update Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` or `{dewormId}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petMedical.errors.dewormRecord.invalidDateFormat` | Invalid `date` or `nextDewormDate` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petMedical.errors.dewormRecord.notFound` | Record does not exist for that pet |
| 429 | `common.rateLimited` | Update rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### DELETE /pet/medical/{petId}/deworming/{dewormId}

Delete a deworming record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required

#### Deworming Delete Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` or `{dewormId}` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petMedical.errors.dewormRecord.notFound` | Record does not exist for that pet |
| 429 | `common.rateLimited` | Delete rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Blood Test Records

### GET /pet/medical/{petId}/blood-test

List blood test records.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required

### POST /pet/medical/{petId}/blood-test

Create a blood test record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Blood Test Create Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `bloodTestDate` | string | No | Flexible date string |
| `heartworm` | string | No | Max 50 chars |
| `lymeDisease` | string | No | Max 50 chars |
| `ehrlichiosis` | string | No | Max 50 chars |
| `anaplasmosis` | string | No | Max 50 chars |
| `babesiosis` | string | No | Max 50 chars |

#### Blood Test Create Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petMedical.errors.bloodTest.invalidDateFormat` | Invalid `bloodTestDate` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 429 | `common.rateLimited` | Create rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### PATCH /pet/medical/{petId}/blood-test/{bloodTestId}

Update a blood test record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Blood Test Update Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` or `{bloodTestId}` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `petMedical.errors.bloodTest.invalidDateFormat` | Invalid `bloodTestDate` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petMedical.errors.bloodTest.notFound` | Record does not exist for that pet |
| 429 | `common.rateLimited` | Update rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### DELETE /pet/medical/{petId}/blood-test/{bloodTestId}

Delete a blood test record.

**Lambda owner:** `pet-medical`  
**Auth:** `x-api-key` + Bearer JWT required

#### Blood Test Delete Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `{petId}` or `{bloodTestId}` |
| 403 | `common.forbidden` | Caller does not own the pet |
| 404 | `petMedical.errors.petNotFound` | Pet does not exist or is deleted |
| 404 | `petMedical.errors.bloodTest.notFound` | Record does not exist for that pet |
| 429 | `common.rateLimited` | Delete rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Frontend Integration Guide

1. Treat all four medical sub-domains as separate resource lists under the same authorization model.
2. Read lists from `data` and paginator state from `pagination`; do not rely on old `form.medical` or `form.medication` wrappers.
3. After create or update, replace the edited row with the returned `data` record because the backend already returns the sanitized document.
4. After delete, remove the row locally; the backend returns no `data` payload.
5. Validate date fields client-side when possible, but still branch on the sub-domain-specific `invalidDateFormat` keys.

---

## Verification Snapshot

This document is grounded in the current handlers in `functions/pet-medical/src/services/medical.ts`, `medication.ts`, `deworming.ts`, and `bloodTest.ts`, the shared auth/sanitize helpers, and the current Zod schemas under `functions/pet-medical/src/zodSchema`. The active Tier 2 suite also evidences current keys such as `petMedical.errors.petNotFound` and `petMedical.errors.medicalRecord.invalidDateFormat`.

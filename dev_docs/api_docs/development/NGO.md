# NGO Admin API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Protected NGO self-service and NGO member-management endpoints owned by the `ngo` Lambda. For NGO registration and NGO login, see [AUTH.md](./AUTH.md).

## Overview

| Method | Path | Auth | Lambda | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/ngo/me` | `x-api-key` + Bearer JWT (`role: ngo`, `ngoId` required) | `ngo` | Return current NGO, NGO access, NGO counter, and caller user profile |
| PATCH | `/ngo/me` | `x-api-key` + Bearer JWT (`role: ngo`, `ngoId` required) | `ngo` | Update current NGO-owned profile sections |
| GET | `/ngo/me/members` | `x-api-key` + Bearer JWT (`role: ngo`, `ngoId` required) | `ngo` | Return paginated NGO member list |

## API Gateway And Auth Rules

### API Gateway Requirements

`/ngo/*` routes inherit the API's default authorizer and API-key requirement.

| Route group | API key required at API Gateway | API Gateway authorizer |
| --- | --- | --- |
| `/ngo/*` routes in this doc | Yes | `DddTokenAuthorizer` |

Required deployed headers:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
```

For JSON body requests such as `PATCH /ngo/me`, also send:

```http
Content-Type: application/json
```

`OPTIONS` preflight for `/ngo/me` and `/ngo/me/members` does not require `x-api-key`.

Browser integration note:

- Current Lambda CORS preflight responses advertise `Content-Type,Authorization,X-Request-Id,x-api-key`
- Cross-origin browser requests can therefore send `x-api-key`, subject to normal origin allowlisting

### Authorization Rules

These routes require an auth context with:

- `userRole === "ngo"`
- `ngoId` present in JWT

Additional backend checks then enforce:

- the NGO record must exist
- the NGO record must be `isActive: true`
- the NGO record must be `isVerified: true`
- the caller must have an active `NgoUserAccess` row for that `ngoId`

Failures on these checks return:

- `404 ngo.errors.notFound` if NGO record does not exist
- `403 common.unauthorized` for role mismatch, missing `ngoId`, inactive NGO, unverified NGO, or missing active NGO access

Auth failure note:

- In direct Lambda execution and local handler tests, missing auth context becomes `401 common.unauthorized`
- In deployed API Gateway flows, an authorizer denial may surface as `401` or `403` before Lambda code runs

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "ngo.errors.registrationNumberExists",
  "error": "Business registration number already exists",
  "requestId": "aws-lambda-request-id"
}
```

### Request Body Validation

JSON-body routes in this doc (`PATCH /ngo/me`) run their decoded body through the shared `parseBody` helper before any business logic.

The helper returns these standardized `400` `errorKey`s:

| Condition | `errorKey` |
| --- | --- |
| Body is not valid JSON (raw string survives parsing) | `common.invalidBodyParams` |
| Zod schema rejected the body and the first issue message is a dotted i18n key | that key |
| Zod schema rejected the body and no issue message is a dotted key | `common.invalidBodyParams` |

`PATCH /ngo/me` schemas use `common.invalidBodyParams` for all field-level validation messages, so failed Zod validation surfaces as `400 common.invalidBodyParams`. Mongoose `ValidationError` thrown later during the transactional update is also normalized to the same key.

Deployed API Gateway may also reject malformed or non-object JSON before Lambda runs with its own `400`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale is `en`
- Success messages like `success.updated` and `common.noFieldsToUpdate` are translated before returning JSON

## Endpoints

### GET /ngo/me

Return the caller's current NGO management payload.

**Lambda:** `ngo`  
**Auth:** `x-api-key` + Bearer JWT required, caller must be NGO-scoped

**Response sections**

| Field | Type | Notes |
| --- | --- | --- |
| `userProfile` | object or `null` | Sanitized caller user document |
| `ngoProfile` | object | Sanitized authorized NGO document |
| `ngoUserAccessProfile` | object | Sanitized active access document for caller and NGO |
| `ngoCounters` | object or `null` | Sanitized NGO counter record when found |
| `warnings` | object | Partial-success metadata for non-critical section failures |

Sanitization rules:

- `userProfile` strips `password`, `deleted`, `credit`, `vetCredit`, `eyeAnalysisCredit`, `bloodAnalysisCredit`, `__v`, `createdAt`, `updatedAt`
- `ngoProfile` strips `__v`, `createdAt`, `updatedAt`
- `ngoUserAccessProfile` strips `__v`, `createdAt`, `updatedAt`
- `ngoCounters` strips `__v`, `createdAt`, `updatedAt`

`warnings` shape:

- `warnings.userProfile`: `null` or `ngo.warnings.temporarilyUnavailable`
- `warnings.ngoCounters`: `null` or `ngo.warnings.temporarilyUnavailable`

`warnings` is only used for non-fatal partial section failures. Auth-critical sections are not degraded into warnings.

**Success (200)**

```json
{
  "success": true,
  "userProfile": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "firstName": "Ada",
    "lastName": "Wong",
    "email": "admin@helpingpaws.org",
    "phoneNumber": "+85291234567",
    "role": "ngo"
  },
  "ngoProfile": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0e",
    "name": "Helping Paws",
    "description": "Animal rescue NGO",
    "email": "admin@helpingpaws.org",
    "phone": "+85291234567",
    "website": "https://helpingpaws.org",
    "registrationNumber": "BR-12345",
    "isVerified": true,
    "isActive": true
  },
  "ngoUserAccessProfile": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0f",
    "ngoId": "665f1a2b3c4d5e6f7a8b9c0e",
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "roleInNgo": "admin",
    "assignedPetIds": [],
    "menuConfig": {},
    "isActive": true
  },
  "ngoCounters": {
    "_id": "665f1a2b3c4d5e6f7a8b9c10",
    "ngoId": "665f1a2b3c4d5e6f7a8b9c0e",
    "counterType": "ngopet",
    "ngoPrefix": "HP",
    "seq": 42
  },
  "warnings": {
    "userProfile": null,
    "ngoCounters": null
  },
  "requestId": "aws-lambda-request-id"
}
```

**Success: partial section warning (200)**

```json
{
  "success": true,
  "userProfile": null,
  "ngoProfile": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0e",
    "name": "Helping Paws",
    "description": "Animal rescue NGO",
    "email": "admin@helpingpaws.org",
    "phone": "+85291234567",
    "website": "https://helpingpaws.org",
    "registrationNumber": "BR-12345",
    "isVerified": true,
    "isActive": true
  },
  "ngoUserAccessProfile": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0f",
    "ngoId": "665f1a2b3c4d5e6f7a8b9c0e",
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "roleInNgo": "admin",
    "assignedPetIds": [],
    "menuConfig": {},
    "isActive": true
  },
  "ngoCounters": {
    "_id": "665f1a2b3c4d5e6f7a8b9c10",
    "ngoId": "665f1a2b3c4d5e6f7a8b9c0e",
    "counterType": "ngopet",
    "ngoPrefix": "HP",
    "seq": 42
  },
  "warnings": {
    "userProfile": "ngo.warnings.temporarilyUnavailable",
    "ngoCounters": null
  },
  "requestId": "aws-lambda-request-id"
}
```

**Behavior notes**

- `ngoProfile` and `ngoUserAccessProfile` are authorization-critical; failure there does not degrade to partial success
- `userProfile` and `ngoCounters` are fetched with `Promise.allSettled`, so non-fatal section failures can be surfaced in `warnings` while still returning `200`
- `userProfile`, `ngoProfile`, `ngoUserAccessProfile`, and `ngoCounters` are sanitized before being returned

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.unauthorized` | Non-NGO token, missing `ngoId`, inactive NGO, unverified NGO, or no active NGO access |
| 404 | `ngo.errors.notFound` | NGO record missing |
| 500 | `common.internalError` | Unexpected error |

### PATCH /ngo/me

Update one or more NGO-owned profile sections in a single MongoDB transaction.

**Lambda:** `ngo`  
**Auth:** `x-api-key` + Bearer JWT required, caller must be NGO-scoped

Deployment note:

- This route has an API Gateway request model (`type: object`) in SAM
- On deployed API Gateway, malformed JSON or non-object JSON can be rejected before Lambda with an API Gateway-generated `400`

**Body sections**

All top-level sections are optional. Unknown fields are ignored after allowlist filtering.

```json
{
  "userProfile": {
    "firstName": "Ada",
    "lastName": "Wong",
    "email": "admin@helpingpaws.org",
    "phoneNumber": "+85291234567",
    "gender": "female"
  },
  "ngoProfile": {
    "name": "Helping Paws",
    "description": "Animal rescue NGO",
    "registrationNumber": "BR-12345",
    "email": "contact@helpingpaws.org",
    "website": "https://helpingpaws.org",
    "address": {
      "street": "1 Example Street",
      "city": "Hong Kong",
      "state": "",
      "zipCode": "",
      "country": "HK"
    },
    "petPlacementOptions": [
      {
        "name": "Adoption",
        "positions": ["home-check", "follow-up"]
      }
    ]
  },
  "ngoCounters": {
    "ngoPrefix": "HP",
    "seq": 43
  },
  "ngoUserAccessProfile": {
    "roleInNgo": "admin",
    "menuConfig": {
      "canViewPetList": true,
      "canEditPetDetails": true,
      "canManageAdoptions": true,
      "canAccessFosterLog": true,
      "canViewReports": true,
      "canManageUsers": true,
      "canManageNgoSettings": true
    }
  }
}
```

**Allowlisted fields**

| Section | Allowed fields |
| --- | --- |
| `userProfile` | `firstName`, `lastName`, `email`, `phoneNumber`, `gender` |
| `ngoProfile` | `name`, `description`, `registrationNumber`, `email`, `website`, `address.street`, `address.city`, `address.state`, `address.zipCode`, `address.country`, `petPlacementOptions` |
| `ngoCounters` | `ngoPrefix`, `seq` |
| `ngoUserAccessProfile` | `roleInNgo`, `menuConfig.canViewPetList`, `menuConfig.canEditPetDetails`, `menuConfig.canManageAdoptions`, `menuConfig.canAccessFosterLog`, `menuConfig.canViewReports`, `menuConfig.canManageUsers`, `menuConfig.canManageNgoSettings` |

**Admin-only rule**

If the caller is not NGO admin (`roleInNgo !== "admin"`), they may only update `userProfile`. Any attempt to update `ngoProfile`, `ngoCounters`, or `ngoUserAccessProfile` returns `403 common.unauthorized`.

**Conflict checks**

- `userProfile.email` must be unique among active users excluding caller
- `userProfile.phoneNumber` must be unique among active users excluding caller
- `ngoProfile.registrationNumber` must be unique among NGOs excluding current NGO

**Success: no effective updates (200)**

```json
{
  "success": true,
  "message": "No fields provided to update",
  "requestId": "aws-lambda-request-id"
}
```

**Success: updated sections (200)**

```json
{
  "success": true,
  "message": "Updated successfully",
  "updated": ["userProfile", "ngoProfile"],
  "data": {
    "userProfile": {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "firstName": "Ada",
      "lastName": "Wong",
      "email": "admin@helpingpaws.org"
    },
    "ngoProfile": {
      "_id": "665f1a2b3c4d5e6f7a8b9c0e",
      "name": "Helping Paws",
      "registrationNumber": "BR-12345"
    }
  },
  "requestId": "aws-lambda-request-id"
}
```

**Behavior notes**

- The handler flattens nested objects to dot paths, filters to allowlists, then updates each section transactionally
- If `ngoUserAccessProfile` update is requested but the active access row cannot be updated, the transaction is aborted and the route returns `403 common.unauthorized`
- Mongoose `ValidationError` is normalized to `400 common.invalidBodyParams`
- Any returned `userProfile`, `ngoProfile`, `ngoUserAccessProfile`, and `ngoCounters` objects in `data` are sanitized before being returned

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Body failed Zod or Mongoose validation |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts; local handler normalization is `401` |
| 403 | `common.unauthorized` | Non-NGO token, missing `ngoId`, inactive/unverified NGO, missing active access, or non-admin editing admin-only sections |
| 404 | `ngo.errors.notFound` | NGO record missing |
| 409 | `ngo.errors.emailExists` | Duplicate active user email |
| 409 | `ngo.errors.phoneExists` | Duplicate active user phone |
| 409 | `ngo.errors.registrationNumberExists` | Duplicate NGO registration number |
| 500 | `common.internalError` | Unexpected error or transaction failure |

### GET /ngo/me/members

Return paginated NGO member records for the caller's NGO.

**Lambda:** `ngo`  
**Auth:** `x-api-key` + Bearer JWT required, caller must be NGO-scoped

**Query params**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `search` | string | No | Case-insensitive regex search against `user.firstName`, `user.lastName`, `ngo.name`, `ngo.registrationNumber` |
| `page` | number | No | 1-indexed, minimum `1`, default `1` |

Fixed page size is `50`.

**Success (200)**

```json
{
  "success": true,
  "userList": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "firstName": "Ada",
      "lastName": "Wong",
      "email": "admin@helpingpaws.org",
      "role": "ngo",
      "ngoName": "Helping Paws",
      "ngoId": "665f1a2b3c4d5e6f7a8b9c0e",
      "ngoPrefix": "HP",
      "sequence": "42"
    }
  ],
  "totalPages": 1,
  "totalDocs": 1,
  "requestId": "aws-lambda-request-id"
}
```

**Behavior notes**

- Only active `NgoUserAccess` rows are included
- Joined users must be `deleted: false`
- `sequence` is returned as a string
- If no `NgoCounters` row exists, `ngoPrefix` and `sequence` become empty strings

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts; local handler normalization is `401` |
| 403 | `common.unauthorized` | Non-NGO token, missing `ngoId`, inactive/unverified NGO, or missing active NGO access |
| 404 | `ngo.errors.notFound` | NGO record missing |
| 500 | `common.internalError` | Unexpected error |

## Frontend Integration Guide

### NGO Dashboard Bootstrap

Call `GET /ngo/me` after NGO login or refresh to hydrate:

- caller user profile
- NGO profile
- access permissions
- NGO counters

The `warnings` object is section-specific partial-success metadata. Frontend should not treat non-null `warnings.userProfile` or `warnings.ngoCounters` as auth failure by themselves if the response status is still `200`.

### NGO Profile Editing

Send only the sections being changed to `PATCH /ngo/me`. Branch on these `errorKey` values for conflict handling:

- `ngo.errors.emailExists`
- `ngo.errors.phoneExists`
- `ngo.errors.registrationNumberExists`

### NGO Member List

Use `GET /ngo/me/members?page=<n>&search=<term>` for the management grid. The backend currently returns only `totalDocs` and `totalPages`; it does not echo `page` or `limit`.

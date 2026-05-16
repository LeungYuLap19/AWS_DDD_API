# NGO API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-ngo`

Protected NGO self-service endpoints for the current NGO-scoped caller. These routes serve NGO dashboard/profile needs and member-list retrieval. All payloads use the post-migration `data` envelope.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/ngo/me` | `x-api-key` + Bearer JWT with `userRole=ngo` and `ngoId` | Return current NGO dashboard/profile payload |
| PATCH | `/ngo/me` | `x-api-key` + Bearer JWT with `userRole=ngo` and `ngoId` | Update allowed user, NGO, counter, and access sections |
| GET | `/ngo/me/members` | `x-api-key` + Bearer JWT with `userRole=ngo` and `ngoId` | Return paginated NGO member list |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| GET wrapper | `/ngo/me` returns one composite object inside `data` |
| Partial section failures | `/ngo/me` can still return `200` with `warnings.userProfile` or `warnings.ngoCounters` set to `ngo.warnings.temporarilyUnavailable` |
| PATCH permission split | Non-admin NGO users can update `userProfile` only; NGO/admin sections require `roleInNgo === admin` |
| PATCH unknown fields | Current built/runtime behavior ignores unsupported nested keys like `userProfile.role`, `ngoProfile.isVerified`, `ngoProfile._id`, `ngoUserAccessProfile.isActive`, and injected `_id` values; allowed fields in the same payload still update |
| No-op PATCH | If the parsed payload yields no allowlisted updates after field filtering, PATCH returns `200` with `message: common.noFieldsToUpdate` and no `data` |
| Members list | `/ngo/me/members` returns `data` array plus `pagination` |

---

## Auth Reference

Gateway/API-key/JWT behavior for NGO routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization

The Lambda first requires:

- `userRole === "ngo"`
- `ngoId` present in the JWT

Then it verifies all of the following:

- NGO record exists
- NGO is active
- NGO is verified
- Caller has an active `NgoUserAccess` record for that NGO

Failures return:

| Condition | Status | `errorKey` |
| --- | --- | --- |
| Wrong role or missing `ngoId` | 403 | `common.forbidden` |
| NGO record missing | 404 | `ngo.errors.notFound` |
| NGO inactive or unverified | 403 | `common.forbidden` |
| Missing active NGO access row | 403 | `common.forbidden` |

### Rate Limits

| Route | Policy |
| --- | --- |
| `GET /ngo/me` | No route-level limiter in the current handler |
| `PATCH /ngo/me` | IP 60 / 5 min, identifier 30 / 5 min |
| `GET /ngo/me/members` | No route-level limiter in the current handler |

Rate-limit failures return `429 common.rateLimited` and may include `Retry-After`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale is `en`
- Use `errorKey` for branching logic

---

## Success And Error Conventions

### Success Response Shape

GET `/ngo/me` and PATCH success-with-data:

```json
{
  "success": true,
  "message": "localized success message",
  "data": {},
  "requestId": "aws-lambda-request-id"
}
```

Members list also includes pagination:

```json
{
  "success": true,
  "message": "localized success message",
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 30,
    "total": 0,
    "totalPages": 1
  },
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "ngo.errors.emailExists",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

---

## GET /ngo/me

Return the current NGO dashboard/profile payload.

**Lambda owner:** `ngo`  
**Auth:** `x-api-key` + Bearer JWT required

### Response `data` Shape

| Field | Type | Notes |
| --- | --- | --- |
| `userProfile` | object or `null` | Sanitized current NGO user document |
| `ngoProfile` | object | Sanitized NGO document |
| `ngoUserAccessProfile` | object | Sanitized access document for the caller |
| `ngoCounters` | object or `null` | Sanitized NGO counter document |
| `warnings.userProfile` | string or `null` | `ngo.warnings.temporarilyUnavailable` when user lookup failed non-fatally |
| `warnings.ngoCounters` | string or `null` | `ngo.warnings.temporarilyUnavailable` when counter lookup failed non-fatally |

### Returned Sub-Objects

#### `userProfile`

Sanitized user fields typically include:

- `_id`
- `firstName`
- `lastName`
- `email`
- `phoneNumber`
- `role`
- `verified`
- `subscribe`
- `promotion`
- `district`
- `image`
- `birthday`
- `gender`

#### `ngoProfile`

Typical fields include:

- `_id`
- `name`
- `description`
- `email`
- `phone`
- `website`
- `address.street`
- `address.city`
- `address.state`
- `address.zipCode`
- `address.country`
- `registrationNumber`
- `establishedDate`
- `categories`
- `isVerified`
- `isActive`
- `petPlacementOptions`

#### `ngoUserAccessProfile`

Typical fields include:

- `_id`
- `ngoId`
- `userId`
- `roleInNgo`
- `assignedPetIds`
- `menuConfig.canViewPetList`
- `menuConfig.canEditPetDetails`
- `menuConfig.canManageAdoptions`
- `menuConfig.canAccessFosterLog`
- `menuConfig.canViewReports`
- `menuConfig.canManageUsers`
- `menuConfig.canManageNgoSettings`
- `isActive`

#### `ngoCounters`

Typical fields include:

- `_id`
- `ngoId`
- `counterType`
- `ngoPrefix`
- `seq`

### Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "userProfile": {
      "email": "admin@helpingpaws.org",
      "firstName": "Ngo"
    },
    "ngoProfile": {
      "name": "Helping Paws",
      "registrationNumber": "BR-HELPING-PAWS-001"
    },
    "ngoUserAccessProfile": {
      "roleInNgo": "admin"
    },
    "ngoCounters": {
      "ngoPrefix": "HP",
      "seq": 42
    },
    "warnings": {
      "userProfile": null,
      "ngoCounters": null
    }
  },
  "requestId": "aws-lambda-request-id"
}
```

### Get Me Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 403 | `common.forbidden` | Caller is not NGO-scoped, the NGO is inactive/unverified, or the caller lacks active NGO access |
| 404 | `ngo.errors.notFound` | NGO record does not exist |
| 500 | `common.internalError` | Unexpected internal error |

---

## PATCH /ngo/me

Update current NGO-owned profile sections.

**Lambda owner:** `ngo`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

### Request Body Shape

All top-level sections are optional.

```json
{
  "userProfile": {},
  "ngoProfile": {},
  "ngoCounters": {},
  "ngoUserAccessProfile": {}
}
```

Current runtime note: unsupported nested fields are ignored rather than rejected. Only allowlisted fields are applied to the write operations.

### `userProfile` Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `firstName` | string | No | Max 100 chars |
| `lastName` | string | No | Max 100 chars |
| `email` | string | No | Valid email; normalized before conflict checks |
| `phoneNumber` | string | No | E.164 format; normalized before conflict checks |
| `gender` | string | No | Max 20 chars |

### `ngoProfile` Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | No | Max 200 chars |
| `description` | string | No | Max 2000 chars |
| `registrationNumber` | string | No | Max 64 chars; unique across NGOs |
| `email` | string | No | Valid email |
| `website` | string | No | Max 2048 chars |
| `address.street` | string | No | Max 200 chars |
| `address.city` | string | No | Max 100 chars |
| `address.state` | string | No | Max 100 chars |
| `address.zipCode` | string | No | Max 20 chars |
| `address.country` | string | No | Max 100 chars |
| `petPlacementOptions` | array | No | Max 50 items |

Each `petPlacementOptions` item has:

| Field | Type | Required |
| --- | --- | --- |
| `name` | string | Yes |
| `positions` | string[] | Yes |

### `ngoCounters` Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ngoPrefix` | string | No | Max 5 chars |
| `seq` | integer | No | 0 to 1,000,000,000 |

### `ngoUserAccessProfile` Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `roleInNgo` | string | No | Max 50 chars |
| `menuConfig.canViewPetList` | boolean | No | |
| `menuConfig.canEditPetDetails` | boolean | No | |
| `menuConfig.canManageAdoptions` | boolean | No | |
| `menuConfig.canAccessFosterLog` | boolean | No | |
| `menuConfig.canViewReports` | boolean | No | |
| `menuConfig.canManageUsers` | boolean | No | |
| `menuConfig.canManageNgoSettings` | boolean | No | |

### Permission Rules

| Section | Non-admin NGO user | NGO admin |
| --- | --- | --- |
| `userProfile` | Allowed | Allowed |
| `ngoProfile` | Forbidden | Allowed |
| `ngoCounters` | Forbidden | Allowed |
| `ngoUserAccessProfile` | Forbidden | Allowed |

### Example Request

```json
{
  "userProfile": {
    "firstName": "Ngo",
    "phoneNumber": "+85261234567"
  },
  "ngoProfile": {
    "description": "Updated NGO description",
    "address": {
      "country": "Hong Kong"
    }
  },
  "ngoCounters": {
    "ngoPrefix": "HP"
  },
  "ngoUserAccessProfile": {
    "menuConfig": {
      "canManageUsers": true
    }
  }
}
```

### Success: Updated Payload (200)

When at least one section is updated, the response returns only the updated sections inside `data`.

```json
{
  "success": true,
  "message": "Updated successfully",
  "data": {
    "userProfile": {
      "firstName": "Ngo",
      "phoneNumber": "+85261234567"
    },
    "ngoProfile": {
      "description": "Updated NGO description"
    },
    "ngoCounters": {
      "ngoPrefix": "HP"
    },
    "ngoUserAccessProfile": {
      "menuConfig": {
        "canManageUsers": true
      }
    }
  },
  "requestId": "aws-lambda-request-id"
}
```

### Success: No-Updatable-Fields Branch (200)

```json
{
  "success": true,
  "message": "No fields to update",
  "requestId": "aws-lambda-request-id"
}
```

Current implementation key: `message` is generated from `common.noFieldsToUpdate`.

Important distinction: an empty or malformed JSON body still fails earlier with `400`; this `200` branch applies only when the parsed payload contains no allowlisted updates after field filtering.

### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Malformed JSON, invalid nested types, invalid email, invalid phone, or invalid field shape |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 403 | `common.forbidden` | Caller is not NGO-scoped, the NGO is inactive/unverified, the caller lacks active NGO access, or a non-admin caller attempted NGO-admin sections |
| 404 | `ngo.errors.notFound` | NGO record does not exist |
| 409 | `ngo.errors.emailExists` | Another active user already owns the requested email |
| 409 | `ngo.errors.phoneExists` | Another active user already owns the requested phone number |
| 409 | `ngo.errors.registrationNumberExists` | Another NGO already owns the requested registration number |
| 429 | `common.rateLimited` | Patch rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## GET /ngo/me/members

Return the NGO's active member list.

**Lambda owner:** `ngo`  
**Auth:** `x-api-key` + Bearer JWT required

### Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Shared pagination schema, default 1 |
| `limit` | integer | No | Shared pagination schema |
| `search` | string | No | Escaped before regex lookup across first name, last name, NGO name, registration number |

### Returned Member Row Shape

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | Same as member user id |
| `firstName` | string | |
| `lastName` | string | |
| `email` | string | |
| `role` | string | User role |
| `ngoName` | string | NGO display name |
| `ngoId` | string | |
| `ngoPrefix` | string | From NGO counter, may be empty string |
| `sequence` | string | Counter sequence converted to string, may be empty string |

### Members Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "firstName": "Ngo",
      "lastName": "Admin",
      "email": "admin@helpingpaws.org",
      "role": "ngo",
      "ngoName": "Helping Paws",
      "ngoId": "665f1a2b3c4d5e6f7a8b9c0e",
      "ngoPrefix": "HP",
      "sequence": "42"
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

### Members Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid `page` or `limit` |
| 403 | `common.forbidden` | Caller is not NGO-scoped, the NGO is inactive/unverified, or the caller lacks active NGO access |
| 404 | `ngo.errors.notFound` | NGO record does not exist |
| 500 | `common.internalError` | Unexpected internal error |

---

## Frontend Integration Guide

1. Load `/ngo/me` first for NGO dashboard bootstrapping. Treat `data` as the canonical dashboard payload.
2. Handle `warnings.userProfile` and `warnings.ngoCounters` as partial-degradation flags, not hard failures.
3. When building PATCH payloads for non-admin NGO users, only send `userProfile` fields.
4. Do not rely on the backend to reject unsupported nested PATCH keys. The current runtime ignores them, so frontend payload shaping should stay explicit.
5. For member management UIs, use `/ngo/me/members` with `page`, `limit`, and `search`; the returned `pagination` object is authoritative.
6. Use `409 ngo.errors.emailExists`, `ngo.errors.phoneExists`, and `ngo.errors.registrationNumberExists` for inline form errors.

---

## Verification Snapshot

Current verification evidence is in `__tests__/ngo.test.js`, plus the `ngo` service and helper code. The test suite covers NGO registration/login-adjacent flows, malformed PATCH bodies, duplicate email handling, authorization failures, partial-success warnings, PATCH mass-assignment stripping, injected `_id` suppression, and member-list behavior. The wrapped `data` contract documented here is grounded in the current DDD implementation and compiled lambda behavior.

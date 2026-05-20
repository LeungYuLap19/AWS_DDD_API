# User API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-user`

Authenticated self-service profile endpoints for the current user. All routes operate on the caller's own account only. There is no path/body override for targeting another user.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/user/me` | `x-api-key` + Bearer JWT | Return the current active user profile |
| PATCH | `/user/me` | `x-api-key` + Bearer JWT | Update the current active user profile |
| DELETE | `/user/me` | `x-api-key` + Bearer JWT | Soft-delete the current user and revoke refresh tokens |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Success wrapper | GET and PATCH return the profile inside `data` |
| Sanitization | Returned user objects do not include `password`, `deleted`, credits, `__v`, `createdAt`, or `updatedAt` |
| PATCH semantics | Partial update only; only provided fields are changed |
| PATCH unknown fields | Unknown top-level fields like `role`, `credit`, `password`, `deleted`, and `_id` are rejected with `400 common.invalidBodyParams` |
| DELETE side effect | Marks the user as deleted and deletes all refresh tokens for that user |
| Post-delete behavior | Future `/user/me` access returns `404 common.notFound`; future refresh returns `401 auth.refresh.invalidSession` |

---

## Auth Reference

Gateway/API-key/JWT behavior for `/user/me` is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization

- There is no admin bypass or alternate path for reading another user through this Lambda
- The handler does not require `userRole === "user"`; an NGO-scoped caller can read, update, or delete its own underlying `User` document as long as the resolved `userId` matches that record

### Rate Limits

| Route | Policy |
| --- | --- |
| `GET /user/me` | No route-level limiter in the current handler |
| `PATCH /user/me` | IP 60 / 5 min, identifier 30 / 5 min |
| `DELETE /user/me` | IP 20 / 60 min, identifier 5 / 60 min |

Rate-limit failures return `429 common.rateLimited` and may include `Retry-After`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale is `en`
- Use `errorKey` for integration logic

---

## Success And Error Conventions

### Success Response Shape

GET and PATCH:

```json
{
  "success": true,
  "message": "localized success message",
  "data": {},
  "requestId": "aws-lambda-request-id"
}
```

DELETE:

```json
{
  "success": true,
  "message": "localized success message",
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "user.errors.emailExists",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

### Returned User Shape

Typical fields returned inside `data`:

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | Current user id |
| `firstName` | string | |
| `lastName` | string | |
| `email` | string | |
| `phoneNumber` | string | |
| `role` | string | Usually `user` or `ngo` depending on account |
| `verified` | boolean | |
| `subscribe` | boolean | |
| `promotion` | boolean | |
| `district` | string or `null` | |
| `image` | string or `null` | |
| `birthday` | string or `null` | JSON serialization of stored date |
| `gender` | string | |

Removed internal fields:

- `password`
- `deleted`
- `credit`
- `vetCredit`
- `eyeAnalysisCredit`
- `bloodAnalysisCredit`
- `__v`
- `createdAt`
- `updatedAt`

### PATCH Validation Rules

`PATCH /user/me` accepts a JSON object and only applies these supported fields:

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `firstName` | string | No | Must be non-empty after trim; max 100 chars |
| `lastName` | string | No | Must be non-empty after trim; max 100 chars |
| `birthday` | string or `null` | No | String value must parse as a valid date; `null` clears it |
| `email` | string | No | Must be valid email |
| `district` | string | No | Max 100 chars |
| `image` | string | No | Must be `http` or `https` URL |
| `phoneNumber` | string | No | Must be valid E.164 phone number |

Observed validation keys:

| Condition | `errorKey` |
| --- | --- |
| Malformed JSON | `common.invalidBodyParams` |
| Empty object or missing JSON body | `common.missingBodyParams` or generic shared missing-body behavior depending on transport path |
| Invalid field shape on a supported field | `common.invalidBodyParams` |
| Unknown top-level PATCH field | `common.invalidBodyParams` |

---

## Endpoints

### GET /user/me

Return the current active user profile.

**Lambda owner:** `user`  
**Auth:** `x-api-key` + Bearer JWT required

#### Get Request Body

None.

#### Get Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "email": "jane@example.com",
    "firstName": "Jane",
    "lastName": "Ng",
    "district": "Wan Chai",
    "verified": true,
    "role": "user"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Get Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 404 | `common.notFound` | User does not exist or was already deleted |
| 500 | `common.internalError` | Unexpected internal error |

### PATCH /user/me

Partially update the current user profile.

**Lambda owner:** `user`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Patch Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `firstName` | string | No | Must be non-empty after trim |
| `lastName` | string | No | Must be non-empty after trim |
| `birthday` | string or `null` | No | Stored as a `Date` when provided; `null` clears it |
| `email` | string | No | Normalized before duplicate checks and storage |
| `district` | string | No | `""` is allowed and persists as empty string |
| `image` | string | No | Public `http`/`https` URL |
| `phoneNumber` | string | No | Normalized before duplicate checks and storage |

#### Reset Rules

- `birthday` can be reset by sending `null`.
- `district` can be reset by sending `""`.
- `firstName` and `lastName` cannot be reset via empty payloads.
- `email` and `phoneNumber` cannot be reset via empty/null payloads.

#### Patch Example Request

```json
{
  "firstName": "Renamed Jane",
  "district": "Hong Kong Island",
  "image": "https://cdn.example.com/user.jpg"
}
```

#### Patch Success (200)

```json
{
  "success": true,
  "message": "Updated successfully",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "firstName": "Renamed Jane",
    "district": "Hong Kong Island",
    "email": "jane@example.com"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Patch Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Malformed JSON, invalid email, invalid phone, invalid birthday, invalid image URL, invalid field shape, or unknown top-level PATCH field |
| 404 | `common.notFound` | User no longer exists or is deleted |
| 409 | `user.errors.emailExists` | Another active user already owns the email |
| 409 | `user.errors.phoneExists` | Another active user already owns the phone number |
| 429 | `common.rateLimited` | Patch rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### DELETE /user/me

Soft-delete the current user account and revoke the user's refresh tokens.

**Lambda owner:** `user`  
**Auth:** `x-api-key` + Bearer JWT required

#### Delete Request Body

None.

#### Side Effects

- Sets `deleted: true` on the user
- Deletes all refresh-token records for that user
- Future refresh attempts for that session family will fail with `auth.refresh.invalidSession`

#### Delete Success (200)

```json
{
  "success": true,
  "message": "Deleted successfully",
  "requestId": "aws-lambda-request-id"
}
```

#### Delete Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 404 | `common.notFound` | User already deleted or not found |
| 429 | `common.rateLimited` | Delete rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Frontend Integration Guide

1. Load `/user/me` after authentication bootstrap and treat `body.data` as the canonical profile object.
2. For PATCH, only send fields the user changed. The route is partial-update-safe.
3. Keep frontend PATCH payloads explicit. The backend rejects unknown top-level keys with `400 common.invalidBodyParams`.
4. On `409 user.errors.emailExists` or `409 user.errors.phoneExists`, attach the error to the corresponding form field.
5. On successful PATCH, replace local profile state with the returned `data` object.
6. On successful DELETE, clear local auth state immediately. The backend also revokes refresh tokens, so token refresh will stop working.

---

## Verification Snapshot

Current verification evidence is in `__tests__/user.test.js`. That suite proves the `data` wrapper on GET/PATCH, sanitization of returned user objects, duplicate email/phone handling, PATCH unknown-field rejection, valid NGO-role access to the same underlying user record, and the delete-then-refresh invalidation path. Deployed development-stage verification is still the authoritative runtime check for the live route contract.

# Account API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Self-service user profile endpoints owned by the `user` Lambda. For auth, registration, challenge verification, and refresh, see [AUTH.md](./AUTH.md).

## Overview

| Method | Path | Auth | Lambda | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/user/me` | `x-api-key` + Bearer JWT | `user` | Return current active user profile |
| PATCH | `/user/me` | `x-api-key` + Bearer JWT | `user` | Update current user profile |
| DELETE | `/user/me` | `x-api-key` + Bearer JWT | `user` | Soft-delete current user and revoke refresh tokens |

## API Gateway And Auth Rules

### API Gateway Requirements

`/user/me` routes inherit the API's default authorizer and API-key requirement.

| Route group | API key required at API Gateway | API Gateway authorizer |
| --- | --- | --- |
| `/user/*` routes in this doc | Yes | `DddTokenAuthorizer` |

Required deployed headers:

```http
x-api-key: <api-gateway-api-key>
Authorization: Bearer <access-token>
```

For JSON body requests such as `PATCH /user/me`, also send:

```http
Content-Type: application/json
```

Missing `x-api-key` is rejected by API Gateway before Lambda runs.

`OPTIONS` preflight for `/user/me` does not require `x-api-key`.

Browser integration note:

- Current Lambda CORS preflight responses advertise `Content-Type,Authorization,X-Request-Id,x-api-key`
- Cross-origin browser requests can therefore send `x-api-key`, subject to normal origin allowlisting

Auth failure note:

- In direct Lambda execution and local handler tests, missing auth context becomes `401 common.unauthorized`
- In deployed API Gateway flows, an authorizer denial may surface as `401` or `403` before Lambda code runs

Implementation note:

- The `user` Lambda does not enforce `userRole === "user"`
- It resolves the target record strictly from JWT `userId`
- A valid NGO JWT can therefore read, update, or delete its own underlying `User` document through these endpoints

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale is `en`
- `message` values like `success.retrieved` and `success.updated` are translated by the shared response helper before returning JSON

### Success Response Shape

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "user": {},
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "user.errors.emailExists",
  "error": "Email already exists",
  "requestId": "aws-lambda-request-id"
}
```

### Sanitized User Shape

`GET /user/me` and `PATCH /user/me` both return a sanitized `user` object.

Removed from returned `user` objects:

- `password`
- `deleted`
- `credit`
- `vetCredit`
- `eyeAnalysisCredit`
- `bloodAnalysisCredit`
- `__v`
- `createdAt`
- `updatedAt`

Typical fields:

```json
{
  "_id": "665f1a2b3c4d5e6f7a8b9c0d",
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "phoneNumber": "+85291234567",
  "role": "user",
  "verified": true,
  "subscribe": false,
  "promotion": false,
  "district": "Kowloon",
  "image": "https://cdn.example.com/avatar.jpg",
  "birthday": "1995-08-17T00:00:00.000Z",
  "gender": "female"
}
```

## Endpoints

### GET /user/me

Return the current active user profile for the authenticated `userId`.

**Lambda:** `user`  
**Auth:** `x-api-key` + Bearer JWT required

The returned `user` object is sanitized using `functions/user/src/utils/sanitize.ts`.

**Request body:** none

**Success (200)**

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "user": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane@example.com",
    "phoneNumber": "+85291234567",
    "role": "user",
    "verified": true,
    "district": "Kowloon"
  },
  "requestId": "aws-lambda-request-id"
}
```

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts; local handler normalization is `401` |
| 404 | `common.notFound` | Authenticated user does not exist or is already soft-deleted |
| 500 | `common.internalError` | Unexpected error |

### PATCH /user/me

Update the current active user profile for the authenticated `userId`. Only supplied fields are updated.

**Lambda:** `user`  
**Auth:** `x-api-key` + Bearer JWT required

Deployment note:

- This route has an API Gateway request model (`type: object`) in SAM
- On deployed API Gateway, malformed JSON or non-object JSON can be rejected before Lambda with an API Gateway-generated `400`

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `firstName` | string | No | |
| `lastName` | string | No | |
| `birthday` | string | No | Any JavaScript-parseable date string |
| `email` | string | No | Must match email regex |
| `district` | string | No | |
| `image` | string | No | Must be `http` or `https` URL |
| `phoneNumber` | string | No | Must be E.164 format |

**Example**

```json
{
  "firstName": "Jane",
  "district": "Hong Kong Island",
  "image": "https://cdn.example.com/new-avatar.jpg"
}
```

**Behavior notes**

- `email` and `phoneNumber` are normalized before storage
- Duplicate checks exclude the current user and only consider `deleted: false` users
- `birthday` is stored as a `Date`
- This route does not require a verification challenge to change email or phone; it directly updates those fields if unique
- The patch schema is not `.strict()`, so unknown top-level fields are currently accepted and ignored unless they cause downstream issues
- The returned `user` object is sanitized using `functions/user/src/utils/sanitize.ts`

**Success (200)**

```json
{
  "success": true,
  "message": "Updated successfully",
  "user": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane@example.com",
    "phoneNumber": "+85291234567",
    "district": "Hong Kong Island",
    "image": "https://cdn.example.com/new-avatar.jpg"
  },
  "requestId": "aws-lambda-request-id"
}
```

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.invalidBodyParams` | Invalid birthday, email, image URL, or phone format |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts; local handler normalization is `401` |
| 404 | `common.notFound` | Authenticated user does not exist or is deleted |
| 409 | `user.errors.emailExists` | Another active user already has this email |
| 409 | `user.errors.phoneExists` | Another active user already has this phone number |
| 500 | `common.internalError` | Unexpected error |

### DELETE /user/me

Soft-delete the current account for the authenticated `userId` and revoke all stored refresh tokens for that user.

**Lambda:** `user`  
**Auth:** `x-api-key` + Bearer JWT required

**Request body:** none

**Side effects**

- Updates `User.deleted` to `true`
- Deletes all `RefreshToken` records for the current `userId`

**Success (200)**

```json
{
  "success": true,
  "message": "Deleted successfully",
  "userId": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "aws-lambda-request-id"
}
```

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 401 or 403 | `common.unauthorized` | Missing or invalid auth in deployed/API-authorizer contexts; local handler normalization is `401` |
| 404 | `common.notFound` | Authenticated user does not exist or is already deleted |
| 500 | `common.internalError` | Unexpected error |

## Frontend Integration Guide

### Read Current Profile

Use `GET /user/me` after login or refresh to hydrate account state. No path parameter is needed; the backend resolves the user from the JWT.

Because the handler is keyed by JWT `userId` rather than JWT role, this endpoint can also hydrate the underlying `User` record for NGO callers.

### Update Current Profile

Use `PATCH /user/me` with only changed fields. If the UI branches on duplicate conflicts, key on:

- `user.errors.emailExists`
- `user.errors.phoneExists`

### Delete Current Account

After `DELETE /user/me` succeeds, clear any in-memory access token immediately. Existing refresh cookies will no longer be usable because the backend deletes all refresh-token records.

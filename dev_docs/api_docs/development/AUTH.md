# Auth API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-auth`

Verification-first authentication for the DDD API. Normal users verify email or phone first, then either log in automatically or complete registration. NGO accounts are created by a dedicated registration route and later log in with email + password. Refresh rotates the refresh-token cookie and issues a new access token.

This document is written against the current `AWS_DDD_API` implementation, `template.yaml`, the current auth schemas and service code, and the available NGO + refresh integration tests. Where legacy docs or older tests imply pre-migration flat response payloads, the current DDD auth contract documented here is authoritative.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/challenges` | `x-api-key`; no Bearer JWT required | Create email or SMS verification challenge |
| POST | `/auth/challenges/verify` | `x-api-key`; Bearer JWT optional for linking | Verify email or SMS challenge |
| POST | `/auth/registrations/user` | `x-api-key`; no Bearer JWT required | Create a normal user after recent verification proof |
| POST | `/auth/registrations/ngo` | `x-api-key`; no Bearer JWT required | Create NGO user, NGO profile, NGO access, and NGO counter |
| POST | `/auth/login/ngo` | `x-api-key`; no Bearer JWT required | NGO email/password login |
| POST | `/auth/tokens/refresh` | `x-api-key` + refresh cookie | Rotate refresh cookie and issue a new access token |

### Flow Summary

#### Normal User Flow

1. `POST /auth/challenges` with `email` or `phoneNumber`
2. `POST /auth/challenges/verify`
3. Branch on `data.isNewUser`
4. If `true`, call `POST /auth/registrations/user` within 10 minutes of successful verification
5. Persist the returned access token and allow the browser to store the `refreshToken` cookie
6. When access token expires, call `POST /auth/tokens/refresh`

#### Returning User Flow

1. `POST /auth/challenges`
2. `POST /auth/challenges/verify`
3. Response includes `data.token` and `Set-Cookie: refreshToken=...`
4. Frontend stores the access token and uses refresh when needed

#### Link Email Or Phone To Existing Account

1. Caller is already logged in with a valid Bearer JWT
2. `POST /auth/challenges`
3. `POST /auth/challenges/verify` with the same Bearer JWT
4. Response includes `data.linked.email` or `data.linked.phoneNumber`

#### NGO Flow

1. `POST /auth/registrations/ngo`
2. Persist returned access token and refresh cookie
3. Later logins use `POST /auth/login/ngo`
4. Token renewal uses `POST /auth/tokens/refresh`

---

## Auth Reference

Gateway/API-key/JWT behavior for auth routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Route-Specific Requirements

| Scenario | Requirement |
| --- | --- |
| Create challenge | `x-api-key` only |
| Verify challenge for login/new-user decision | `x-api-key` only |
| Verify challenge for linking | `x-api-key` + `Authorization: Bearer <access-token>` |
| User registration | `x-api-key` only |
| NGO registration | `x-api-key` only |
| NGO login | `x-api-key` only |
| Refresh | `x-api-key` + `Cookie: refreshToken=<token>` |

Access tokens use HS256 and expire in 15 minutes.

### Refresh Cookie Contract

Verification of an existing user, user registration, NGO registration, NGO login, and refresh all set a refresh cookie.

```http
Set-Cookie: refreshToken=<token>; HttpOnly; Secure; SameSite=<REFRESH_COOKIE_SAME_SITE>; Path=/development/auth/tokens/refresh; Max-Age=<seconds>
```

Important behavior:

- The actual cookie path is `/<stage>/auth/tokens/refresh`; with the current default deployed stage name it is `/development/auth/tokens/refresh`
- `SameSite` is environment-configurable through `REFRESH_COOKIE_SAME_SITE` (allowed values: `Strict`, `Lax`, `None`)
- On local invocation without a stage prefix, the fallback path is `/auth/tokens/refresh`
- Refresh tokens are single-use; refresh deletes the old token record and creates a new one

### Browser Credential Mode

For browser clients using `fetch`/Axios:

- `withCredentials: true` (or `credentials: "include"`) is required on auth routes that must set/send the refresh cookie
- `withCredentials: false` (or `credentials: "omit"`) is recommended for normal Bearer-token API routes to avoid unnecessary credentialed CORS constraints

Use this route policy:

| Route | Cookie behavior | Browser credential mode |
| --- | --- | --- |
| `POST /auth/challenges/verify` (existing-user success branch) | Sets refresh cookie | `include` |
| `POST /auth/registrations/user` | Sets refresh cookie | `include` |
| `POST /auth/registrations/ngo` | Sets refresh cookie | `include` |
| `POST /auth/login/ngo` | Sets refresh cookie | `include` |
| `POST /auth/tokens/refresh` | Requires and rotates refresh cookie | `include` |
| Other auth calls that do not set/send refresh cookie (for example `POST /auth/challenges`) | No cookie requirement | `omit` |

Recommended frontend setup:

- default API client: `withCredentials: false`
- refresh/cookie-lifecycle auth client: `withCredentials: true`

---

## Success And Error Conventions

### Success Response Shape

Auth routes use the shared success envelope.

```json
{
  "success": true,
  "message": "localized success message",
  "data": {},
  "requestId": "aws-lambda-request-id"
}
```

Route-specific notes:

- Challenge creation returns `success`, `message`, `requestId` with no `data`
- Verify returns branch-specific payload inside `data`
- User registration returns `data: { userId, role, isVerified, token }`
- NGO registration returns `data: { userId, role, isVerified, token, ngoId, ngoUserAccessId, ngoCounterId }`
- NGO login returns `data: { userId, role, isVerified, token, ngoId }`
- Refresh returns `data: { accessToken, id }`

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "auth.challenge.verificationFailed",
  "error": "localized string",
  "requestId": "aws-lambda-request-id"
}
```

Frontend integrations should branch on `errorKey`, not the localized `error` string.

This unified error envelope applies to Lambda-generated responses in this document. It should not be generalized to gateway-generated auth failures on other protected APIs in the repo.

### Request Body Validation Rules

All JSON routes use the shared `parseBody` helper.

| Condition | Current `errorKey` |
| --- | --- |
| Body is malformed JSON | `common.invalidBodyParams` |
| Body is missing, `null`, or fails required-field checks in schema | `common.missingBodyParams` or route-specific key depending on schema |
| Body contains invalid field types or invalid shapes | `common.invalidBodyParams` or route-specific schema key |
| Unknown extra fields on strict schemas | `common.invalidBodyParams` |

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale in the shared runtime is `en`
- `POST /auth/challenges` also inspects body `lang` for email-content localization only; response localization still follows query, cookie, then `Accept-Language`

---

## Endpoints

### POST /auth/challenges

Create an email or SMS verification challenge.

**Lambda owner:** `auth`  
**Auth:** `x-api-key` only

#### Request Body Variants

Exactly one of the following body shapes must be used.

##### Email Challenge Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | Yes | Valid email address, max 254 chars |
| `lang` | string | No | Max 16 chars; `en` sends English email content, other values fall back to Chinese content |

#### Email Challenge Example Request

```json
{
  "email": "user@example.com",
  "lang": "en"
}
```

##### SMS Challenge Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `phoneNumber` | string | Yes | E.164 format, max 20 chars, e.g. `+85291234567` |

#### SMS Challenge Example Request

```json
{
  "phoneNumber": "+85291234567"
}
```

#### Rate Limits

| Variant | Policy |
| --- | --- |
| Email challenge | IP 20 / 5 min, identifier 3 / 5 min |
| SMS challenge | IP 20 / 10 min, identifier 3 / 10 min |

#### Success Responses

Email challenge success returns `200`.

```json
{
  "success": true,
  "message": "Verification code generated successfully",
  "requestId": "aws-lambda-request-id"
}
```

SMS challenge success returns `201` with the same envelope shape.

#### Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing required identifier field |
| 400 | `common.invalidBodyParams` | Invalid email, invalid phone number, mixed/invalid union body, or bad `lang` |
| 429 | `common.rateLimited` | Challenge rate limit exceeded |
| 503 | `auth.challenge.emailServiceUnavailable` | Email provider failed |
| 503 | `auth.challenge.smsServiceUnavailable` | SMS provider failed |
| 500 | `common.internalError` | Unexpected internal error |

### POST /auth/challenges/verify

Verify an email or SMS challenge. The response branch depends on whether the caller is already logged in and whether the verified identifier already belongs to an existing active user.

**Lambda owner:** `auth`  
**Auth:** `x-api-key`; Bearer JWT optional for linking

#### Verify Request Body Variants

##### Email Verify Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | Yes | Valid email address |
| `code` | string | Yes | Exactly 6 digits |
| `lang` | string | No | Max 16 chars; accepted by schema but not used by verify logic for response localization |

#### Email Verify Example Request

```json
{
  "email": "user@example.com",
  "code": "123456",
  "lang": "en"
}
```

##### SMS Verify Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `phoneNumber` | string | Yes | E.164 format |
| `code` | string | Yes | SMS verification code |

#### SMS Verify Example Request

```json
{
  "phoneNumber": "+85291234567",
  "code": "123456"
}
```

#### Branch Behavior

| Condition | Response branch |
| --- | --- |
| No Bearer JWT, verified identifier has no active user | `data: { verified: true, isNewUser: true }` |
| No Bearer JWT, verified identifier belongs to an active user | `data: { verified: true, isNewUser: false, userId, role, isVerified, token }` + refresh cookie |
| Valid Bearer JWT present | `data: { verified: true, isNewUser: false, userId, role, isVerified, linked: { email } }` or `linked: { phoneNumber }` |

#### Rate Limits And Cooldowns

| Variant | Rate limits | Failure cooldown |
| --- | --- | --- |
| Email verify | IP 30 / 5 min, identifier 5 / 5 min | 15 min cooldown after 5 failures |
| SMS verify | IP 30 / 10 min, identifier 5 / 10 min | 15 min cooldown after 5 failures |

#### Success Example: New User Branch

```json
{
  "success": true,
  "message": "Verification successful",
  "data": {
    "verified": true,
    "isNewUser": true
  },
  "requestId": "aws-lambda-request-id"
}
```

Frontend action: collect profile fields and call `POST /auth/registrations/user` within 10 minutes.

#### Success Example: Existing User Login Branch

```json
{
  "success": true,
  "message": "Verification successful",
  "data": {
    "verified": true,
    "isNewUser": false,
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "role": "user",
    "isVerified": true,
    "token": "eyJhbGciOiJIUzI1NiIs..."
  },
  "requestId": "aws-lambda-request-id"
}
```

Also sets `Set-Cookie: refreshToken=...`.

#### Success Example: Linking Branch

```json
{
  "success": true,
  "message": "Verification successful",
  "data": {
    "verified": true,
    "isNewUser": false,
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "role": "user",
    "isVerified": true,
    "linked": {
      "email": "user@example.com"
    }
  },
  "requestId": "aws-lambda-request-id"
}
```

For SMS linking, `linked` contains `phoneNumber` instead.

#### Verify Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing required identifier or `code` |
| 400 | `common.invalidBodyParams` | Invalid email, phone, or code format |
| 400 | `auth.challenge.verificationFailed` | Email verification record missing, expired, consumed, or wrong code |
| 400 | `auth.challenge.codeIncorrect` | SMS verify status returned `pending` |
| 400 | `auth.challenge.codeExpired` | SMS verify status returned `expired` or `canceled` |
| 400 | `auth.challenge.verificationFailed` | SMS verify returned another non-approved status not mapped to a more specific key |
| 409 | `auth.challenge.emailAlreadyLinked` | Email already belongs to another user during linking |
| 409 | `auth.challenge.phoneAlreadyLinked` | Phone already belongs to another user during linking |
| 429 | `common.rateLimited` | Rate limit or failure cooldown exceeded |
| 503 | `auth.challenge.smsServiceUnavailable` | SMS verify provider unavailable |
| 500 | `common.internalError` | Unexpected internal error |

### POST /auth/registrations/user

Create a normal user after a successful recent email or phone verification.

**Lambda owner:** `auth`  
**Auth:** `x-api-key` only  
**Precondition:** a matching email or phone verification must have been consumed within the last 10 minutes

Current implementation caveat: the source schema for this route is currently miswired and fails request validation before the registration logic runs. The field list and downstream behavior below describe the intended request shape and business logic that the handler is written to apply once that validator defect is corrected.

#### Request Body

At least one of `email` or `phoneNumber` must be present.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `firstName` | string | Yes | 1-100 chars |
| `lastName` | string | Yes | 1-100 chars |
| `email` | string | Conditional | Valid email; one of `email` or `phoneNumber` is required |
| `phoneNumber` | string | Conditional | E.164 format; one of `email` or `phoneNumber` is required |
| `subscribe` | boolean or string | No | Passed through boolean-ish parsing on create |
| `promotion` | boolean | No | Defaults to `false` when omitted |
| `district` | string | No | Max 100 chars |
| `image` | string | No | Must be `http` or `https` URL |
| `birthday` | string | No | Must parse as a valid date |
| `gender` | string | No | Business logic writes empty string when omitted |

#### User Registration Example Request

```json
{
  "firstName": "Jane",
  "lastName": "Ng",
  "email": "jane@example.com",
  "phoneNumber": "+85291234567",
  "subscribe": true,
  "promotion": false,
  "district": "Wan Chai",
  "image": "https://cdn.example.com/avatar.jpg",
  "birthday": "1995-06-15T00:00:00.000Z",
  "gender": "female"
}
```

#### User Registration Rate Limits

IP 12 / 10 min, identifier 3 / 60 min, IP+identifier 5 / 10 min.

#### Success (201)

```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "role": "user",
    "isVerified": true,
    "token": "eyJhbGciOiJIUzI1NiIs..."
  },
  "requestId": "aws-lambda-request-id"
}
```

Also sets `Set-Cookie: refreshToken=...`.

#### User Registration Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing required fields or both `email` and `phoneNumber` absent |
| 400 | `common.invalidBodyParams` | Invalid email, phone, birthday, image URL, or other schema mismatch |
| 403 | `auth.registration.user.verificationRequired` | No recent verification proof within the 10-minute window |
| 409 | `auth.registration.user.emailAlreadyRegistered` | Active user already owns the email |
| 409 | `auth.registration.user.phoneAlreadyRegistered` | Active user already owns the phone number |
| 429 | `common.rateLimited` | Registration rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### POST /auth/registrations/ngo

Create an NGO account bundle: user, NGO profile, NGO access row, and NGO counter.

**Lambda owner:** `auth`  
**Auth:** `x-api-key` only

#### NGO Registration Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `firstName` | string | Yes | 1-100 chars |
| `lastName` | string | Yes | 1-100 chars |
| `email` | string | Yes | Valid email, max 254 chars |
| `phoneNumber` | string | Yes | E.164 format |
| `password` | string | Yes | 8-128 chars |
| `confirmPassword` | string | Yes | Must match `password` |
| `ngoName` | string | Yes | 1-200 chars |
| `ngoPrefix` | string | Yes | 1-5 chars; stored uppercased in NGO counter |
| `businessRegistrationNumber` | string | Yes | 1-64 chars |
| `address.street` | string | No | Max 200 chars |
| `address.city` | string | No | Max 100 chars |
| `address.state` | string | No | Max 100 chars |
| `address.zipCode` | string | No | Max 20 chars |
| `address.country` | string | No | Max 100 chars |
| `description` | string | No | Max 2000 chars |
| `website` | string | No | Max 2048 chars |
| `subscribe` | boolean or string | No | Boolean-ish input accepted |

Important integration rule: `address` must be a structured object. The legacy string-only address payload is rejected.

#### NGO Registration Example Request

```json
{
  "firstName": "Ngo",
  "lastName": "Admin",
  "email": "admin@helpingpaws.org",
  "phoneNumber": "+85261234567",
  "password": "Password123!",
  "confirmPassword": "Password123!",
  "ngoName": "Helping Paws",
  "ngoPrefix": "HP",
  "businessRegistrationNumber": "BR-HELPING-PAWS-001",
  "address": {
    "street": "1 Test Street",
    "city": "Hong Kong",
    "state": "HK",
    "zipCode": "00000",
    "country": "Hong Kong"
  },
  "description": "Animal rescue NGO",
  "website": "https://helpingpaws.org",
  "subscribe": false
}
```

#### NGO Registration Rate Limits

IP 8 / 10 min, identifier 3 / 60 min, IP+identifier 5 / 10 min.

#### NGO Registration Success (201)

```json
{
  "success": true,
  "message": "NGO registration successful",
  "data": {
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "role": "ngo",
    "isVerified": true,
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "ngoId": "665f1a2b3c4d5e6f7a8b9c0e",
    "ngoUserAccessId": "665f1a2b3c4d5e6f7a8b9c0f",
    "ngoCounterId": "665f1a2b3c4d5e6f7a8b9c10"
  },
  "requestId": "aws-lambda-request-id"
}
```

Also sets `Set-Cookie: refreshToken=...`.

#### NGO Registration Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing required registration field |
| 400 | `common.invalidBodyParams` | Invalid email, phone, password mismatch, invalid address object, or other schema mismatch |
| 409 | `auth.registration.user.emailAlreadyRegistered` | Existing active user already owns the email |
| 409 | `auth.registration.user.phoneAlreadyRegistered` | Existing active user already owns the phone number |
| 409 | `auth.registration.ngo.businessRegistrationAlreadyRegistered` | NGO already exists with this registration number |
| 429 | `common.rateLimited` | Registration rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

### POST /auth/login/ngo

NGO email/password login.

**Lambda owner:** `auth`  
**Auth:** `x-api-key` only

#### NGO Login Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | Yes | Valid email format |
| `password` | string | Yes | 1-128 chars |

#### NGO Login Example Request

```json
{
  "email": "admin@helpingpaws.org",
  "password": "Password123!"
}
```

#### Rate Limits And Cooldown

- IP 60 / 15 min
- Identifier 10 / 15 min
- Failure cooldown: 15 min after 5 failed credential attempts for the same email

#### Success (200)

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "role": "ngo",
    "isVerified": true,
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "ngoId": "665f1a2b3c4d5e6f7a8b9c0e"
  },
  "requestId": "aws-lambda-request-id"
}
```

Also sets `Set-Cookie: refreshToken=...`.

#### NGO Login Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `auth.login.ngo.invalidEmailFormat` | Invalid email format |
| 400 | `auth.login.ngo.paramsMissing` | Missing password |
| 401 | `auth.login.ngo.invalidUserCredential` | Wrong email/password combination |
| 403 | `auth.login.ngo.userNGONotFound` | User exists but has no active NGO access row |
| 403 | `auth.login.ngo.ngoApprovalRequired` | NGO exists but is inactive or unverified |
| 429 | `common.rateLimited` | Login rate limit or cooldown exceeded |
| 500 | `auth.login.ngo.NGONotFound` | Active NGO access references a missing NGO record |
| 500 | `common.internalError` | Unexpected internal error |

### POST /auth/tokens/refresh

Rotate the refresh-token cookie and issue a new access token.

**Lambda owner:** `auth`  
**Auth:** `x-api-key` + refresh cookie  
**Request body:** none

#### Request Requirements

```http
Cookie: refreshToken=<token>
```

#### Refresh Rate Limits And Cooldown

- IP 60 / 5 min
- Identifier limit is environment-driven through `REFRESH_RATE_LIMIT_LIMIT` and `REFRESH_RATE_LIMIT_WINDOW_SEC`
- Failure cooldown: 30 min after 10 failed refresh attempts from the same IP-scoped identifier bucket

#### Refresh Success (200)

```json
{
  "success": true,
  "message": "Completed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "id": "665f1a2b3c4d5e6f7a8b9c0d"
  },
  "requestId": "aws-lambda-request-id"
}
```

Also sets a new `refreshToken` cookie.

#### Refresh Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 401 | `auth.refresh.missingRefreshToken` | No `refreshToken` cookie/header value was present |
| 401 | `auth.refresh.invalidRefreshTokenCookie` | Cookie header existed but did not contain a parseable `refreshToken` |
| 401 | `auth.refresh.invalidSession` | Token record missing, token expired, token already used, or user no longer exists |
| 403 | `auth.refresh.ngoApprovalRequired` | Refresh belongs to NGO user whose NGO is inactive or unverified |
| 429 | `common.rateLimited` | Refresh rate limit or cooldown exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Frontend Integration Guide

### New User Login / Registration

1. Call `POST /auth/challenges`
2. Prompt for verification code
3. Call `POST /auth/challenges/verify`
4. If `data.isNewUser === true`, collect first name / last name plus email or phone and call `POST /auth/registrations/user`
5. Save the returned access token from `data.token`
6. Allow credentials so the refresh cookie is stored

### Returning User Login

1. Call `POST /auth/challenges`
2. Call `POST /auth/challenges/verify`
3. Read `data.token` and persist it client-side
4. Ensure the browser accepts the refresh cookie

### Linking Flow

1. Send the current access token in `Authorization`
2. Re-run challenge + verify using the new email or phone
3. On success, update the local account view from `data.linked`

### Refresh Handling

1. When access token expires, call `POST /auth/tokens/refresh`
2. On `200`, replace the stored access token with `data.accessToken`
3. On `401 auth.refresh.missingRefreshToken`, `auth.refresh.invalidRefreshTokenCookie`, or `auth.refresh.invalidSession`, clear local auth state and redirect to login
4. On `403 auth.refresh.ngoApprovalRequired`, log out and show approval-required UI for NGO users
5. Ensure the refresh call uses credentialed mode (`withCredentials: true` / `credentials: "include"`)

---

## Verification Snapshot

Auth behavior is currently evidenced by:

- `template.yaml` route wiring for all `/auth/*` routes
- `functions/auth/src/services/*.ts` and matching Zod schemas
- `__tests__/ngo.test.js` for NGO registration/login happy paths, validation failures, duplicate handling, and approval gating
- `__tests__/user.test.js` for the delete-then-refresh invalidation path on `/auth/tokens/refresh`

There is no single dedicated auth challenge / normal-user registration suite yet. Challenge creation, challenge verification, and user-registration details are currently grounded primarily in the wired DDD implementation and schemas rather than a dedicated end-to-end auth test file.

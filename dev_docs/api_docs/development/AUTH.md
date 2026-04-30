# Auth Flow API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Verification-first authentication flow for the DDD API. Email and SMS challenges are used for normal user verification, login, and account-linking flows. NGO login is password-based. Refresh uses a rotated refresh-token cookie.

## Overview

### Route Summary

| Method | Path | Auth | Lambda | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/auth/challenges` | `x-api-key`; no Bearer JWT required | `auth` | Generate email or SMS verification code |
| POST | `/auth/challenges/verify` | `x-api-key`; Bearer JWT optional for linking | `auth` | Verify email or SMS challenge |
| POST | `/auth/registrations/user` | `x-api-key`; no Bearer JWT required | `auth` | Create normal user after recent verification proof |
| POST | `/auth/registrations/ngo` | `x-api-key`; no Bearer JWT required | `auth` | Create NGO admin user + NGO profile |
| POST | `/auth/login/ngo` | `x-api-key`; no Bearer JWT required | `auth` | NGO password login |
| POST | `/auth/tokens/refresh` | `x-api-key` + refresh cookie | `auth` | Rotate refresh cookie and issue new access token |

### Flow Summary

1. `POST /auth/challenges` with either `email` or `phoneNumber`
2. `POST /auth/challenges/verify`
3. Branch on response:
   - Existing active user: access token returned, refresh cookie set
   - New normal user: `{ verified: true, isNewUser: true }`
   - Logged-in caller with Bearer JWT: identifier is linked to current account
4. New normal user only: `POST /auth/registrations/user` within 10 minutes of verification
5. Later session renewal: `POST /auth/tokens/refresh`

NGO onboarding is separate:

1. `POST /auth/registrations/ngo`
2. Subsequent NGO logins use `POST /auth/login/ngo`
3. Later session renewal still uses `POST /auth/tokens/refresh`

## API Gateway And Auth Rules

### API Gateway Requirements

All endpoints in this doc require a valid API Gateway API key.

| Route group | API key required at API Gateway | API Gateway authorizer |
| --- | --- | --- |
| `/auth/*` routes in this doc | Yes | None |

`OPTIONS` preflight routes remain public and do not require `x-api-key`.

### Authentication

| Scenario | Requirement |
| --- | --- |
| Challenge generation | `x-api-key`; no Bearer JWT required |
| Challenge verification for new/existing user | `x-api-key`; no Bearer JWT required |
| Challenge verification for identifier linking | `x-api-key`; add `Authorization: Bearer <access-token>` when linking to an existing signed-in account |
| User registration | `x-api-key`; no Bearer JWT required; requires recent consumed verification proof in DB |
| NGO registration | `x-api-key`; no Bearer JWT required |
| NGO login | `x-api-key`; no Bearer JWT required |
| Refresh | `x-api-key` + `Cookie: refreshToken=<token>` |

Access tokens use HS256 and expire in 15 minutes.

### Required Headers

| Scenario | Headers |
| --- | --- |
| JSON request | `Content-Type: application/json`, `x-api-key: <api-gateway-api-key>` |
| Linking flow | Add `Authorization: Bearer <access-token>` |
| Refresh | `x-api-key: <api-gateway-api-key>`, `Cookie: refreshToken=<token>` |

### Refresh Cookie Contract

Login / registration / returning-user verification responses set:

```http
Set-Cookie: refreshToken=<token>; HttpOnly; Secure; SameSite=Strict; Path=/<stage>/auth/tokens/refresh; Max-Age=<seconds>
```

Notes:

- On deployed stages, cookie path is `/<stage>/auth/tokens/refresh`, for example `/development/auth/tokens/refresh`
- On local invocation without an API Gateway stage, path falls back to `/auth/tokens/refresh`
- Refresh tokens are single-use: refresh deletes the old record and creates a new one

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "auth.challenge.verificationFailed",
  "error": "Verification failed. Please check your identifier and code and try again.",
  "requestId": "aws-lambda-request-id"
}
```

### Success Response Shape

All Lambda-produced success responses include `success: true` and `requestId`. `message` is present on the routes documented below.

```json
{
  "success": true,
  "message": "Verification successful",
  "requestId": "aws-lambda-request-id"
}
```

### Localization

`error` is localized. `errorKey` is the stable integration key.

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Default locale in the shared runtime is `en`
- Success messages are translated using the same request-locale resolution
- The `lang` field accepted by the email challenge routes affects email content generation, not API response localization

## Endpoints

### POST /auth/challenges

Generate a verification challenge. Body must contain either `email` or `phoneNumber`, not both.

**Lambda:** `auth`  
**Auth:** `x-api-key` required; no Bearer JWT required  
**Rate limit:** email `5 / 300s`, SMS `5 / 600s`

Deployment note:

- This route has an API Gateway request model (`type: object`) in SAM
- On deployed API Gateway, malformed JSON or non-object JSON can be rejected before Lambda with an API Gateway-generated `400`

**Body variant A: email**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | Yes | Valid email |
| `lang` | string | No | Used for email content language; `en` or fallback `zh` |

**Example**

```json
{
  "email": "user@example.com",
  "lang": "en"
}
```

**Body variant B: SMS**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `phoneNumber` | string | Yes | E.164 format, e.g. `+85291234567` |

**Example**

```json
{
  "phoneNumber": "+85291234567"
}
```

**Success: email (200)**

```json
{
  "success": true,
  "message": "Verification code generated successfully",
  "requestId": "aws-lambda-request-id"
}
```

**Success: SMS (201)**

```json
{
  "success": true,
  "message": "Verification code generated successfully",
  "requestId": "aws-lambda-request-id"
}
```

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing required field |
| 400 | `common.invalidBodyParams` | Invalid email / phone format or wrong union shape |
| 429 | `common.rateLimited` | Per-identifier rate limit exceeded |
| 503 | `auth.challenge.emailServiceUnavailable` | SMTP send failed |
| 503 | `auth.challenge.smsServiceUnavailable` | Twilio Verify request failed |
| 500 | `common.internalError` | Unexpected error |

### POST /auth/challenges/verify

Verify an email or SMS challenge. Behavior depends on caller context.

| Context | Result |
| --- | --- |
| No JWT, identifier not attached to active user | `verified: true`, `isNewUser: true` |
| No JWT, identifier belongs to active user | login success, access token returned, refresh cookie set |
| Valid Bearer JWT present | identifier is linked to caller account |

**Lambda:** `auth`  
**Auth:** `x-api-key` required; Bearer JWT optional for linking  
**Rate limit:** email `10 / 300s`, SMS `10 / 600s`

Deployment note:

- This route has an API Gateway request model (`type: object`) in SAM
- On deployed API Gateway, malformed JSON or non-object JSON can be rejected before Lambda with an API Gateway-generated `400`

**Body variant A: email**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | Yes | Valid email |
| `code` | string | Yes | Exactly 6 digits |
| `lang` | string | No | Language hint |

**Example**

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Body variant B: SMS**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `phoneNumber` | string | Yes | E.164 format |
| `code` | string | Yes | Twilio Verify code |

**Example**

```json
{
  "phoneNumber": "+85291234567",
  "code": "123456"
}
```

**Success: new user proof (200)**

```json
{
  "success": true,
  "message": "Verification successful",
  "verified": true,
  "isNewUser": true,
  "requestId": "aws-lambda-request-id"
}
```

No token and no cookie are returned in this branch.

**Success: existing active user login (200)**

```json
{
  "success": true,
  "message": "Verification successful",
  "verified": true,
  "isNewUser": false,
  "userId": "665f1a2b3c4d5e6f7a8b9c0d",
  "role": "user",
  "isVerified": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "requestId": "aws-lambda-request-id"
}
```

Also sets `Set-Cookie: refreshToken=...`.

Implementation note:

- This branch currently looks up any active `User` record by email or phone, not only `role: "user"`
- The response `role` mirrors the matched user document
- The token issued by this branch is always created via `issueUserAccessToken(...)`, so NGO-specific claims like `ngoId` and `ngoName` are not attached here
- NGO clients should use `POST /auth/login/ngo` for supported NGO login

**Success: linking email or phone to logged-in caller (200)**

```json
{
  "success": true,
  "message": "Verification successful",
  "verified": true,
  "isNewUser": false,
  "userId": "665f1a2b3c4d5e6f7a8b9c0d",
  "role": "user",
  "isVerified": true,
  "linked": {
    "email": "user@example.com"
  },
  "requestId": "aws-lambda-request-id"
}
```

`linked` contains either `email` or `phoneNumber`, depending on the verified identifier.

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing required field |
| 400 | `common.invalidBodyParams` | Invalid email / phone / code format or wrong union shape |
| 400 | `auth.challenge.verificationFailed` | Email verification code not found, expired, consumed, or mismatched |
| 400 | `auth.challenge.codeIncorrect` | SMS code incorrect |
| 400 | `auth.challenge.codeExpired` | SMS code expired or canceled |
| 401 | `common.unauthorized` | Invalid Bearer token supplied for linking |
| 409 | `auth.challenge.emailAlreadyLinked` | Email already belongs to another active user |
| 409 | `auth.challenge.phoneAlreadyLinked` | Phone already belongs to another active user |
| 429 | `common.rateLimited` | Per-identifier verify rate limit exceeded |
| 503 | `auth.challenge.smsServiceUnavailable` | SMS verification provider failed |
| 500 | `common.internalError` | Unexpected error |

### POST /auth/registrations/user

Create a normal user account after recent verification proof exists. The backend accepts either recent email proof, recent phone proof, or both. Verification proof must have been consumed within the previous 10 minutes.

**Lambda:** `auth`  
**Auth:** `x-api-key` required; no Bearer JWT required  
**Rate limit:** `12 / 10 minutes` per caller

Deployment note:

- This route has an API Gateway request model (`type: object`) in SAM
- On deployed API Gateway, malformed JSON or non-object JSON can be rejected before Lambda with an API Gateway-generated `400`

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `firstName` | string | Yes | Non-empty |
| `lastName` | string | Yes | Non-empty |
| `email` | string | Conditionally | Optional, but at least one of `email` or `phoneNumber` must be present |
| `phoneNumber` | string | Conditionally | Optional, but at least one of `email` or `phoneNumber` must be present |
| `subscribe` | boolean or string | No | `1`, `true`, `yes`, `on` become `true`; other non-empty values become `false` |
| `promotion` | boolean | No | Defaults to `false` if omitted |
| `district` | string, `null`, or `""` | No | Empty string normalizes to falsy input |
| `image` | string, `null`, or `""` | No | Must be `http` or `https` URL when present |
| `birthday` | string, `null`, or `""` | No | Any JavaScript-parseable date string accepted; stored as `Date` |
| `gender` | string, `null`, or `""` | No | Stored as provided or empty string |

**Example**

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "phoneNumber": "+85291234567",
  "subscribe": true,
  "promotion": false,
  "district": "Kowloon",
  "image": "https://cdn.example.com/avatar.jpg",
  "birthday": "1995-08-17",
  "gender": "female"
}
```

**Success (201)**

```json
{
  "success": true,
  "message": "Registration successful",
  "userId": "665f1a2b3c4d5e6f7a8b9c0d",
  "role": "user",
  "isVerified": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "requestId": "aws-lambda-request-id"
}
```

Also sets `Set-Cookie: refreshToken=...`.

**Side effects**

- Creates a `User` with role `user`
- Sets `verified: true`
- Seeds default credits: `credit`, `vetCredit`, `eyeAnalysisCredit`, `bloodAnalysisCredit` all start at `300`
- Deletes the consumed verification proof records for provided email / phone

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing required name fields or both identifier fields absent |
| 400 | `common.invalidBodyParams` | Invalid email, phone, image URL, or birthday |
| 403 | `auth.registration.user.verificationRequired` | No recent consumed verification proof found |
| 409 | `auth.registration.user.emailAlreadyRegistered` | Active user with same email already exists |
| 409 | `auth.registration.user.phoneAlreadyRegistered` | Active user with same phone already exists |
| 429 | `common.rateLimited` | Registration rate limit exceeded |
| 500 | `common.internalError` | Unexpected error |

### POST /auth/registrations/ngo

Create the NGO admin user, NGO profile, NGO access record, and NGO counter in one MongoDB transaction. This route does not depend on email/SMS verification proof.

**Lambda:** `auth`  
**Auth:** `x-api-key` required; no Bearer JWT required  
**Rate limit:** `8 / 10 minutes` per caller

Deployment note:

- This route has an API Gateway request model (`type: object`) in SAM
- On deployed API Gateway, malformed JSON or non-object JSON can be rejected before Lambda with an API Gateway-generated `400`

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `firstName` | string | Yes | Non-empty |
| `lastName` | string | Yes | Non-empty |
| `email` | string | Yes | Valid email |
| `phoneNumber` | string | Yes | E.164 format |
| `password` | string | Yes | Minimum 8 chars |
| `confirmPassword` | string | Yes | Must exactly match `password` |
| `ngoName` | string | Yes | Non-empty |
| `ngoPrefix` | string | Yes | Non-empty, max 5 chars; stored uppercased in `NgoCounters` |
| `businessRegistrationNumber` | string | Yes | Unique per NGO |
| `address.street` | string | No | Defaults to empty string when omitted |
| `address.city` | string | No | Defaults to empty string when omitted |
| `address.state` | string | No | Defaults to empty string when omitted |
| `address.zipCode` | string | No | Defaults to empty string when omitted |
| `address.country` | string | No | Defaults to empty string when omitted |
| `description` | string, `null`, or `""` | No | |
| `website` | string, `null`, or `""` | No | |
| `subscribe` | boolean or string | No | `1`, `true`, `yes`, `on` become `true`; other non-empty values become `false` |

**Example**

```json
{
  "firstName": "Ada",
  "lastName": "Wong",
  "email": "admin@helpingpaws.org",
  "phoneNumber": "+85291234567",
  "password": "strongpassword",
  "confirmPassword": "strongpassword",
  "ngoName": "Helping Paws",
  "ngoPrefix": "HP",
  "businessRegistrationNumber": "BR-12345",
  "address": {
    "street": "1 Example Street",
    "city": "Hong Kong",
    "state": "",
    "zipCode": "",
    "country": "HK"
  },
  "description": "Animal rescue NGO",
  "website": "https://helpingpaws.org",
  "subscribe": true
}
```

**Success (201)**

```json
{
  "success": true,
  "message": "NGO registration successful",
  "userId": "665f1a2b3c4d5e6f7a8b9c0d",
  "role": "ngo",
  "isVerified": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "ngoId": "665f1a2b3c4d5e6f7a8b9c0e",
  "ngoUserAccessId": "665f1a2b3c4d5e6f7a8b9c0f",
  "ngoCounterId": "665f1a2b3c4d5e6f7a8b9c10",
  "requestId": "aws-lambda-request-id"
}
```

Also sets `Set-Cookie: refreshToken=...`.

**Transactional side effects**

- Creates `User` with role `ngo`
- Creates `NGO` with `isVerified: true` and `isActive: true`
- Creates `NgoUserAccess` with `roleInNgo: "admin"` and `isActive: true`
- Creates `NgoCounters` with `counterType: "ngopet"`

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing required fields |
| 400 | `common.invalidBodyParams` | Invalid email, phone, password confirmation, or malformed body |
| 409 | `auth.registration.user.emailAlreadyRegistered` | Email already belongs to an active user |
| 409 | `auth.registration.user.phoneAlreadyRegistered` | Phone already belongs to an active user |
| 409 | `auth.registration.ngo.businessRegistrationAlreadyRegistered` | NGO registration number already exists |
| 429 | `common.rateLimited` | Registration rate limit exceeded |
| 500 | `common.internalError` | Unexpected error or transaction failure |

### POST /auth/login/ngo

Password login for an existing NGO admin/staff user.

**Lambda:** `auth`  
**Auth:** `x-api-key` required; no Bearer JWT required  
**Rate limit:** `10 / 15 minutes` per normalized email

Deployment note:

- This route has an API Gateway request model (`type: object`) in SAM
- On deployed API Gateway, malformed JSON or non-object JSON can be rejected before Lambda with an API Gateway-generated `400`

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | Yes | Valid email |
| `password` | string | Yes | Non-empty |

**Example**

```json
{
  "email": "admin@helpingpaws.org",
  "password": "strongpassword"
}
```

**Success (200)**

```json
{
  "success": true,
  "message": "Login successful",
  "userId": "665f1a2b3c4d5e6f7a8b9c0d",
  "role": "ngo",
  "isVerified": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "ngoId": "665f1a2b3c4d5e6f7a8b9c0e",
  "requestId": "aws-lambda-request-id"
}
```

Also sets `Set-Cookie: refreshToken=...`.

**Requirements and branch rules**

- User lookup requires `role: "ngo"` and `deleted: false`
- Password is checked with bcrypt
- The user must have an active `NgoUserAccess`
- The linked NGO must exist and must be both `isActive: true` and `isVerified: true`

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `auth.login.ngo.invalidEmailFormat` | Invalid email format |
| 400 | `auth.login.ngo.paramsMissing` | Missing password |
| 401 | `auth.login.ngo.invalidUserCredential` | User not found or password mismatch |
| 403 | `auth.login.ngo.userNGONotFound` | User has no active NGO access record |
| 403 | `auth.login.ngo.ngoApprovalRequired` | Linked NGO exists but is inactive or unverified |
| 429 | `common.rateLimited` | Login rate limit exceeded |
| 500 | `auth.login.ngo.NGONotFound` | Active access exists but NGO record missing |
| 500 | `common.internalError` | Unexpected error |

### POST /auth/tokens/refresh

Exchange a refresh-token cookie for a new access token and a rotated refresh cookie.

**Lambda:** `auth`  
**Auth:** `x-api-key` + refresh token cookie  
**Rate limit:** configurable, default template values are `20 / 300s`

**Request**

No JSON body is required.

Header example:

```http
Cookie: refreshToken=<token>
```

**Success (200)**

```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "requestId": "aws-lambda-request-id"
}
```

Also sets a new `Set-Cookie: refreshToken=...`.

**Behavior notes**

- Missing cookie is rejected before DB lookup
- Refresh token record is deleted on use
- Expired or unknown refresh token returns `401`
- NGO refresh rebuilds an NGO-scoped access token only if active NGO access and an active+verified NGO still exist

**Errors**

| Status | errorKey | Cause |
| --- | --- | --- |
| 401 | `auth.refresh.missingRefreshToken` | No cookie header or cookie array provided |
| 401 | `auth.refresh.invalidRefreshTokenCookie` | Cookie header exists but `refreshToken` is missing / malformed |
| 401 | `auth.refresh.invalidSession` | Refresh token expired, missing, spent, user deleted, or NGO access missing |
| 403 | `auth.refresh.ngoApprovalRequired` | NGO user exists but linked NGO is inactive or unverified |
| 429 | `common.rateLimited` | Refresh rate limit exceeded |
| 500 | `common.internalError` | Unexpected error |

## Frontend Integration Guide

### Normal User Login / Register

1. Call `POST /auth/challenges`
2. Call `POST /auth/challenges/verify`
3. If response includes `token`, treat as logged in
4. If response returns `isNewUser: true`, collect profile fields and call `POST /auth/registrations/user`
5. Store access token client-side and allow browser to retain refresh cookie

### Identifier Linking

1. User is already logged in with Bearer token
2. Call `POST /auth/challenges`
3. Call `POST /auth/challenges/verify` with the same Bearer token
4. Check `linked.email` or `linked.phoneNumber`

### NGO Login

1. First-time onboarding uses `POST /auth/registrations/ngo`
2. Later sign-ins use `POST /auth/login/ngo`
3. If refresh later returns `auth.refresh.ngoApprovalRequired`, force logout and show NGO approval state

Do not rely on challenge verification as the NGO login path. The implemented verify branch does not attach NGO-specific JWT claims.

## Testing Notes

- Challenge generation and verification have different email and SMS rate-limit windows
- `POST /auth/challenges/verify` is the most branch-heavy route; test new-user, existing-user, and linking flows separately
- Refresh is single-use by design, so replaying the same cookie should fail with `401 auth.refresh.invalidSession`

## Known Contract Edges

- Invalid JSON bodies are first passed through the shared handler as raw strings; route-level Zod validation then typically returns `400 common.invalidBodyParams` or another route-specific validation key rather than a dedicated `common.invalidJSON`
- In non-production deployments where `ALLOWED_ORIGINS='*'`, the shared CORS helper returns `Access-Control-Allow-Origin: *` without `Access-Control-Allow-Credentials`; browser cookie-based refresh flows can therefore require explicit allowed origins instead of wildcard CORS

# Notifications API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

Per-user notification inbox and admin dispatch. Users read and archive their own notifications. Admin dispatches notifications to any target user.

> Conventions: see shared API Gateway / auth / error-response rules below.

---

## Overview

### Route Summary

| Method | Path | Auth | Lambda | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/notifications/me` | `x-api-key` + Bearer JWT | `notifications` | List caller's notifications |
| PATCH | `/notifications/me/{notificationId}` | `x-api-key` + Bearer JWT | `notifications` | Archive a single notification |
| POST | `/notifications/dispatch` | `x-api-key` + Bearer JWT + `admin` role | `notifications` | Create a notification for a target user |

### API Gateway Requirements

All routes require a valid API Gateway API key in the `x-api-key` header. Requests missing the key are rejected by API Gateway with `403 Forbidden` before the Lambda runs.

`OPTIONS` preflight routes are public and do not require `x-api-key`.

Local SAM testing (`sam local start-api`) does not enforce `x-api-key`.

### Authentication

| Route | Mechanism |
| --- | --- |
| `GET /notifications/me` | Bearer JWT required. Scope is derived from JWT `userId`. |
| `PATCH /notifications/me/{notificationId}` | Bearer JWT required. Ownership enforced against JWT `userId`. |
| `POST /notifications/dispatch` | Bearer JWT required. Caller must have role `admin`. |

Access tokens use HS256. JWT payload populates `userId`, `userEmail`, `userRole` on the Lambda event.

### Required Headers

| Scenario | Headers |
| --- | --- |
| Deployed API Gateway | `Content-Type: application/json`, `x-api-key: <key>` |
| Local SAM | `Content-Type: application/json` |
| All routes | Add `Authorization: Bearer <access-token>` |

### Success Response Shape

```json
{
  "success": true,
  "message": "success.retrieved",
  "<endpoint-specific-fields>": "..."
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "common.notFound",
  "error": "<localized message>",
  "requestId": "<lambda-request-id>"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `success` | `boolean` | Always `false` |
| `errorKey` | `string` | Machine-readable key for integration logic |
| `error` | `string` | Localized message — do not use for branching |
| `requestId` | `string` | Lambda request ID for CloudWatch lookup |

### Localization

Append `?lang=en` to the URL for English. Default is `zh` (Traditional Chinese).

---

## Notification Document Shape

The notification document returned in list and dispatch responses has the following fields. The `__v` field is stripped.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | `string` (ObjectId) | |
| `userId` | `string` (ObjectId) | Owner of the notification |
| `type` | `string` | One of the supported notification types (see below) |
| `isArchived` | `boolean` | `false` by default; `true` after `PATCH` archive |
| `petId` | `string` (ObjectId) \| `null` | Optional linked pet |
| `petName` | `string` \| `null` | Optional pet name |
| `nextEventDate` | `string` (ISO date) \| `null` | Stored as UTC Date; serialized as ISO string |
| `nearbyPetLost` | `string` \| `null` | Nearby lost pet reference; format is context-dependent |
| `createdAt` | `string` (ISO date) | Mongoose timestamps |
| `updatedAt` | `string` (ISO date) | Mongoose timestamps |

### Supported Notification Types

| Value | Trigger domain |
| --- | --- |
| `nearby_pet_lost` | Pet Recovery — nearby lost-pet post created |
| `vaccine_reminder` | Pet Medical — vaccine due date approaching |
| `deworming_reminder` | Pet Medical — deworming due date approaching |
| `medical_reminder` | Pet Medical — general medical event due |
| `adoption_follow_up` | Pet Adoption — follow-up action required |
| `ownership_transfer` | Pet Transfer — ownership transfer initiated or completed |

---

## Endpoints

### GET /notifications/me

List all notifications belonging to the authenticated caller, sorted newest first. Returns both archived and unarchived records — frontend should filter on `isArchived` if needed.

**Lambda:** `notifications`  
**Auth:** Bearer JWT required  
**Rate limit:** None

**Request:** No body, no query params.

**Example request:**

```http
GET /notifications/me HTTP/1.1
Authorization: Bearer <access-token>
x-api-key: <api-key>
```

**Success (200):**

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "count": 2,
  "notifications": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "userId": "665f1a2b3c4d5e6f7a8b9c01",
      "type": "vaccine_reminder",
      "isArchived": false,
      "petId": "665f1a2b3c4d5e6f7a8b9c02",
      "petName": "Mochi",
      "nextEventDate": "2026-06-01T00:00:00.000Z",
      "nearbyPetLost": null,
      "createdAt": "2026-05-01T10:00:00.000Z",
      "updatedAt": "2026-05-01T10:00:00.000Z"
    }
  ]
}
```

**Errors:**

| Status | errorKey | Cause |
| --- | --- | --- |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 500 | `common.internalError` | Unexpected error |

---

### PATCH /notifications/me/{notificationId}

Archives a single notification owned by the caller. Sets `isArchived: true`. The request body is ignored. The operation is idempotent — archiving an already-archived notification returns `200`.

**Lambda:** `notifications`  
**Auth:** Bearer JWT required  
**Rate limit:** None

**Path parameters:**

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `notificationId` | string (ObjectId) | Yes | Must be a valid MongoDB ObjectId |

**Request:** No body required.

**Example request:**

```http
PATCH /notifications/me/665f1a2b3c4d5e6f7a8b9c0d HTTP/1.1
Authorization: Bearer <access-token>
x-api-key: <api-key>
```

**Success (200):**

```json
{
  "success": true,
  "message": "success.updated",
  "notificationId": "665f1a2b3c4d5e6f7a8b9c0d"
}
```

**Errors:**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `common.missingPathParams` | `notificationId` path param is missing |
| 400 | `common.invalidObjectId` | `notificationId` is not a valid MongoDB ObjectId |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 404 | `common.notFound` | No notification matching `_id` + `userId` — either does not exist or belongs to another user |
| 500 | `common.internalError` | Unexpected error |

**Ownership:** The query filters on both `_id: notificationId` and `userId: authContext.userId`. A notification belonging to another user returns `404`, not `403`. This prevents caller ID enumeration.

---

### POST /notifications/dispatch

Creates a notification record for any target user. Caller must have role `admin`.

This is the internal dispatch endpoint used by other services or admin tooling. It is not a self-service create — regular users cannot create notifications for themselves via this endpoint.

**Lambda:** `notifications`  
**Auth:** Bearer JWT required; role `admin` enforced  
**Rate limit:** None

**Body:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `targetUserId` | string (ObjectId) | Yes | MongoDB ObjectId of the recipient user |
| `type` | string (enum) | Yes | One of the supported notification types |
| `petId` | string (ObjectId) | No | Nullable. Linked pet ObjectId |
| `petName` | string | No | Nullable. Linked pet name |
| `nextEventDate` | string | No | Nullable. Accepted formats: ISO 8601 (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ssZ`) or `DD/MM/YYYY` |
| `nearbyPetLost` | string | No | Nullable. Nearby lost-pet reference string |

Unknown fields are rejected (`.strict()` schema).

**Example request:**

```json
{
  "targetUserId": "665f1a2b3c4d5e6f7a8b9c01",
  "type": "vaccine_reminder",
  "petId": "665f1a2b3c4d5e6f7a8b9c02",
  "petName": "Mochi",
  "nextEventDate": "2026-06-01"
}
```

**Success (200):**

```json
{
  "success": true,
  "message": "success.created",
  "notification": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "userId": "665f1a2b3c4d5e6f7a8b9c01",
    "type": "vaccine_reminder",
    "isArchived": false,
    "petId": "665f1a2b3c4d5e6f7a8b9c02",
    "petName": "Mochi",
    "nextEventDate": "2026-06-01T00:00:00.000Z",
    "nearbyPetLost": null,
    "createdAt": "2026-05-06T10:00:00.000Z",
    "updatedAt": "2026-05-06T10:00:00.000Z"
  }
}
```

**Errors:**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `notifications.errors.typeRequired` | `type` missing or not one of the supported enum values |
| 400 | `notifications.errors.invalidDate` | `nextEventDate` provided but not valid ISO 8601 or `DD/MM/YYYY` |
| 400 | `common.invalidObjectId` | `targetUserId` or `petId` is not a valid MongoDB ObjectId |
| 400 | `common.invalidBodyParams` | Malformed JSON body, or request body contains unrecognized fields (strict schema) |
| 401 | `common.unauthorized` | Missing or invalid Bearer token |
| 403 | `common.forbidden` | Caller role is not `admin` |
| 500 | `common.internalError` | Unexpected error |

---

## DDD Contract Delta vs Legacy

The DDD Notifications API intentionally differs from the legacy `PetLostandFound` endpoints in the following ways. Frontend integrators must update their integration.

| Concern | Legacy (`AWS_API`) | DDD (`AWS_DDD_API`) |
| --- | --- | --- |
| **Route paths** | `/v2/account/{userId}/notifications` | `/notifications/me` (GET/PATCH) |
| **Scope enforcement** | Path `userId` must match JWT `userId` | No path userId — scope is always the JWT caller |
| **Archive method** | `PUT` | `PATCH` |
| **Notification creation** | Any authenticated user POSTs their own notification via `POST /v2/account/{userId}/notifications` | Only `admin` role can dispatch via `POST /notifications/dispatch` — self-service creation removed |
| **Dispatch target** | User creates for themselves | Admin dispatches to any `targetUserId` |
| **Type validation** | No enum constraint in legacy | Enum-enforced: one of six known types |
| **Date formats** | `DD/MM/YYYY` only | ISO 8601 or `DD/MM/YYYY` |

---

## Frontend Integration Guide

### Reading Notifications

```
GET /notifications/me
Authorization: Bearer <access-token>
x-api-key: <api-key>
```

Filter the returned array on `isArchived === false` to show active notifications.

### Archiving A Notification

```
PATCH /notifications/me/{notificationId}
Authorization: Bearer <access-token>
x-api-key: <api-key>
```

No body needed. On `404`, the notification either does not exist or belongs to another user.

### Dispatching A Notification (Admin Only)

```
POST /notifications/dispatch
Authorization: Bearer <admin-access-token>
x-api-key: <api-key>
Content-Type: application/json

{
  "targetUserId": "<user-objectid>",
  "type": "<notification-type>",
  ...optional fields
}
```

Non-admin callers receive `403 common.forbidden`.

# Notifications API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-notifications`

Per-user notification inbox plus authenticated dispatch. The current DDD implementation uses the shared `{ success, message, data, pagination?, requestId }` envelope. Older docs that describe top-level `notifications`, `count`, or `notification` payloads are stale.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/notifications/me` | `x-api-key` + Bearer JWT | List the caller's notifications |
| PATCH | `/notifications/me/{notificationId}` | `x-api-key` + Bearer JWT | Archive a single caller-owned notification |
| POST | `/notifications/dispatch` | `x-api-key` + Bearer JWT | Create a notification for any target user |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| List wrapper | `GET /notifications/me` returns `data: Notification[]` plus `pagination` |
| Archive response | PATCH returns no `data` |
| Dispatch response | Dispatch returns the full created notification inside `data`, not just the new `_id` |
| Ownership model | Archive filters by both `_id` and `userId`; another user's notification returns `404 common.notFound`, not `403` |
| Archive semantics | PATCH always sets `isArchived: true`; the request body is ignored |
| Dispatch permissions | Any authenticated user can dispatch to any `targetUserId` |
| Dispatch rate limit | Layered per-IP, per-caller, and per-target throttling returns `429 common.rateLimited` when exceeded |
| Archived list behavior | `GET /notifications/me` still returns rows where `isArchived` is already `true` |

---

## Auth Reference

Gateway/API-key/JWT behavior for notifications routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization

- `GET /notifications/me` scopes results to `jwt.userId`
- `PATCH /notifications/me/{notificationId}` only archives rows where `_id` and `userId` both match
- `POST /notifications/dispatch` does not enforce target ownership and can dispatch to any `targetUserId`

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Use `errorKey` for branching logic

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

Archive success:

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

Dispatch success:

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "userId": "665f1a2b3c4d5e6f7a8b9c01",
    "type": "vaccine_reminder",
    "petId": "665f1a2b3c4d5e6f7a8b9c02",
    "petName": "Mochi",
    "nextEventDate": "2026-06-01T00:00:00.000Z",
    "nearbyPetLost": null,
    "isArchived": false,
    "createdAt": "2026-05-08T12:00:00.000Z",
    "updatedAt": "2026-05-08T12:00:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "common.notFound",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

### Notification Record Shape

Notifications returned in list and dispatch responses may include:

- `_id`
- `userId`
- `type`
- `petId`
- `petName`
- `nextEventDate`
- `nearbyPetLost`
- `isArchived`
- `createdAt`
- `updatedAt`

`__v` is removed before the record is returned.

### Supported Notification Types

- `nearby_pet_lost`
- `vaccine_reminder`
- `deworming_reminder`
- `medical_reminder`
- `adoption_follow_up`
- `ownership_transfer`

---

## Endpoints

### GET /notifications/me

List the caller's notifications.

**Lambda owner:** `notifications`  
**Auth:** `x-api-key` + Bearer JWT required

#### Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Shared pagination schema |
| `limit` | integer | No | Shared pagination schema |

The result is sorted by `createdAt` descending.

#### List Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "userId": "665f1a2b3c4d5e6f7a8b9c01",
      "type": "vaccine_reminder",
      "isArchived": false,
      "petName": "Mochi"
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

#### List Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid pagination query |
| 500 | `common.internalError` | Unexpected internal error |

### PATCH /notifications/me/{notificationId}

Archive one caller-owned notification.

**Lambda owner:** `notifications`  
**Auth:** `x-api-key` + Bearer JWT required

#### Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `notificationId` | string | Yes | MongoDB ObjectId |

#### Request Body

None required. The handler ignores body content.

#### Archive Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | Invalid `notificationId` |
| 404 | `common.notFound` | Notification not found or not owned by caller |
| 500 | `common.internalError` | Unexpected internal error |

### POST /notifications/dispatch

Create a notification for any target user.

**Lambda owner:** `notifications`  
**Auth:** `x-api-key` + Bearer JWT  
**Content-Type:** `application/json`

#### Dispatch Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `targetUserId` | string | Yes | MongoDB ObjectId |
| `type` | enum string | Yes | One of the supported notification types |
| `petId` | string or `null` | No | MongoDB ObjectId when present |
| `petName` | string or `null` | No | Max 100 chars |
| `nextEventDate` | string or `null` | No | ISO-like or `DD/MM/YYYY` |
| `nearbyPetLost` | string or `null` | No | Max 2000 chars |

The body schema is strict. Extra keys are rejected.

#### Dispatch Example Request

```json
{
  "targetUserId": "665f1a2b3c4d5e6f7a8b9c01",
  "type": "vaccine_reminder",
  "petId": "665f1a2b3c4d5e6f7a8b9c02",
  "petName": "Mochi",
  "nextEventDate": "2026-06-01"
}
```

#### Dispatch Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON, strict-schema violation, or invalid field type |
| 400 | `notifications.errors.typeRequired` | Invalid or missing notification type |
| 400 | `notifications.errors.invalidDate` | Invalid `nextEventDate` |
| 429 | `common.rateLimited` | Dispatch write rate limit exceeded |
| 500 | `common.internalError` | Unexpected internal error |

---

## Frontend Integration Guide

1. Read inbox state from `data` and pagination state from `pagination`; do not use the older `notifications` or `count` keys.
2. Treat `common.notFound` from archive as a stale-client state: the item is missing or not owned by the current user.
3. The dispatch route accepts any authenticated Bearer JWT and writes the notification to the supplied `targetUserId`.
4. Frontend should handle `429 common.rateLimited` on dispatch and retry after the `retry-after` header when present.

---

## Verification Snapshot

This document is grounded in `functions/notifications/src/services/notifications.ts`, `functions/notifications/src/zodSchema/notificationSchema.ts`, and the current router wiring. The main post-migration correction is the wrapper-based `data` / `pagination` contract.

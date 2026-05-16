# Commerce Fulfillment API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-commerce-fulfillment`

Post-order fulfillment, supplier edit flows, WhatsApp share-link retrieval, and admin notification commands. The current DDD implementation uses the shared `{ success, message, data, pagination?, requestId }` envelope. Older docs that describe top-level `orderVerification`, `form`, `id`, `orderVerificationId`, or `notificationDispatched` payloads are stale.

---

## Overview

### Route Summary

| Method | Path | Auth | Content-Type | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/commerce/fulfillment` | `x-api-key` + Bearer JWT with `admin` or `developer` role | — | Paginated fulfillment list |
| DELETE | `/commerce/fulfillment/{orderVerificationId}` | `x-api-key` + Bearer JWT with `admin` or `developer` role | — | Soft-cancel one order-verification record |
| GET | `/commerce/fulfillment/tags/{tagId}` | `x-api-key` + Bearer JWT | — | Read one tag-bound fulfillment record |
| PATCH | `/commerce/fulfillment/tags/{tagId}` | `x-api-key` + Bearer JWT | `application/json` | Update allowed fields on one tag-bound record |
| GET | `/commerce/fulfillment/suppliers/{orderId}` | `x-api-key` + Bearer JWT | — | Read supplier-facing fulfillment view |
| PATCH | `/commerce/fulfillment/suppliers/{orderId}` | `x-api-key` + Bearer JWT | `application/json` | Update supplier-editable fulfillment fields |
| GET | `/commerce/fulfillment/share-links/whatsapp/{verificationId}` | `x-api-key` + Bearer JWT | — | Read WhatsApp share-link payload for one verification |
| POST | `/commerce/commands/ptag-detection-email` | `x-api-key` + Bearer JWT with `admin` or `developer` role | `application/json` | Send PTag detection email |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| List wrapper | `GET /commerce/fulfillment` returns `data` plus `pagination`, not top-level `orderVerification` |
| Cancel response | DELETE success returns only `{ success, message, requestId }`; there is no returned id payload |
| Tag GET shape | `GET /commerce/fulfillment/tags/{tagId}` returns a flat object in `data`, not `form` |
| Tag PATCH response | PATCH tag update returns no `data`; old `notificationDispatched` output is gone |
| Supplier auth | Supplier routes enforce owner-or-admin/developer access using linked order email first, then `masterEmail` fallback |
| Supplier lookup fallback | Supplier identifier is resolved in order: `orderId`, then `contact`, then `tagId` |
| Share-link auth | WhatsApp share-link route uses `verificationId` ObjectId and owner checks against linked order email or `masterEmail` |
| Tag-route openness | Tag GET and tag PATCH require authentication, but do not apply ownership checks |
| Email command side effect | PTag detection email is sent to the provided user email with CC to `notification@ptag.com.hk` |

---

## Auth Reference

Gateway/API-key/JWT behavior for commerce-fulfillment routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization

| Route | Rule |
| --- | --- |
| `GET /commerce/fulfillment` | Admin or developer only |
| `DELETE /commerce/fulfillment/{orderVerificationId}` | Admin or developer only |
| `GET /commerce/fulfillment/tags/{tagId}` | Any authenticated caller |
| `PATCH /commerce/fulfillment/tags/{tagId}` | Any authenticated caller |
| `GET /commerce/fulfillment/suppliers/{orderId}` | Owner of linked order or admin/developer |
| `PATCH /commerce/fulfillment/suppliers/{orderId}` | Owner of linked order or admin/developer |
| `GET /commerce/fulfillment/share-links/whatsapp/{verificationId}` | Owner of linked order or admin/developer |
| `POST /commerce/commands/ptag-detection-email` | Admin or developer only |

### Request-Model Validation

These routes use the `GenericJsonObjectRequest` API Gateway model:

- `PATCH /commerce/fulfillment/tags/{tagId}`
- `PATCH /commerce/fulfillment/suppliers/{orderId}`
- `POST /commerce/commands/ptag-detection-email`

Malformed non-object JSON can be rejected before Lambda runs. Lambda-level body validation still enforces strict field schemas.

### Rate Limits

No dedicated route-level rate limiter is configured inside the fulfillment handlers.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Use `errorKey` for integration logic instead of `error`

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

Single-record success:

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {},
  "requestId": "aws-lambda-request-id"
}
```

Update / delete / command success:

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "fulfillment.errors.notFound",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

---

## Endpoints

### GET /commerce/fulfillment

Return paginated fulfillment list. Admin/developer only.

**Lambda owner:** `commerce-fulfillment`  
**Auth:** `x-api-key` + Bearer JWT with `admin` or `developer` role

#### Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Default `1` |
| `limit` | integer | No | Default `30`, max `100` |

#### Returned List Item Shape

Each item in `data` is sanitized to:

- `_id`
- `tagId`
- `staffVerification`
- `verifyDate`
- `petName`
- `shortUrl`
- `masterEmail`
- `qrUrl`
- `petUrl`
- `orderId`
- `pendingStatus`
- `option`
- `type`
- `optionSize`
- `optionColor`
- `price`
- `createdAt`
- `updatedAt`

`cancelled` and `discountProof` are not returned in the current sanitized list payload.

#### Fulfillment List Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c30",
      "tagId": "A2B3C4",
      "staffVerification": false,
      "verifyDate": null,
      "petName": "Mochi",
      "shortUrl": "https://cutt.ly/example",
      "masterEmail": "owner@example.com",
      "qrUrl": "https://cdn.example.com/qr-codes/A2B3C4.png",
      "petUrl": "https://cdn.example.com/user-uploads/orders/TEMP-ORDER-001/file.jpg",
      "orderId": "TEMP-ORDER-001",
      "pendingStatus": false,
      "option": "PTagClassic",
      "type": "",
      "optionSize": "",
      "optionColor": "",
      "price": 298,
      "createdAt": "2026-05-10T12:34:56.000Z",
      "updatedAt": "2026-05-10T12:34:56.000Z"
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

#### Fulfillment List Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid `page` or `limit` |
| 403 | `common.forbidden` | Caller is not `admin` or `developer` |
| 500 | `common.internalError` | Unexpected database or server error |

### DELETE /commerce/fulfillment/{orderVerificationId}

Soft-cancel one order-verification record by Mongo `_id`.

**Lambda owner:** `commerce-fulfillment`  
**Auth:** `x-api-key` + Bearer JWT with `admin` or `developer` role

#### Cancel Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `orderVerificationId` | string | Yes | MongoDB ObjectId |

#### Cancel Success (200)

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

The handler sets `cancelled: true` and does not hard-delete the record.

#### Cancel Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingPathParams` | Missing `orderVerificationId` |
| 400 | `common.invalidObjectId` | Invalid `orderVerificationId` |
| 403 | `common.forbidden` | Caller is not `admin` or `developer` |
| 404 | `fulfillment.errors.notFound` | Verification not found |
| 409 | `fulfillment.errors.alreadyCancelled` | Verification already cancelled |
| 500 | `common.internalError` | Unexpected database or server error |

### GET /commerce/fulfillment/tags/{tagId}

Read one tag-bound fulfillment record plus linked SF waybill number.

**Lambda owner:** `commerce-fulfillment`  
**Auth:** `x-api-key` + Bearer JWT required

#### Tag Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `tagId` | string | Yes | Validated by the shared temp-id path parser |

#### Tag Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c31",
    "tagId": "A2B3C4",
    "staffVerification": false,
    "contact": "91234567",
    "verifyDate": null,
    "tagCreationDate": "2026-05-10T12:34:56.000Z",
    "petName": "Mochi",
    "shortUrl": "https://cutt.ly/example",
    "masterEmail": "owner@example.com",
    "qrUrl": "https://cdn.example.com/qr-codes/A2B3C4.png",
    "petUrl": "https://cdn.example.com/user-uploads/orders/TEMP-ORDER-001/file.jpg",
    "orderId": "TEMP-ORDER-001",
    "location": "123 Nathan Road",
    "petHuman": "Chan",
    "createdAt": "2026-05-10T12:34:56.000Z",
    "updatedAt": "2026-05-10T12:34:56.000Z",
    "pendingStatus": false,
    "option": "PTagClassic",
    "sf": "SF1234567890"
  },
  "requestId": "aws-lambda-request-id"
}
```

`sf` may be absent or `null` when no linked order or no waybill exists yet.

#### Tag Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidPathParams` | Missing or invalid `tagId` |
| 404 | `fulfillment.errors.notFound` | Verification not found for `tagId` |
| 500 | `common.internalError` | Unexpected database or server error |

### PATCH /commerce/fulfillment/tags/{tagId}

Update allowed fields on one tag-bound record. Any authenticated caller can use this route.

**Lambda owner:** `commerce-fulfillment`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Tag PATCH Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `tagId` | string | Yes | Validated by the shared temp-id path parser |

#### Tag PATCH Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `contact` | string | No | Trimmed, normalized phone |
| `verifyDate` | string | No | Must parse through the fulfillment `DD/MM/YYYY` / date parser |
| `petName` | string | No | Max 100 |
| `shortUrl` | string | No | Max 2048 |
| `masterEmail` | string | No | Max 254; normalized to lowercase |
| `orderId` | string | No | Max 64; must not duplicate another verification's `orderId` |
| `location` | string | No | Max 200 |
| `petHuman` | string | No | Max 200 |

The body schema is strict. Extra keys are rejected.

#### Tag PATCH Side Effect

After a successful update, the handler attempts to send a WhatsApp tracking message using the linked order's phone number and waybill number. Failure is logged but does not change the HTTP success response.

#### Tag PATCH Success (200)

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

#### Tag PATCH Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidPathParams` | Missing or invalid `tagId` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON or strict-schema violation |
| 400 | `common.noFieldsToUpdate` | Body parsed but no supported non-empty fields were supplied |
| 400 | `fulfillment.errors.invalidDate` | `verifyDate` failed fulfillment date parsing |
| 404 | `fulfillment.errors.notFound` | Verification not found for `tagId` |
| 409 | `fulfillment.errors.duplicateOrderId` | Another verification already uses the requested `orderId` |
| 500 | `common.internalError` | Unexpected database or server error |

### GET /commerce/fulfillment/suppliers/{orderId}

Read supplier-facing fulfillment view with owner-or-admin authorization.

**Lambda owner:** `commerce-fulfillment`  
**Auth:** `x-api-key` + Bearer JWT required

#### Supplier Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `orderId` | string | Yes | Validated by the shared temp-id path parser |

#### Identifier Resolution

The handler resolves the supplied identifier in this order:

1. `OrderVerification.orderId`
2. `OrderVerification.contact`
3. `OrderVerification.tagId`

#### Supplier Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c32",
    "tagId": "A2B3C4",
    "staffVerification": false,
    "contact": "91234567",
    "verifyDate": null,
    "tagCreationDate": "2026-05-10T12:34:56.000Z",
    "petName": "Mochi",
    "shortUrl": "https://cutt.ly/example",
    "masterEmail": "owner@example.com",
    "qrUrl": "https://cdn.example.com/qr-codes/A2B3C4.png",
    "petUrl": "https://cdn.example.com/user-uploads/orders/TEMP-ORDER-001/file.jpg",
    "orderId": "TEMP-ORDER-001",
    "location": "123 Nathan Road",
    "petHuman": "Chan",
    "createdAt": "2026-05-10T12:34:56.000Z",
    "updatedAt": "2026-05-10T12:34:56.000Z",
    "pendingStatus": false,
    "option": "PTagClassic",
    "optionSize": "",
    "optionColor": ""
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Supplier Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidPathParams` | Missing or invalid `orderId` |
| 403 | `common.forbidden` | Caller does not own the linked order and is not privileged |
| 404 | `fulfillment.errors.notFound` | No matching verification found |
| 500 | `common.internalError` | Unexpected database or server error |

### PATCH /commerce/fulfillment/suppliers/{orderId}

Update supplier-editable fulfillment fields with owner-or-admin authorization.

**Lambda owner:** `commerce-fulfillment`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Supplier PATCH Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `contact` | string | No | Normalized phone |
| `petName` | string | No | Max 100 |
| `shortUrl` | string | No | Max 2048 |
| `masterEmail` | string | No | Max 254; normalized to lowercase |
| `location` | string | No | Max 200 |
| `petHuman` | string | No | Max 200 |
| `pendingStatus` | boolean | No | Must be boolean |
| `qrUrl` | string | No | Max 2048 |
| `petUrl` | string | No | Max 2048 |
| `petContact` | string | No | Updates linked `Order.petContact` when an order link exists |

The body schema is strict. Extra keys are rejected.

#### Supplier PATCH Success (200)

```json
{
  "success": true,
  "message": "Updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

#### Supplier PATCH Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidPathParams` | Missing or invalid `orderId` |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON or strict-schema violation |
| 400 | `common.noFieldsToUpdate` | Body parsed but no supported non-empty fields were supplied |
| 400 | `fulfillment.errors.invalidPendingStatus` | `pendingStatus` is not boolean |
| 403 | `common.forbidden` | Caller does not own the linked order and is not privileged |
| 404 | `fulfillment.errors.notFound` | No matching verification found |
| 500 | `common.internalError` | Unexpected database or server error |

### GET /commerce/fulfillment/share-links/whatsapp/{verificationId}

Read one fulfillment record for the WhatsApp share-link flow.

**Lambda owner:** `commerce-fulfillment`  
**Auth:** `x-api-key` + Bearer JWT required

#### Share-Link Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `verificationId` | string | Yes | MongoDB ObjectId |

#### Share-Link Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c33",
    "tagId": "A2B3C4",
    "staffVerification": false,
    "contact": "91234567",
    "verifyDate": null,
    "tagCreationDate": "2026-05-10T12:34:56.000Z",
    "petName": "Mochi",
    "shortUrl": "https://cutt.ly/example",
    "masterEmail": "owner@example.com",
    "qrUrl": "https://cdn.example.com/qr-codes/A2B3C4.png",
    "petUrl": "https://cdn.example.com/user-uploads/orders/TEMP-ORDER-001/file.jpg",
    "orderId": "TEMP-ORDER-001",
    "location": "123 Nathan Road",
    "petHuman": "Chan",
    "pendingStatus": false,
    "option": "PTagClassic",
    "price": 298,
    "type": "",
    "optionSize": "",
    "optionColor": "",
    "createdAt": "2026-05-10T12:34:56.000Z",
    "updatedAt": "2026-05-10T12:34:56.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Share-Link Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingPathParams` | Missing `verificationId` |
| 400 | `common.invalidObjectId` | Invalid `verificationId` |
| 403 | `common.forbidden` | Caller does not own the linked order and is not privileged |
| 404 | `fulfillment.errors.notFound` | Verification not found |
| 500 | `common.internalError` | Unexpected database or server error |

### POST /commerce/commands/ptag-detection-email

Send PTag detection email to one user. Admin/developer only.

**Lambda owner:** `commerce-fulfillment`  
**Auth:** `x-api-key` + Bearer JWT with `admin` or `developer` role  
**Content-Type:** `application/json`

#### Detection Email Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | Yes | Max 200 |
| `tagId` | string | Yes | Max 64 |
| `dateTime` | string | Yes | Max 64 |
| `locationURL` | string | Yes | Absolute `https://` URL, max 2048 |
| `email` | string | Yes | Valid email, max 254 |

The body schema is strict. Extra keys are rejected.

#### Command Example Request

```json
{
  "name": "Mochi",
  "tagId": "A2B3C4",
  "dateTime": "2026-05-10 20:30",
  "locationURL": "https://maps.google.com/?q=22.3193,114.1694",
  "email": "owner@example.com"
}
```

#### Command Side Effect

On success, the Lambda sends the rendered HTML email to the provided `email` address and CCs `notification@ptag.com.hk`.

#### Command Success (200)

```json
{
  "success": true,
  "message": "Created successfully",
  "requestId": "aws-lambda-request-id"
}
```

#### Command Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Malformed JSON or strict-schema violation |
| 400 | `fulfillment.errors.invalidLocationURL` | `locationURL` is not a valid `https://` URL |
| 400 | `fulfillment.errors.invalidEmail` | Invalid email |
| 403 | `common.forbidden` | Caller is not `admin` or `developer` |
| 503 | `fulfillment.errors.emailServiceUnavailable` | SMTP send failed |
| 500 | `common.internalError` | Unexpected server error |

---

## Frontend Integration Guide

1. Use `/commerce/orders/operations` for admin operations dashboards and `/commerce/fulfillment` for admin fulfillment dashboards; they are different list payloads from different Lambdas.
2. Read all single-record fulfillment responses from `data`; the old `form` wrapper is gone.
3. Do not expect any payload body from successful DELETE or PATCH fulfillment mutations beyond the shared success envelope.
4. Use supplier routes when ownership checks matter. Use tag routes only when any authenticated user is allowed to access the verification record.
5. For supplier lookup and update, remember the identifier fallback order: `orderId`, then `contact`, then `tagId`.

---

## Verification Snapshot

This document is grounded in `functions/commerce-fulfillment/src/services/verifications.ts`, `cancel.ts`, `tags.ts`, `suppliers.ts`, `shareLinks.ts`, `commands.ts`, the fulfillment schemas and self-access helpers, the commerce-fulfillment tests, and the route wiring in `template.yaml`.

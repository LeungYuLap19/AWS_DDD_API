# Commerce Fulfillment API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda name:** `aws-ddd-api-{stage}-commerce-fulfillment`

Post-order lifecycle management: admin review/cancellation, tag-based verification management, supplier-facing edit flows, WhatsApp share links, and PTag detection email dispatch. All routes (except OPTIONS) require `x-api-key` + `Authorization: Bearer <token>`.

> See also: [COMMERCE_CATALOG.md](COMMERCE_CATALOG.md), [COMMERCE_ORDERS.md](COMMERCE_ORDERS.md)

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/commerce/fulfillment` | `x-api-key` + JWT; admin/developer only | Paginated list of all order verifications |
| DELETE | `/commerce/fulfillment/{orderVerificationId}` | `x-api-key` + JWT; admin/developer only | Soft-cancel one order verification |
| GET | `/commerce/fulfillment/tags/{tagId}` | `x-api-key` + JWT; any authenticated user | Get tag-bound verification record |
| PATCH | `/commerce/fulfillment/tags/{tagId}` | `x-api-key` + JWT; any authenticated user | Update tag verification fields |
| GET | `/commerce/fulfillment/suppliers/{orderId}` | `x-api-key` + JWT; owner or admin/developer | Get supplier-facing verification view |
| PATCH | `/commerce/fulfillment/suppliers/{orderId}` | `x-api-key` + JWT; owner or admin/developer | Update supplier-editable verification fields |
| GET | `/commerce/fulfillment/share-links/whatsapp/{verificationId}` | `x-api-key` + JWT; owner or admin/developer | Get verification payload for WhatsApp deep-link flow |
| POST | `/commerce/commands/ptag-detection-email` | `x-api-key` + JWT; admin/developer only | Send PTag location alert email to pet owner |

### Domain Model Relationships

```
Order (tempId)  ──────────────────────────────── OrderVerification (orderId = Order.tempId)
  └── buyDate, lastName, email, price, option      └── tagId, staffVerification, qrUrl, shortUrl
  └── delivery, paymentWay, shopCode               └── verifyDate, pendingStatus, cancelled
  └── petImg, petContact, sfWayBillNumber           └── masterEmail, contact, location, petHuman
```

---

## API Gateway and Auth Rules

### API Gateway Requirements

| Route group | API key required | API Gateway authorizer |
| --- | --- | --- |
| All `/commerce/fulfillment` and `/commerce/commands` routes | Yes | Lambda authorizer |
| `OPTIONS` preflight routes | No | None |

### Authentication

| Scenario | Requirement |
| --- | --- |
| Fulfillment tag/supplier/whatsapp-link | `Authorization: Bearer <access-token>` + `x-api-key` |
| Admin-only fulfillment routes | `Authorization: Bearer <access-token>` + `x-api-key`; role must be `admin` or `developer` |

**Privileged roles:** `admin` and `developer`. They bypass ownership checks on all routes.

### Ownership Rules

| Route | Non-privileged access control |
| --- | --- |
| `GET /commerce/fulfillment/suppliers/{orderId}` | Caller's JWT email must match the email on the linked `Order`; falls back to `OrderVerification.masterEmail` |
| `PATCH /commerce/fulfillment/suppliers/{orderId}` | Same ownership check as GET |
| `GET /commerce/fulfillment/share-links/whatsapp/{verificationId}` | Caller's JWT email must match the linked `Order.email`; falls back to `OrderVerification.masterEmail` |
| `GET /commerce/fulfillment/tags/{tagId}` | Any authenticated user (no ownership check) |
| `PATCH /commerce/fulfillment/tags/{tagId}` | Any authenticated user (no ownership check) |

---

## Shared Conventions

### Success Response Shape

```json
{
  "success": true,
  "message": "<optional localized message>",
  "<endpoint-specific fields>": "...",
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "fulfillment.errors.notFound",
  "error": "Localized message (zh default)",
  "requestId": "aws-lambda-request-id"
}
```

Use `errorKey` for programmatic branching. `error` is localized and not stable.

### Common Error Keys

| `errorKey` | Status | Meaning |
| --- | --- | --- |
| `common.unauthorized` | 401 / 403 | Missing/invalid JWT, or ownership check failed |
| `common.forbidden` | 403 | Role check failed |
| `common.invalidObjectId` | 400 | Path parameter is not a valid MongoDB ObjectId |
| `common.missingBodyParams` | 400 | Body is missing or empty (caught before schema) |
| `common.invalidBodyParams` | 400 | Malformed JSON or unknown field key (strict schema rejects unknown keys) |
| `common.missingParams` | 400 | Body is valid but all field values are empty or non-updatable |
| `common.internalError` | 500 | Unhandled server error — look up by `requestId` in CloudWatch |

### Pagination

List endpoints accept `?page=<n>&limit=<n>`. All return a `pagination` object:

```json
{ "page": 1, "limit": 100, "total": 450 }
```

| Param | Default | Max |
| --- | --- | --- |
| `page` | 1 | — |
| `limit` | 100 | 500 |

### Localization

Append `?lang=en` for English messages. Default is `zh` (Traditional Chinese).

---

## Endpoints

### GET /commerce/fulfillment

Returns paginated list of all `OrderVerification` records. Admin/developer only.

**Auth:** `x-api-key` + JWT; role must be `admin` or `developer`
**Rate limit:** None configured

**Query params:** `page`, `limit` (same defaults and max as above)

**Success (200):**

```json
{
  "success": true,
  "orderVerification": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c12",
      "tagId": "A2B3C4",
      "staffVerification": false,
      "verifyDate": null,
      "petName": "Mochi",
      "shortUrl": "https://cutt.ly/abc123",
      "masterEmail": "owner@example.com",
      "qrUrl": "https://bucket.s3.amazonaws.com/qr-codes/A2B3C4.png",
      "petUrl": "https://bucket.s3.amazonaws.com/user-uploads/orders/ORDER-2025-001/pet.jpg",
      "orderId": "ORDER-2025-001",
      "pendingStatus": false,
      "option": "PTagStandard",
      "type": "",
      "optionSize": "",
      "optionColor": "",
      "price": 298,
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 320
  },
  "requestId": "aws-lambda-request-id"
}
```

**Note:** `cancelled` and `discountProof` are selected from DB but stripped by `sanitizeOrderVerification`. `contact`, `tagCreationDate`, `location`, and `petHuman` are not included in the list projection and will not appear in list items. These fields are only present on single-record endpoints (`/tags/{tagId}`, `/suppliers/{orderId}`, `/share-links/whatsapp/{verificationId}`). The list includes all records regardless of cancellation state.

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 403 | `common.forbidden` | Caller is not `admin` or `developer` |
| 500 | `common.internalError` | Unexpected error |

---

### DELETE /commerce/fulfillment/{orderVerificationId}

Soft-cancels one order verification by MongoDB `_id`. Sets `cancelled: true`. Does not hard-delete. Admin/developer only.

**Auth:** `x-api-key` + JWT; role must be `admin` or `developer`
**Rate limit:** None configured

**Path parameter:**

| Param | Type | Notes |
| --- | --- | --- |
| `orderVerificationId` | string | MongoDB ObjectId of the `OrderVerification` document |

**Success (200):**

```json
{
  "success": true,
  "message": "Cancelled successfully.",
  "orderVerificationId": "665f1a2b3c4d5e6f7a8b9c12",
  "requestId": "aws-lambda-request-id"
}
```

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `fulfillment.errors.missingVerificationId` | `orderVerificationId` path param is absent |
| 400 | `common.invalidObjectId` | `orderVerificationId` is not a valid MongoDB ObjectId |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 403 | `common.forbidden` | Caller is not `admin` or `developer` |
| 404 | `fulfillment.errors.notFound` | No `OrderVerification` with this `_id` |
| 409 | `fulfillment.errors.alreadyCancelled` | `cancelled` is already `true` |
| 500 | `common.internalError` | Unexpected error |

---

### GET /commerce/fulfillment/tags/{tagId}

Returns the tag-bound `OrderVerification` record, plus the linked SF waybill number from the associated `Order`. Any authenticated user can access.

**Auth:** `x-api-key` + JWT; any authenticated user (no ownership check)
**Rate limit:** None configured

**Path parameter:**

| Param | Type | Notes |
| --- | --- | --- |
| `tagId` | string | The `OrderVerification.tagId` value (e.g. `"A2B3C4"`) |

**Success (200):**

```json
{
  "success": true,
  "message": "Order Verification info retrieved successfully",
  "id": "665f1a2b3c4d5e6f7a8b9c12",
  "sf": "SF1234567890",
  "form": {
    "tagId": "A2B3C4",
    "staffVerification": false,
    "contact": "91234567",
    "verifyDate": null,
    "tagCreationDate": "2025-01-15T10:30:00.000Z",
    "petName": "Mochi",
    "shortUrl": "https://cutt.ly/abc123",
    "masterEmail": "owner@example.com",
    "qrUrl": "https://bucket.s3.amazonaws.com/qr-codes/A2B3C4.png",
    "petUrl": "https://bucket.s3.amazonaws.com/user-uploads/orders/ORDER-2025-001/pet.jpg",
    "orderId": "ORDER-2025-001",
    "location": "123 Nathan Road, Mong Kok",
    "petHuman": "Chan",
    "pendingStatus": false,
    "option": "PTagStandard",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

`sf` is `null` or `undefined` when no linked order exists or when the linked order has no `sfWayBillNumber` yet.

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `fulfillment.errors.missingTagId` | `tagId` path param is absent |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 404 | `fulfillment.errors.notFound` | No `OrderVerification` with this `tagId` |
| 500 | `common.internalError` | Unexpected error |

---

### PATCH /commerce/fulfillment/tags/{tagId}

Updates allowed fields on the tag-bound `OrderVerification`. On success, attempts a WhatsApp tracking message dispatch (non-fatal). Any authenticated user can update (no ownership check).

**Auth:** `x-api-key` + JWT; any authenticated user
**Rate limit:** None configured
**Content-Type:** `application/json`

**Path parameter:**

| Param | Type | Notes |
| --- | --- | --- |
| `tagId` | string | The `OrderVerification.tagId` value |

**Body (all fields optional; at least one required):**

| Field | Type | Notes |
| --- | --- | --- |
| `contact` | string | Phone number; normalized to digits only |
| `verifyDate` | string | Date in `DD/MM/YYYY` format; e.g. `"15/01/2025"` |
| `petName` | string | |
| `shortUrl` | string | |
| `masterEmail` | string | Normalized to lowercase |
| `orderId` | string | If changing, must not conflict with an existing `OrderVerification.orderId` |
| `location` | string | |
| `petHuman` | string | |

**Example:**

```json
{
  "contact": "91234567",
  "verifyDate": "15/01/2025"
}
```

> `staffVerification` is **not** an updatable field on this route — `tagUpdateSchema` uses `.strict()` and will reject any unknown key with `400`.

**Side effect:** After a successful update, the Lambda fetches the updated `OrderVerification` and its linked `Order`, then attempts to dispatch a WhatsApp tracking notification. This dispatch is non-fatal — if it fails, the update response is still `200`.

**Success (200):**

```json
{
  "success": true,
  "message": "Tag info updated successfully",
  "id": "665f1a2b3c4d5e6f7a8b9c12",
  "notificationDispatched": true,
  "requestId": "aws-lambda-request-id"
}
```

`notificationDispatched` is `false` if the WhatsApp token is not configured, if required contact/waybill fields are missing on the linked order, or if the dispatch threw an error.

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `fulfillment.errors.missingTagId` | `tagId` path param is absent |
| 400 | `common.missingBodyParams` | Body is missing or empty |
| 400 | `common.invalidBodyParams` | Malformed JSON or unknown field key (strict schema) |
| 400 | `common.missingParams` | Body is valid but all field values are empty or non-updatable |
| 400 | `fulfillment.errors.invalidDate` | `verifyDate` is not in `DD/MM/YYYY` format |
| 400 | `fulfillment.errors.invalidField` | A provided field failed type validation |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 404 | `fulfillment.errors.notFound` | No `OrderVerification` with this `tagId` |
| 409 | `fulfillment.errors.duplicateOrderId` | New `orderId` is already owned by another `OrderVerification` |
| 500 | `common.internalError` | Unexpected error |

---

### GET /commerce/fulfillment/suppliers/{orderId}

Returns the supplier-facing verification view. Non-admin callers must own the linked order.

**Auth:** `x-api-key` + JWT; owner or admin/developer
**Rate limit:** None configured

**Path parameter:**

| Param | Type | Notes |
| --- | --- | --- |
| `orderId` | string | Resolved as `OrderVerification.orderId` first; falls back to `contact` (phone), then `tagId` if no match |

**Ownership rule:** Admin/developer bypass. Non-privileged callers must have a JWT email matching the linked `Order.email`. If the `orderId` cannot be linked to an `Order`, ownership falls back to `OrderVerification.masterEmail`.

**Success (200):**

```json
{
  "success": true,
  "message": "Order Verification info retrieved successfully",
  "id": "665f1a2b3c4d5e6f7a8b9c12",
  "form": {
    "tagId": "A2B3C4",
    "staffVerification": false,
    "contact": "91234567",
    "verifyDate": null,
    "tagCreationDate": "2025-01-15T10:30:00.000Z",
    "petName": "Mochi",
    "shortUrl": "https://cutt.ly/abc123",
    "masterEmail": "owner@example.com",
    "qrUrl": "https://bucket.s3.amazonaws.com/qr-codes/A2B3C4.png",
    "petUrl": "https://bucket.s3.amazonaws.com/user-uploads/orders/ORDER-2025-001/pet.jpg",
    "orderId": "ORDER-2025-001",
    "location": "123 Nathan Road, Mong Kok",
    "petHuman": "Chan",
    "pendingStatus": false,
    "option": "PTagStandard",
    "optionSize": "",
    "optionColor": "",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `fulfillment.errors.missingOrderId` | `orderId` path param is absent |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 403 | `common.unauthorized` | Ownership check failed |
| 404 | `fulfillment.errors.notFound` | No matching `OrderVerification` found |
| 500 | `common.internalError` | Unexpected error |

---

### PATCH /commerce/fulfillment/suppliers/{orderId}

Updates supplier-editable fields on the verification record. Accepts JSON only.

**Auth:** `x-api-key` + JWT; owner or admin/developer
**Rate limit:** None configured
**Content-Type:** `application/json`

**DDD delta vs legacy:** Legacy `PUT /v2/orderVerification/supplier/{orderId}` accepted multipart/form-data. The DDD version accepts JSON only.

**Path parameter:** Same as `GET /commerce/fulfillment/suppliers/{orderId}` — resolved by `orderId`, falling back to `contact`, then `tagId`.

**Body (all fields optional; at least one of the listed fields or `petContact` required):**

| Field | Type | Notes |
| --- | --- | --- |
| `contact` | string | Updates `OrderVerification.contact`; normalized to digits only |
| `petName` | string | Updates `OrderVerification.petName` |
| `shortUrl` | string | Updates `OrderVerification.shortUrl` |
| `masterEmail` | string | Updates `OrderVerification.masterEmail`; normalized to lowercase |
| `location` | string | Updates `OrderVerification.location` |
| `petHuman` | string | Updates `OrderVerification.petHuman` |
| `pendingStatus` | boolean | Updates `OrderVerification.pendingStatus` |
| `qrUrl` | string | Updates `OrderVerification.qrUrl` |
| `petUrl` | string | Updates `OrderVerification.petUrl` |
| `petContact` | string | Updates the linked `Order.petContact`; normalized to digits only |

**Example:**

```json
{
  "contact": "91234567",
  "petName": "Mochi updated",
  "petContact": "61234567"
}
```

**Success (200):**

```json
{
  "success": true,
  "message": "Tag info updated successfully",
  "requestId": "aws-lambda-request-id"
}
```

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `fulfillment.errors.missingOrderId` | `orderId` path param is absent |
| 400 | `common.missingBodyParams` | Body is missing or empty |
| 400 | `common.invalidBodyParams` | Malformed JSON or unknown field key (strict schema) |
| 400 | `common.missingParams` | Body is valid but all field values are empty or non-updatable |
| 400 | `fulfillment.errors.invalidField` | A provided field failed type validation |
| 400 | `fulfillment.errors.invalidPendingStatus` | `pendingStatus` is not a boolean |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 403 | `common.unauthorized` | Ownership check failed |
| 404 | `fulfillment.errors.notFound` | No matching `OrderVerification` found |
| 500 | `common.internalError` | Unexpected error |

---

### GET /commerce/fulfillment/share-links/whatsapp/{verificationId}

Returns the full verification payload for the WhatsApp deep-link flow. Non-admin callers must own the linked order.

**Auth:** `x-api-key` + JWT; owner or admin/developer
**Rate limit:** None configured

**Path parameter:**

| Param | Type | Notes |
| --- | --- | --- |
| `verificationId` | string | MongoDB `_id` of the `OrderVerification` document |

**Ownership rule:** Admin/developer bypass. Non-privileged callers: the `OrderVerification.orderId` is used to look up the linked `Order` and match by email. If there is no linked `Order`, falls back to matching `OrderVerification.masterEmail` against the caller's JWT email.

**Success (200):**

```json
{
  "success": true,
  "message": "Order Verification info retrieved successfully",
  "id": "665f1a2b3c4d5e6f7a8b9c12",
  "form": {
    "tagId": "A2B3C4",
    "staffVerification": false,
    "contact": "91234567",
    "verifyDate": null,
    "tagCreationDate": "2025-01-15T10:30:00.000Z",
    "petName": "Mochi",
    "shortUrl": "https://cutt.ly/abc123",
    "masterEmail": "owner@example.com",
    "qrUrl": "https://bucket.s3.amazonaws.com/qr-codes/A2B3C4.png",
    "petUrl": "https://bucket.s3.amazonaws.com/user-uploads/orders/ORDER-2025-001/pet.jpg",
    "orderId": "ORDER-2025-001",
    "location": "123 Nathan Road, Mong Kok",
    "petHuman": "Chan",
    "pendingStatus": false,
    "option": "PTagStandard",
    "price": 298,
    "type": "",
    "optionSize": "",
    "optionColor": "",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

`form` here includes `price`, `type`, `optionSize`, `optionColor` — this differs from the tag-bound GET which omits those fields. Use this endpoint when building the WhatsApp order link UI.

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `fulfillment.errors.missingVerificationId` | `verificationId` path param is absent |
| 400 | `fulfillment.errors.invalidVerificationId` | `verificationId` is not a valid MongoDB ObjectId |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 403 | `common.unauthorized` | Ownership check failed |
| 404 | `fulfillment.errors.notFound` | No `OrderVerification` with this `_id` |
| 500 | `common.internalError` | Unexpected error |

---

### POST /commerce/commands/ptag-detection-email

Sends a PTag location alert email to a pet owner. Admin/developer only.

**Auth:** `x-api-key` + JWT; role must be `admin` or `developer`
**Rate limit:** None configured
**Content-Type:** `application/json`

**Purpose:** When a PTag is scanned at a location, this command sends the pet owner an HTML email with the pet name, tagId, scan date/time, and a Google Maps link or similar location URL.

**Body:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | Yes | Pet name; rendered into the email HTML |
| `tagId` | string | Yes | PTag ID being detected |
| `dateTime` | string | Yes | Scan date/time string rendered into email |
| `locationURL` | string | Yes | Must be a valid `https://` URL; rendered as a location link in email |
| `email` | string | Yes | Recipient email address (pet owner) |

**Example:**

```json
{
  "name": "Mochi",
  "tagId": "A2B3C4",
  "dateTime": "2025-01-15 10:30",
  "locationURL": "https://maps.google.com/?q=22.3193,114.1694",
  "email": "owner@example.com"
}
```

**Side effects:**
- Sends HTML email to `email` using the `SMTP_*` env vars configured for this Lambda
- CC'd to `notification@ptag.com.hk`
- Email subject: `PTag | 您的寵物 {name} ({tagId}) 最新位置更新 | Your pet {name} ({tagId}) Latest location update`
- HTML template is loaded from `static/ptag-detection-email.html` at runtime; `{{PET_NAME}}`, `{{TAG_ID}}`, `{{DATE_TIME}}`, `{{LOCATION_URL}}` placeholders are replaced (HTML-escaped)

**Success (200):**

```json
{
  "success": true,
  "message": "Email sent successfully.",
  "requestId": "aws-lambda-request-id"
}
```

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Body is missing or empty |
| 400 | `common.invalidBodyParams` | Malformed JSON or unknown field key (strict schema) |
| 400 | `fulfillment.errors.missingFields` | Any required field is missing or empty |
| 400 | `fulfillment.errors.invalidEmail` | `email` fails format validation |
| 400 | `fulfillment.errors.invalidLocationURL` | `locationURL` is not a valid `https://` URL |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 403 | `common.forbidden` | Caller is not `admin` or `developer` |
| 500 | `common.internalError` | SMTP failure or unexpected error |

---

## Frontend Integration Guide

### Supplier Tag Management (Authenticated + Owner)

The supplier flow uses `orderId` (= `tempId`) as the primary identifier:

```
1. GET /commerce/fulfillment/suppliers/{tempId}
   └── resolves by orderId, contact, or tagId (in that order)
   └── returns full verification form for review / editing
2. PATCH /commerce/fulfillment/suppliers/{tempId}
   └── JSON body only (not multipart)
   └── updates allowed fields on the verification record
```

### WhatsApp Deep-Link Flow (Authenticated + Owner)

```
1. GET /commerce/fulfillment/share-links/whatsapp/{verificationId}
   └── verificationId is the OrderVerification._id returned at order creation
   └── form includes tagId, qrUrl, shortUrl, option, price, etc.
2. Frontend builds WhatsApp share link using the returned payload
```

### Admin Operations

Admin/developer callers (`role: "admin"` or `"developer"`) have access to:

- `GET /commerce/fulfillment` — paginated OrderVerification list (fulfillment view)
- `DELETE /commerce/fulfillment/{orderVerificationId}` — soft-cancel a verification
- `PATCH /commerce/fulfillment/tags/{tagId}` — set `verifyDate`, update contact, retarget `orderId`
- `POST /commerce/commands/ptag-detection-email` — send location alert

---

## Known Constraints

- `GET /commerce/fulfillment` list response does **not** include `cancelled`, `discountProof`, `contact`, `tagCreationDate`, `location`, or `petHuman`. `cancelled`/`discountProof` are selected but stripped by the sanitize layer; `contact`, `tagCreationDate`, `location`, `petHuman` are not in the list projection at all. These fields are only present on the single-record fulfillment endpoints.
- The WhatsApp tracking dispatch in `PATCH /commerce/fulfillment/tags/{tagId}` is silent-failure — `notificationDispatched: false` is returned if the token is missing or if the linked order lacks a phone number or SF waybill number.

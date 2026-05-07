# Commerce Orders API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda name:** `aws-ddd-api-{stage}-commerce-orders`

Order checkout and retrieval. All routes require `x-api-key` + `Authorization: Bearer <token>`.

> See also: [COMMERCE_CATALOG.md](COMMERCE_CATALOG.md), [COMMERCE_FULFILLMENT.md](COMMERCE_FULFILLMENT.md)

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/commerce/orders` | `x-api-key` + JWT; admin/developer only | Paginated list of all orders |
| POST | `/commerce/orders` | `x-api-key` + JWT; any authenticated user | Submit a new PTag order (multipart/form-data) |
| GET | `/commerce/orders/operations` | `x-api-key` + JWT; admin/developer only | Paginated list of all order verifications |
| GET | `/commerce/orders/{tempId}` | `x-api-key` + JWT; owner or admin/developer | Get contact summary for one order |

### Domain Model Relationships

```
Order (tempId)  ──────────────────────────────── OrderVerification (orderId = Order.tempId)
  └── buyDate, lastName, email, price, option      └── tagId, staffVerification, qrUrl, shortUrl
  └── delivery, paymentWay, shopCode               └── verifyDate, pendingStatus, cancelled
  └── petImg, petContact, sfWayBillNumber           └── masterEmail, contact, location, petHuman
```

When `POST /commerce/orders` succeeds, it creates both documents atomically. `OrderVerification.orderId` references `Order.tempId`.

**Auth delta vs legacy:** `POST /commerce/orders` was a **public** route in legacy (`POST /purchase/confirmation`). The DDD version requires authentication. This is an intentional auth-strengthening delta — the frontend must send a valid JWT when submitting an order.

---

## API Gateway and Auth Rules

### API Gateway Requirements

| Route group | API key required | API Gateway authorizer |
| --- | --- | --- |
| All `/commerce/orders` routes | Yes | Lambda authorizer |
| `OPTIONS` preflight routes | No | None |

### Authentication

| Scenario | Requirement |
| --- | --- |
| Submit an order | `Authorization: Bearer <access-token>` + `x-api-key` |
| View own order by tempId | `Authorization: Bearer <access-token>` + `x-api-key` |
| Admin order/operations list | `Authorization: Bearer <access-token>` + `x-api-key`; role must be `admin` or `developer` |

**Privileged roles:** `admin` and `developer`. They bypass ownership checks on all routes.

### Ownership Rules

| Route | Non-privileged access control |
| --- | --- |
| `GET /commerce/orders/{tempId}` | Caller's JWT email must match `Order.email` (case-insensitive, trimmed) |
| `GET /commerce/orders` | Admin/developer only |
| `GET /commerce/orders/operations` | Admin/developer only |

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
  "errorKey": "orders.errors.duplicateOrder",
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

Append `?lang=en` for English messages. Default is `zh` (Traditional Chinese). For POST bodies, include `lang: "eng"` or `"chn"` where applicable.

---

## Endpoints

### GET /commerce/orders

Returns paginated list of all orders. Admin/developer only.

**Auth:** `x-api-key` + JWT; role must be `admin` or `developer`
**Rate limit:** None configured

**Query params:**

| Param | Type | Default | Max | Notes |
| --- | --- | --- | --- | --- |
| `page` | integer | 1 | — | 1-based |
| `limit` | integer | 100 | 500 | |

**Success (200):**

```json
{
  "success": true,
  "orders": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c11",
      "isPTagAir": false,
      "lastName": "Chan",
      "email": "owner@example.com",
      "phoneNumber": "91234567",
      "address": "123 Nathan Road, Mong Kok",
      "paymentWay": "FPS",
      "delivery": "SF Express",
      "tempId": "ORDER-2025-001",
      "option": "PTagStandard",
      "type": "",
      "price": 298,
      "petImg": "https://bucket.s3.amazonaws.com/user-uploads/orders/ORDER-2025-001/pet.jpg",
      "promotionCode": "",
      "shopCode": "HK001",
      "buyDate": "2025-01-15T10:30:00.000Z",
      "petName": "Mochi",
      "petContact": "98765432",
      "sfWayBillNumber": null,
      "language": "eng",
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

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 403 | `common.forbidden` | Caller role is not `admin` or `developer` |
| 500 | `common.internalError` | Unexpected error |

---

### POST /commerce/orders

Submits a new PTag order. Authenticated users only.

**Auth:** `x-api-key` + JWT; any authenticated user
**Rate limit:** 10 requests / 3600 s per source IP
**Content-Type:** `multipart/form-data`

**File upload rules:**
- Field `pet_img`: optional; max 1 file; max 4 MB; accepted MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Field `discount_proof`: optional; max 1 file; same size and type constraints as `pet_img`
- MIME type is detected from file content (magic bytes), not from the `Content-Type` claim

**Body fields (all arrive as strings from multipart):**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `lastName` | string | Yes | Order holder last name |
| `email` | string | Yes | Valid email; normalized to lowercase |
| `phoneNumber` | string | Yes | 7–15 digits only (`/^\d{7,15}$/`) |
| `address` | string | Yes | Delivery address |
| `option` | string | Yes | Tag option identifier; max 64 chars; alphanumeric + `-_` only |
| `tempId` | string | Yes | Client-generated unique order ID; max 64 chars; alphanumeric + `-_` only; must be globally unique |
| `paymentWay` | string | Yes | Payment method description; max 128 chars |
| `delivery` | string | Yes | Delivery method; max 128 chars |
| `petName` | string | Yes | Pet name |
| `shopCode` | string | Yes | Must match an existing `ShopInfo.shopCode` — used to resolve server-authoritative price |
| `type` | string | No | Tag type; max 64 chars; defaults to `""` |
| `promotionCode` | string | No | Promotion code; max 64 chars; defaults to `""` |
| `petContact` | string | No | Pet-related contact number; defaults to `""` |
| `optionSize` | string | No | Size variant; max 32 chars; defaults to `""` |
| `optionColor` | string | No | Color variant; max 64 chars; defaults to `""` |
| `optionImg` | string | No | Image URL variant hint; max unconstrained; defaults to `""`; accepted by the schema but **not used** by the handler — stored as empty string regardless |
| `lang` | string | No | `"chn"` or `"eng"`; defaults to `"eng"` |

**Side effects on success:**
1. Creates `Order` document in MongoDB
2. Generates a unique 6-character `tagId` (format: `[A-Z][0-9][A-Z][0-9][A-Z][0-9]` from restricted alphabets)
3. Creates `OrderVerification` document linked by `orderId = tempId`
4. For non-PTagAir options: generates a QR code image and shortens the QR URL via Cutt.ly; uploads QR image to S3
5. Sends confirmation email to the order email address (non-fatal — order still succeeds if email fails)
6. Sends WhatsApp order notification (non-fatal — order still succeeds if WhatsApp fails)

If `OrderVerification` creation fails after `Order` is saved, the `Order` is deleted (compensation) so the same `tempId` can be retried.

`isPTagAir` is set server-side when `option` is `"PTagAir"` or `"PTagAir_member"`.

**Price is server-authoritative.** The client-submitted price is ignored. Price is resolved from `ShopInfo.price` by `shopCode`. If `shopCode` does not match any shop, the request is rejected.

**Success (200):**

```json
{
  "success": true,
  "message": "Order placed successfully.",
  "purchase_code": "ORDER-2025-001",
  "price": 298,
  "_id": "665f1a2b3c4d5e6f7a8b9c12",
  "requestId": "aws-lambda-request-id"
}
```

`_id` is the `OrderVerification._id` (not the `Order._id`).

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `orders.errors.missingRequiredFields` | Missing required fields in multipart body |
| 400 | `orders.errors.invalidEmail` | Invalid email format |
| 400 | `orders.errors.invalidOption` | `option` exceeds max length or contains invalid characters |
| 400 | `orders.errors.invalidTempId` | `tempId` exceeds max length or contains invalid characters |
| 400 | `orders.errors.missingPhoneNumber` | `phoneNumber` absent |
| 400 | `orders.errors.invalidPhone` | `phoneNumber` fails digit-only regex |
| 400 | `orders.errors.invalidShopCode` | `shopCode` not found in `ShopInfo` collection |
| 400 | `orders.errors.invalidFileType` | Uploaded file MIME type not allowed |
| 400 | `orders.errors.fileTooLarge` | Uploaded file exceeds 4 MB |
| 400 | `orders.errors.tooManyFiles` | More than 1 file per field |
| 413 | *(Lambda invocation limit)* | Base64-encoded request body exceeds Lambda's 6 MB synchronous payload limit (raw file > ~4.5 MB); API GW returns 413 before Lambda runs. API GW's own limit is 10 MB. |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 409 | `orders.errors.duplicateOrder` | `tempId` already exists in `Order` collection |
| 429 | `common.rateLimited` | Rate limit exceeded (10 req / hour per IP) |
| 500 | `common.internalError` | Unexpected error |

---

### GET /commerce/orders/operations

Returns paginated list of all `OrderVerification` records. Admin/developer only.

**Auth:** `x-api-key` + JWT; role must be `admin` or `developer`
**Rate limit:** None configured

**Query params:** `page`, `limit` (same defaults and max as GET /commerce/orders)

**Note:** Filter is `{ cancelled: { $exists: true } }` — records without a `cancelled` field are excluded.

**Success (200):**

```json
{
  "success": true,
  "message": "Latest PTag orders retrieved successfully.",
  "allOrders": [
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
      "cancelled": false,
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

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 403 | `common.forbidden` | Caller is not `admin` or `developer` |
| 404 | `orders.errors.noOrders` | No records match the filter |
| 500 | `common.internalError` | Unexpected error |

---

### GET /commerce/orders/{tempId}

Returns the pet contact summary for one order. Ownership enforced for non-admin callers.

**Auth:** `x-api-key` + JWT; any authenticated user; non-admin callers must own the order
**Rate limit:** None configured

**Path parameter:**

| Param | Type | Notes |
| --- | --- | --- |
| `tempId` | string | The order's `tempId` value |

**Ownership rule:** Admin/developer callers bypass ownership. Non-privileged callers must have a JWT email that matches `Order.email` (case-insensitive, trimmed).

**Success (200):**

```json
{
  "success": true,
  "message": "Order info retrieved successfully.",
  "form": {
    "petContact": "98765432"
  },
  "id": "665f1a2b3c4d5e6f7a8b9c12",
  "requestId": "aws-lambda-request-id"
}
```

`id` is the `Order._id` (as string). `form.petContact` may be `undefined` if no pet contact was provided at order time.

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `orders.errors.missingTempId` | `tempId` path parameter is absent |
| 401 | `common.unauthorized` | Missing or invalid JWT |
| 403 | `common.forbidden` | Non-owner caller |
| 404 | `orders.errors.orderNotFound` | No `Order` document with this `tempId` |
| 500 | `common.internalError` | Unexpected error |

---

## Frontend Integration Guide

### Order Checkout Flow

The frontend must have a valid JWT before submitting an order.

```
1. GET /commerce/storefront       → get shopCode + canonical price
2. User fills order form
3. POST /commerce/orders          → multipart/form-data
   └── on 200: store purchase_code (= tempId) and _id (= OrderVerification._id)
   └── on 409 orders.errors.duplicateOrder: re-generate tempId client-side and retry
   └── on 429: show rate limit error
4. GET /commerce/orders/{tempId}  → verify petContact if needed
```

Generate `tempId` client-side using a UUID or collision-resistant format. The server will reject a duplicate with `409`.

**Price is always server-authoritative.** Do not send price in the order body. The price shown to the user should come from `ShopInfo.price` via `GET /commerce/storefront` (see [COMMERCE_CATALOG.md](COMMERCE_CATALOG.md)).

---

## Known Constraints

- `POST /commerce/orders` uses `multipart/form-data`, not JSON. All scalar fields arrive as strings from the multipart parser.
- `GET /commerce/orders/operations` only returns records where the `cancelled` field **exists** (`$exists: true`). Records created before the `cancelled` field was introduced are not returned.
- Cutt.ly URL shortening in `POST /commerce/orders` is best-effort — if the API key is not configured or the Cutt.ly call fails, the full unshortened URL is stored and used as `shortUrl`.

# Commerce Orders API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-commerce-orders`

Authenticated order checkout and order retrieval. The current DDD implementation uses the shared `{ success, message, data, pagination?, requestId }` envelope. Older docs that describe top-level `orders`, `allOrders`, `purchase_code`, `_id`, or `form` payloads are stale.

---

## Overview

### Route Summary

| Method | Path | Auth | Content-Type | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/commerce/orders` | `x-api-key` + Bearer JWT with `admin` or `developer` role | — | Paginated list of all orders |
| POST | `/commerce/orders` | `x-api-key` only | `multipart/form-data` | Create one order and one order-verification record |
| GET | `/commerce/orders/operations` | `x-api-key` + Bearer JWT with `admin` or `developer` role | — | Paginated operations view of order verifications |
| GET | `/commerce/orders/{tempId}` | `x-api-key` + Bearer JWT with `admin` role | — | Return minimal contact data for one order |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Auth delta | `POST /commerce/orders` is protected in DDD; legacy public checkout behavior is no longer valid |
| Checkout response | Order creation returns `data: { id, purchaseCode, price }`, not top-level `purchase_code`, `price`, or `_id` |
| Price source | `price` is resolved server-side from MongoDB only. With a `shopCode`: `finalPrice = ShopInfo.price + deliveryFee` (ShopInfo.price is the shop's authoritative item price). Without a `shopCode`: `finalPrice = ptagProduct tier basePrice + deliveryFee`. Client price fields are not accepted |
| Money precision | Checkout price math is performed in cents and normalized to 2 decimal places to avoid floating-point precision artifacts |
| Order side effects | Successful checkout creates both `Order` and `OrderVerification`, generates a tag id, and may generate QR and short URLs |
| Best-effort notifications | Confirmation email and WhatsApp send after persistence, but failures do not roll back a successful order |
| List pagination | All list routes use shared pagination defaults: `page=1`, `limit=30`, max `limit=100` |
| Operations filter | `GET /commerce/orders/operations` only returns records where `cancelled` field exists |
| Operations query behavior | `GET /commerce/orders/operations` supports `search`, `sortBy`, and `sortOrder`; unsupported `sortBy` falls back to `updatedAt` |
| Order lookup shape | `GET /commerce/orders/{tempId}` returns only `data.id` and `data.petContact` |

---

## Auth Reference

Gateway/API-key/JWT behavior for commerce-orders routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### API Gateway Body Validation

`commerce-orders` does not attach an API Gateway `RequestModel` to these routes in `template.yaml`.

- `POST /commerce/orders` multipart parsing and field validation happen inside the Lambda
- The documented 400/409/413 `errorKey` values for checkout are still Lambda-generated responses
- Do not assume API Gateway will return shared `common.*` keys for malformed or missing auth headers

### Endpoint-Specific Authorization

| Route | Rule |
| --- | --- |
| `GET /commerce/orders` | Admin or developer only |
| `POST /commerce/orders` | Public (API key only) |
| `GET /commerce/orders/operations` | Admin or developer only |
| `GET /commerce/orders/{tempId}` | Admin only |

### Rate Limits

`POST /commerce/orders` applies layered Mongo-backed rate limiting:

| Scope | Policy |
| --- | --- |
| IP | 60 requests / 3600s |
| Identifier (`auth.userId`) | 20 requests / 3600s |
| IP + identifier | 10 requests / 3600s |

Rate-limit failures return `429 common.rateLimited` and may include `Retry-After`.

### Localization

- Locale priority for API messages is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- The multipart body field `lang` is separate from API message localization and is stored with the order for downstream messaging flows

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

Order create success:

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c20",
    "purchaseCode": "TEMP-ORDER-001",
    "price": 298
  },
  "requestId": "aws-lambda-request-id"
}
```

Single-order lookup success:

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c21",
    "petContact": "91234567"
  },
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

When the Lambda handles the request, errors use the shared envelope:

```json
{
  "success": false,
  "errorKey": "orders.errors.duplicateOrder",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

Gateway-originated failures such as missing/invalid API key or JWT can return a different shape, because the request may be rejected before the Lambda runs.

---

## Endpoints

### GET /commerce/orders

Return paginated order list. Admin/developer only.

**Lambda owner:** `commerce-orders`  
**Auth:** `x-api-key` + Bearer JWT with `admin` or `developer` role

#### Orders Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Default `1` |
| `limit` | integer | No | Default `30`, max `100` |

#### Returned Order Shape

Each item in `data` is sanitized to:

- `_id`
- `isPTagAir`
- `lastName`
- `email`
- `phoneNumber`
- `address`
- `paymentWay`
- `delivery`
- `tempId`
- `option`
- `type`
- `price`
- `petImg`
- `promotionCode`
- `shopCode`
- `buyDate`
- `petName`
- `petContact`
- `sfWayBillNumber`
- `language`
- `createdAt`
- `updatedAt`

#### Orders Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c22",
      "isPTagAir": false,
      "lastName": "Chan",
      "email": "owner@example.com",
      "phoneNumber": "91234567",
      "address": "123 Nathan Road",
      "paymentWay": "FPS",
      "delivery": "SF Express",
      "tempId": "TEMP-ORDER-001",
      "option": "PTagClassic",
      "type": "",
      "price": 298,
      "petImg": "https://cdn.example.com/user-uploads/orders/TEMP-ORDER-001/file.jpg",
      "promotionCode": "",
      "shopCode": "HK001",
      "buyDate": "2026-05-10T12:34:56.000Z",
      "petName": "Mochi",
      "petContact": "91234567",
      "sfWayBillNumber": null,
      "language": "eng",
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

#### Orders Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid `page` or `limit` |
| 403 | `common.forbidden` | Caller is not `admin` or `developer` |
| 500 | `common.internalError` | Unexpected database or server error |

### POST /commerce/orders

Create one order and its linked order-verification record.

**Lambda owner:** `commerce-orders`  
**Auth:** `x-api-key` only  
**Content-Type:** `multipart/form-data`

#### Multipart File Rules

| File field | Required | Max files | Allowed types | Size limit |
| --- | --- | --- | --- | --- |
| `pet_img` | No | 1 | `image/jpeg`, `image/png`, `image/webp`, `image/gif` | 4 MB |
| `discount_proof` | No | 1 | `image/jpeg`, `image/png`, `image/webp`, `image/gif` | 4 MB |

The backend detects MIME type from file bytes, not just the declared multipart content type.

#### Multipart Text Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `lastName` | string | Yes | Trimmed, max 100 |
| `email` | string | Yes | Valid email |
| `address` | string | Yes | Trimmed, max 500 |
| `option` | string | Yes | Must be one of: `PTag`, `PTagAir` |
| `type` | string | No | Tier within the product. `PTag`: `normal` or `custom`. `PTagAir`: `standard` (or omit — defaults to standard). Defaults to `""` |
| `optionSize` | string | Conditional | Required when `option=PTag`. Must be one of: `25mm`, `30mm`. Not required for `PTagAir` (no sizes defined) |
| `optionColor` | string | Conditional | Required when `option=PTag`. Must be one of: `gold`, `silver`. Not required for `PTagAir` (no colours defined) |
| `tempId` | string | Yes | Max 64, must match `[A-Za-z0-9_-]+` |
| `paymentWay` | string | Yes | Max 128 |
| `delivery` | string | Yes | Max 128 |
| `lastName` | string | Yes | Trimmed, max 100 |
| `email` | string | Yes | Valid email |
| `address` | string | Yes | Trimmed, max 500 |
| `petName` | string | Conditional | Required unless `option=PTag`; trimmed, max 100 |
| `phoneNumber` | string | Yes | 7 to 15 digits only |
| `shopCode` | string | No | Defaults to `""` |
| `promotionCode` | string | No | Defaults to `""` |
| `petContact` | string | No | Defaults to `""` |
| `optionImg` | string | No | Accepted by schema but not used by handler output or response |
| `lang` | enum string | No | `chn` or `eng`, defaults to `eng` |

##### Product Reference (current DB state)

| `option` | `type` | `optionSize` | `optionColor` | Base price | Delivery |
| --- | --- | --- | --- | --- | --- |
| `PTag` | `normal` | `25mm` or `30mm` | `gold` or `silver` | $259 | $50 |
| `PTag` | `custom` | `25mm` or `30mm` | `gold` or `silver` | $279 | $50 |
| `PTagAir` | `standard` (or `""`) | — | — | $199 | $50 |

`optionSize` and `optionColor` are validated against the live `ptagProduct` collection at order time. If the product's options arrays are non-empty and the submitted value does not match, the order is rejected with `400 orders.errors.invalidProductSelection`.

The multipart field set is strict. Unknown text fields are rejected.
For example, sending client-side `price` in checkout body is rejected with
`400 common.invalidBodyParams`.

#### Order Side Effects

On success, the handler:

1. resolves authoritative backend pricing from DB only:
   - resolves product and tier from `option` / `type` against `ptagProduct`
   - uses selected tier price as `itemBasePrice`
   - validates `optionSize` against `ptagProduct.options.sizes` if the array is non-empty; rejects with `orders.errors.invalidProductSelection` on mismatch
   - validates `optionColor` against `ptagProduct.options.colours` if the array is non-empty; rejects with `orders.errors.invalidProductSelection` on mismatch
   - uses `ptagProduct.deliveryCharge` as `deliveryFee`
   - when `shopCode` is provided, `ShopInfo.price` is the authoritative item price for that shop (e.g. SPCA VIP $199); delivery fee is added on top
   - when no `shopCode`, uses the product tier `basePrice` as the item price
   - computes `finalPrice = shopCodePrice + deliveryFee` (with shopCode) or `itemBasePrice + deliveryFee` (without) (floored at `0`)
   - performs money arithmetic in cents and normalizes to 2 decimal places
2. creates an `Order` record with computed `price = finalPrice`
3. classifies `isPTagAir` from `option`
4. uploads `pet_img` and `discount_proof` when present
5. generates a unique `tagId`
6. resolves a short URL for every order; non-`PTagAir` orders upload a QR image from that short URL, while `PTagAir` uses the landing URL plus the shared static QR asset
7. creates an `OrderVerification` record linked by `orderId = tempId`
8. sends confirmation email and WhatsApp order message in parallel on a best-effort basis

If order-verification creation fails after the order is saved, the handler compensates by deleting the just-created order so the same `tempId` can be retried.

#### Order Success (200)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c23",
    "purchaseCode": "TEMP-ORDER-001",
    "price": 298
  },
  "requestId": "aws-lambda-request-id"
}
```

`data.id` is the `OrderVerification._id`, not the `Order._id`.

#### Order Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing multipart body or missing required text field (including `petName` when `option` is not `PTag`) |
| 400 | `orders.errors.invalidEmail` | Invalid email |
| 400 | `orders.errors.invalidOption` | Invalid `option` format |
| 400 | `orders.errors.invalidTempId` | Invalid `tempId` format |
| 400 | `orders.errors.invalidPhone` | Invalid `phoneNumber` |
| 400 | `orders.errors.invalidProductSelection` | `option` / `type` does not map to a valid `ptagProduct` tier, or `optionSize` / `optionColor` does not match the product's available options |
| 400 | `orders.errors.invalidShopCode` | Unknown non-empty `shopCode` |
| 400 | `orders.errors.invalidFileType` | Unsupported upload format |
| 400 | `orders.errors.tooManyFiles` | More than one file supplied for `pet_img` or `discount_proof` |
| 400 | `common.invalidBodyParams` | Strict-schema violation (for example unknown/extra text fields such as `price`) |
| 409 | `orders.errors.duplicateOrder` | `tempId` already exists |
| 413 | `orders.errors.fileTooLarge` | Uploaded file exceeds 4 MB |
| 429 | `common.rateLimited` | Checkout rate limit exceeded |
| 500 | `common.internalError` | Unexpected server error |

### GET /commerce/orders/operations

Return paginated operations view of order-verification records. Admin/developer only.

**Lambda owner:** `commerce-orders`  
**Auth:** `x-api-key` + Bearer JWT with `admin` or `developer` role

#### Operations Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Default `1` |
| `limit` | integer | No | Default `30`, max `100` |
| `search` | string | No | Trimmed before use; escaped and applied as case-insensitive regex across `tagId`, `contact`, `petName`, `masterEmail`, `orderId`, `location`, `petHuman`, `option`, `type`, `optionSize`, `optionColor` |
| `sortBy` | string | No | Allowlist: `updatedAt`, `createdAt`, `tagId`, `staffVerification`, `cancelled`, `verifyDate`, `tagCreationDate`, `petName`, `masterEmail`, `orderId`, `location`, `petHuman`, `pendingStatus`, `option`, `type`, `optionSize`, `optionColor`, `price`; fallback `updatedAt` |
| `sortOrder` | `asc` or `desc` | No | Defaults to `desc`; any non-`asc` value is treated as `desc` |

#### Operations Filter

This endpoint filters with `{ cancelled: { $exists: true } }`. It returns only records that already have a `cancelled` field in MongoDB.

Sorting is deterministic with a tie-breaker on `_id` descending: `.sort({ [sortBy]: sortOrder, _id: -1 })`.

#### Returned Operations Shape

Each item in `data` is sanitized to:

- `_id`
- `tagId`
- `staffVerification`
- `cancelled`
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

#### Operations Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c24",
      "tagId": "A2B3C4",
      "staffVerification": false,
      "cancelled": false,
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

#### Operations Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid `page` or `limit` |
| 403 | `common.forbidden` | Caller is not `admin` or `developer` |
| 500 | `common.internalError` | Unexpected database or server error |

### GET /commerce/orders/{tempId}

Return minimal contact data for one order.

**Lambda owner:** `commerce-orders`  
**Auth:** `x-api-key` + Bearer JWT with `admin` role

#### Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `tempId` | string | Yes | Validated by the shared temp-id path parser |

#### Lookup Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c25",
    "petContact": "91234567"
  },
  "requestId": "aws-lambda-request-id"
}
```

`petContact` may be empty or omitted depending on stored data.

#### Lookup Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidPathParams` | Missing or invalid `tempId` |
| 403 | `common.forbidden` | Caller does not own the order |
| 404 | `orders.errors.orderNotFound` | No order found for `tempId` |
| 500 | `common.internalError` | Unexpected database or server error |

---

## Frontend Integration Guide

1. `shopCode` is optional for checkout. If provided, `ShopInfo.price` becomes the authoritative item price for that shop (e.g. SPCA VIP = $199) and delivery fee is added on top. If omitted, the product tier `basePrice` is used. Checkout `price` is always computed server-side and never accepted from the client.
2. Submit checkout as `multipart/form-data`; do not send JSON to `POST /commerce/orders`.
3. Read successful checkout output from `data.purchaseCode` and `data.id`.
4. Treat `orders.errors.duplicateOrder` as a client retry case with a newly generated `tempId`.
5. Use `GET /commerce/orders/{tempId}` only for the minimal post-checkout contact lookup; it is not a full order-details endpoint.

---

## Verification Snapshot

This document is grounded in `functions/commerce-orders/src/services/orders.ts`, `orderSchema.ts`, `upload.ts`, `sanitize.ts`, the commerce-order tests, and the route wiring in `template.yaml`.

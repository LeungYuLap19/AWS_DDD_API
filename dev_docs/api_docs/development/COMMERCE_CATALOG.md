# Commerce Catalog API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-commerce-catalog`

Public commerce browsing endpoints for legacy product catalog, PTag product catalog, storefront metadata, product-view event logging, and storefront shop-code verification. The current DDD implementation uses the shared `{ success, message, data, pagination?, requestId }` envelope. Older docs that describe top-level `items`, `shops`, or `id` payloads are stale.

---

## Overview

### Route Summary

| Method | Path | Auth | Content-Type | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/commerce/catalog` | `x-api-key` only | — | Paginated product list |
| POST | `/commerce/catalog/events` | `x-api-key` only | `application/json` | Record a product-view event |
| GET | `/commerce/catalog/ptag-products` | `x-api-key` only | — | PTag product list |
| GET | `/commerce/catalog/ptag-products/{productId}` | `x-api-key` only | — | PTag product detail |
| GET | `/commerce/storefront` | `x-api-key` only | — | Paginated storefront list |
| POST | `/commerce/storefront/shop-code-verifications` | `x-api-key` only | `application/json` or `multipart/form-data` | Verify a storefront shop code |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Pagination | `GET /commerce/catalog` and `GET /commerce/storefront` use shared pagination defaults `page=1`, `limit=30`, max `limit=100` |
| Catalog response | `GET /commerce/catalog` returns product records inside `data`, not top-level `items` |
| PTag product list response | `GET /commerce/catalog/ptag-products` returns sanitized records from `ptagProduct` collection, each with `productId` mapped from `_id` |
| PTag product detail path | `GET /commerce/catalog/ptag-products/{productId}` requires MongoDB ObjectId path param and returns `400 common.invalidObjectId` for invalid IDs |
| Storefront response | `GET /commerce/storefront` returns storefront rows inside `data`, not top-level `shops` |
| Event response | `POST /commerce/catalog/events` returns `201` with `data: { id }` |
| Event validation | Event body is strict JSON; extra keys are rejected |
| `accessAt` handling | `accessAt` is only string-length checked by the current schema; when present, the handler passes it to `new Date(...)` without separate date-format validation |
| Event rate limit | Event logging is capped by IP and global ceilings even though the route is public |
| Shop-code verification | `POST /commerce/storefront/shop-code-verifications` accepts either `shopCode` directly or a PDF upload; unmatched codes return `200` with `isValid=false` |

---

## Auth Reference

Gateway/API-key/JWT behavior for commerce-catalog routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### API Gateway Body Validation

`POST /commerce/catalog/events` is wired to the `GenericJsonObjectRequest` API Gateway model.

- malformed non-object JSON can be rejected by API Gateway before Lambda runs
- Lambda-level body validation still enforces the strict schema and field formats

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Use `errorKey` for branching logic instead of `error`

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

Create success:

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d"
  },
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "common.invalidBodyParams",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

---

## Endpoints

### GET /commerce/catalog

Return paginated product catalog records.

**Lambda owner:** `commerce-catalog`  
**Auth:** `x-api-key` only

#### Catalog Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Default `1` |
| `limit` | integer | No | Default `30`, max `100` |

#### Returned Record Shape

This handler returns the stored `ProductList` documents as-is. No response sanitizer or field projection is applied in the current implementation.

Frontend consumers should therefore treat the record shape as model-defined and avoid assuming undocumented legacy wrapper keys.

#### Catalog Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c01"
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

#### Catalog Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid `page` or `limit` |
| 500 | `common.internalError` | Unexpected database or server error |

### POST /commerce/catalog/events

Record a product-view event.

**Lambda owner:** `commerce-catalog`  
**Auth:** `x-api-key` only  
**Content-Type:** `application/json`

#### Rate Limits

| Scope | Policy |
| --- | --- |
| IP | 120 requests / 60s |
| Global | 5000 requests / 60s |

Rate-limit failures return `429 common.rateLimited` and may include `Retry-After`.

#### Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | MongoDB ObjectId |
| `userId` | string | Yes | MongoDB ObjectId |
| `userEmail` | string | Yes | Valid email, max 254 chars |
| `productUrl` | string | Yes | Absolute URL, max 2048 chars |
| `accessAt` | string | No | Optional string up to 64 chars; when present, the handler passes it to `new Date(...)` and does not currently reject semantically invalid date strings |

The body schema is strict. Extra keys are rejected.

#### Event Example Request

```json
{
  "petId": "665f1a2b3c4d5e6f7a8b9c10",
  "userId": "665f1a2b3c4d5e6f7a8b9c11",
  "userEmail": "owner@example.com",
  "productUrl": "https://shop.example.com/products/ptag-classic",
  "accessAt": "2026-05-10T12:34:56.000Z"
}
```

#### Event Success (201)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "665f1a2b3c4d5e6f7a8b9c12"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Event Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.missingBodyParams` | Missing or empty JSON body |
| 400 | `common.invalidBodyParams` | Invalid ObjectId, invalid email, invalid URL, malformed JSON, or strict-schema violation |
| 429 | `common.rateLimited` | Event rate limit exceeded |
| 500 | `common.internalError` | Unexpected database or server error |

### GET /commerce/catalog/ptag-products

Return PTag product list from `ptagProduct` collection.

**Lambda owner:** `commerce-catalog`  
**Auth:** `x-api-key` only

#### Returned PTag Product Shape

Each row is sanitized and returned as:

- `productId` (string; mapped from MongoDB `_id`)
- `name` (string or `null`)
- `deliveryCharge` (number or `null`)
- `options.sizes` (string[])
- `options.colours` (string[])
- `tiers[]` with `{ type, price }` where `type` is non-empty string and `price` is number or `null`
- `createdAt` (ISO string or `null`)
- `updatedAt` (ISO string or `null`)

#### PTag Product List Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "productId": "68298a5b7f8f0b2a81d8aa12",
      "name": "PTag",
      "deliveryCharge": 50,
      "options": {
        "sizes": ["25mm", "30mm"],
        "colours": ["gold", "silver"]
      },
      "tiers": [
        { "type": "normal", "price": 259 },
        { "type": "custom", "price": 279 }
      ],
      "createdAt": "2026-05-18T09:45:00.000Z",
      "updatedAt": "2026-05-18T09:45:00.000Z"
    }
  ],
  "requestId": "aws-lambda-request-id"
}
```

#### PTag Product List Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 500 | `common.internalError` | Unexpected database or server error |

### GET /commerce/catalog/ptag-products/{productId}

Return a single PTag product by MongoDB ObjectId.

**Lambda owner:** `commerce-catalog`  
**Auth:** `x-api-key` only

#### Path Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `productId` | string | Yes | MongoDB ObjectId |

#### PTag Product Detail Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "productId": "68298a5b7f8f0b2a81d8aa12",
    "name": "ptag air",
    "deliveryCharge": 50,
    "options": {
      "sizes": [],
      "colours": []
    },
    "tiers": [
      { "type": "standard", "price": 199 }
    ],
    "createdAt": "2026-05-18T09:45:00.000Z",
    "updatedAt": "2026-05-18T09:45:00.000Z"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### PTag Product Detail Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidObjectId` | `productId` is missing or not a valid ObjectId |
| 404 | `common.notFound` | Product document not found |
| 500 | `common.internalError` | Unexpected database or server error |

### GET /commerce/storefront

Return paginated storefront records.

**Lambda owner:** `commerce-catalog`  
**Auth:** `x-api-key` only

#### Storefront Query Parameters

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | No | Default `1` |
| `limit` | integer | No | Default `30`, max `100` |

#### Returned Storefront Shape

Each returned row is projected to:

- `_id`
- `shopCode`
- `shopName`
- `shopAddress`
- `shopContact`
- `shopContactPerson`
- `price`

`price` is the shop's authoritative item price used by checkout when `shopCode` is provided — `finalPrice = ShopInfo.price + deliveryFee`. It is not a discount off the base price.

#### Storefront Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c13",
      "shopCode": "HK001",
      "shopName": "PetPet Club Mong Kok",
      "shopAddress": "123 Nathan Road, Mong Kok",
      "shopContact": "+85291234567",
      "shopContactPerson": "Ms Chan",
      "price": 298
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

#### Storefront Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidQueryParams` | Invalid `page` or `limit` |
| 500 | `common.internalError` | Unexpected database or server error |

### POST /commerce/storefront/shop-code-verifications

Verify a storefront shop code against the current `ShopInfo` collection.

**Lambda owner:** `commerce-catalog`  
**Auth:** `x-api-key` only  
**Content-Type:** `application/json` or `multipart/form-data`

#### Request Body

JSON mode:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `shopCode` | string | No | Trimmed, max 64 chars |

Multipart mode:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `shopCode` | string | No | Optional direct verify value |
| `file` | file | No | Optional. If `shopCode` is absent, endpoint expects at least one PDF file |

#### Verification Rules

1. If `shopCode` is provided, the endpoint verifies it case-insensitively against shop codes in DB.
2. If `shopCode` is missing:
   - no uploaded files => `400 catalog.errors.shopCodeOrPdfRequired`
   - files exist but no PDF => `400 catalog.errors.invalidVerificationFileType`
   - PDF exists => backend scans PDF bytes for known shop codes and verifies the extracted value
3. If no match is found, the endpoint still returns `200` with `isValid: false`.
4. Matched responses include canonical storefront `price`; unmatched responses return `price: null`.

#### Verification Success (200, matched)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "isValid": true,
    "source": "shopCode",
    "shopCode": "HK001",
    "matchedShopCode": "HK001",
    "price": 299
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Verification Success (200, unmatched)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "isValid": false,
    "source": "pdf",
    "shopCode": null,
    "matchedShopCode": null,
    "price": null
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Verification Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `catalog.errors.shopCodeOrPdfRequired` | Neither `shopCode` nor file was provided |
| 400 | `catalog.errors.invalidVerificationFileType` | Multipart request provided files but none are PDF |
| 400 | `common.invalidBodyParams` | Invalid body shape or `shopCode` exceeds max length |
| 400 | `common.invalidJSON` | Malformed JSON body |
| 500 | `common.internalError` | Unexpected database or server error |

---

## Frontend Integration Guide

1. Use `GET /commerce/storefront` to fetch server-authoritative `shopCode` and `price` values before checkout.
2. Use `GET /commerce/catalog` for paginated browsing and read records from `data`, not old top-level `items`.
3. Use `GET /commerce/catalog/ptag-products` and `GET /commerce/catalog/ptag-products/{productId}` for checkout-ready PTag product metadata (`deliveryCharge`, `options`, `tiers`) and treat `productId` as the canonical identifier.
4. Treat `POST /commerce/catalog/events` as fire-and-forget analytics. It is public but rate-limited, so the client should not retry aggressively on `429`.
5. For shop-code checks, prefer sending `shopCode` directly. Use PDF upload only when frontend cannot reliably provide the code as text.

---

## Verification Snapshot

This document is grounded in `functions/commerce-catalog/src/services/catalog.ts`, `ptagProducts.ts`, `storefront.ts`, `catalogEventBodySchema.ts`, `verifyShopCodeBodySchema.ts`, `models/PtagProduct.ts`, and the route wiring in `template.yaml`.

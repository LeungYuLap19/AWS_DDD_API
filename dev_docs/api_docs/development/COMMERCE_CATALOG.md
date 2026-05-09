# Commerce Catalog API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-commerce-catalog`

Public commerce browsing endpoints for product catalog, storefront metadata, and product-view event logging. The current DDD implementation uses the shared `{ success, message, data, pagination?, requestId }` envelope. Older docs that describe top-level `items`, `shops`, or `id` payloads are stale.

---

## Overview

### Route Summary

| Method | Path | Auth | Content-Type | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/commerce/catalog` | `x-api-key` only | — | Paginated product list |
| POST | `/commerce/catalog/events` | `x-api-key` only | `application/json` | Record a product-view event |
| GET | `/commerce/storefront` | `x-api-key` only | — | Paginated storefront list |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Auth | All three routes are public at the Lambda level, but still require API Gateway `x-api-key` |
| Pagination | Both GET endpoints use the shared pagination schema with default `page=1`, `limit=30`, max `limit=100` |
| Catalog response | `GET /commerce/catalog` returns product records inside `data`, not top-level `items` |
| Storefront response | `GET /commerce/storefront` returns storefront rows inside `data`, not top-level `shops` |
| Event response | `POST /commerce/catalog/events` returns `201` with `data: { id }` |
| Event validation | Event body is strict JSON; extra keys are rejected |
| `accessAt` handling | `accessAt` is only string-length checked by the current schema; when present, the handler passes it to `new Date(...)` without separate date-format validation |
| Event rate limit | Event logging is capped by IP and global ceilings even though the route is public |

---

## API Gateway And Auth Rules

### API Gateway Requirements

| Route group | API key required at API Gateway | API Gateway authorizer |
| --- | --- | --- |
| `GET /commerce/catalog` | Yes | None |
| `POST /commerce/catalog/events` | Yes | None |
| `GET /commerce/storefront` | Yes | None |
| `OPTIONS` for the above routes | No | None |

Required deployed header:

```http
x-api-key: <api-gateway-api-key>
```

`Authorization` is not required for any route in this Lambda.

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

`price` is the canonical storefront price later used by order creation.

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

---

## Frontend Integration Guide

1. Use `GET /commerce/storefront` to fetch server-authoritative `shopCode` and `price` values before checkout.
2. Use `GET /commerce/catalog` for paginated browsing and read records from `data`, not old top-level `items`.
3. Treat `POST /commerce/catalog/events` as fire-and-forget analytics. It is public but rate-limited, so the client should not retry aggressively on `429`.

---

## Verification Snapshot

This document is grounded in `functions/commerce-catalog/src/services/catalog.ts`, `storefront.ts`, `catalogEventBodySchema.ts`, and the route wiring in `template.yaml`.

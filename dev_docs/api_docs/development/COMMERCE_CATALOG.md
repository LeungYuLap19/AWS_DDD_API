# Commerce Catalog API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda name:** `aws-ddd-api-{stage}-commerce-catalog`

Product browsing and storefront metadata. All three routes require `x-api-key` but no JWT.

> See also: [COMMERCE_ORDERS.md](COMMERCE_ORDERS.md), [COMMERCE_FULFILLMENT.md](COMMERCE_FULFILLMENT.md)

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/commerce/catalog` | `x-api-key`; no JWT required | List all products |
| POST | `/commerce/catalog/events` | `x-api-key`; no JWT required | Record a product-view event |
| GET | `/commerce/storefront` | `x-api-key`; no JWT required | List shop metadata |

---

## API Gateway and Auth Rules

### API Gateway Requirements

| Route group | API key required | API Gateway authorizer |
| --- | --- | --- |
| All catalog and storefront routes | Yes | None (no JWT authorizer) |
| `OPTIONS` preflight routes | No | None |

### Authentication

All three routes require `x-api-key` at API Gateway. No `Authorization` header is needed.

---

## Shared Conventions

### Success Response Shape

```json
{
  "success": true,
  "<endpoint-specific fields>": "..."
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "common.internalError",
  "error": "Localized message (zh default)",
  "requestId": "aws-lambda-request-id"
}
```

Use `errorKey` for programmatic branching. `error` is localized and not stable.

### Localization

Append `?lang=en` for English messages. Default is `zh` (Traditional Chinese).

---

## Endpoints

### GET /commerce/catalog

Returns the full product list.

**Auth:** `x-api-key` required; no JWT required
**Rate limit:** None configured

**Query params:** None

**Success (200):**

```json
{
  "success": true,
  "items": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "..."
    }
  ]
}
```

`items` contains all documents from the `ProductList` collection. Fields are model-defined and returned as-is (no sanitization projection beyond what the model stores).

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 500 | `common.internalError` | DB connection failure or unexpected error |

---

### POST /commerce/catalog/events

Records a product-view event (analytics tracking).

**Auth:** `x-api-key` required; no JWT required
**Rate limit:** None configured
**Content-Type:** `application/json`

**Body:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `petId` | string | Yes | Pet whose profile triggered the product view |
| `userId` | string | Yes | User who viewed the product |
| `userEmail` | string | Yes | Email of the viewing user |
| `productUrl` | string | Yes | URL of the product that was viewed |
| `accessAt` | string | No | ISO timestamp of the access event; server-stored as Date; defaults to `null` if omitted |

**Example:**

```json
{
  "petId": "665f1a2b3c4d5e6f7a8b9c0d",
  "userId": "665f1a2b3c4d5e6f7a8b9c0e",
  "userEmail": "user@example.com",
  "productUrl": "https://example.com/product/ptag-standard",
  "accessAt": "2025-01-15T10:30:00Z"
}
```

**Success (201):**

```json
{
  "success": true,
  "id": "665f1a2b3c4d5e6f7a8b9c0f"
}
```

`id` is the `_id` of the newly created `ProductLog` document.

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `common.invalidJSON` | Body is not valid JSON |
| 400 | `common.invalidInput` | Zod validation failed (missing required fields) |
| 500 | `common.internalError` | DB write failure or unexpected error |

---

### GET /commerce/storefront

Returns shop metadata for all configured shops.

**Auth:** `x-api-key` required; no JWT required
**Rate limit:** None configured

**Query params:** None

**Success (200):**

```json
{
  "success": true,
  "shops": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c10",
      "shopCode": "HK001",
      "shopName": "PetPetClub Mong Kok",
      "shopAddress": "123 Nathan Road, Mong Kok",
      "shopContact": "+85291234567",
      "shopContactPerson": "Ms. Chan",
      "price": 298
    }
  ]
}
```

Fields returned per shop: `shopCode`, `shopName`, `shopAddress`, `shopContact`, `shopContactPerson`, `price`. These are an explicit projection — no other `ShopInfo` fields are returned.

`price` is the server-authoritative canonical price used during order creation.

**Errors:**

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 500 | `common.internalError` | DB connection failure or unexpected error |

---

## Frontend Integration Note

Typical browsing flow:

1. `GET /commerce/storefront` — fetch available shops, their `shopCode` values and prices
2. `GET /commerce/catalog` — fetch product list
3. `POST /commerce/catalog/events` — log product view events (fire-and-forget; no JWT needed)

**Price is always server-authoritative.** Do not use a client-stored price when building an order. Always source price from `ShopInfo.price` via `GET /commerce/storefront`.

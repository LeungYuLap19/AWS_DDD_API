# Logistics API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

SF Express logistics integration — address lookups, shipment creation, and cloud waybill printing. Lookup routes are public. Token, shipment, and waybill routes require authentication.

> Conventions: see shared API Gateway / auth / error-response rules below.

---

## Overview

### Route Summary

| Method | Path | Auth | API Key | Lambda | Purpose |
| --- | --- | --- | --- | --- | --- |
| POST | `/logistics/token` | Bearer JWT | Yes | `logistics` | Get SF Address API bearer token |
| POST | `/logistics/lookups/areas` | None | No | `logistics` | List SF area metadata |
| POST | `/logistics/lookups/net-codes` | None | No | `logistics` | List SF net codes for an area + type |
| POST | `/logistics/lookups/pickup-locations` | None | No | `logistics` | Get pickup addresses for net codes |
| POST | `/logistics/shipments` | Bearer JWT | Yes | `logistics` | Create SF shipment and record waybill |
| POST | `/logistics/cloud-waybill` | Bearer JWT | Yes | `logistics` | Print cloud waybill PDF and email it |

### Typical Frontend Flow

```
1. POST /logistics/token          → bearer_token
2. POST /logistics/lookups/areas  → area_list  (pick area)
3. POST /logistics/lookups/net-codes → netCode (pick net code)
4. POST /logistics/lookups/pickup-locations → addresses (pick pickup point)
5. POST /logistics/shipments      → trackingNumber
6. POST /logistics/cloud-waybill  → waybillNo + PDF emailed
```

Step 1 (token) requires a Bearer JWT. Steps 2–4 (lookups) are public — no JWT or API key needed. Steps 5–6 require authentication.

### API Gateway Requirements

| Route group | API key required at API Gateway | API Gateway authorizer |
| --- | --- | --- |
| `/logistics/token`, `/logistics/shipments`, `/logistics/cloud-waybill` | Yes | `DddTokenAuthorizer` |
| `/logistics/lookups/*` | **No** | None |

`OPTIONS` preflight routes are always public and do not require `x-api-key`.

Local SAM testing (`sam local start-api`) does not enforce `x-api-key`.

### Authentication

| Route | Mechanism |
| --- | --- |
| `/logistics/token` | Bearer JWT required |
| `/logistics/lookups/areas` | Public — no token needed |
| `/logistics/lookups/net-codes` | Public — no token needed |
| `/logistics/lookups/pickup-locations` | Public — no token needed |
| `/logistics/shipments` | Bearer JWT required. Ownership check applies for non-privileged callers |
| `/logistics/cloud-waybill` | Bearer JWT required |

**Privileged roles for shipment ownership bypass:** `admin`, `ngo`, `staff`, `developer`. A caller with one of these roles may create shipments linked to orders owned by any email address.

### Required Headers

| Scenario | Headers |
| --- | --- |
| Deployed: `/logistics/token`, `/logistics/shipments`, `/logistics/cloud-waybill` | `Content-Type: application/json`, `x-api-key: <key>`, `Authorization: Bearer <access-token>` |
| Deployed: `/logistics/lookups/*` | `Content-Type: application/json` (no `x-api-key`, no `Authorization`) |
| Local SAM | `Content-Type: application/json` |

### Rate Limits

Rate limiting is enforced per `userEmail ?? userId`. For public lookup routes, the caller has no JWT so `getAuthContext` returns `null` and the rate-limit identifier is `null`. How the shared rate limiter handles a null identifier (e.g. global action bucket or no limit) is determined by the shared runtime and is not directly observable from this Lambda's code.

| Route | Limit | Window |
| --- | --- | --- |
| `POST /logistics/token` | 10 requests | 300 s |
| `POST /logistics/lookups/areas` | 30 requests | 300 s |
| `POST /logistics/lookups/net-codes` | 30 requests | 300 s |
| `POST /logistics/lookups/pickup-locations` | 30 requests | 300 s |
| `POST /logistics/shipments` | 20 requests | 300 s |
| `POST /logistics/cloud-waybill` | 20 requests | 300 s |

### Success Response Shape

```json
{
  "success": true,
  "<endpoint-specific-fields>": "..."
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "logistics.validation.tokenRequired",
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

## Endpoints

### POST /logistics/token

Fetch an SF Address API bearer token. The returned token is passed as-is to the `/lookups/areas`, `/lookups/net-codes`, and `/lookups/pickup-locations` endpoints. Tokens are short-lived — callers should fetch a fresh one before each lookup session.

**Lambda:** `logistics`  
**Auth:** Bearer JWT required  
**Rate limit:** 10 / 300 s  
**Env dependency:** `SF_ADDRESS_API_KEY`

**Body:** Not required. The handler does not parse or validate the request body — any body is ignored.

**Example request:**

```http
POST /logistics/token HTTP/1.1
Authorization: Bearer <access-token>
x-api-key: <api-key>
Content-Type: application/json
```

**Success (200):**

```json
{
  "success": true,
  "bearer_token": "<sf-address-api-bearer-token>"
}
```

`bearer_token` is an opaque value returned directly from the SF Address login API. Pass it to subsequent lookup requests as `token`.

**Errors:**

| Status | errorKey | Cause |
| --- | --- | --- |
| 401 | `common.unauthorized` | Missing or invalid Bearer JWT |
| 429 | `common.rateLimited` | Rate limit exceeded |
| 500 | `common.internalError` | `SF_ADDRESS_API_KEY` missing or SF upstream failure |

---

### POST /logistics/lookups/areas

List SF Express area metadata. No authentication required. Use the returned `area_list` to display area selection and to determine `areaId` for the next step.

**Lambda:** `logistics`  
**Auth:** None  
**API key:** Not required  
**Rate limit:** 30 / 300 s

**Body:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string | Yes | Bearer token from `POST /logistics/token` |

Unknown fields are rejected (`.strict()` schema).

**Example request:**

```json
{ "token": "<bearer-token>" }
```

**Success (200):**

```json
{
  "success": true,
  "area_list": [
    { "areaId": 1, "areaName": "Hong Kong Island" },
    { "areaId": 2, "areaName": "Kowloon" }
  ]
}
```

`area_list` is the pass-through `data` value from the SF Address API. Shape is controlled by SF.

**Errors:**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.tokenRequired` | `token` missing or empty |
| 400 | `common.invalidJSON` | Malformed JSON body |
| 429 | `common.rateLimited` | Rate limit exceeded |
| 500 | `common.internalError` | SF upstream failure |

---

### POST /logistics/lookups/net-codes

List SF Express net codes for a given area and type. No authentication required. Use `areaId` from `/lookups/areas` and a `typeId` to get relevant net codes.

**Lambda:** `logistics`  
**Auth:** None  
**API key:** Not required  
**Rate limit:** 30 / 300 s

**Body:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string | Yes | Bearer token from `POST /logistics/token` |
| `typeId` | string \| number | Yes | Express type identifier |
| `areaId` | string \| number | Yes | Area identifier from `/lookups/areas` |

Unknown fields are rejected (`.strict()` schema).

**Example request:**

```json
{
  "token": "<bearer-token>",
  "typeId": 1,
  "areaId": 2
}
```

**Success (200):**

```json
{
  "success": true,
  "netCode": [
    { "netCode": "852A", "netName": "Mong Kok Service Point" }
  ]
}
```

`netCode` is the pass-through `data` value from the SF Address API. Shape is controlled by SF.

**Errors:**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.tokenRequired` | `token` missing or empty |
| 400 | `logistics.validation.typeIdRequired` | `typeId` missing |
| 400 | `logistics.validation.areaIdRequired` | `areaId` missing |
| 400 | `common.invalidJSON` | Malformed JSON body |
| 429 | `common.rateLimited` | Rate limit exceeded |
| 500 | `common.internalError` | SF upstream failure |

---

### POST /logistics/lookups/pickup-locations

Get SF Express pickup addresses for one or more net codes. Fetches each net code's addresses in parallel. No authentication required.

**Lambda:** `logistics`  
**Auth:** None  
**API key:** Not required  
**Rate limit:** 30 / 300 s

**Body:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string | Yes | Bearer token from `POST /logistics/token` |
| `netCode` | string[] | Yes | Non-empty array of net code strings from `/lookups/net-codes` |
| `lang` | string | No | Language for address names. Default `"en"` |

Unknown fields are rejected (`.strict()` schema).

**Example request:**

```json
{
  "token": "<bearer-token>",
  "netCode": ["852A", "852B"],
  "lang": "en"
}
```

**Success (200):**

```json
{
  "success": true,
  "addresses": [
    [
      { "addressId": 123, "addressName": "Pickup Point A" }
    ],
    [
      { "addressId": 124, "addressName": "Pickup Point B" }
    ]
  ]
}
```

`addresses[i]` corresponds to `netCode[i]`. Each inner array is the pass-through `data` value from the SF Address API. Shape is controlled by SF.

**Errors:**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.tokenRequired` | `token` missing or empty |
| 400 | `logistics.validation.netCodeListRequired` | `netCode` missing, empty array, or contains empty strings |
| 400 | `common.invalidJSON` | Malformed JSON body |
| 429 | `common.rateLimited` | Rate limit exceeded |
| 500 | `common.internalError` | SF upstream failure |

---

### POST /logistics/shipments

Create an SF Express shipment for a receiver and record the waybill number on any linked orders. Requires authentication.

**Lambda:** `logistics`  
**Auth:** Bearer JWT required  
**Rate limit:** 20 / 300 s  
**Env dependencies:** `SF_CUSTOMER_CODE`, `SF_PRODUCTION_CHECK_CODE`

**Body:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `lastName` | string | Yes | Receiver last name |
| `phoneNumber` | string | Yes | Receiver phone number |
| `address` | string | Yes | Receiver delivery address |
| `count` | number | No | Item count. Positive integer. Default `1` |
| `attrName` | string | No | SF extra attribute name (e.g. net code attribute name) |
| `netCode` | string | No | Selected net code string |
| `tempId` | string | No | Single `Order.tempId` to link the shipment to |
| `tempIdList` | string[] | No | Multiple `Order.tempId` values to link |

Unknown fields are rejected (`.strict()` schema).

**Order ownership:** If `tempId` or `tempIdList` is supplied, the service resolves the linked `Order` records and enforces caller ownership.

- **Non-privileged caller (`user` role):** `Order.email` must match the caller's JWT `userEmail` (case-insensitive). Any mismatch returns `403 common.unauthorized`.
- **Privileged caller (`admin`, `ngo`, `staff`, `developer`):** Ownership check is skipped.
- If no orders are found for the provided `tempId` values, the ownership check is skipped and the shipment still proceeds.

The SF shipment is sent with a hardcoded sender address (Pet Pet Club, Tsuen Wan HK). The receiver address is built from `lastName`, `phoneNumber`, and `address`.

After a successful shipment, `Order.sfWayBillNumber` is updated for all matched orders.

**Example request:**

```json
{
  "lastName": "Chan",
  "phoneNumber": "85291234567",
  "address": "Flat 5B, 12 Example Street, Kowloon",
  "count": 1,
  "attrName": "网点代码",
  "netCode": "852A",
  "tempIdList": ["T0001234567", "T0001234568"]
}
```

**Success (200):**

```json
{
  "success": true,
  "tempIdList": ["T0001234567", "T0001234568"],
  "trackingNumber": "SF1234567890"
}
```

`tempIdList` echoes back `customerDetails.tempIdList` from the request. If `tempIdList` was not provided in the request, the field is omitted from the response. `trackingNumber` is the SF waybill number.

**Errors:**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.lastNameRequired` | `lastName` missing or empty |
| 400 | `logistics.validation.phoneNumberRequired` | `phoneNumber` missing or empty |
| 400 | `logistics.validation.addressRequired` | `address` missing or empty |
| 400 | `common.invalidJSON` | Malformed JSON body |
| 401 | `common.unauthorized` | Missing or invalid Bearer JWT |
| 403 | `common.unauthorized` | Non-privileged caller does not own linked order |
| 429 | `common.rateLimited` | Rate limit exceeded |
| 500 | `common.internalError` | SF auth failure, missing env vars, or unhandled error |
| 500 | `logistics.missingWaybill` | SF returned a success response but no waybill number |
| 500 | `logistics.sfApiError` | SF API returned a failure (propagated from SF service error message) |

---

### POST /logistics/cloud-waybill

Request SF's cloud-print PDF for a waybill number, then email the PDF to the internal logistics address (`notification@ptag.com.hk`). Requires authentication.

**Lambda:** `logistics`  
**Auth:** Bearer JWT required  
**Rate limit:** 20 / 300 s  
**Env dependencies:** `SF_CUSTOMER_CODE`, `SF_PRODUCTION_CHECK_CODE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

**Body:**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `waybillNo` | string | Yes | SF waybill number returned from `POST /logistics/shipments` |

Unknown fields are rejected (`.strict()` schema).

**Side effect:** On success, the waybill PDF is emailed to `notification@ptag.com.hk`. There is no record of this action saved to MongoDB.

**Example request:**

```json
{ "waybillNo": "SF1234567890" }
```

**Success (200):**

```json
{
  "success": true,
  "waybillNo": "SF1234567890"
}
```

`waybillNo` echoes back the input waybill number. The PDF is emailed in the background — no PDF URL is returned.

**Errors:**

| Status | errorKey | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.waybillNoRequired` | `waybillNo` missing or empty |
| 400 | `common.invalidJSON` | Malformed JSON body |
| 401 | `common.unauthorized` | Missing or invalid Bearer JWT |
| 429 | `common.rateLimited` | Rate limit exceeded |
| 500 | `common.internalError` | SF auth failure, PDF download failure, SMTP failure, or missing env vars |
| 500 | `logistics.sfApiError` | SF cloud-print API returned `success: false` |
| 500 | `logistics.missingPrintFile` | SF cloud-print API returned no file entries |

---

## DDD Contract Delta vs Legacy

The DDD Logistics API intentionally differs from the legacy `SFExpressRoutes` endpoints. Frontend integrators must update their integration.

| Concern | Legacy (`AWS_API`) | DDD (`AWS_DDD_API`) |
| --- | --- | --- |
| **Route prefix** | `/sf-express-routes/` or `/v2/sf-express-routes/` | `/logistics/` |
| **Route paths** | `/sf-express-routes/get-token` | `/logistics/token` |
| | `/sf-express-routes/get-area` | `/logistics/lookups/areas` |
| | `/sf-express-routes/get-netCode` | `/logistics/lookups/net-codes` |
| | `/sf-express-routes/get-pickup-locations` | `/logistics/lookups/pickup-locations` |
| | `/sf-express-routes/create-order` | `/logistics/shipments` |
| | `/v2/sf-express-routes/print-cloud-waybill` | `/logistics/cloud-waybill` |
| **Lookup auth** | All legacy routes required Bearer JWT | Lookup routes (`/lookups/*`) are **public — no auth, no API key** |
| **Error key namespace** | `sfExpressRoutes.errors.*` | `logistics.*` |
| **Validation error keys** | `sfExpressRoutes.errors.validation.*` | `logistics.validation.*` |

---

## Frontend Integration Guide

### Address Discovery Flow (Public — No Token Required)

```
1. POST /logistics/token   (requires auth) → bearer_token
2. POST /logistics/lookups/areas            → area_list
3. POST /logistics/lookups/net-codes        → netCode list
4. POST /logistics/lookups/pickup-locations → addresses
```

Steps 2–4 require the `token` value from step 1 in their body, but do not require an `Authorization` header or `x-api-key`. The SF bearer token is not the same as the PetPetClub JWT.

### Creating A Shipment

```http
POST /logistics/shipments
Authorization: Bearer <access-token>
x-api-key: <api-key>
Content-Type: application/json

{
  "lastName": "Chan",
  "phoneNumber": "85291234567",
  "address": "...",
  "netCode": "852A",
  "tempIdList": ["T0001234567"]
}
```

On success, store `trackingNumber` for display and waybill printing.

### Printing A Waybill

```http
POST /logistics/cloud-waybill
Authorization: Bearer <access-token>
x-api-key: <api-key>
Content-Type: application/json

{ "waybillNo": "SF1234567890" }
```

Success means the PDF was emailed to `notification@ptag.com.hk`. No PDF URL is returned to the caller.

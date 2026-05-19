# Logistics API

**Base URL (Development):** `https://b6nj233e1a.execute-api.ap-southeast-1.amazonaws.com/development`

**Lambda:** `aws-ddd-api-{stage}-logistics`

SF Express integration for public metadata lookups, shipment creation, and cloud-waybill printing. The current DDD implementation uses the shared `{ success, message, data, requestId }` envelope. Older docs that describe top-level `bearer_token`, `area_list`, `netCode`, `addresses`, or `trackingNumber` payloads are stale.

---

## Overview

### Route Summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/logistics/token` | `x-api-key` only | Fetch SF address-service bearer token |
| POST | `/logistics/lookups/areas` | `x-api-key` only | Get area list |
| POST | `/logistics/lookups/net-codes` | `x-api-key` only | Get net-code list for area + type |
| POST | `/logistics/lookups/pickup-locations` | `x-api-key` only | Get pickup locations for net codes |
| POST | `/logistics/shipments` | `x-api-key` + Bearer JWT | Create shipment and write waybill number onto matched orders |
| POST | `/logistics/cloud-waybill` | `x-api-key` only | Generate and email cloud-print waybill PDF |

### Integration-Critical Behavior

| Topic | Current DDD behavior |
| --- | --- |
| Lookup routes | All three lookups are public and IP-rate-limited only |
| Shipment ownership | Non-privileged callers can only create shipments for orders whose `email` matches `jwt.userEmail` |
| Privileged roles | `admin`, `ngo`, `staff`, and `developer` bypass the order-email ownership check |
| Shipment side effect | Successful shipment creation updates matched `Order.sfWayBillNumber` values |
| Cloud-waybill side effect | On success, the PDF is emailed to `notification@ptag.com.hk` |
| Response wrappers | All routes return wrapper-based `data`; no legacy top-level fields |

---

## Auth Reference

Gateway/API-key/JWT behavior for logistics routes is defined only in [ENDPOINT_AUTH_BEHAVIOR.md](./ENDPOINT_AUTH_BEHAVIOR.md).

### Endpoint-Specific Authorization

- Non-privileged callers can only create shipments for orders whose `email` matches `jwt.userEmail`
- `admin`, `ngo`, `staff`, and `developer` bypass the shipment ownership check

### Rate Limits

| Route | Policy |
| --- | --- |
| Token | IP 10 / 300s |
| Areas lookup | IP 30 / 300s |
| Net-code lookup | IP 30 / 300s |
| Pickup-locations lookup | IP 30 / 300s |
| Shipments | IP 60 / 300s, identifier 30 / 300s, IP+identifier 20 / 300s |
| Cloud waybill | IP 60 / 300s, identifier 30 / 300s, IP+identifier 20 / 300s |

Rate-limit failures return `429 common.rateLimited`.

### Localization

- Locale priority is query `?lang` or `?locale`, then `language` / `lang` cookie, then `Accept-Language`
- Use `errorKey` for integration logic

---

## Success And Error Conventions

### Success Response Shape

Metadata success:

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {},
  "requestId": "aws-lambda-request-id"
}
```

Create success:

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {},
  "requestId": "aws-lambda-request-id"
}
```

### Error Response Shape

```json
{
  "success": false,
  "errorKey": "logistics.validation.tokenRequired",
  "error": "localized message",
  "requestId": "aws-lambda-request-id"
}
```

---

## Endpoints

### POST /logistics/token

Fetch the SF address-service bearer token.

**Lambda owner:** `logistics`  
**Auth:** `x-api-key` only

#### Request Body

No fields are required. `{}` is the simplest valid body for deployed API Gateway.

#### Token Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "bearerToken": "sf-address-token"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Token Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 429 | `common.rateLimited` | Token rate limit exceeded |
| 502 | `logistics.sfApiError` | Upstream SF token call failed |

### POST /logistics/lookups/areas

Get area metadata.

**Lambda owner:** `logistics`  
**Auth:** `x-api-key` only

#### Areas Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string | Yes | SF address bearer token |

#### Areas Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "areaList": []
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Areas Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.tokenRequired` | Missing or empty `token` |
| 400 | `common.invalidBodyParams` | Malformed JSON or strict-schema violation |
| 429 | `common.rateLimited` | Lookup rate limit exceeded |
| 502 | `logistics.sfApiError` | Upstream SF call failed |

### POST /logistics/lookups/net-codes

Get net codes for an area and type.

**Lambda owner:** `logistics`  
**Auth:** `x-api-key` only

#### Net-Code Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string | Yes | SF address bearer token |
| `typeId` | string or number | Yes | SF type id |
| `areaId` | string or number | Yes | SF area id |

#### Net-Code Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "netCode": []
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Net-Code Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.tokenRequired` | Missing or empty `token` |
| 400 | `logistics.validation.typeIdRequired` | Missing `typeId` |
| 400 | `logistics.validation.areaIdRequired` | Missing `areaId` |
| 400 | `common.invalidBodyParams` | Malformed JSON or strict-schema violation |
| 429 | `common.rateLimited` | Lookup rate limit exceeded |
| 502 | `logistics.sfApiError` | Upstream SF call failed |

### POST /logistics/lookups/pickup-locations

Get pickup-location lists for one or more net codes.

**Lambda owner:** `logistics`  
**Auth:** `x-api-key` only

#### Pickup-Locations Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string | Yes | SF address bearer token |
| `netCode` | string[] | Yes | Non-empty list of net codes |
| `lang` | string | No | Defaults to `en` |

#### Pickup-Locations Success (200)

```json
{
  "success": true,
  "message": "Retrieved successfully",
  "data": {
    "addresses": []
  },
  "requestId": "aws-lambda-request-id"
}
```

`addresses` follows the SF response structure and may be nested by requested net code.

#### Pickup-Locations Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.tokenRequired` | Missing or empty `token` |
| 400 | `logistics.validation.netCodeListRequired` | Missing or empty `netCode` list |
| 400 | `common.invalidBodyParams` | Malformed JSON or strict-schema violation |
| 429 | `common.rateLimited` | Lookup rate limit exceeded |
| 502 | `logistics.sfApiError` | Upstream SF call failed |

### POST /logistics/shipments

Create a shipment and write the returned waybill number onto matched orders.

**Lambda owner:** `logistics`  
**Auth:** `x-api-key` + Bearer JWT required  
**Content-Type:** `application/json`

#### Shipment Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `lastName` | string | Yes | Max 100 chars |
| `phoneNumber` | string | Yes | Max 20 chars |
| `address` | string | Yes | Max 500 chars |
| `count` | integer | No | Defaults to `1`, max `1000` |
| `attrName` | string | No | Max 200 chars |
| `netCode` | string | No | Max 64 chars |
| `tempId` | string | No | Max 64 chars |
| `tempIdList` | string[] | No | Max 100 items |

#### Shipment Success (200)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "tempIdList": ["T0001234567"],
    "trackingNumber": "SF1234567890"
  },
  "requestId": "aws-lambda-request-id"
}
```

`tempIdList` is only echoed when the caller sent that field. If the request uses only `tempId`, the success payload may contain just `trackingNumber`.

#### Shipment Ownership Rules

- if `tempId` or `tempIdList` resolves to orders, non-privileged callers must match `Order.email` against `jwt.userEmail`
- privileged roles `admin`, `ngo`, `staff`, and `developer` bypass this check
- matched orders are updated with `sfWayBillNumber`

#### Shipment Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.lastNameRequired` | Missing or empty `lastName` |
| 400 | `logistics.validation.phoneNumberRequired` | Missing or empty `phoneNumber` |
| 400 | `logistics.validation.addressRequired` | Missing or empty `address` |
| 400 | `common.invalidBodyParams` | Malformed JSON or strict-schema violation |
| 403 | `common.forbidden` | Non-privileged caller does not own linked order(s) |
| 429 | `common.rateLimited` | Shipment rate limit exceeded |
| 500 | `logistics.missingWaybill` | SF returned no waybill number |
| 502 | `logistics.sfApiError` | Upstream SF shipment call failed |

### POST /logistics/cloud-waybill

Generate a cloud-print PDF for a waybill and email it internally.

**Lambda owner:** `logistics`  
**Auth:** `x-api-key` only  
**Content-Type:** `application/json`

#### Cloud-Waybill Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `waybillNo` | string | Yes | Max 64 chars |

#### Cloud-Waybill Success (200)

```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "waybillNo": "SF1234567890"
  },
  "requestId": "aws-lambda-request-id"
}
```

#### Cloud-Waybill Side Effects

- downloads the generated PDF from SF
- emails it to `notification@ptag.com.hk`

#### Cloud-Waybill Errors

| Status | `errorKey` | Cause |
| --- | --- | --- |
| 400 | `logistics.validation.waybillNoRequired` | Missing or empty `waybillNo` |
| 400 | `common.invalidBodyParams` | Malformed JSON or strict-schema violation |
| 429 | `common.rateLimited` | Cloud-waybill rate limit exceeded |
| 500 | `logistics.sfApiError` | SF returned a failure state |
| 500 | `logistics.missingPrintFile` | SF returned no PDF file entry |
| 500 | `common.internalError` | Internal email delivery failed after the PDF was generated |
| 502 | `logistics.sfApiError` | Upstream SF call or PDF download failed |

---

## Frontend Integration Guide

1. Treat `/logistics/token` and `/logistics/lookups/*` as public API-key routes. The old doc version that required JWT for `/logistics/token` is wrong.
2. Read all successful payloads from `data`; do not use the old top-level `bearer_token`, `area_list`, `netCode`, or `trackingNumber` keys.
3. Use `tempId` or `tempIdList` only when shipment creation should also update matching orders.
4. Do not assume shipment success always returns `tempIdList`; that field is only echoed when it was sent in the request.
5. For non-privileged callers, ensure the shipment is tied to orders owned by the current user's email or the request will fail with `common.forbidden`.
6. `attrName` and `netCode` are treated as a pair for SF pickup metadata. Send both to include `extraInfoList`; if either is missing, shipment creation is sent as address-only delivery.

---

## Verification Snapshot

This document is grounded in `functions/logistics/src/services/sfMetadata.ts`, `sfShipment.ts`, `sfWaybill.ts`, `functions/logistics/src/zodSchema/logisticsSchema.ts`, and the public/protected route wiring in `template.yaml`.

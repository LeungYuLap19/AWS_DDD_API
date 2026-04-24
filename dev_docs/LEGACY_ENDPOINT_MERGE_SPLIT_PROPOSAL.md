# Legacy Endpoint Merge And Split Proposal

## Purpose

This document proposes which legacy endpoints from `AWS_API` should be merged into cleaner contracts and which should be split apart during the DDD rebuild in `AWS_DDD_API`.

The proposal is based on actual service behavior, not just route names.

## Decision Rules

- Merge endpoints when they operate on the same business object but were split by legacy transport or naming history.
- Split endpoints when one route mixes multiple business concerns, side effects, or aggregate owners.
- Do not preserve legacy action-style routes just because they already exist.
- Keep legacy online during migration; use this as the target contract-shaping guide.

## Strong Merge Candidates

### Auth Challenge Flows

These should remain separate by channel internally, but the public contract can be normalized around one challenge model.

Legacy endpoints:

- `POST /account/generate-email-code`
- `POST /account/verify-email-code`
- `POST /account/generate-sms-code`
- `POST /account/verify-sms-code`

Proposal:

- merge into one auth-challenge concept
- example target shape:
  - `POST /auth/challenges`
  - `POST /auth/challenges/verify`

Reason:

- all four endpoints do the same business job: create or verify a short-lived proof for login, registration, or account linking
- the channel is a field, not a separate business aggregate

### User Account Mutations

Legacy endpoints:

- `PUT /account`
- `POST /account/update-image`

Proposal:

- merge image update into normal account profile update
- or keep `avatar` as a small sub-resource only if upload lifecycle is distinct

Example target shape:

- `GET /users/me`
- `PATCH /users/me`
- optional `PUT /users/me/avatar`

Reason:

- `update-image` is only a narrow variant of the same profile mutation space
- separate route exists because of legacy frontend workflow, not domain separation

### Pet Create Variants

Legacy endpoints:

- `POST /pets/create-pet-basic-info`
- `POST /pets/create-pet-basic-info-with-image`

Proposal:

- merge into one pet-creation flow at the domain level
- implementation may still accept multiple input modes, but the contract should be one capability

Example target shape:

- `POST /pets`
- optional follow-up `POST /pets/{petId}/media`

Reason:

- both routes create the same pet aggregate
- the current split is transport-driven: JSON vs multipart + initial images
- the NGO counter logic belongs to pet creation, not to a separate endpoint family

### Pet Delete Variants

Legacy endpoints:

- `DELETE /pets/{petID}`
- `POST /pets/deletePet`

Proposal:

- merge into one canonical delete route

Example target shape:

- `DELETE /pets/{petId}`

Reason:

- both perform soft-delete behavior on the same aggregate
- `POST /pets/deletePet` is a compatibility route only

### NGO Edit Surface

Legacy endpoints:

- `GET /v2/account/edit-ngo/{ngoId}`
- `PUT /v2/account/edit-ngo/{ngoId}`
- `GET /v2/account/edit-ngo/{ngoId}/pet-placement-options`

Proposal:

- merge reads under one NGO management surface

Example target shape:

- `GET /organizations/{orgId}`
- `PATCH /organizations/{orgId}`
- `GET /organizations/{orgId}/placement-options`
- `PUT /organizations/{orgId}/placement-options`

Reason:

- current `edit-ngo` naming reflects one admin screen, not a durable domain model

### Product Reference And Logging

Legacy endpoints:

- `GET /product/productList`
- `POST /product/productLog`

Proposal:

- merge them under one product-support or catalog-support surface

Example target shape:

- `GET /products`
- `POST /products/activity`

Reason:

- both are legacy support flows around product discovery/recommendation
- they do not belong inside checkout/order APIs

## Strong Split Candidates

### NGO Registration

Legacy endpoint:

- `POST /v2/account/register-ngo`

Current behavior:

- creates NGO admin user
- creates NGO profile
- creates NGO access mapping
- creates NGO counter
- issues tokens

Proposal:

- split into onboarding steps or at least clearer application services

Target concepts:

- organization registration
- admin membership bootstrap
- counter initialization
- post-create sign-in

Reason:

- one request currently creates multiple aggregates with different lifecycles
- acceptable as one orchestration use case, but not as one generic “account register” concept

### NGO Edit Transaction

Legacy endpoint:

- `PUT /v2/account/edit-ngo/{ngoId}`

Current behavior:

- updates user profile
- updates NGO profile
- updates NGO counters
- updates NGO access permissions

Proposal:

- split by ownership even if one admin screen still orchestrates them

Target concepts:

- `PATCH /organizations/{orgId}`
- `PATCH /organizations/{orgId}/members/{memberId}`
- `PATCH /organizations/{orgId}/settings/counters`
- `PATCH /organizations/{orgId}/members/{memberId}/permissions`

Reason:

- one legacy route mutates four distinct aggregates
- this is the clearest overloaded admin endpoint in the current system

### Pet Update With Image

Legacy endpoint:

- `POST /pets/updatePetImage`

Current behavior:

- removes images
- uploads new images
- updates pet scalar profile fields
- can mutate NGO-related fields
- can change `tagId`

Proposal:

- split media operations from core pet mutations

Target concepts:

- `PATCH /pets/{petId}`
- `POST /pets/{petId}/media`
- `DELETE /pets/{petId}/media/{mediaId}`

Reason:

- one multipart route currently edits both the pet aggregate and the pet media collection
- the route name hides how broad the mutation really is

### Detail Info vs Transfer vs Source

Legacy endpoint family:

- `POST /pets/{petID}/detail-info`
- `POST /pets/{petID}/detail-info/transfer`
- `PUT /pets/{petID}/detail-info/transfer/{transferId}`
- `DELETE /pets/{petID}/detail-info/transfer/{transferId}`
- `PUT /pets/{petID}/detail-info/NGOtransfer`
- `GET /v2/pets/{petID}/detail-info/source`
- `POST /v2/pets/{petID}/detail-info/source`
- `PUT /v2/pets/{petID}/detail-info/source/{sourceId}`

Proposal:

- split into three subdomains:
  - pet extended profile
  - transfer history / ownership reassignment
  - source/origin

Example target shape:

- `GET/PATCH /pets/{petId}/details`
- `GET/POST/PATCH/DELETE /pets/{petId}/transfers`
- `GET/PUT /pets/{petId}/source`

Reason:

- transfer history is not the same thing as lineage/detail fields
- source/origin is also its own record with one-per-pet semantics
- current grouping exists because they shared one legacy screen area

### NGO Transfer

Legacy endpoint:

- `PUT /pets/{petID}/detail-info/NGOtransfer`

Current behavior:

- validates target user by email and phone
- reassigns pet ownership
- clears NGO ownership
- rewrites transfer fields

Proposal:

- split this from generic detail editing and treat it as reassignment or transfer orchestration

Example target shape:

- `POST /pets/{petId}/transfers/ngo-exit`
- or `POST /pets/{petId}/ownership-transfers`

Reason:

- this is a workflow endpoint, not a detail-info mutation

### Adoption Management vs Public Adoption Browse

Legacy endpoint families:

- `GET/POST/PUT/DELETE /v2/pets/{petID}/pet-adoption...`
- `GET /adoption`
- `GET /adoption/{id}`

Proposal:

- split managed placement/adoption records from the public adoption catalog

Target concepts:

- managed side:
  - `GET/PUT /pets/{petId}/placement`
- public side:
  - `GET /adoptions`
  - `GET /adoptions/{adoptionId}`

Reason:

- one side is an internal pet-owned record
- the other is a public browse/read model over adoption listings

### Lost Pet Creation

Legacy endpoint:

- `POST /v2/pets/pet-lost`

Current behavior:

- validates lost-pet form
- optionally checks linked owned pet
- mutates linked pet status
- uploads files
- creates lost-pet post
- generates serial number

Proposal:

- split report creation from pet-status side effects and media handling

Target concepts:

- `POST /lost-pet-reports`
- internal domain event or application step to update linked pet status
- `POST /lost-pet-reports/{reportId}/media`

Reason:

- current route mixes report aggregate creation with pet aggregate mutation and file storage

### Purchase Confirmation

Legacy endpoint:

- `POST /purchase/confirmation`

Current behavior:

- validates multipart checkout payload
- uploads assets
- creates order
- generates tag ID
- creates order-verification record
- generates QR/short URL
- sends email
- sends WhatsApp message

Proposal:

- split checkout orchestration from downstream fulfillment and notification work

Target concepts:

- `POST /orders`
- async/internal fulfillment step:
  - tag issuance
  - verification record creation
  - QR generation
  - notification dispatch

Reason:

- this is the most overloaded public write route in the current system
- it spans checkout, fulfillment, verification, and messaging

### Order Verification Surface

Legacy endpoint family:

- `GET/PUT /v2/orderVerification/supplier/{orderId}`
- `GET /v2/orderVerification/whatsapp-order-link/{_id}`
- `GET /v2/orderVerification/ordersInfo/{tempId}`
- `GET /v2/orderVerification/getAllOrders`
- `GET/PUT /v2/orderVerification/{tagId}`

Proposal:

- split by actor and lookup mode

Target concepts:

- supplier management view
- owner/customer verification lookup
- internal operations list
- tag-bound verification detail

Example target shape:

- `GET/PATCH /supplier-orders/{orderId}/verification`
- `GET /orders/{orderId}/contact-summary`
- `GET /verifications/by-tag/{tagId}`
- `GET /operations/order-verifications`

Reason:

- current surface mixes supplier edits, owner deep links, admin list views, and tag lookups in one namespace

### SF Express Routes

Legacy endpoint family:

- `POST /sf-express-routes/create-order`
- `POST /sf-express-routes/get-pickup-locations`
- `POST /sf-express-routes/get-token`
- `POST /sf-express-routes/get-area`
- `POST /sf-express-routes/get-netCode`
- `POST /v2/sf-express-routes/print-cloud-waybill`

Proposal:

- split logistics operations from vendor metadata helpers

Target concepts:

- shipment creation
- pickup/address search
- label generation
- keep token retrieval internal only

Example target shape:

- `POST /shipments`
- `POST /shipping/pickup-locations:search`
- `POST /shipping/areas:search`
- `POST /shipping/network-codes:search`
- `POST /shipments/{shipmentId}/labels`

Reason:

- current paths expose vendor RPC actions directly
- `get-token` is infrastructure leakage, not business API

## Keep Mostly As-Is

These endpoint families are already reasonably aligned with one business concept and mainly need naming cleanup, not major decomposition:

- `GET/POST/PUT/DELETE /pets/{petID}/medical-record...`
- `GET/POST/PUT/DELETE /pets/{petID}/medication-record...`
- `GET/POST/PUT/DELETE /pets/{petID}/deworm-record...`
- `GET/POST/PUT/DELETE /pets/{petID}/vaccine-record...`
- `GET/POST/PUT/DELETE /v2/pets/{petID}/blood-test-record...`
- `GET /petBiometrics/{petId}`
- `POST /petBiometrics/register`
- `POST /petBiometrics/verifyPet`
- `POST /analysis/breed`
- `POST /analysis/eye-upload/{petId}`

These still need better naming, but not heavy merge/split work compared with the overloaded flows above.

## Suggested Migration Order

1. Merge obvious duplicates first:
   - pet create variants
   - pet delete variants
   - auth challenge variants
2. Split overloaded write routes next:
   - NGO edit
   - pet update with image
   - lost-pet creation
   - purchase confirmation
3. Split mixed namespaces after that:
   - detail-info family
   - orderVerification family
   - sf-express-routes family

## Summary

The main merge targets are legacy duplicates and transport-driven variants.

The main split targets are routes that currently combine:

- aggregate mutation plus media handling
- aggregate mutation plus notification side effects
- admin-screen convenience payloads across multiple aggregates
- public checkout plus fulfillment plus verification issuance

Those split candidates should drive the new DDD API surface, not the old route names.
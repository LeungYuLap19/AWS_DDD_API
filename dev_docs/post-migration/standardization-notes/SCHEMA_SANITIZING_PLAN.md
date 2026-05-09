# Schema & Sanitizing Tightening — Audit + Plan

Audit date: 2026-05-08
Scope: `functions/**` across 18 domains in `AWS_DDD_API`.

## TL;DR

- Canonical validation: **Zod v4** via `parseBody(ctx.body, schema)` from shared bootstrap. Each domain has `src/zodSchema/`.
- Output sanitization (sensitive field stripping) is in good shape across domains.
- **Three classes of gaps**:
  1. **Path params not ObjectId-validated** (~60+ endpoints) — MongoDB injection risk.
  2. **No HTML sanitization** on free-text fields — XSS-at-rest risk for any client that renders raw values.
  3. **Schema looseness** — missing `.max()`, `.passthrough()` instead of `.strict()`, missing enums, unbounded pagination.

---

## 1. Findings by Domain

| Domain | `.strict()` | Path-param validation | Max-length | HTML sanitize | Notes |
|---|---|---|---|---|---|
| auth | ✓ | n/a | ⚠️ firstName/lastName unbounded | ⚠️ | basic email regex; phone normalize trims only |
| commerce-catalog | ✓ | n/a | ⚠️ | ⚠️ | `userEmail` not email-validated; `productUrl` not URL-validated |
| commerce-fulfillment | ✓ | ❌ tagId/orderId/verificationId | ⚠️ contact/petName/shortUrl | ⚠️ | |
| commerce-orders | ✓ | ❌ tempId (regex elsewhere) | ✓ mostly | n/a | pagination clamped manually, no schema |
| logistics | ✓ | n/a | ⚠️ name/phone/address | ⚠️ | `netCodeList` no `.max()` |
| ngo | ❌ no `.strict()` | n/a | ⚠️ description, registrationNumber, website | ❌ | root schema allows unknown |
| notifications | ✓ | ❌ notificationId | ✓ | n/a | |
| pet-adoption | ✓ | ❌ id | ❌ no constraints | ⚠️ | |
| pet-analysis | ⚠️ `.passthrough()` + manual reject | ❌ identifier | ✓ species(100) | n/a | upload MIME/size ✓ |
| pet-biometric | n/a (proxy) | n/a | n/a | n/a | proxies external service |
| pet-medical | ✓ | ❌ petId/medicalId/medicationId | ⚠️ medicalPlace/Doctor/Result/Solution | ⚠️ | ~15 endpoints affected |
| pet-profile | ⚠️ `.passthrough()` + `rejectUnknownFields()` | ❌ petId | ⚠️ many | ❌ | upload validation ✓; `breedimage` array no `.max()` |
| pet-recovery | ✓ | ✓ ObjectId on petId in body (best practice) | ⚠️ description/remarks | ❌ | path params (petLostID/petFoundID) not validated |
| pet-source | ? | ❌ petId | ⚠️ | ⚠️ | |
| pet-transfer | ✓ | ❌ petId/transferId | ⚠️ regPlace/transferOwner/Contact/Remark | ⚠️ | NGO transfer requires email-or-contact ✓ |
| pipeline-smoke | n/a | n/a | n/a | n/a | health check |
| request-authorizer | n/a | n/a | n/a | n/a | no `src/` |
| user | ✓ | n/a | ⚠️ firstName/lastName/district | n/a | sanitizeUser ✓ output side |

Legend: ✓ ok · ⚠️ partial · ❌ missing · n/a not applicable

---

## 2. Top 15 Highest-Risk Endpoints

1. `PATCH /pet/profile/{petId}` — petId not ObjectId-validated.
2. `GET /pet/medical/{petId}/general` (and ~15 sibling pet-medical endpoints) — petId/recordIds raw.
3. `POST /pet/profile` — `.passthrough()` schema; `name`/`features`/`info` unbounded; no HTML sanitize.
4. `POST /pet/analysis/uploads/image` — body schema is `.passthrough()`.
5. `POST /auth/registrations/user` — firstName/lastName unbounded.
6. `PATCH /ngo/me` — root schema no `.strict()`; description allows HTML.
7. `POST /commerce/orders` — optional fields unbounded, multipart.
8. `GET /commerce/orders` — pagination clamped manually, no schema.
9. `POST /pet/recovery/lost` — description/remarks free-text, no sanitize.
10. `POST /logistics/shipments` — name/phone/address unbounded.
11. `POST /pet/transfer/{petId}/{transferId}` — both path params raw; transferRemark free-text.
12. `POST /commerce/catalog/events` — userEmail/productUrl not format-validated.
13. `PATCH /notifications/me/{notificationId}` — path param raw.
14. `GET|POST /pet/adoption/{id}` — path param raw, schema has no constraints.
15. `POST /commerce/fulfillment/tags/{tagId}` — path param raw; multiple unbounded text fields.

---

## 3. Phased Plan

### P0 — Security-critical ✅ COMPLETED

- **Shared path-param validators** in `bootstrap/` (or layers/shared):
  - `objectIdString` (mongoose `ObjectId.isValid`)
  - `tempIdString` (regex `^[A-Za-z0-9_-]{1,64}$`)
  - Helper `parsePathParam(event, key, schema)` returning a typed value or 400.
- **Apply to all path params** used in DB queries (audit list above + `pet-medical`, `pet-profile`, `pet-transfer`, `pet-source`, `pet-recovery` lost/found IDs, `notifications`, `pet-adoption`, `commerce-fulfillment`, `commerce-orders/tempId`).
- **HTML sanitization**: add `sanitize-html` (or a small allow-list escaper); apply to free-text fields *post-parse* via a `sanitizeText`/`sanitizeRichText` helper. Targets: pet-profile (`features`,`info`,`name`,`owner`,`location`), pet-recovery (`description`,`remarks`), ngo (`description`), pet-transfer (`transferRemark`,`regPlace`), commerce-fulfillment (`contact`,`shortUrl`,`petName`), pet-medical free-text fields.

### P1 — Schema tightening ✅ COMPLETED

- Add `.max()` to all string fields per buckets: names 255, short codes 64, addresses 500, descriptions/remarks 2000.
- Replace `.passthrough()` + manual rejection with `.strict()`:
  - `pet-profile/createPetSchemas.ts`
  - `pet-analysis/breedAnalysisSchema.ts`
  - Add `.strict()` to `ngo/editNgoBodySchema.ts` root.
- **Shared `paginationQuerySchema`** with `page` 1..10000 and `limit` 1..100, coerced; apply to all paginated GETs.
- Enums for `gender`, `status`, `lang` — standardize across domains.
- Array bounds: `pet-profile.breedimage` `.max(10)`; `logistics.netCodeList` `.max(100)`.
- Switch basic email regex → `z.string().email()`; canonicalize phone to E.164 in `normalizePhone`.

### P2 — Infrastructure / observability ✅ COMPLETED

- Consolidate validators into a `bootstrap/validators/` shared module (objectId, tempId, email, phone, url, dates, pagination).
- Centralized `sanitize` module (`bootstrap/sanitizers/`) with `sanitizeHtml`, `sanitizeText`, `stripControlChars`.
- Log validation failures with route + identifier; consider WAF/CloudWatch alarms on bursts.
- Integration tests: malicious ObjectId payloads, oversized strings, `<script>` payloads, unknown-field rejection on `.strict()` schemas, pagination DoS values.

---

## 4. Cross-cutting deliverables

- `bootstrap/validators/index.ts` — `objectIdString`, `tempIdString`, `emailString`, `phoneE164`, `urlString`, `paginationQuerySchema`, `dateStringYYYYMMDD`, `dateStringDDMMYYYY`.
- `bootstrap/sanitizers/index.ts` — `sanitizeText`, `sanitizeHtml`, `sanitizeRichText`.
- `bootstrap/http/parsePathParam.ts` — uniform 400 response on bad path params.
- `dev_docs/api_docs/` — refresh affected endpoint specs after tightening.

---

## 5. Acceptance checklist (per endpoint)

- [ ] Path params parsed via shared validator.
- [ ] Body schema uses `.strict()`.
- [ ] All strings have `.max()`; arrays have `.max()`.
- [ ] Free-text fields run through `sanitizeText`/`sanitizeRichText` before persist.
- [ ] Pagination uses shared schema.
- [ ] Enum fields use `z.enum`.
- [ ] Email/phone/url use canonical validators.
- [ ] Tests cover: invalid ObjectId, oversized field, unknown field, XSS payload, pagination bounds.

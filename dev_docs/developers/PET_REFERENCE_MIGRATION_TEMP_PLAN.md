# Pet Reference Migration Temp Plan

Temporary working plan for the new public reference lambda. Delete or archive after the migration is complete.

## Legacy Sources Recovered

- `../AWS_API/functions/GetBreed/src/router.js`
- `../AWS_API/functions/GetBreed/src/services/referenceData.js`
- `../AWS_API/functions/GetBreed/src/config/db.js`
- `../AWS_API/dev_docs/REFACTORED_LAMBDA_ENDPOINT_STATUS.md`

Legacy routes mapped:

- `GET /animal/breed/{species}/en`
- `GET /animal/breed/{species}/zh`
- `GET /deworm`

Legacy collection/model notes:

- breed lookup reads `animal_list`
- deworm reference reads `anthelmintic`
- legacy `GetBreed` used `Animal.find({})` and read the first document's nested `breeds[...]` payload

## Auth / Data Inventory

Route auth:

- `GET /pet/reference/breed/{animalType}?lang={lang}`: public at Lambda layer, `x-api-key` required at API Gateway
- `GET /pet/reference/deworm`: public at Lambda layer, `x-api-key` required at API Gateway

Models / collections:

- `Animal` -> `animal_list`
- `Anthelmintic` -> `anthelmintic`
- `MongoRateLimit` / `RateLimit`

Env:

- `MONGODB_URI` only

Side effects:

- no writes except rate-limit counters
- no external providers

## Intentional Deltas

- No legacy compatibility routes were added.
- Breed lookup moved from legacy path-segment language selection to `GET /pet/reference/breed/{animalType}?lang={lang}`.
- Public deworm reference ownership moved out of `pet-medical` into the dedicated `pet-reference` Lambda.
- Response transport uses the shared DDD `{ success, message, data, requestId }` envelope.
- Success `message` is localized by the shared response helper; clients should treat `errorKey` as the stable failure contract.

## Non-Negotiables

- Follow `dev_docs/llms/migration/ROLE.md`.
- Follow `dev_docs/post-migration/standardization-notes/*`.
- Use shared-layer helpers only.
- Do not add legacy compatibility routes.
- Do not guess unclear behavior. Recover it from legacy sources first.

## Goal

Create a new `pet-reference` Lambda for public reference data:

- breed lookup by animal type
- deworm reference list

Working route shape:

- `GET /pet/reference/breed/{animalType}?lang={lang}`
- `GET /pet/reference/deworm`

## Scope

### 1. New Lambda

Create `functions/pet-reference/` with:

- `index.ts`
- `src/router.ts`
- `src/config/env.ts`
- `src/config/db.ts`
- `src/utils/response.ts`
- `src/utils/rateLimit.ts`
- `src/models/*`
- `src/services/*`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/zodSchema/*`

Behavior:

- public at Lambda level
- `x-api-key` still required at API Gateway
- no JWT authorizer
- shared response envelope and error keys
- shared `parseBody` / `parsePathParam` / rate-limit helpers

### 2. Template and Build Wiring

Update:

- `template.yaml`
- `script/esbuild-functions.cjs`

Add:

- new Lambda resource
- API Gateway `GET` + `OPTIONS` routes
- `Auth: Authorizer: NONE` for public routes
- deployment alias wiring for `pet-reference`

### 3. Config / Secret / Deployment Files

Audit and update as needed:

- `env.development.json`
- `env.json`
- `script/create-github-dev-secrets-script.cjs`
- `script/set-github-dev-secrets.local.sh`
- `.github/workflows/deploy.yml`
- `package.json`

Rule:

- if the new Lambda only uses global env vars, do not invent extra secret plumbing
- if a new function-specific env var is needed, add it everywhere consistently

### 4. Pet Medical Cleanup

Remove deworm reference ownership from `pet-medical` everywhere:

- `functions/pet-medical/src/router.ts`
- `functions/pet-medical/src/services/reference.ts`
- `functions/pet-medical/src/config/db.ts`
- `functions/pet-medical/src/models/Anthelmintic.ts`
- `functions/pet-medical/src/locales/*` if reference-specific keys remain unused
- `__tests__/pet-medical.test.js`
- `__tests__/pet-medical.sam.test.js`
- `dev_docs/api_docs/development/PET_MEDICAL.md`
- `dev_docs/developers/structure.txt`
- `dev_docs/developers/DDD_API_REWRITE_PLAN_ZH_TW.md`

### 5. Tests

Add or update:

- `__tests__/pet-reference.test.js`
- `__tests__/pet-reference.sam.test.js` if needed
- remove or relocate old pet-medical reference tests

Test cases:

- valid breed lookup
- valid deworm reference lookup
- invalid `animalType`
- missing `lang` or malformed `lang`
- not found / empty collection
- rate limit behavior
- cyberattack / malformed input cases

Intentional testing delta:

- no SAM-local HTTP suite was added for this slice because the current instruction is to keep only local Jest coverage and verify the deployed routes directly later

### 6. API Docs

Add:

- `dev_docs/api_docs/development/PET_REFERENCE.md`

Update:

- `dev_docs/api_docs/development/PET_MEDICAL.md`
- `dev_docs/developers/structure.txt`
- `dev_docs/developers/DDD_API_REWRITE_PLAN_ZH_TW.md`

## Execution Order

1. Recover legacy breed/deworm behavior and collection names.
2. Scaffold `pet-reference`.
3. Wire template and build config.
4. Move reference routes out of `pet-medical`.
5. Update tests.
6. Update docs.
7. Run build, typecheck, targeted tests, then live verification after deploy.

## Done Criteria

- new lambda is deployed
- `pet-medical` no longer owns deworm reference routing
- docs match deployed routes
- tests pass
- no legacy aliases were added
- shared-layer helpers are used throughout

## Validation Snapshot

- `npm run build:ts`
- `npm run validate`
- `npm run build`
- `npx jest __tests__/pet-reference.test.js __tests__/pet-medical.test.js --runInBand`

Known remaining gap before final closeout:

- deployed live verification for the new public endpoints is still pending

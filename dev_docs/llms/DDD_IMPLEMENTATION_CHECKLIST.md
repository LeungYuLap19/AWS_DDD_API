# DDD Implementation Checklist

Audience:

- primary: LLMs performing migration work
- secondary: developers reviewing implementation completeness

This document is the implementation checklist and harness-oriented guidance for continuing the `AWS_DDD_API` migration.

It is designed for:

- AI-assisted implementation
- future domain-by-domain Lambda migration
- faster and more accurate execution than the first-stage modularization done in `AWS_API`

This checklist should be treated as the **current DDD implementation standard**.

Required companion docs for AI-driven migration:

- `dev_docs/llms/DDD_MIGRATION_HARNESS.md`
- `dev_docs/llms/DDD_TESTING_STANDARD.md`

This file defines the implementation standard.

The companion docs define the execution harness:

- what must be discovered before code changes
- how to prove route-by-route parity after implementation
- how post-migration testing should be written
- how to hand completed migration work to the audition LLM

The best live reference is:

- `AWS_DDD_API/functions/auth`

The legacy reference set is:

- `AWS_API/`

`AWS_API` is not the target architecture. It is a **legacy modularized resource base** that should be treated as:

- behavior source
- flow source
- endpoint contract source
- schema source
- model source
- documentation source
- RAG source for migration support

That legacy repo matters because it already captured a large amount of monolith behavior during the first-stage modularization effort.

Do not blindly copy legacy code into DDD. Use it to recover:

- settled business behavior
- edge cases
- success/error branches
- old request/response semantics
- operational assumptions

The DDD target should keep behavior where needed, but improve:

- structure
- transport consistency
- env handling
- response consistency
- logging
- VPC/networking consistency
- shared runtime reuse

---

## 1. Current Reference Lambda

Use `functions/auth` as the reference implementation for current DDD shape.

Reference files:

- [functions/auth/index.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/auth/index.ts:1)
- [functions/auth/src/router.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/auth/src/router.ts:1)
- [functions/auth/src/services/challenge.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/auth/src/services/challenge.ts:1)
- [functions/auth/src/services/registration.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/auth/src/services/registration.ts:1)
- [functions/auth/src/config/db.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/auth/src/config/db.ts:1)
- [functions/auth/src/config/env.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/auth/src/config/env.ts:1)
- [functions/auth/src/utils/response.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/auth/src/utils/response.ts:1)
- [functions/auth/src/utils/token.ts](/Users/jimmyleung/Documents/vscode/AWS_DDD_API/functions/auth/src/utils/token.ts:1)

This lambda is the reference for:

- route shape
- service split
- env validation
- response pattern
- shared runtime usage
- workflow orchestration

---

## 2. Legacy Resource Positioning

`AWS_API` should be treated as a **legacy knowledge base**, not as the architecture to preserve.

Use `AWS_API` for:

- old flow discovery
- branch discovery
- error condition discovery
- missing env discovery
- old schema/model discovery
- old route-to-behavior mapping
- old operational notes and test reports

Useful legacy sources:

- `AWS_API/dev_docs/REFACTOR_CHECKLIST.md`
- `AWS_API/dev_docs/api_docs/*.md`
- `AWS_API/functions/*/src/services/*`
- `AWS_API/functions/*/src/config/*`
- `AWS_API/functions/*/src/models/*`
- `AWS_API/functions/*/src/zodSchema/*`

Do not assume legacy naming is still correct.

Specifically, these may intentionally change in DDD:

- route names
- error keys
- success message keys
- internal file structure
- auth transport shape
- CORS implementation location

What must be preserved when required:

- behavior
- side effects
- security checks
- refresh/session semantics
- ownership semantics
- duplicate/conflict behavior
- rate-limit behavior

---

## 3. Current Target Structure

Every domain Lambda in `AWS_DDD_API` should converge toward this shape:

```text
functions/<domain>/
  index.ts
  package.json                  # required for deploy packaging; include runtime deps used by this lambda
  src/
    router.ts
    config/
      db.ts                     # when DB-backed
      env.ts
      <provider>.ts             # mail/twilio/etc when needed
    services/
      <flow>.ts
    models/
      <Model>.ts
    utils/
      response.ts
      normalize.ts              # when needed
      rateLimit.ts              # when needed
      token.ts                  # auth only or token-issuing domains only
    zodSchema/
      <schema>.ts
    locales/
      en.json
      zh.json
```

Important:

- `applications/` is **not mandatory**
- do not create `applications/` by default
- only split further when service files become genuinely too dense

Current auth proved that a better split is:

- `services/challenge.ts`
- `services/registration.ts`
- `services/<flow>.ts`

instead of forcing fake layers.

---

## 4. Canonical Implementation Rules

### 4.1 Entrypoint

Each Lambda entrypoint should be minimal:

```ts
import './src/config/env';
import { createApiGatewayHandler } from '@aws-ddd-api/shared';
import { routeRequest } from './src/router';
import { response } from './src/utils/response';

export const handler = createApiGatewayHandler(routeRequest, { response });
```

Required properties:

- env validation at cold start
- shared handler adapter
- shared response singleton

No business logic belongs in `index.ts`.

### 4.2 Router

Use exact route keys:

```ts
'POST /domain/action'
'GET /domain/{id}'
```

Do not use:

- `includes()`
- `startsWith()`
- regex route dispatch

### 4.3 Services

Services should own:

- request validation
- branching
- business flow
- DB calls
- provider calls
- response creation

Do not introduce extra layers unless complexity demands it.

### 4.4 Shared Response

All API responses from domain lambdas should go through the domain response singleton.

Use:

- `response.successResponse(...)`
- `response.errorResponse(...)`
- `response.noContentResponse(...)` for preflight only

Do not return ad hoc:

```ts
{ statusCode, body }
```

### 4.5 Logging

Request outcome logging is centralized in shared response helpers.

Current rule:

- `2xx` -> info
- `4xx` -> warn
- `5xx` -> error

Keep direct logging only where no API response exists yet, for example:

- shared env validation at cold start

### 4.6 Env Validation

Shared env validation lives in:

- `layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/config/env.ts`

Each domain keeps:

- `src/zodSchema/envSchema.ts`
- `src/config/env.ts`

Pattern:

- parse `process.env`
- on failure `logError(...)`
- throw

Do not over-engineer env validation.

### 4.7 Request Validation

Schema files always live in:

- `src/zodSchema/`

Use `common.*` keys for structural request errors unless a domain key is clearly needed.

Current useful generic keys:

- `common.requestBodyRequired`
- `common.invalidBodyParams`
- `common.missingBodyParams`
- `common.invalidQueryParams`
- `common.missingQueryParams`
- `common.invalidPathParam`
- `common.missingPathParams`

### 4.8 Provider Config

If a service depends on a provider, client/config setup belongs in `config/`, not in the service file.

Examples:

- SMTP client wrapper -> `config/mail.ts`
- Twilio client wrapper -> `config/twilio.ts`

### 4.9 Packaging

Each Lambda should have a function-local `package.json`.

This is not only for dependency declaration.

It is also part of the deploy packaging contract for `dist/`.

Current example:

- `functions/auth/package.json`
- `functions/user/package.json`

Required rule:

- when creating a new Lambda under `functions/<domain>/`, also create `functions/<domain>/package.json`
- add a matching copy step in `script/prepare-dist.cjs`
- if that Lambda has a function-local lockfile that is needed for packaging workflow parity, copy that as well

Reason:

- `sam build` packages from `dist/`, not directly from the source function folder
- `script/prepare-dist.cjs` is responsible for copying Lambda-local package manifests into `dist/functions/<domain>/`
- if the Lambda package manifest is missing from source or not copied into `dist/`, deployment can fail or package the wrong runtime dependency set

The minimum expectation is:

- source manifest exists at `functions/<domain>/package.json`
- `prepare-dist.cjs` copies it to `dist/functions/<domain>/package.json`

If a Lambda truly has no function-local runtime dependencies, keep the manifest minimal rather than omitting it.

---

## 5. VPC and Runtime Infra Rules

Current repo reality:

- Lambdas are globally attached to a VPC through `Globals.Function.VpcConfig`

This was required because the legacy working AWS_API lambdas were already using a VPC path to reach MongoDB Atlas.

### Required VPC implications

If a Lambda is in a VPC, its execution role must include:

- `AWSLambdaBasicExecutionRole`
- `AWSLambdaVPCAccessExecutionRole`

Without that, Lambda cannot create ENIs and deployment fails with:

- `CreateNetworkInterface on EC2`

### Global VPC parameters

Current template parameters:

- `LambdaSubnetIds`
- `LambdaSecurityGroupIds`

Use parameterized VPC config, not hardcoded per-function `VpcConfig` duplication.

---

## 6. AI Harness Checklist

Use this checklist when migrating one legacy Lambda/domain into DDD.

### Phase 0 — Execution Scope

- [ ] Freeze the migration scope before editing code
- [ ] Record exact legacy source files, not just directory names
- [ ] Record exact target DDD routes, not just domain labels
- [ ] Record explicit non-goals for this migration slice
- [ ] Record stop/escalation conditions if key behavior is still unknown

### Phase A — Discovery

- [ ] Identify the legacy source Lambda(s) in `AWS_API`
- [ ] Identify all route mappings from legacy to DDD
- [ ] Identify all env vars used by the legacy implementation
- [ ] Identify all models touched by the legacy flow
- [ ] Identify all external providers used by the legacy flow
- [ ] Identify all security-sensitive branches
- [ ] Identify all rate-limited flows
- [ ] Identify all refresh/session/token behavior
- [ ] Identify all ownership / role checks
- [ ] Identify all public-vs-protected routes

### Phase B — Contract Recovery

- [ ] Recover request body/query/path shapes from legacy code and docs
- [ ] Recover behavior branches from legacy service code
- [ ] Recover side effects from legacy code
- [ ] Recover success and failure status codes
- [ ] Decide what stays behaviorally identical
- [ ] Decide what naming is intentionally modernized

### Phase C — DDD Scaffolding

- [ ] Create `index.ts`
- [ ] Create `router.ts`
- [ ] Create function-local `package.json`
- [ ] Create `src/config/env.ts`
- [ ] Create `src/zodSchema/envSchema.ts`
- [ ] Create `src/utils/response.ts`
- [ ] Create `src/services/*.ts`
- [ ] Create `src/models/*.ts` as needed
- [ ] Create `src/locales/en.json` and `zh.json`

### Phase D — Runtime Wiring

- [ ] Add/update function events in `template.yaml`
- [ ] Add explicit `OPTIONS` events where needed
- [ ] Decide whether route uses default authorizer, `NONE`, or optional local auth
- [ ] Add env parameters / function env wiring
- [ ] Confirm VPC/global infra assumptions are compatible
- [ ] Add Lambda `package.json` copy step to `script/prepare-dist.cjs`
- [ ] Confirm deployment packaging for function-local dependencies in `dist/`

### Phase E — Behavior Implementation

- [ ] Implement request validation
- [ ] Implement normalization helpers
- [ ] Implement provider wrappers in `config/`
- [ ] Implement DB connection and model registration
- [ ] Implement rate limits
- [ ] Implement conflict handling
- [ ] Implement response mapping
- [ ] Implement auth/session/cookie behavior if applicable
- [ ] Implement ownership / role / security checks

### Phase F — Security Audit

- [ ] Check auth enforcement
- [ ] Check public flow enumeration resistance
- [ ] Check rate limits on public/sensitive flows
- [ ] Check internal field exposure in response
- [ ] Check sensitive fields absent from client schemas
- [ ] Check duplicate conflict handling
- [ ] Check refresh/session rotation behavior
- [ ] Check VPC / provider / env runtime assumptions

### Phase G — Verification

- [ ] `npm run build:ts`
- [ ] `sam validate`
- [ ] deploy to development
- [ ] run pipeline smoke
- [ ] manually test critical flows
- [ ] compare with legacy behavior
- [ ] document any intentional deltas

### Phase G.1 — Post-Migration Test Implementation

- [ ] Write tests after the Lambda migration slice is functionally complete
- [ ] Follow `dev_docs/llms/DDD_TESTING_STANDARD.md`
- [ ] Cover happy paths
- [ ] Cover sad paths
- [ ] Cover cyberattack / abuse cases
- [ ] Use `AWS_API/dev_docs/test_reports/*.md` as legacy verification-style references where useful
- [ ] Record test scope and outcomes in the migration output

### Phase H — Audition Handoff

- [ ] Record route-by-route parity status
- [ ] Record security/ownership/rate-limit parity status
- [ ] Record env, packaging, and infra assumptions actually validated
- [ ] Record unresolved gaps and release risk
- [ ] Hand the migrated Lambda and validation output to the audition LLM

---

## 7. Useful Dos

### Do use `AWS_API` as RAG material

Use it to answer:

- what did the old flow do
- which error branch existed
- which env var was required
- which provider/API was involved
- what model fields were actually read/written

### Do treat `AWS_DDD_API/functions/auth` as the current gold standard

Use it to answer:

- how should the Lambda be structured now
- where should validation live
- where should provider setup live
- how should response/logging work
- how should token/cookie flows be done

### Do preserve behavior before preserving names

The migration target is not legacy naming fidelity.

Preserve first:

- behavior
- side effects
- security
- status codes when materially important

Then modernize:

- route names
- error key names
- module boundaries

### Do keep services pragmatic

If splitting into more layers does not simplify the code, do not do it.

### Do use shared runtime aggressively, but not blindly

Good shared usage:

- handler
- response
- auth context helpers
- env validation
- shared rate-limit core
- locale helpers

Do not move domain-specific code into shared too early.

### Do make infra part of the migration checklist

The first migration already showed that correctness is not only code.

Check:

- VPC
- Lambda execution role
- function packaging
- API Gateway auth config
- request model validation
- env injection

before assuming a behavior bug is in service code.

---

## 8. Useful Don'ts

- Don’t copy legacy file layout mechanically
- Don’t recreate `applications/` by default
- Don’t trust legacy naming more than legacy behavior
- Don’t return raw API Gateway stock errors when Lambda should own the contract
- Don’t let API Gateway request validation block routes that intentionally do not require a body
- Don’t put provider client creation inline in business services
- Don’t issue tokens outside the auth domain unless explicitly intended
- Don’t move token issuance into shared runtime just for reuse aesthetics
- Don’t attach VPC config without also checking Lambda execution-role policies
- Don’t treat your own deploy permission as equivalent to Lambda execution-role permission

---

## 9. Recommended Prompting Pattern For AI

When using AI to migrate a domain, provide:

1. target files in `AWS_DDD_API`
2. relevant legacy files in `AWS_API`
3. this checklist
4. explicit statement of:
   - route mapping
   - behavior that must stay the same
   - naming that may change

Recommended instruction shape:

```text
Use AWS_DDD_API/functions/auth as the structural reference.
Use AWS_API only as legacy behavior/RAG material.
Preserve behavior unless I explicitly approve a change.
Do not add extra layers unless they simplify the code.
Keep shared-runtime usage aligned with the current repo.
Audit template/env/VPC/packaging impact, not just service code.
```

---

## 10. Exit Criteria For A Migrated Lambda

A domain Lambda is only considered done when:

- routes are wired
- env is wired
- packaging is correct
- VPC/runtime assumptions are correct
- build passes
- deploy passes
- smoke/manual tests pass
- critical legacy behavior is preserved or explicitly documented as changed
- security review does not show an unclosed blocker

If those are not all true, the migration is not complete.

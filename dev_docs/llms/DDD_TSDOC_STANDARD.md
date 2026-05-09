# DDD TSDoc Standard

Audience:

- primary: LLMs and developers editing Lambda code in `AWS_DDD_API`
- secondary: reviewers checking whether changed Lambda files are documented enough to be maintained safely

This document defines where TSDoc is required in `AWS_DDD_API` Lambda source.

Scope:

- `functions/*/index.ts`
- `functions/*/src/**/*.ts`

This standard is intentionally limited to Lambda code in `AWS_DDD_API`.

---

## 1. Default Stance

Use TSDoc to explain contracts, invariants, side effects, and non-obvious behavior.

Do not try to put TSDoc on every symbol.

The rule is:

- document what a future maintainer could reasonably misread
- skip comments that only restate a clear name and type signature

This standard applies to:

- new Lambda files
- newly exported symbols
- modified exported symbols in files you touch

Do not stop a migration just to backfill untouched historical files.

---

## 2. Where TSDoc Is Required

### 2.1 `src/services/*.ts`

Required on:

- every exported route handler
- any helper whose behavior is security-sensitive, branch-heavy, or side-effect-heavy
- any helper preserving non-obvious legacy parity

Service comments should explain the business purpose and any important auth, ownership, rate-limit, provider, persistence, or response assumptions.

### 2.2 `src/utils/*.ts`

Required on exported helpers when the caller needs to know any of these:

- sanitization or projection rules
- auth or ownership expectations
- rate-limit semantics
- fallback behavior
- thrown error shape
- warm-container caching
- DB/S3/provider side effects

Trivial pure helpers such as obvious normalizers or formatters do not need TSDoc.

### 2.3 `src/config/*.ts`

Required on exported helpers that create or manage runtime resources, including:

- DB connection helpers
- provider client wrappers
- cached/singleton factories
- helpers with fallback or retry behavior

Not required for a straightforward `env.ts` parsed export whose contract is already obvious from the schema and variable names.

### 2.4 `src/models/*.ts`

Required only when the model file carries an important constraint that is not obvious from the schema itself, such as:

- intentionally partial/slim model definitions
- ownership-only lookup models
- counter/increment semantics
- compatibility notes with another Lambda-owned collection

Do not add TSDoc to routine schema field declarations with no special caveat.

### 2.5 `src/zodSchema/*.ts`

Required only when a schema includes non-obvious behavior, such as:

- coercion or transform logic
- custom refinement rules
- transport quirks
- legacy compatibility behavior worth preserving explicitly

Plain declarative body/query/path schemas usually do not need TSDoc.

### 2.6 Exported Types

Required on exported types, interfaces, and unions when the name alone does not make the contract clear, especially for:

- params objects passed across files
- discriminated unions
- result objects with operational meaning

---

## 3. Where TSDoc Is Usually Not Required

Do not require TSDoc by default on:

- `index.ts` `handler` exports created by `createApiGatewayHandler(...)`
- `router.ts` route tables and the `routeRequest` export
- simple `env.ts` default exports
- local variables
- trivial private helpers
- obvious schema/model declarations with no special behavior

If one of these files contains non-obvious logic anyway, document that logic directly.

---

## 4. What The TSDoc Must Say

A good Lambda TSDoc block should capture the part that the signature does not.

Include, when relevant:

- one-sentence purpose
- side effects
- security or ownership assumptions
- fallback behavior
- warm-container or caching behavior
- legacy parity note if the code intentionally preserves a tricky old behavior

Use tags selectively:

- `@param` when parameters are easy to confuse or several are the same primitive type
- `@returns` when the return meaning is not obvious from the type alone
- `@throws` when callers are expected to rely on an `HttpError` or another intentional thrown contract

Prefer symbol-level comments over file-level essays.

---

## 5. What To Avoid

Do not add TSDoc that only says:

- "Handles the request"
- "Gets the data"
- "Returns a response"

Avoid:

- boilerplate restatement of the function name
- stale historical notes with no present-day behavior impact
- large file-header blocks that do not help the next editor understand a symbol contract

If the comment would not help a reviewer catch a bug or a maintainer avoid a wrong refactor, omit it.

---

## 6. Practical Review Rule

Before finishing a Lambda change, check the touched files with this rule:

- if you changed an exported symbol in scope and its contract is non-obvious, add or refresh TSDoc in the same change

The expected quality bar is "enough to preserve behavior and intent", not "document every line".

---

## 7. Current Repo Examples

Good examples of the intended usage pattern already exist in:

- `functions/pet-medical/src/utils/auth.ts`
- `functions/commerce-orders/src/utils/template.ts`
- `functions/pet-recovery/src/utils/upload.ts`
- `functions/pet-recovery/src/models/Pet.ts`

Examples that usually do not need TSDoc:

- `functions/auth/index.ts`
- most `functions/*/src/router.ts` exports
- most plain `functions/*/src/zodSchema/*.ts` declarations

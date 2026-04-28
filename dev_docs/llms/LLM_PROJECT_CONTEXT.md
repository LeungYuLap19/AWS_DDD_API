# AWS_DDD_API LLM Project Context

Audience:

- primary: LLMs
- secondary: developers preparing or reviewing LLM-assisted migration runs

This document is the shared high-level context file for LLMs working in `AWS_DDD_API`.

Do not use this as the first entrypoint by itself.

LLM entrypoints are:

- `dev_docs/llms/migration/ROLE.md`
- `dev_docs/llms/audition/ROLE.md`

Read the appropriate role doc first, then read this file.

---

## 1. What `AWS_DDD_API` Is

`AWS_DDD_API` is the new serverless API codebase for the system's domain-driven rewrite.

It is not a patch-on-top of the old Lambda layout.

It is the new target architecture for:

- domain-oriented Lambda boundaries
- cleaner request routing
- shared runtime reuse
- stronger deployment consistency
- infrastructure defined through AWS SAM
- CI/CD-driven delivery instead of manual Lambda zip uploads

Current repo characteristics:

- AWS SAM manages API Gateway, Lambda, Layer, IAM, and deployment shape
- TypeScript source is compiled and prepared into `dist/` before deployment
- the repo already contains the top-level domain Lambda scaffold
- shared runtime utilities are used for handler orchestration, CORS, response behavior, and other cross-cutting concerns
- deployment is designed around `sam build`, `sam deploy`, and GitHub Actions

This repo is intended to become the long-term maintainable API architecture.

---

## 2. What `AWS_DDD_API` Is Trying To Do

The goal is not to mechanically copy legacy endpoints into a new folder structure.

The goal is to preserve required business behavior while moving the system into a better architecture.

That means:

- migrate legacy behavior into domain-based Lambdas
- preserve important request/response semantics where needed
- preserve security checks, ownership rules, session/token behavior, and side effects
- improve module boundaries, runtime consistency, env handling, and infra clarity
- reduce architecture drift caused by ad hoc Lambda edits and AWS Console-only changes

The migration target is:

- behavior continuity where required
- architectural improvement where beneficial

The rewrite is allowed to modernize:

- route naming
- module structure
- response/error key naming
- internal service organization

But it should not casually change:

- auth behavior
- ownership logic
- rate-limit behavior
- duplicate/conflict behavior
- side effects
- token or refresh semantics

---

## 3. Current Live Reference Inside `AWS_DDD_API`

The best current implementation reference is:

- `functions/auth`

Use it as the primary live example for:

- Lambda entry shape
- router structure
- service split
- env validation placement
- provider config placement
- response handling
- shared runtime usage

Do not assume every unfinished domain already matches this quality bar.

`functions/auth` is the current standard-bearing example.

---

## 4. How To Treat `AWS_API`

`AWS_API` is the legacy API codebase.

It is a modularized Lambda codebase produced from the first-stage breakup of the older monolithic Lambda implementation.

That first-stage modularization already captured a large amount of:

- business behavior
- endpoint flow
- model usage
- request and response semantics
- env usage
- provider integrations
- legacy operational assumptions
- documentation and test evidence

This matters because the legacy monolith behavior was not trivial to recover.

The first-stage modularization in `AWS_API` is valuable historical engineering work and should be treated as a major migration resource base.

In practical terms:

- `AWS_API` is legacy
- `AWS_API` is not the target architecture
- `AWS_API` is a strong behavior/resource base for DDD migration
- `AWS_API` can be used as RAG material during implementation

Good uses of `AWS_API`:

- recover legacy route behavior
- recover request/query/path shapes
- recover success and error branches
- recover security and ownership behavior
- recover model and schema usage
- recover required env vars
- recover provider/API integrations
- recover test expectations and documented edge cases

Bad uses of `AWS_API`:

- copying its architecture as the DDD target
- assuming its naming must be preserved
- assuming every file boundary should remain the same
- mechanically porting code without reconsidering DDD boundaries

Short version:

- preserve legacy behavior when needed
- do not preserve legacy architecture by default

---

## 5. Relationship Between `AWS_API` And `AWS_DDD_API`

The relationship should be understood like this:

- `AWS_API` = legacy modularized knowledge base
- `AWS_DDD_API` = new target DDD architecture

`AWS_API` exists to help answer:

- what did the old system actually do
- which branches and side effects existed
- which inputs and outputs were expected
- which env vars and providers were required
- which routes were public, protected, or special-case

`AWS_DDD_API` exists to decide:

- how those behaviors should now be organized
- which domain owns the behavior
- what the new route graph should be
- how the runtime and infra should be standardized

If there is tension between legacy naming and legacy behavior:

- prefer preserving behavior over preserving names

If there is tension between legacy architecture and DDD architecture:

- prefer DDD architecture while carrying forward required behavior

---

## 6. Guidance For LLMs Working In This Repo

When implementing or migrating code:

- treat `AWS_DDD_API` as the target system
- treat `AWS_API` as a legacy behavior/resource base
- use the DDD docs to decide target structure
- use the legacy repo to recover behavior details
- do not blindly port files
- do not guess through unclear auth, ownership, token, or side-effect behavior

Before substantial migration work, consult:

- `dev_docs/llms/DDD_IMPLEMENTATION_CHECKLIST.md`
- `dev_docs/llms/DDD_MIGRATION_HARNESS.md`
- `dev_docs/llms/DDD_TESTING_STANDARD.md`

Before starting migration for any Lambda or domain slice, study these critical docs:

- `dev_docs/developers/DDD_API_REWRITE_PLAN_ZH_TW.md`
- `template.yaml`
- `../AWS_API/dev_docs/REFACTORED_LAMBDA_ENDPOINT_STATUS.md`

Why these are critical:

- `dev_docs/developers/DDD_API_REWRITE_PLAN_ZH_TW.md`
  - defines the new domain/resource structure
  - lists target resource paths and endpoints
  - maps new DDD endpoints to corresponding legacy endpoints
- `template.yaml`
  - defines the AWS Lambda and API infrastructure wiring
  - shows function events, auth config, env injection, aliases, layers, and deployment assumptions
  - should be treated as the source of truth for infrastructure behavior in `AWS_DDD_API`
- `../AWS_API/dev_docs/REFACTORED_LAMBDA_ENDPOINT_STATUS.md`
  - explains the active legacy endpoint set
  - captures legacy endpoint behavior and route ownership
  - helps distinguish live behavior from frozen, null-routed, or intentionally unimplemented legacy routes

If the task is domain migration, the expected mindset is:

1. recover legacy behavior from `AWS_API`
2. map that behavior into the DDD domain target
3. implement in `AWS_DDD_API` using current DDD standards
4. write post-migration tests covering happy paths, sad paths, and cyberattack cases
5. hand the result to the audition LLM for cross-validation
6. record intentional deltas and review findings

---

## 7. One-Sentence Working Rule

Use `AWS_API` as legacy behavior/RAG material, but build toward `AWS_DDD_API` as the real long-term architecture.

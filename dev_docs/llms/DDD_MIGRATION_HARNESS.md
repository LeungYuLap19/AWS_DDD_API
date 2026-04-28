# DDD Migration Harness

Audience:

- primary: LLMs
- secondary: developers reviewing AI migration workflow

This document defines the execution harness for AI-driven domain migration in `AWS_DDD_API`.

`dev_docs/llms/DDD_IMPLEMENTATION_CHECKLIST.md` is the implementation standard.

This file defines the execution controls that make migrations more deterministic, reviewable, and repeatable.

---

## 1. Why The Checklist Alone Is Not Enough

The current checklist is good at describing:

- target architecture
- implementation rules
- migration phases

But a high-performing AI migration workflow also needs:

- explicit scope control
- explicit validation targets
- a place to record unknowns before editing
- a review handoff for cross-validation

Without those artifacts, later runs will drift because the model has to rediscover too much context each time.

---

## 3. Execution Workflow

### Step 1 — Freeze The Migration Scope

Before editing code, the working notes or prompt context must state:

- exact legacy source files
- exact target DDD routes
- exact legacy-to-DDD route mapping
- auth/public/optional-auth classification
- ownership and role checks
- models and collections touched
- env vars and external providers
- side effects
- intentional non-goals
- stop conditions when behavior is still unknown

If these items are not explicit, do not start implementation.

### Step 2 — Migrate In Bounded Slices

Implement by domain or subdomain slice, not by random file grouping.

Good slices:

- `auth/challenges`
- `pet-medical/deworming`
- `pet-profile core CRUD`

Bad slices:

- "all validators first"
- "all models first"
- "all routers first"

The slice should preserve a coherent behavior boundary.

### Step 3 — Verify Against The Scoped Notes

After implementation, verify:

- build success
- SAM validation
- route coverage
- auth behavior
- error behavior
- response shape
- side effects
- packaging/runtime assumptions

Do not verify against memory. Verify against the scoped notes and source references.

### Step 4 — Record Validation Findings

The migration output must show:

- what is the same
- what intentionally changed
- what is still unknown
- what evidence exists
- what release risk remains

### Step 5 — Add Post-Migration Tests

After the Lambda or slice is functionally migrated, add tests according to:

- `dev_docs/llms/DDD_TESTING_STANDARD.md`

Minimum required categories:

- happy paths
- sad paths
- cyberattack / abuse cases

Testing should happen after implementation is complete enough for route behavior to be stable.

### Step 6 — Hand Off To Audition

After migration and tests are complete, hand the result to:

- `dev_docs/llms/audition/ROLE.md`

The audition LLM is responsible for cross-validation and hallucination resistance.

---

## 4. Non-Negotiable Controls

Every migration run should make these visible.

### 4.1 Exact Route Map

Never describe routes loosely.

Always record:

- legacy method
- legacy path
- new method
- new path
- whether behavior is merged/split/renamed

### 4.2 Explicit Auth Matrix

For every route, record one of:

- public
- protected
- optional auth

Also record:

- required JWT claims
- role restrictions
- ownership rules

### 4.3 Explicit Data Inventory

Record:

- models read
- models written
- collections affected
- fields that are security-sensitive

This reduces missed side effects during migration.

### 4.4 Explicit Infra Inventory

Record:

- required env vars
- provider clients
- function-local runtime dependencies
- VPC assumptions
- API Gateway authorizer assumptions

Code parity is not enough if runtime wiring is incomplete.

### 4.5 Explicit Intentional Delta Log

If behavior changes on purpose, log it before implementation.

Typical acceptable deltas:

- route rename
- error key rename
- response message modernization
- internal module split

Typical dangerous unlogged deltas:

- auth weakening
- status-code change
- public/protected change
- response-field removal
- skipped side effect

---

## 5. Stop Conditions

Pause the migration and resolve the gap when any of these are true:

- legacy route ownership rule is unclear
- optional-auth behavior is unclear
- token/session behavior is unclear
- rate-limit behavior is unclear
- response contract differs across legacy paths and no target decision was recorded
- required env vars or providers are still unknown
- the new domain boundary would merge flows with incompatible security models

Do not let the model guess through these cases.

---

## 6. Definition Of Done

A domain migration is not done when code merely compiles.

It is done when all of the following are true:

- code implementation exists
- build passes
- `sam validate` passes
- post-migration tests exist
- critical flow verification is recorded
- intentional deltas are documented
- unresolved gaps are explicitly listed
- the result is ready for audition review

---

## 7. Recommended Prompt Assembly

When driving an AI migration run, provide:

1. `dev_docs/llms/DDD_IMPLEMENTATION_CHECKLIST.md`
2. the target DDD files
3. the exact legacy source files
4. relevant legacy docs and test reports
5. a short instruction naming:
   - the migration slice
   - what must remain behaviorally identical
   - what may be modernized
   - what validation evidence is expected

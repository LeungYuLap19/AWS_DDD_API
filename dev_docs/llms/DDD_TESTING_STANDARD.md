# DDD Testing Standard

Audience:

- primary: LLMs implementing post-migration tests
- secondary: developers reviewing test coverage expectations

This document defines the testing expectation for Lambda migration work in `AWS_DDD_API`.

Testing is not optional completion polish.

It is part of the migration definition of done.

---

## 1. When Tests Should Be Written

Tests should be implemented after the migration of a Lambda or migration slice is functionally complete.

Recommended order:

1. finish the migration slice implementation
2. complete route wiring and behavior wiring
3. run build and validation checks
4. write the test suite for the migrated Lambda
5. record the results in the migration output for audition review

Do not skip tests just because the migration compiles.

---

## 2. Baseline Testing Philosophy

Follow the spirit of how `AWS_API` handled verification work.

That legacy repo already established a useful testing mindset:

- test real route behavior
- test business failure behavior
- test security behavior
- document results clearly

The DDD migration should continue that standard, not weaken it.

Useful legacy references:

- `AWS_API/dev_docs/test_reports/*.md`
- especially `AWS_API/dev_docs/test_reports/USERROUTES_TEST_REPORT.md`

---

## 3. Minimum Coverage Categories

Every migrated Lambda should have tests covering all three categories below.

### 3.1 Happy Paths

Cover the expected successful flows.

Examples:

- successful create/read/update/delete behavior
- successful auth or verification flow
- successful protected-resource access with valid credentials
- successful provider-backed or DB-backed business workflow

### 3.2 Sad Paths

Cover expected business and validation failures.

Examples:

- missing required fields
- invalid JSON
- invalid body/query/path params
- duplicate/conflict cases
- not found cases
- invalid state transitions
- wrong credentials
- forbidden ownership or role failures
- method not allowed behavior

### 3.3 Cyberattack / Abuse Cases

Cover hostile or malformed requests that should be rejected safely.

Examples:

- missing auth header
- malformed bearer token
- expired JWT
- tampered JWT
- `alg:none` JWT attack
- self-access bypass attempts
- role escalation attempts
- body field injection attempts
- NoSQL operator injection where strings are expected
- malicious extra fields for mass assignment
- rate-limit abuse paths
- malformed multipart or malformed request body input when relevant

The exact attack cases should match the Lambda's risk profile.

---

## 4. Expected Test Style

Prefer tests that verify:

- HTTP status code
- response shape
- machine-readable success or error key
- important response fields
- side effects when applicable

For security tests, verify both:

- rejection behavior
- absence of unintended state mutation

For mutation routes, do not only assert the HTTP response.

Also verify the write result or lack of write result where practical.

---

## 5. Scope Expectations Per Lambda

Every migrated Lambda does not need identical test volume.

But every migrated Lambda does need risk-appropriate coverage.

Higher expectation:

- auth
- account/user
- NGO
- pet profile mutation
- medical mutation
- token/session flows
- public endpoints with write capability

Lower but still required expectation:

- simple read-only reference routes
- low-risk lookup routes

Even low-risk routes should still cover:

- happy path
- invalid input
- method/auth behavior if applicable

---

## 6. Suggested Test Layout

The exact file layout may evolve, but the repo should trend toward a predictable pattern.

Recommended shape:

- `__tests__/integration/<lambda>.test.*`
- `__tests__/unit/<lambda>-<module>.test.*`

Use integration-style tests for:

- route behavior
- auth behavior
- request validation
- cross-module business flows

Use focused unit tests for:

- provider wrappers
- token helpers
- normalization helpers
- isolated workflow logic that benefits from mocking

---

## 7. Required Post-Migration Testing Outputs

After a Lambda migration is complete, the work should include:

- the implemented test files
- the executed test results
- migration output notes summarizing what was verified

If a test category is intentionally deferred, the migration output must say so explicitly.

Silent omission is not acceptable.

---

## 8. Definition Of Done For Testing

A migrated Lambda is not fully done unless:

- happy paths are tested
- sad paths are tested
- cyberattack/abuse paths are tested
- test outcomes are recorded
- known coverage gaps are explicitly documented

---

## 9. Guidance For LLMs

When finishing a migrated Lambda:

- do not stop at implementation
- add tests after the Lambda migration is complete
- model the verification depth on the stronger `AWS_API` examples
- include security and attack cases, not only business success/failure

Short rule:

- migrate the Lambda
- then write the tests
- then record the evidence

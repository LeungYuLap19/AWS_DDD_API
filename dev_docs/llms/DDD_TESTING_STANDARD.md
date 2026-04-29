# DDD Testing Standard

Audience:

- primary: LLMs implementing post-migration tests
- secondary: developers reviewing test coverage expectations

This document defines the testing expectation for Lambda migration work in `AWS_DDD_API`.

Testing is not optional completion polish.

It is part of the migration definition of done.

This standard exists to prevent a false sense of safety from mock-heavy tests that never prove the real Lambda execution path.

If a suite only proves isolated business logic with mocks, it has not yet proven the migration.

Legacy reference:

- `AWS_API/dev_docs/test_reports/USERROUTES_TEST_REPORT.md`

That report is a good example of the expected verification style:

- explicit coverage categories
- real HTTP integration evidence
- DB-backed assertions where state matters
- security coverage called out separately

---

## 1. Core Principle

Do not claim a Lambda is "tested" unless the evidence matches the real risk.

For this repo, stable proof is not just:

- service-level logic passing
- mocked model calls passing
- one-shot happy-path integration tests passing

Stable proof must cover the actual execution boundary where bugs often hide:

- `createApiGatewayHandler` behavior
- `createRouter` dispatch behavior
- API Gateway body parsing assumptions
- authorizer context flow
- Lambda-to-DB persistence behavior
- repeated request behavior
- token revocation behavior across later requests

Mocked tests are useful, but they are not sufficient evidence for high-risk routes.

---

## 2. Required Test Evidence Tiers

Every migrated Lambda should be verified using the tiers below.

### 2.1 Tier 1: Focused Unit Tests

Use unit tests for isolated logic where mocking is appropriate.

Examples:

- pure helpers
- token utilities
- response normalization helpers
- provider wrappers
- small validation helpers

These tests are encouraged but do not prove route wiring.

### 2.2 Tier 2: Handler-Level Integration Tests

Every migrated Lambda must include handler-level tests that execute the real exported Lambda handler:

- `export const handler = createApiGatewayHandler(...)`

These tests should exercise:

- real `event.httpMethod`
- real `event.resource` / `event.path`
- real `event.body` as API Gateway string input
- real `requestContext.authorizer` shape when the route is protected
- real router dispatch
- real shared response/error normalization

These tests may mock external providers or DB connection primitives when needed, but they must still execute the real handler and route wiring.

### 2.3 Tier 3: Local SAM Integration Test

For API-facing Lambdas, local integration should also be run through the SAM runtime:

- `sam local start-api`
- `template.yaml`
- Docker

This tier exists to simulate the AWS Lambda runtime and API boundary more realistically than direct Jest handler invocation.

It should send real HTTP requests to the local SAM API and verify:

- happy-path flows
- input validation `400` responses
- business-logic `4xx` responses
- authentication and authorisation
- cyberattacks

Use this tier to prove:

- route wiring through the SAM template
- request/response behavior over HTTP
- real body serialization and parsing behavior
- route and method dispatch behavior
- `OPTIONS` / CORS behavior where the local harness can represent it faithfully

Important limitation:

- local SAM is useful, but it does not fully prove live AWS API Gateway authorizer behavior or all infra wiring
- in this repo, `sam local start-api` may invoke the route Lambda without a trustworthy live-equivalent `requestContext.authorizer`
- local protected-route testing may therefore rely on:
  - handler-level tests that inject a real `requestContext.authorizer` shape directly
  - a local JWT-header fallback path in shared auth code when SAM fails to inject authorizer context
  - `AUTH_BYPASS=true` for broad route and persistence testing when strict local auth proof is not the goal

Do not describe these local compensating mechanisms as proof that deployed API Gateway authorizer enforcement is correct.

Do not treat local SAM as a replacement for DB-backed UAT or live verification where those are required.

For routes whose production auth depends on API Gateway Lambda authorizers, at least one deployed AWS verification path is still required before claiming the infra auth behavior is fully proven.

### 2.4 Tier 4: Real DB-Backed UAT Or Equivalent Runtime Test

For high-risk Lambdas, mocked tests are not enough.

At least one DB-backed test path must run against a real persistence layer using the provided UAT flow or an equivalent real execution harness.

This is required for Lambdas involving:

- auth
- user/account mutation
- NGO mutation
- token/session flows
- destructive operations
- role/ownership enforcement
- refresh token revocation
- write endpoints exposed to public or semi-public clients

The goal is to prove actual persistence and multi-request behavior, not just mocked repository outcomes.

If the provided UAT exists for the route family, use it rather than replacing the proof entirely with mocks.

If UAT cannot be run, the migration output must explicitly say:

- why it was blocked
- which claims remain unproven
- what residual release risk remains

Silent omission is not acceptable.

---

## 3. Minimum Coverage Categories

Every migrated Lambda should cover all five categories below.

These categories should be made explicit in tests or in the migration test report.

They intentionally mirror the stronger legacy reporting style used in:

- `AWS_API/dev_docs/test_reports/USERROUTES_TEST_REPORT.md`

### 3.1 Happy-Path Flows

Examples:

- successful create/read/update/delete behavior
- successful protected-resource access with valid credentials
- successful DB-backed workflow completion
- successful refresh/login/logout behavior where applicable

### 3.2 Input Validation - `400` Responses

Examples:

- missing required fields
- malformed JSON
- invalid body/query/path params
- invalid format cases
- invalid field types

### 3.3 Business-Logic Errors - `4xx` Responses

Examples:

- duplicate/conflict cases
- not found cases
- invalid state transitions
- wrong credentials
- throttling / rate-limit behavior
- already-deleted or already-processed state conflicts
- forbidden ownership or role failures
- method not allowed behavior

### 3.4 Authentication And Authorisation

Examples:

- missing auth header
- malformed bearer token
- expired JWT
- tampered JWT
- valid token with wrong ownership scope
- valid token with wrong role
- missing authorizer context on protected routes
- optional-auth route differences across no token, valid token, and invalid token

### 3.5 Cyberattacks

Examples:

- `alg:none` JWT attack
- self-access bypass attempts
- role escalation attempts
- body field injection attempts
- NoSQL operator injection where strings are expected
- malicious extra fields for mass assignment
- repeated hostile requests
- malformed request body input
- replay / duplicate-submission abuse
- stale or revoked token reuse

The exact attack cases should match the Lambda's risk profile.

---

## 4. Non-Negotiable Handler-Level Proofs

Every migrated Lambda should prove the shared HTTP runtime behavior that it depends on.

These assertions should be done through the real handler, not only through direct unit tests of helpers.

### 4.1 `createApiGatewayHandler` Error Normalization

Required proof:

- thrown 4xx errors normalize to the expected status and error key
- thrown unexpected errors normalize to a safe 500 response
- missing required auth context is normalized correctly for protected flows

### 4.2 `createRouter` 404/405 Behavior

Required proof:

- unknown route returns `404`
- known path with wrong method returns `405`

### 4.3 Real API Gateway Body Handling

Required proof:

- `event.body` arrives as a string and is parsed through the real handler
- malformed JSON is rejected safely
- empty body / null body behavior is correct for the route type

Do not bypass this by directly calling downstream service functions with pre-parsed objects.

### 4.4 `OPTIONS` / CORS Behavior

Required proof when the Lambda is API-facing:

- allowed origin preflight returns correct success behavior
- denied origin preflight returns correct rejection behavior
- CORS headers are present on normal responses where expected

### 4.5 Real Authorization Context Flow

Required proof for protected or optional-auth routes:

- handler-level tests prove the route reads identity from a real `requestContext.authorizer` event shape
- missing authorizer context is rejected when protection is required
- optional-auth route behavior differs correctly between no token, valid token, and invalid token when applicable

Important boundary:

- local SAM HTTP tests do not, by themselves, prove that deployed API Gateway will inject `requestContext.authorizer` correctly
- if local SAM uses JWT fallback or bypass behavior, document that explicitly
- deployed AWS verification is required to prove:
  - authorizer deny prevents the backend Lambda from running
  - API Gateway injects the expected authorizer context into the backend event
  - deployed stage/method auth wiring is correct

---

## 5. Non-Negotiable Real DB-Backed Proofs For High-Risk Lambdas

The following cases are not considered fully proven by mock-backed tests alone.

For high-risk Lambdas, use UAT or equivalent DB-backed execution to prove them.

### 5.1 Persistence Behavior

Required proof:

- create/update/delete effects are actually persisted
- follow-up read sees the persisted state
- failed writes do not leave partial unsafe state when relevant

### 5.2 Repeated Request Stability

Required proof:

- repeated identical requests behave predictably
- warm repeated invocations do not corrupt state
- reconnect or repeated-connect behavior does not break request handling

### 5.3 Sequential Security State Changes

Required proof where applicable:

- delete then read is denied or not found as intended
- delete then patch is denied or not found as intended
- stale token tied to deleted or disabled identity no longer works

### 5.4 Refresh-Token Revocation

Required proof for auth/session flows:

- refresh-token revocation actually changes downstream auth behavior
- a revoked token cannot keep minting valid downstream access
- logout/delete/revoke flow affects later requests, not just the immediate response

### 5.5 Duplicate / Conflict Concurrency Cases

Required proof where relevant:

- parallel duplicate create requests do not both succeed incorrectly
- uniqueness/conflict rules still hold under concurrent requests

For cyberattack-oriented routes, include adversarial multi-request sequences, not only one isolated malformed request.

---

## 6. Attack Coverage Expectations

Security-sensitive Lambdas should include attack-path tests that prove both:

- rejection behavior
- absence of unintended state mutation

At minimum, consider these families when applicable:

- auth bypass attempts
- ownership bypass attempts
- role escalation attempts
- request-body injection
- operator injection
- duplicate replay / repeat-submission abuse
- stale token reuse
- revoked token reuse
- deleted-user token reuse

For mutation routes, do not only assert the HTTP response.

Also verify the resulting DB state or lack of state mutation.

---

## 7. Test Style Rules

Prefer assertions on:

- HTTP status code
- response shape
- machine-readable success or error key
- important response fields
- headers when behavior depends on them
- persistence side effects
- absence of unintended persistence side effects

Do not over-credit shallow assertions like:

- "returned 200"
- "mock function was called"
- "service function returned expected object"

Those are insufficient when the route claim is about real Lambda behavior.

---

## 8. Suggested Test Layout

Recommended shape:

- `__tests__/unit/<module>.test.*`
- `__tests__/integration/<lambda>.test.*`
- `uat/` or equivalent DB-backed verification artifacts when provided by the repo workflow

Use handler-level integration tests for:

- route behavior
- auth behavior
- request parsing
- response normalization
- shared runtime behavior

Use DB-backed UAT or equivalent runtime tests for:

- persistence verification
- multi-request flows
- token revocation flows
- concurrency/conflict verification
- attack paths where real state matters

---

## 9. Required Post-Migration Outputs

After a Lambda migration is complete, the work should include:

- implemented test files
- executed handler-level test results
- executed UAT / real DB-backed results for high-risk Lambdas
- migration output notes summarizing what was proven
- explicit list of anything still unproven

If a test category is deferred, blocked, or simulated only with mocks, say so explicitly.

Do not describe mock-backed proof as real runtime proof.

---

## 10. Definition Of Done For Testing

A migrated Lambda is not fully done unless:

- happy paths are tested
- sad paths are tested
- cyberattack / abuse paths are tested
- handler-level wiring is tested through the real exported Lambda handler
- high-risk persistence and security flows are proven with real DB-backed execution where required
- test outcomes are recorded
- known coverage gaps are explicitly documented

For high-risk Lambdas, "all tests use mocks" is a coverage gap, not a completed testing story.

---

## 11. Guidance For LLMs

When finishing a migrated Lambda:

- do not stop at implementation
- do not stop at unit tests
- do not stop at mock-backed handler tests if the route risk requires real persistence proof
- add handler-level tests after the Lambda migration is complete
- use the provided UAT or equivalent DB-backed harness for high-risk routes
- include security and attack cases, not only business success/failure
- record exactly which claims were proven by mocks versus real execution

Short rule:

- migrate the Lambda
- add handler-level tests
- run UAT / real DB-backed proof for risky flows
- record the evidence

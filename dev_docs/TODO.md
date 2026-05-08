# TODO

## Standardization

- [x] service function flow
- [x] locale keys
- [x] response format
- [x] error handling
- [x] all list enforce pagination
- [x] S3 and multipart
  - formadata only in mutipart route (do not mix json + multipart)

- [ ] retest, api docs update
- [ ] Tsdoc

## Optimization, Security Scan and Hardening

- [ ] what can be extract to shared (SoC) - delay
  - db connection, service standard flow, s3 client
- [x] template
  - iam roles: removed s3:PutObjectAcl (least-privilege), tightened PetAnalysis S3 resources to explicit prefixes, added RoleName to all 6 roles
  - multipart
- [ ] mongodb indexing - delay
- [ ] business logics optimisation - delay
- [x] Cold start optimisation
- [ ] Checkov, semgrep, snyk
  - [x] Checkov: 57 → 0 failures (see `.checkov.yaml` for skip justifications)
  - [ ] **Requires manager / deploy-role approval before applying to template:**
    - [ ] `CKV_AWS_76` — API Gateway access logging: add `AWS::Logs::LogGroup` + `AccessLogSetting` on `RestApi`; deploy role needs `logs:CreateLogGroup`, `logs:PutRetentionPolicy`; also requires one-time per-account API GW CloudWatch role (`aws apigateway update-account`)
    - [ ] `CKV_AWS_116` — Lambda DLQ: add `AWS::SQS::Queue` + `AWS::IAM::ManagedPolicy` (sqs:SendMessage) + attach to all 6 Lambda roles + `DeadLetterQueue` in Globals; deploy role needs `sqs:CreateQueue`, `sqs:SetQueueAttributes`, `iam:CreatePolicy`
  - [ ] semgrep
  - [ ] snyk checkings
- [x] schema and sanitizing tightening — see [SCHEMA_SANITIZING_PLAN.md](./SCHEMA_SANITIZING_PLAN.md)
  - P0: shared path-param validators (objectId/tempId) + apply to ~60 endpoints; add `sanitize-html` for free-text
  - P1: `.max()` on strings/arrays; replace `.passthrough()` with `.strict()` (pet-profile, pet-analysis, ngo); shared `paginationQuerySchema`; enums for gender/status/lang
  - P2: consolidate `bootstrap/validators/` + `bootstrap/sanitizers/`
  - [ ] P3: integration tests for injection/XSS/oversize
- [ ] path optimization (consider move PATCH pet profile by {petId} to /pet-profile/me) - delay
- [ ] Remove dead S3 env vars from `PetBiometricFunction` and `CommerceFulfillmentFunction`
  - `AWS_BUCKET_NAME`, `AWS_BUCKET_BASE_URL`, `AWS_BUCKET_REGION` declared in `envSchema.ts` and wired in `template.yaml` but never consumed by any service, router, or utility
  - Remove from both `envSchema.ts` files and from the `Environment.Variables` blocks in `template.yaml`
- [x] Layered rate limiting + per-flow failure cooldowns
  - Shared `requireMongoRateLimit` now accepts `policies: RateLimitPolicy[]` (scopes: `ip`, `identifier`, `ip+identifier`, `account`, `global`); request is rejected on the first lane that trips. Legacy `{ limit, windowSeconds }` shorthand preserved.
  - Added `requireMongoRateLimitNotInCooldown` + `recordMongoRateLimitFailure` (auth wrapper exports `requireFailureCooldown` / `recordFailure`) for failure-only counters that do not consume legitimate-traffic quota.
  - Auth: login, OTP send (email/sms), OTP verify (email/sms), refresh, user/ngo registration migrated to layered policies; OTP verify + login + refresh now have failure cooldowns (5 fails / 15 min for OTP & login, 10 fails / 30 min for refresh).
  - All other Lambda call sites (commerce-orders, logistics, pet-profile, pet-recovery, pet-analysis, pet-medical) migrated to explicit `policies[]`.
  - Consider WAF rate-based rules later if infra scope allows.

- [logistics] SF address client uses `hksfaddsit.sf-express.com` (SIT/staging environment) for area, netCode, and address lookups. Only the login URL uses the production `hksfadd` subdomain. Carried over from legacy unchanged. Confirm with SF Express whether separate production URLs exist for these endpoints. Revisit after frontend integration tests

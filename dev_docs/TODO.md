# TODO

## Standardization

- [x] service function flow
- [x] locale keys
- [x] response format
- [x] error handling
- [x] all list enforce pagination
- [x] S3 and multipart
  - formadata only in mutipart route (do not mix json + multipart)

- [x] retest local
- [x] tests for injection/XSS/oversize
- [x] retest sam
- [x] api docs update
- [x] Tsdoc
- [x] deployment tests

## Optimization, Security Scan and Hardening

- [x] template
  - iam roles: removed s3:PutObjectAcl (least-privilege), tightened PetAnalysis S3 resources to explicit prefixes, added RoleName to all 6 roles
  - multipart
- [x] Cold start optimisation
- [x] Checkov, semgrep, snyk
  - [x] Checkov: 57 -> 0 failures (see `.checkov.yaml` for skip justifications)
  - [x] Required manager / deploy-role coordination to apply in template/account:
    - [x] `CKV_AWS_76` - API Gateway access logging: add `AWS::Logs::LogGroup` + `AccessLogSetting` on `RestApi`; deploy role needs `logs:CreateLogGroup`, `logs:PutRetentionPolicy`; also required one-time per-account API GW CloudWatch role (`aws apigateway update-account`)
    - [x] `CKV_AWS_116` - Lambda DLQ: add `AWS::SQS::Queue` + inline `sqs:SendMessage` role policies on all 6 Lambda roles + `DeadLetterQueue` in Globals; deploy role needs `sqs:CreateQueue`, `sqs:SetQueueAttributes`
  - [x] semgrep: 18 findings - all false positives; body inputs guarded by Zod schemas; path-param ObjectId validation applied (P0)
  - [x] snyk: 1 high (DoS in `dicer@0.3.0` via `lambda-multipart-parser`) - fixed by replacing `lambda-multipart-parser` with `busboy@1.6.0`; 0 vulnerabilities remaining
- [x] schema and sanitizing tightening - see [SCHEMA_SANITIZING_PLAN.md](./SCHEMA_SANITIZING_PLAN.md)
  - [x] P0: shared path-param validators (objectId/tempId) applied to all path params used in DB queries
  - [x] P1: `.max()` on strings/arrays; replace `.passthrough()` with `.strict()` (pet-profile, pet-analysis, ngo); shared `paginationQuerySchema`; enums for gender/status/lang
  - [x] P2: consolidate `bootstrap/validators/` + `bootstrap/sanitizers/`
  - [x] P3: integration tests for injection/XSS/oversize - deferred; will run after all optimization, hardening, and standardization passes are complete
- [x] Layered rate limiting + per-flow failure cooldowns
  - Shared `requireMongoRateLimit` now accepts `policies: RateLimitPolicy[]` (scopes: `ip`, `identifier`, `ip+identifier`, `account`, `global`); request is rejected on the first lane that trips. Legacy `{ limit, windowSeconds }` shorthand preserved.
  - Added `requireMongoRateLimitNotInCooldown` + `recordMongoRateLimitFailure` (auth wrapper exports `requireFailureCooldown` / `recordFailure`) for failure-only counters that do not consume legitimate-traffic quota.
  - Auth: login, OTP send (email/sms), OTP verify (email/sms), refresh, user/ngo registration migrated to layered policies; OTP verify + login + refresh now have failure cooldowns (5 fails / 15 min for OTP & login, 10 fails / 30 min for refresh).
  - All other Lambda call sites (commerce-orders, logistics, pet-profile, pet-recovery, pet-analysis, pet-medical) migrated to explicit `policies[]`.
  - Consider WAF rate-based rules later if infra scope allows.

## Do Later / Can Set Aside

- [ ] what can be extract to shared (SoC) - delay
  - db connection, service standard flow, s3 client
- [ ] mongodb indexing - delay
- [ ] admin protected routes need db identity checking
- [ ] add CORS restrictions
- [ ] business logics optimisation - delay
- [ ] path optimization (consider move PATCH pet profile by {petId} to /pet-profile/me) - delay
- [ ] Remove dead S3 env vars from `PetBiometricFunction` and `CommerceFulfillmentFunction`
  - `AWS_BUCKET_NAME`, `AWS_BUCKET_BASE_URL`, `AWS_BUCKET_REGION` declared in `envSchema.ts` and wired in `template.yaml` but never consumed by any service, router, or utility
  - Remove from both `envSchema.ts` files and from the `Environment.Variables` blocks in `template.yaml`

- [logistics] SF address client uses `hksfaddsit.sf-express.com` (SIT/staging environment) for area, netCode, and address lookups. Only the login URL uses the production `hksfadd` subdomain. Carried over from legacy unchanged. Confirm with SF Express whether separate production URLs exist for these endpoints. Revisit after frontend integration tests

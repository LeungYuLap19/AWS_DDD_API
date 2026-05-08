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
- [ ] Checkov, semgrep, snyk, CodeGuru Security
- [x] schema and sanitizing tightening — see [SCHEMA_SANITIZING_PLAN.md](./SCHEMA_SANITIZING_PLAN.md)
  - P0: shared path-param validators (objectId/tempId) + apply to ~60 endpoints; add `sanitize-html` for free-text
  - P1: `.max()` on strings/arrays; replace `.passthrough()` with `.strict()` (pet-profile, pet-analysis, ngo); shared `paginationQuerySchema`; enums for gender/status/lang
  - P2: consolidate `bootstrap/validators/` + `bootstrap/sanitizers/`
  - [ ] P3: integration tests for injection/XSS/oversize
- [ ] path optimization (consider move PATCH pet profile by {petId} to /pet-profile/me) - delay
- [x] Layered rate limiting + per-flow failure cooldowns
  - Shared `requireMongoRateLimit` now accepts `policies: RateLimitPolicy[]` (scopes: `ip`, `identifier`, `ip+identifier`, `account`, `global`); request is rejected on the first lane that trips. Legacy `{ limit, windowSeconds }` shorthand preserved.
  - Added `requireMongoRateLimitNotInCooldown` + `recordMongoRateLimitFailure` (auth wrapper exports `requireFailureCooldown` / `recordFailure`) for failure-only counters that do not consume legitimate-traffic quota.
  - Auth: login, OTP send (email/sms), OTP verify (email/sms), refresh, user/ngo registration migrated to layered policies; OTP verify + login + refresh now have failure cooldowns (5 fails / 15 min for OTP & login, 10 fails / 30 min for refresh).
  - All other Lambda call sites (commerce-orders, logistics, pet-profile, pet-recovery, pet-analysis, pet-medical) migrated to explicit `policies[]`.
  - Consider WAF rate-based rules later if infra scope allows.

- [logistics] SF address client uses `hksfaddsit.sf-express.com` (SIT/staging environment) for area, netCode, and address lookups. Only the login URL uses the production `hksfadd` subdomain. Carried over from legacy unchanged. Confirm with SF Express whether separate production URLs exist for these endpoints. Revisit after frontend integration tests

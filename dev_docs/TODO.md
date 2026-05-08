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

- [ ] what can be extract to shared (SoC)
  - db connection, service standard flow, s3 client
- [x] template
  - iam roles: removed s3:PutObjectAcl (least-privilege), tightened PetAnalysis S3 resources to explicit prefixes, added RoleName to all 6 roles
  - multipart
- [ ] mongodb indexing
- [ ] business logics optimisation
- [ ] Cold start optimisation
- [ ] Checkov, semgrep, snyk, CodeGuru Security
- [ ] schema and sanitizing tightening — see [SCHEMA_SANITIZING_PLAN.md](./SCHEMA_SANITIZING_PLAN.md)
  - P0: shared path-param validators (objectId/tempId) + apply to ~60 endpoints; add `sanitize-html` for free-text
  - P1: `.max()` on strings/arrays; replace `.passthrough()` with `.strict()` (pet-profile, pet-analysis, ngo); shared `paginationQuerySchema`; enums for gender/status/lang
  - P2: consolidate `bootstrap/validators/` + `bootstrap/sanitizers/`; integration tests for injection/XSS/oversize
- [ ] path optimization (consider move PATCH pet profile by {petId} to /pet-profile/me)
- [ ] Replace current basic rate limiting with layered rate limiting:
  - Add per-IP, per-identifier, and per-account limits.
  - Add separate failure counters/cooldowns for login, OTP verify, refresh abuse, and destructive routes.
  - Consider WAF rate-based rules later if infra scope allows.

- [logistics] SF address client uses `hksfaddsit.sf-express.com` (SIT/staging environment) for area, netCode, and address lookups. Only the login URL uses the production `hksfadd` subdomain. Carried over from legacy unchanged. Confirm with SF Express whether separate production URLs exist for these endpoints. Revisit after frontend integration tests

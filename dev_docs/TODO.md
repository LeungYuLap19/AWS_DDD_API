# TODO

## Standardization with Opus

- [ ] service function flow
- [ ] locale keys
- [ ] response format
- [ ] error handling
- [ ] S3 and multipart
- [ ] Tsdoc
- [ ] Api docs

## Optimization, Security Scan and Hardening

- [ ] mongodb indexing
- [ ] business logics optimisation
- [ ] Cold start optimisation
- [ ] Checkov, semgrep, snyk, CodeGuru Security
- [ ] schema and sanitizing tightening
- [ ] path optimization (consider move PATCH pet profile by {petId} to /pet-profile/me)
- [ ] Replace current basic rate limiting with layered rate limiting:
  - Add per-IP, per-identifier, and per-account limits.
  - Add separate failure counters/cooldowns for login, OTP verify, refresh abuse, and destructive routes.
  - Consider WAF rate-based rules later if infra scope allows.

- [logistics] SF address client uses `hksfaddsit.sf-express.com` (SIT/staging environment) for area, netCode, and address lookups. Only the login URL uses the production `hksfadd` subdomain. Carried over from legacy unchanged. Confirm with SF Express whether separate production URLs exist for these endpoints. Revisit after frontend integration tests

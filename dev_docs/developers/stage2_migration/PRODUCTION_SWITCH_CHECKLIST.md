# Production Switch Checklist

This runbook lists all required changes when promoting from development usage patterns to production deployment behavior.

Use this file together with:

- `template.yaml`
- `.github/workflows/deploy.yml`
- `dev_docs/api_docs/development/AUTH.md`

---

## 1. Required Backend Configuration Changes

Set production values in GitHub Actions secrets before triggering production deploy.

### 1.1 Security and Auth

1. `PROD_AUTH_BYPASS` must be `false`.
2. `PROD_JWT_SECRET` must be a production secret (not development secret).
3. `PROD_ALLOWED_ORIGINS` must be exact production frontend origins (comma-separated). Do not use `*`.
4. `PROD_REFRESH_COOKIE_SAME_SITE` should be `Strict` for normal first-party production web usage.

### 1.2 Core Data and Service Endpoints

1. `PROD_MONGODB_URI`
2. `PROD_ADOPTION_MONGODB_URI`
3. `PROD_BUSINESS_MONGODB_URI`
4. `PROD_FACEID_API`
5. `PROD_PET_ANALYSIS_VM_PUBLIC_IP`
6. `PROD_PET_ANALYSIS_DOCKER_IMAGE`
7. `PROD_PET_ANALYSIS_HEATMAP`
8. `PROD_PET_ANALYSIS_VM_BREED_PUBLIC_IP`
9. `PROD_PET_ANALYSIS_BREED_DOCKER_IMAGE`

### 1.3 Auth Provider Secrets

1. `PROD_TWILIO_ACCOUNT_SID`
2. `PROD_TWILIO_AUTH_TOKEN`
3. `PROD_TWILIO_VERIFY_SERVICE_SID`
4. `PROD_AUTH_SMTP_HOST`
5. `PROD_AUTH_SMTP_PORT`
6. `PROD_AUTH_SMTP_USER`
7. `PROD_AUTH_SMTP_PASS`
8. `PROD_AUTH_SMTP_FROM`

### 1.4 Object Storage

1. `PROD_S3_BUCKET_NAME`
2. `PROD_S3_BUCKET_BASE_URL`
3. `PROD_S3_BUCKET_REGION`

### 1.5 Commerce and Logistics Secrets

1. `PROD_COMMERCE_SMTP_HOST`
2. `PROD_COMMERCE_SMTP_PORT`
3. `PROD_COMMERCE_SMTP_USER`
4. `PROD_COMMERCE_SMTP_PASS`
5. `PROD_COMMERCE_SMTP_FROM`
6. `PROD_WHATSAPP_BEARER_TOKEN`
7. `PROD_WHATSAPP_PHONE_NUMBER_ID`
8. `PROD_CUTTLY_API_KEY`
9. `PROD_SF_CUSTOMER_CODE`
10. `PROD_SF_PRODUCTION_CHECK_CODE`
11. `PROD_SF_SANDBOX_CHECK_CODE`
12. `PROD_SF_ADDRESS_API_KEY`
13. `PROD_LOGISTICS_SMTP_HOST`
14. `PROD_LOGISTICS_SMTP_PORT`
15. `PROD_LOGISTICS_SMTP_USER`
16. `PROD_LOGISTICS_SMTP_PASS`
17. `PROD_LOGISTICS_SMTP_FROM`

### 1.6 Rate-Limit Settings

1. `PROD_REFRESH_TOKEN_MAX_AGE_SEC`
2. `PROD_REFRESH_RATE_LIMIT_LIMIT`
3. `PROD_REFRESH_RATE_LIMIT_WINDOW_SEC`

---

## 2. CORS and Cookie Policy (Production)

1. Do not use wildcard production origin.
2. `PROD_ALLOWED_ORIGINS` must list exact browser origins, for example `https://app.example.com,https://www.example.com`.
3. `PROD_REFRESH_COOKIE_SAME_SITE` should be `Strict` unless product requirements explicitly require cross-site cookie flows.
4. Keep `Secure` cookie behavior in production.
5. If product requires cross-site refresh cookies, evaluate `SameSite=None` with security review and exact origin allowlist.

---

## 3. Frontend Configuration Changes for Production

Use two HTTP clients in frontend:

1. Default API client:
2. `withCredentials: false`
3. Include `x-api-key` and `Authorization: Bearer <accessToken>` for protected routes.

4. Refresh/cookie-lifecycle auth client:
5. `withCredentials: true`
6. Use for `POST /auth/tokens/refresh`.

Auth cookie lifecycle routes that should use credentialed mode when browser must store/send refresh cookie:

1. `POST /auth/challenges/verify` (existing-user success branch sets cookie)
2. `POST /auth/registrations/user`
3. `POST /auth/registrations/ngo`
4. `POST /auth/login/ngo`
5. `POST /auth/tokens/refresh`

Routes that should remain non-credentialed by default:

1. Bearer-token protected domain APIs such as `/user/me`, `/pet/*`, `/commerce/*`, `/logistics/*`, `/notifications/*`.

---

## 4. Deployment Procedure

1. Verify all `PROD_*` secrets are present in GitHub.
2. Trigger workflow manually with `deploy_production=true`.
3. Confirm `deploy-development` succeeded in the same run.
4. Confirm `deploy-production` succeeded.
5. Confirm production smoke step passed.

---

## 5. Post-Deploy Verification Checklist

1. `POST /production/pipeline/smoke` or configured smoke endpoint succeeds.
2. Browser preflight works from each production origin.
3. `POST /auth/challenges` and `/auth/challenges/verify` work with production API key.
4. Refresh flow works:
5. Cookie is stored on login/verify success.
6. `POST /auth/tokens/refresh` returns new access token.
7. Protected Bearer route works:
8. `GET /user/me` with `Authorization: Bearer ...` and `x-api-key`.
9. Confirm no frontend client sets `withCredentials: true` globally.

---

## 6. Common Production Switch Mistakes

1. Leaving `PROD_ALLOWED_ORIGINS` as `*` or using wrong scheme/port/domain.
2. Missing `PROD_REFRESH_COOKIE_SAME_SITE` after introducing `RefreshCookieSameSite` parameter.
3. Sending `Authorization` without `Bearer ` prefix.
4. Using `withCredentials: true` globally on all API calls.
5. Forgetting that API Gateway may return gateway-generated 401/403 before Lambda body handling.

---

## 7. Quick Diff: Development vs Production Defaults

1. `ALLOWED_ORIGINS`
2. Development: often localhost origins.
3. Production: exact public frontend origins only.

4. `REFRESH_COOKIE_SAME_SITE`
5. Development for cross-origin localhost testing: often `None`.
6. Production default: `Strict` unless business requirement demands cross-site refresh behavior.

7. Frontend `withCredentials`
8. Development and production should both keep default API calls non-credentialed.
9. Credentialed mode should be limited to refresh/cookie lifecycle auth calls.

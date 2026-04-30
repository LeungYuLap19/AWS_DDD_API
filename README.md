# AWS DDD API

這個 repo 是新的 DDD serverless API 基礎骨架。

目前已經落地的重點-：

- AWS SAM 管理整個 API Gateway + Lambda + Layer + IAM
- TypeScript source，編譯後從 `dist/` 部署
- 14 個 domain Lambda 骨架
- shared Lambda-managed CORS
- API Gateway request body validation
- Lambda JWT authorizer
- global Lambda VPC networking via SAM `Globals.Function.VpcConfig`
- API key requirement
- GitHub Actions 透過 OIDC 自動 deploy `development`，並支援手動 deploy `production`

這不是手動 upload zip 的 repo。部署主線已經是：

- `template.yaml`
- `sam build`
- `sam deploy`
- GitHub Actions CI/CD

## 目前的 domain Lambda

- `auth`
- `user`
- `ngo`
- `pet-profile`
- `pet-source`
- `pet-transfer`
- `pet-adoption`
- `pet-medical`
- `pet-analysis`
- `pet-recovery`
- `pet-biometric`
- `notifications`
- `commerce`
- `logistics`

另外保留：

- `request-authorizer`
- `pipeline-smoke`

## TypeScript 與 build 流程

source code 寫在：

- `functions/**/**/*.ts`
- `layers/shared-runtime/**/*.ts`
- `functions/**/src/locales/*.json`
- `layers/shared-runtime/**/locales/*.json`

部署前流程：

1. `tsc` 把 TypeScript 編譯成 JavaScript
2. `script/prepare-dist.cjs` 整理 deploy 所需檔案到 `dist/`
3. `sam build` 從 `dist/` 打包
4. `sam deploy` 部署 stack

`template.yaml` 的 `CodeUri` 與 layer `ContentUri` 都已經指向 `dist/`。

## 常用指令

```bash
npm ci
npm run build:ts
npm run build
npm run validate
npm run local:smoke
npm run local:api
```

對應 script：

- `npm run validate`
  - `sam validate --template-file template.yaml`
- `npm run build:ts`
  - `tsc -p tsconfig.json && node script/prepare-dist.cjs`
- `npm run build`
  - `npm run build:ts && sam build --template-file template.yaml`

## 目前安全機制

### CORS

目前 CORS 不再由 API Gateway `Cors` block 處理，而是由 shared runtime 處理：

- `layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/http/cors.ts`
- `createApiGatewayHandler()` 會先跑 `handleOptions(event)`
- shared `createResponse()` 會在 normal success/error response 自動 merge `corsHeaders(event)`

目前規則：

- `development`
  - 如果 `ALLOWED_ORIGINS='*'`，回傳 wildcard CORS
- `production`
  - 讀取 `ALLOWED_ORIGINS` comma-separated allowlist
  - 只反射 exact matched origin

`ALLOWED_ORIGINS` 是 Lambda env var，由 `template.yaml` 的 `AllowedOrigins` parameter 注入。

### JWT authorizer

`RequestAuthorizerFunction` 是 API 預設 authorizer。

目前使用：

- `Authorization: Bearer <jwt>`
- `jsonwebtoken`
- `HS256`

authorizer 會把 claims 放進 API Gateway authorizer context，後續 domain Lambda 可直接讀：

- `userId`
- `userEmail`
- `userRole`
- `ngoId`
- `ngoName`

補充：

- `auth/challenges/verify` 這條 route 是 **optional auth**
- API Gateway 層仍然是 public route（`Authorizer: NONE`）
- 但 Lambda 內會在 verify flow 嘗試解析 `Authorization` header
- 沒有 Bearer token：走 public verify/login/register path
- Bearer token 有效：走 link email / phone path
- Bearer token 存在但無效：直接 `401`

### API key

API 目前要求 `x-api-key`。

目前 route 大致分兩類：

- protected route：需要同時通過
  - `x-api-key`
  - `Authorization: Bearer <jwt>`
- auth public flow route（例如 `/auth/challenges`、`/auth/challenges/verify`、`/auth/registrations/*`、`/auth/login/ngo`、`/auth/tokens/refresh`）：
  - 也需要 `x-api-key`
  - 但不一定需要 Bearer JWT

其中 `POST /auth/challenges/verify` 仍然是 optional auth：

- 有 `x-api-key` 但沒有 Bearer token：走 public verify flow
- 有 `x-api-key` 且 Bearer token 有效：走 link email / phone flow
- Bearer token 存在但無效：直接 `401`

### request body validation

API Gateway request model validation 目前只掛在：

- `POST`
- `PUT`
- `PATCH`

`GET` / `DELETE` 不做 body validation。

## 目前已驗證的 live behavior

development stack 已在 AWS 上實測：

- CORS：正常
- request body validation：正常
- JWT checking：正常
- API key requirement：正常
- VPC-attached Lambda networking：正常
- GitHub Actions OIDC deploy：正常

## Deployment Flow

### development

1. 更新 GitHub Actions secrets（如需要）
   - `DEV_ALLOWED_ORIGINS`
   - 其他 `DEV_*`
2. push 到 `main`
3. GitHub Actions 執行 `deploy-development`
4. workflow 會跑：
   - `npm ci`
   - `npm run build`
   - `sam deploy --config-env default --parameter-overrides ...`
5. CloudFormation 會更新：
   - Lambda code
   - shared layer version
   - Lambda published versions / `development` alias

### production

1. 更新 GitHub Actions secrets（如需要）
   - `PROD_ALLOWED_ORIGINS`
   - 其他 `PROD_*`
2. 手動觸發 workflow dispatch，並設 `deploy_production=true`
3. GitHub Actions 先 deploy `development`
4. 成功後再執行 `deploy-production`
5. workflow 會跑：
   - `npm ci`
   - `npm run build`
   - `sam deploy --config-env production --parameter-overrides ...`
6. CloudFormation 會更新：
   - Lambda code
   - shared layer version
   - Lambda published versions / `production` alias

### alias / layer 行為

這個 repo 現在依賴以下 SAM 行為確保 layer 更新會推進到 alias：

- `SharedRuntimeLayer.Properties.PublishLambdaVersion: true`
- every aliased function:
  - `AutoPublishAlias: !Ref LambdaAliasName`
  - `AutoPublishAliasAllProperties: true`

這樣 shared layer 改動時，function 會 publish 新 version，alias 也會跟著移動，不會停留在舊 layer version。

## 目錄結構

### repo root

```text
.
├── .github/workflows/
├── bootstrap/
├── dev_docs/
├── dist/
├── events/
├── functions/
├── layers/
├── script/
├── types/
├── package.json
├── tsconfig.json
├── template.yaml
└── samconfig.toml
```

### 每個 domain Lambda

目前沿用第一階段 modularization 風格，但 entrypoint 已收斂成 shared handler adapter：

```text
functions/<domain>/
├── index.ts
└── src/
    ├── config/
    ├── locales/
    ├── models/
    ├── router.ts
    ├── services/
    ├── utils/
    └── zodSchema/
```

設計原則：

- `index.ts`
  - Lambda entry
  - `createApiGatewayHandler(routeRequest, { response })`
- `router.ts`
  - route matching
- `utils/response.ts`
  - 每個 domain 的 response singleton
  - 載入 common locale + domain locale
- `services/`
  - orchestration / domain-facing service
- `zodSchema/`
  - request schema

因為現在：

- CORS 交給 shared runtime
- JWT checking 交給 API Gateway authorizer
- body validation 有一層 API Gateway gate

所以 Lambda 內不保留 per-domain JWT verification file。需要的 guard 直接放在 application/service 或 domain helper：

- role guard：用 shared `requireRole(event, roles)`
- `/me` scope：用 shared `requireAuthContext(event)` 從 authorizer context 取 `userId` / `ngoId`
- resource ownership：對 `{petId}`、`{notificationId}` 等 route，讀 DB 後檢查 owner / ngo / role
- domain-level validation：Zod/API Gateway schema 之外的 business rule

## shared layer

`layers/shared-runtime` 提供 `@aws-ddd-api/shared`。目前主要 public API：

- `createApiGatewayHandler(routeRequest, { response })`
- `createRouter(routes, { response })`
- `createResponse({ domainTranslations })`
- `corsHeaders(event)` / `handleOptions(event)`
- `validateEnv(envSchema)`
- `requireAuthContext(event)` / `getAuthContext(event)` / `requireRole(event, roles)`
- `logInfo()` / `logWarn()` / `logError()`
- Mongo-backed rate limit helper: `requireMongoRateLimit()`
- `parseJsonBodyWithSchema()` and Zod issue helpers
- i18n helpers such as `translate()` and `getRequestLocale()`

Response model:

- raw `json`, `successResponse`, and `errorResponse` are not public root exports
- each domain imports its own `src/utils/response.ts` singleton
- handler errors, router 404/405, and app responses use the same singleton

i18n model:

- shared common locales live inside the shared layer
- domain locales live in `functions/<domain>/src/locales/en.json` and `zh.json`
- `createResponse()` merges common + domain locales and caches the merged dictionaries in warm Lambda containers

Rate limit model:

- API Gateway / usage plan still owns broad edge throttling
- shared Mongo rate-limit helpers are for business throttles such as login, challenge resend, upload, or action cooldowns
- domain `db.ts` owns Mongoose connection setup
- shared rate limiter accepts that Mongoose instance and does not create its own DB connection
- rate-limit keys are hashed by default to avoid storing raw email/phone/IP key material
- over-limit errors use `statusCode: 429` and `errorKey: common.rateLimited`

Example:

```ts
import { requireMongoRateLimit } from '@aws-ddd-api/shared';
import mongoose from 'mongoose';

await requireMongoRateLimit({
  action: 'auth.challenge.email',
  event,
  identifier: normalizedEmail,
  limit: 5,
  mongoose,
  windowSeconds: 900,
});
```

## template.yaml

`template.yaml` 現在負責：

- REST API
- global Lambda VPC config
- request model validation
- JWT authorizer
- API key + usage plan
- Lambda roles
- shared runtime layer
- 14 個 domain Lambda
- `pipeline-smoke`

環境採用兩個獨立 stack：

- `aws-ddd-api-development`
- `aws-ddd-api-production`

也就是：

- development 有自己一套 API Gateway
- production 有自己一套 API Gateway

這不是同一個 API Gateway 下開兩個 stage 的模式。

### Lambda VPC networking

目前所有 Lambda 透過 `Globals.Function.VpcConfig` 進入既有 VPC：

- private subnets:
  - `subnet-0e83ebdff39d08623`
  - `subnet-07775337a6470eee2`
- security group:
  - `sg-0fd68782d1963c6a3`

對應 template parameters：

- `LambdaSubnetIds`
- `LambdaSecurityGroupIds`

因為所有 Lambda 都繼承 `VpcConfig`，execution role 必須同時具備：

- `AWSLambdaBasicExecutionRole`
- `AWSLambdaVPCAccessExecutionRole`

## samconfig 與 deploy

development：

```bash
sam deploy --config-env default
```

production：

```bash
sam deploy --config-env production
```

目前 GitHub Actions 會：

- push 到 `main` 自動 deploy `development`
- 手動 `workflow_dispatch` 可選擇 deploy `production`

## GitHub Actions

workflow 在：

- `.github/workflows/deploy.yml`

目前流程：

1. checkout
2. setup SAM
3. setup Node.js 22
4. 使用 GitHub OIDC assume AWS deploy role
5. `npm ci`
6. `sam validate`
7. `npm run build`
8. `sam deploy`

需要的 GitHub secret：

- `AWS_DEPLOY_ROLE_ARN`

## GitHub OIDC deploy role

目前 GitHub Actions 已改為使用 AWS OIDC，不使用 long-lived access key。

deploy role 例子：

- `github-actions-aws-ddd-api-deploy-role`

trust policy 應限制到 repo：

- `repo:LeungYuLap19/AWS_DDD_API:ref:refs/heads/main`

## Local 與 AWS 的差異

有幾點要注意：

- `sam local start-api` 不一定能完整模擬 API Gateway authorizer 行為
- body validation 與 authorizer 的最可信驗證仍然是在 AWS live environment
- 本地 `sam build` 若要安裝依賴，仍取決於本地 npm / network 狀態

所以：

- 本地適合做 handler / route / zod 開發
- 真正驗證 API Gateway policy、authorizer、API key，應以 AWS 為準

## Harness Engineering Workflow

這個 repo 的推薦實作方式不是單次叫 AI 直接改完，而是用 **migration LLM + audition LLM** 的遞迴流程。

核心目標：

- 降低 hallucination
- 降低 context shift
- 讓 migration 不只是結構重寫，而是真正保留 legacy behavior
- 讓測試與安全檢查成為 migration 的固定一部分

### 角色分工

- `migration LLM`
  - 負責把 legacy behavior 從 `AWS_API` 遷移到 `AWS_DDD_API`
  - 參考 `functions/auth` 作為目前最佳 DDD 實作樣板
  - 在功能完成後負責寫 tests

- `audition LLM`
  - 負責 cross-validation
  - 驗證 migration 結果是否偏離 legacy behavior、infra truth、security expectation
  - 專門用來抓 hallucination、漏 branch、漏 side effect、漏 auth/rate-limit/test case

### 推薦遞迴流程

1. 選一個明確的 target Lambda
   - 例如 `auth`
   - 例如 `user`
   - 例如 `pet-medical`
2. 交給 `migration LLM` 實作
3. 交給 `audition LLM` 做 audit
4. 把 findings 丟回 `migration LLM` 修正
5. 持續重複，直到沒有 major findings
6. 再讓 `migration LLM` 補 tests
7. 再讓 `audition LLM` 專門 audit tests 與 coverage
8. 持續修正直到 build / validate / tests 都穩定

### 為什麼這樣做

這個流程延續了 `AWS_API` 第一階段 modularization 時有效的做法，但在 `AWS_DDD_API` 需要更嚴格。

因為這裡不只是 pattern refactor，而是同時對齊四種 truth：

- DDD structure truth
  - 以 `functions/auth` 為主要 live reference
- domain and route truth
  - 以 `dev_docs/developers/DDD_API_REWRITE_PLAN_ZH_TW.md` 為主
- infra truth
  - 以 `template.yaml` 為主
- legacy behavior truth
  - 以 `AWS_API` codebase 與 `AWS_API/dev_docs/REFACTORED_LAMBDA_ENDPOINT_STATUS.md` 為主

如果只做結構模仿，很容易得到看起來乾淨，但 behavior 漏失的 Lambda。

### Migration LLM 讀檔順序

先讀：

1. `dev_docs/llms/migration/ROLE.md`
2. `dev_docs/llms/LLM_PROJECT_CONTEXT.md`
3. `dev_docs/llms/DDD_IMPLEMENTATION_CHECKLIST.md`
4. `dev_docs/llms/DDD_MIGRATION_HARNESS.md`
5. `dev_docs/llms/DDD_TESTING_STANDARD.md`
6. `dev_docs/developers/DDD_API_REWRITE_PLAN_ZH_TW.md`
7. `template.yaml`
8. `AWS_API/dev_docs/REFACTORED_LAMBDA_ENDPOINT_STATUS.md`

再讀：

- 對應的 legacy source files
- 對應的 target Lambda files

### Audition LLM 讀檔順序

先讀：

1. `dev_docs/llms/audition/ROLE.md`
2. `dev_docs/llms/LLM_PROJECT_CONTEXT.md`
3. `dev_docs/llms/DDD_IMPLEMENTATION_CHECKLIST.md`
4. `dev_docs/llms/DDD_MIGRATION_HARNESS.md`
5. `dev_docs/llms/DDD_TESTING_STANDARD.md`
6. `dev_docs/developers/DDD_API_REWRITE_PLAN_ZH_TW.md`
7. `template.yaml`
8. `AWS_API/dev_docs/REFACTORED_LAMBDA_ENDPOINT_STATUS.md`
9. migration LLM 的改動與驗證輸出

再讀：

- 對應的 legacy source files

### Tests 的位置

tests 不應該在一開始 Lambda migration 還不穩時就先大量生成。

推薦順序：

1. 先把整個 target Lambda 的行為穩定
2. 再補 tests
3. 再 audit tests
4. 再修正直到通過

tests 最少要覆蓋：

- happy paths
- sad paths
- cyberattack / abuse cases

### 實務原則

- 一次只做一個 target Lambda，不要同一輪同時改多個 Lambda
- 不要讓 LLM 盲讀整個 repo 再自己決定範圍
- 每一輪都應該明確指定這個 Lambda 對應的 legacy source files 與 target files
- route 與 service 是 Lambda 內部要完成的內容，不是 migration 的主邊界
- compile success 不等於 migration 完成
- 需要以 audition LLM 的 review 結果確認是否真的保留了 legacy behavior

## 後續實作建議

接下來的正常方向是：

1. 逐個 domain 把 proxy scaffold 換成真實 route map
2. 每個 route 在 `zodSchema/` 補正式 schema
3. `services/` 承接 orchestration 與主要 business flow
4. 真實 route 需要時在 service 做 role、ownership、domain rule checks

## 補充文件

詳細的 domain 規劃、endpoint graph、legacy mapping，請看：

- `dev_docs/developers/DDD_API_REWRITE_PLAN_ZH_TW.md`

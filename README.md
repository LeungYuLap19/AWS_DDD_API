# AWS DDD API

這個 repo 是新的 DDD serverless API 基礎骨架。

目前已經落地的重點：

- AWS SAM 管理整個 API Gateway + Lambda + Layer + IAM
- TypeScript source，編譯後從 `dist/` 部署
- 14 個 domain Lambda 骨架
- API Gateway CORS
- API Gateway request body validation
- Lambda JWT authorizer
- API key requirement
- GitHub Actions 透過 OIDC 自動 deploy `development`

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
- `layers/shared-runtime/**/index.ts`

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

`template.yaml` 已配置 CORS，目前只先允許：

- `http://localhost:3000`

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

### API key

API 目前要求 `x-api-key`。

也就是 protected route 需要同時通過：

- `x-api-key`
- `Authorization: Bearer <jwt>`

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
- GitHub Actions OIDC deploy：正常

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

目前沿用第一階段 modularization 風格，並額外加入 `applications/`：

```text
functions/<domain>/
├── index.ts
└── src/
    ├── applications/
    ├── config/
    ├── handler.ts
    ├── middleware/
    ├── models/
    ├── router.ts
    ├── services/
    ├── utils/
    └── zodSchema/
```

設計原則：

- `router.ts`
  - route matching
- `applications/`
  - use case function
- `services/`
  - orchestration / domain-facing service
- `zodSchema/`
  - request schema
- `middleware/`
  - optional thin guard layer

因為現在：

- CORS 交給 API Gateway
- JWT checking 交給 API Gateway authorizer
- body validation 有一層 API Gateway gate

所以 Lambda 內 middleware 會比舊 repo 薄很多，主要保留：

- route guard
- ownership / self-access
- domain-level validation

## shared layer

`layers/shared-runtime` 會提供：

- `@aws-ddd-api/shared`

目前骨架已經可被 Lambda 正常 import。

## template.yaml

`template.yaml` 現在負責：

- REST API
- CORS
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

## 後續實作建議

接下來的正常方向是：

1. 逐個 domain 把 proxy scaffold 換成真實 route map
2. 每個 route 在 `zodSchema/` 補正式 schema
3. `applications/` 開始承接 use case
4. `services/` 承接 orchestration
5. 再逐步把共用 helper 抽到 shared layer

## 補充文件

詳細的 domain 規劃、endpoint graph、legacy mapping，請看：

- `dev_docs/DDD_API_REWRITE_PLAN_ZH_TW.md`

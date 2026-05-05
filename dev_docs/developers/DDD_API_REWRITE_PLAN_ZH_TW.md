# AWS DDD API 重構藍圖（繁中）

Audience:

- primary: developers
- secondary: LLMs that need target route and domain context

## 1. 文件目的

本文件根據以下兩份來源整理：

- `AWS_DDD_API/dev_docs/developers/structure.txt`
- `AWS_API/dev_docs/REFACTORED_LAMBDA_ENDPOINT_STATUS.md`

目的不是單純把舊 API 重新命名，而是定義一套可落地的 **DDD + Lambda Domain Routing + SAM + GitHub Actions CI/CD** 重構方式，讓後續開發不再依賴：

- 手動上傳 zip
- 直接在 AWS Console 修改 Lambda
- 繼續沿用舊 API Gateway 的混亂資源結構

本文件會定義：

- 新 API 的 domain 邊界
- 每個 domain Lambda 應承接哪些 legacy endpoint
- 新 endpoint graph
- 每個 Lambda 內部的建議資料夾結構
- `template.yaml` / `sam build` / `sam deploy` / GitHub Actions 的落地方式

---

## 2. 重構總原則

### 2.1 架構原則

本次重構採用：

- **單 repo**
- **多 domain lambda**
- **DDD module boundary**
- **SAM 為唯一部署基礎設施來源**
- **GitHub Actions 做 CI/CD**

不是：

- 傳統多 repo microservices
- 手動 zip upload
- 以舊 API contract 當作新 API 設計來源

### 2.2 設計原則

1. **新 API 以 domain 為主，不以 legacy path 為主**
2. **同一 business action 合併，不保留 transport-driven endpoint**
3. **同一 aggregate 的欄位更新合併，不再分 basic/detail**
4. **真正獨立 lifecycle 的資料，保留成子資源**
5. **舊 API 繼續存在，新 API 逐步接手**
6. **所有部署經由 SAM build/deploy + CI/CD，停止手動上傳 zip**

---

## 3. Domain Lambda 規劃

建議 top-level domain：

- `/auth`
- `/user`
- `/ngo`
- `/pet`
  - `/profile`
  - `/source`
  - `/transfer`
  - `/adoption`
  - `/medical`
  - `/analysis`
  - `/recovery`
  - `/biometric`
- `/notifications`
- `/commerce`
- `/logistics`

這裡的重點是：

- **domain 保持精簡**
- **lambda 以 domain 或 subdomain 為單位**
- **不是一個 Lambda 包整個系統**
- **也不是為了 Lambda 而切成過多 top-level domain**

---

## 4. 新 API Graph

以下 graph 以 `structure.txt` 為基礎，並保留目前已討論完成的方向。

```text
/auth - manual deployment tested 
  /challenges
    POST
    /verify
      POST
  /registrations
    /user
      POST
    /ngo
      POST
  /login
    /ngo
      POST
  /tokens
    /refresh
      POST

/user - manual deployment tested 
  /me
    GET
    PATCH
    DELETE

/ngo - manual deployment tested 
  /me
    GET
    PATCH
    DELETE-?
    /members
      GET

/pet
  /profile - manual deployment tested 
    POST
    /{petId}
      GET
      PATCH
      DELETE
    /me
      GET
    /by-tag
      /{tagId}
        GET

  /source - manual deployment tested 
    /{petId}
      GET
      POST
      PATCH

  /transfer - manual deployment tested
    /{petId}
      POST
      /{transferId}
        PATCH
        DELETE
      /ngo-reassignment
        POST

  /adoption - manual deployment tested 
    GET
    /{adoptionId}
      GET
    /{petId}
      GET
      POST
      PATCH
      DELETE

  /medical - manual deployment tested 
    /reference
      /deworm
        GET
    /{petId}
      /general
        GET
        POST
        /{medicalId}
          PATCH
          DELETE
      /medication
        GET
        POST
        /{medicationId}
          PATCH
          DELETE
      /deworming
        GET
        POST
        /{dewormId}
          PATCH
          DELETE
      /blood-test
        GET
        POST
        /{bloodTestId}
          PATCH
          DELETE
      /vaccination
        GET
        POST
        /{vaccineId}
          PATCH
          DELETE

  /analysis - manual deployment tested
    /eye
      /{petId}
        GET
        POST
        PATCH
      /{eyeDiseaseName}
        GET
    /breed - fully functional
      POST
    /uploads
      /image
        POST
      /breed-image - fully functional
        POST

  /recovery - manual deployment tested 
    /lost
      GET
      POST
      /{petLostID}
        DELETE
    /found
      GET
      POST
      /{petFoundID}
        DELETE

  /biometric - not required 
    /{petId}
      GET
    /registrations
      POST
    /verifications
      POST

/notifications
  /me
    GET
    /{notificationId}
      PATCH
  /dispatch
    POST

/commerce (need further optimization)
  /catalog
    GET
    /events
      POST
  /storefront
    GET
  /orders
    GET
    POST
    /{tempId}
      GET
    /operations
      GET-?
  /fulfillment
    GET
    /{orderVerificationId}
      DELETE
    /tags
      /{tagId}
        GET
        PATCH
    /suppliers
      /{orderId}
        GET
        PATCH
    /share-links
      /whatsapp
        /{_id}
          GET
  /commands
    /ptag-detection-email
      POST

/logistics
  /lookups
    /areas
      POST
    /net-codes
      POST
    /pickup-locations
      POST
  /token
    POST
  /shipments
    POST
  /cloud-waybill
    POST
```

備註：

- `DELETE-?` / `GET-?` 代表目前尚未完全確定是否保留。
- `/pet/adoption` 同時保留 public adoption browse 與 pet-owned adoption record，因為你決定以 domain lambda 管理方便為優先。
- `/pet/profile/me` 之後建議由 JWT claim 或 query scope 決定取 user pet list 或 NGO pet list。

---

## 5. DDD 落地方式

### 5.1 一個 domain lambda 不等於一個大檔案

每個 Lambda 應該是：

- 一個 domain / subdomain 的 transport entrypoint
- 但內部拆成 application / domain / infrastructure / contracts

例如：

- `functions/auth`
- `functions/pet-profile`
- `functions/pet-medical`
- `functions/commerce`
- `functions/logistics`

### 5.2 每個 Lambda 的建議資料夾結構

這裡不另外發明新架構，而是**沿用第一階段 modularization 的結構**，基準就是 `AWS_API/dev_docs/REFACTOR_CHECKLIST.md`。

也就是：

- `index.ts`
- `src/router.ts`
- `src/config`
- `src/services`
- `src/models`
- `src/utils`
- `src/zodSchema`
- `src/locales`

```text
functions/
  pet-profile/
    index.ts
    package.json
    src/
      router.ts
      config/
        db.ts
        env.ts
      services/
        profile.ts
      models/
        Pet.ts
      utils/
        response.ts
        logger.ts
        sanitize.ts
        validators.ts
        zod.ts
      zodSchema/
        petProfileSchema.ts
      locales/
        en.json
        zh.json
```

### 5.3 分層責任

- `index.ts`
  - Lambda entry
  - `createApiGatewayHandler(routeRequest, { response })`
  - shared handler adapter 會 parse body、attach `awsRequestId`、catch unexpected error

- `router.ts`
  - `${httpMethod} ${resource}` 對應 use case
  - `createRouter(routes, { response })`
  - router 404/405 使用同一個 domain response singleton

- `utils/`
  - response singleton、sanitize、validators、domain helpers

- domain guard / ownership
  - 不做 JWT verify；JWT 已由 API Gateway Lambda authorizer 處理
  - `/me` endpoint 從 authorizer context 取得 `userId` / `ngoId`
  - `{petId}` 等 resource route 在 application/service 讀 DB 後做 ownership / role check

- `services/`
  - route-facing orchestration
  - 控制 request -> service flow
  - 目前不強制新增 `applications/`
  - 當 flow 真的複雜到 service 過厚時，再視需要拆出額外模組

- `models/`
  - Mongoose schema definition

- `zodSchema/`
  - request validation schema

- `utils/`
  - `response.ts` 載入 domain locale 並建立 `createResponse({ domainTranslations })`
  - logger, sanitize, validators, zod helper

### 5.5 Auth verify optional JWT

`POST /auth/challenges/verify` 目前是特殊 case：

- API Gateway route 維持 public（`Authorizer: NONE`）
- Lambda 內部會嘗試讀取 `Authorization: Bearer <jwt>`
- 沒有 token：
  - 走 public verify flow
  - new user -> `isNewUser: true`
  - existing user -> issue token + refresh cookie
- token 有效：
  - 走 link email / phone flow
- token 存在但無效：
  - 直接 `401`

補充：

- 目前 runtime contract 已加入 API Gateway `x-api-key` requirement
- `/auth/challenges/verify` 雖然維持 `Authorizer: NONE`，但 non-OPTIONS request 仍然需要 `x-api-key`
- 最新 request / response contract、sanitization、`warnings` payload 等以 `dev_docs/api_docs/development/*.md` 為準

這樣做是因為 verify route 同時需要：

- public verification / login / registration proof
- already logged-in linking flow

而 REST API 單一路由不適合直接用 API Gateway authorizer 表達 optional auth。

### 5.4 Shared response / i18n mental model

- shared layer 內有 common locales
- 每個 domain Lambda 有自己的 `src/locales/en.json`、`src/locales/zh.json`
- 每個 domain 只建立一個 `src/utils/response.ts` singleton
- `index.ts`、`router.ts`、application/service 都使用同一個 response singleton
- raw `json`、`successResponse`、`errorResponse` 不作為 public shared API；只透過 `createResponse()` 取得
- `/me` endpoint 不做 self-access path check，直接由 authorizer context 的 `userId` / `ngoId` scope data
- `{petId}`、`{notificationId}` 等 resource route 要在讀 DB 後做 ownership / role / state check

### 5.5 Shared Mongo rate limit model

- API Gateway usage plan 負責 broad edge throttling
- shared Mongo rate limiter 負責 business throttle，例如 login、challenge resend、upload、sensitive action cooldown
- 每個 domain Lambda 的 `db.ts` 負責 Mongoose connection
- shared helper 接收 domain 傳入的 Mongoose instance，不自己建立 DB connection
- key 預設 hash，避免 raw email / phone / IP key material 存入 Mongo
- 超限時會用 `statusCode = 429`，`errorKey = common.rateLimited`

建議用法：

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

---

## 6. SAM / template.yaml / build / deploy / CI/CD

### 6.1 原則

新 repo 應以 `template.yaml` 作為唯一基礎設施描述來源：

- Lambda function
- API Gateway route
- default authorizer
- CORS
- IAM role
- shared layer
- alias
- env / secrets wiring

不再做：

- 手動 zip upload
- 手動在 AWS Console 新增 route
- 手動在 Console 綁 API Gateway method

### 6.2 目前 repo 已有的 base framework

`AWS_DDD_API/template.yaml` 已經有：

- `AWS::Serverless::Api`
- default Lambda authorizer
- shared runtime layer
- shared function role / authorizer role
- public route sample
- protected route sample
- request model validation sample
- `AutoPublishAlias`
- outputs

這代表：

- 基礎骨架已經有
- 後續只要把 framework sample 換成真實 domain lambda

### 6.3 建議的 SAM 實作方式

後續每個 domain lambda 都應在 `template.yaml` 內增加：

- `CodeUri`
- `Handler`
- `Role`
- `Layers`
- `AutoPublishAlias`
- `Events`

例如：

```yaml
PetProfileFunction:
  Type: AWS::Serverless::Function
  Properties:
    FunctionName: !Sub '${ProjectName}-${StageName}-pet-profile'
    CodeUri: dist/functions/pet-profile/
    Handler: index.handler
    Role: !GetAtt SharedFunctionRole.Arn
    Layers:
      - !Ref SharedRuntimeLayer
    AutoPublishAlias: !Ref LambdaAliasName
    Events:
      PetProfileCreate:
        Type: Api
        Properties:
          RestApiId: !Ref RestApi
          Path: /pet/profile
          Method: POST
      PetProfileGet:
        Type: Api
        Properties:
          RestApiId: !Ref RestApi
          Path: /pet/profile/{petId}
          Method: GET
      PetProfilePatch:
        Type: Api
        Properties:
          RestApiId: !Ref RestApi
          Path: /pet/profile/{petId}
          Method: PATCH
      PetProfileDelete:
        Type: Api
        Properties:
          RestApiId: !Ref RestApi
          Path: /pet/profile/{petId}
          Method: DELETE
```

### 6.4 build / deploy 流程

本 repo 應使用：

```bash
sam validate --lint --template-file template.yaml
sam build --template-file template.yaml
sam deploy
```

以及 production：

```bash
sam deploy --config-env production
```

目前 `samconfig.toml` 已整理為：

- `default` -> `development`
- `production` -> `production`

也就是：

- `sam deploy` = deploy 到 `development`
- `sam deploy --config-env production` = deploy 到 `production`

### 6.5 Stage 與 Alias

目前設定方向：

- Stage:
  - `development`
  - `production`

- Alias:
  - `development`
  - `production`

這樣 API URL 會是：

- `.../development/...`
- `.../production/...`

這個方向是正確的，應保留。

### 6.6 GitHub Actions CI/CD

目標流程應該是：

1. push 到 main
2. `sam validate --lint`
3. `sam build`
4. deploy 到 `development`
5. 跑 smoke test / integration test
6. 若通過，再 deploy 到 `production`
7. 跑 production smoke test

### 6.7 `pipeline-smoke` 的角色

`pipeline-smoke` 不是 business lambda。

它的用途是：

- 驗證 GitHub Actions deploy 有沒有成功
- 驗證 API Gateway stage 有沒有正常
- 驗證 Lambda alias / API route / IAM / layer 有沒有正常

也就是：

- 如果 smoke fail，代表 infra / deploy pipeline 有問題
- 如果 smoke pass 但 domain lambda fail，才是 business code 問題

### 6.8 目前 workflow 與目標狀態的差異

目前 `.github/workflows/deploy.yml` 仍然有舊問題：

- 還在 deploy `aws-ddd-api-dev`
- 還在用 `StageName=dev`
- 尚未分成 `development -> integration test -> production`

所以重構時應同步把 workflow 改成：

- `sam deploy` to `development`
- call `/development/pipeline/smoke`
- run integration tests
- `sam deploy --config-env production`
- call `/production/pipeline/smoke`

### 6.9 結論

未來部署方式應固定為：

- 本地：`sam validate` / `sam build` / `sam deploy`
- CI/CD：GitHub Actions + OIDC role + SAM deploy
- 不再手動 upload zip

---

## 7. Domain 對照表

以下表格使用：

- 新 endpoint
- 對應 legacy endpoint
- 原 Lambda
- 實際功能

### 7.1 Auth

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `POST /auth/challenges` | `POST /account/generate-email-code`、`POST /account/generate-sms-code` | `EmailVerification`、`UserRoutes` | 建立 email / SMS 驗證 challenge。 |
| `POST /auth/challenges/verify` | `POST /account/verify-email-code`、`POST /account/verify-sms-code` | `EmailVerification`、`UserRoutes` | 驗證 email / SMS code，產生登入或註冊前置 proof。 |
| `POST /auth/login/ngo` | 無直接沿用的 DDD route；補回 NGO password login 能力，承接 legacy NGO credential login intent | `UserRoutes` | 以 email + password 登入既有 NGO 帳號，檢查 active NgoUserAccess 與 NGO approval 後發出 NGO token。 |
| `POST /auth/registrations/user` | `POST /account/register` | `UserRoutes` | 建立一般使用者帳號。 |
| `POST /auth/registrations/ngo` | `POST /v2/account/register-ngo` | `UserRoutes` | 建立 NGO admin、NGO profile、access mapping、counter。 |
| `POST /auth/tokens/refresh` | `POST /auth/refresh` | `AuthRoute` | 以 refresh token 換 access token。 |

註：

- 本章節主要描述 legacy 對應與功能拆分
- 最新 deployed contract（例如 `x-api-key` requirement、sanitized response、NGO `warnings` response）請以 `dev_docs/api_docs/development/AUTH.md`、`USER.md`、`NGO.md` 為準

### 7.2 User

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /user/me` | `GET /account/{userId}` | `UserRoutes` | 取得當前登入使用者資料。 |
| `PATCH /user/me` | `PUT /account`、`POST /account/update-image` | `UserRoutes` | 更新使用者個人資料與頭像。 |
| `DELETE /user/me` | `DELETE /account/{userId}`、`POST /account/delete-user-with-email` | `UserRoutes` | 軟刪除帳號並撤銷 refresh token。 |

### 7.3 NGO

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /ngo/me` | `GET /v2/account/edit-ngo/{ngoId}`、`GET /v2/account/edit-ngo/{ngoId}/pet-placement-options` | `UserRoutes` | 取得 NGO profile、admin profile、access 設定、counter 等整體資料，並包含 pet placement options。 |
| `PATCH /ngo/me` | `PUT /v2/account/edit-ngo/{ngoId}` | `UserRoutes` | 更新 NGO profile、admin user、counter、access 設定。 |
| `GET /ngo/me/members` | `GET /v2/account/user-list` | `UserRoutes` | 取得 NGO 成員列表，含 joined user/ngo/counter 資料。 |

### 7.4 Pet Profile

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `POST /pet/profile` | `POST /pets/create-pet-basic-info`、`POST /pets/create-pet-basic-info-with-image` | `CreatePetBasicInfo`、`EyeUpload` | 建立 pet profile，支援 JSON 與 multipart 兩種 legacy create flow。 |
| `GET /pet/profile/{petId}` | `GET /pets/{petID}/basic-info`、`GET /pets/{petID}/detail-info` | `PetBasicInfo`、`PetDetailInfo` | 取得單一 pet 的基本與延伸 profile。 |
| `PATCH /pet/profile/{petId}` | `PUT /pets/{petID}/basic-info`、`POST /pets/{petID}/detail-info`、`POST /pets/updatePetImage` | `PetBasicInfo`、`PetDetailInfo`、`EyeUpload` | 更新 pet profile，合併 basic/detail/image update。 |
| `DELETE /pet/profile/{petId}` | `DELETE /pets/{petID}`、`POST /pets/deletePet` | `PetBasicInfo`、`GetAllPets` | 軟刪除 pet。 |
| `GET /pet/profile/me` | `GET /pets/pet-list/{userId}`、`GET /pets/pet-list-ngo/{ngoId}` | `GetAllPets` | 依 JWT context 取得 user 或 NGO pet list。 |
| `GET /pet/profile/by-tag/{tagId}` | `GET /pets/getPetInfobyTagId/{tagId}` | `PetInfoByPetNumber` | 以 tagId 做 public-safe pet lookup。 |

### 7.5 Pet Source

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /pet/source/{petId}` | `GET /v2/pets/{petID}/detail-info/source` | `PetDetailInfo` | 取得 pet source/origin record。 |
| `POST /pet/source/{petId}` | `POST /v2/pets/{petID}/detail-info/source` | `PetDetailInfo` | 建立 pet source/origin record。 |
| `PATCH /pet/source/{petId}` | `PUT /v2/pets/{petID}/detail-info/source/{sourceId}` | `PetDetailInfo` | 更新 pet source/origin record。 |

### 7.6 Pet Transfer

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `POST /pet/transfer/{petId}` | `POST /pets/{petID}/detail-info/transfer` | `PetDetailInfo` | 新增 transfer history record。 |
| `PATCH /pet/transfer/{petId}/{transferId}` | `PUT /pets/{petID}/detail-info/transfer/{transferId}` | `PetDetailInfo` | 更新 transfer history record。 |
| `DELETE /pet/transfer/{petId}/{transferId}` | `DELETE /pets/{petID}/detail-info/transfer/{transferId}` | `PetDetailInfo` | 刪除 transfer history record。 |
| `POST /pet/transfer/{petId}/ngo-reassignment` | `PUT /pets/{petID}/detail-info/NGOtransfer` | `PetDetailInfo` | NGO pet ownership reassignment。 |

### 7.7 Pet Adoption

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /pet/adoption` | `GET /adoption` | `GetAdoption` | public adoption list / browse feed。 |
| `GET /pet/adoption/{adoptionId}` | `GET /adoption/{id}` | `GetAdoption` | public adoption detail。 |
| `GET /pet/adoption/{petId}` | `GET /v2/pets/{petID}/pet-adoption` | `PetDetailInfo` | 取得 pet-owned adoption record。 |
| `POST /pet/adoption/{petId}` | `POST /v2/pets/{petID}/pet-adoption` | `PetDetailInfo` | 建立 pet-owned adoption record。 |
| `PATCH /pet/adoption/{petId}` | `PUT /v2/pets/{petID}/pet-adoption/{adoptionId}` | `PetDetailInfo` | 更新 pet-owned adoption record。 |
| `DELETE /pet/adoption/{petId}` | `DELETE /v2/pets/{petID}/pet-adoption/{adoptionId}` | `PetDetailInfo` | 刪除 pet-owned adoption record。 |

### 7.8 Pet Medical

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /pet/medical/reference/deworm` | `GET /deworm` | `GetBreed` | deworming reference content。 |
| `GET /pet/medical/{petId}/general` | `GET /pets/{petID}/medical-record` | `PetMedicalRecord` | 取得 general medical records。 |
| `POST /pet/medical/{petId}/general` | `POST /pets/{petID}/medical-record` | `PetMedicalRecord` | 建立 general medical record。 |
| `PATCH /pet/medical/{petId}/general/{medicalId}` | `PUT /pets/{petID}/medical-record/{medicalID}` | `PetMedicalRecord` | 更新 general medical record。 |
| `DELETE /pet/medical/{petId}/general/{medicalId}` | `DELETE /pets/{petID}/medical-record/{medicalID}` | `PetMedicalRecord` | 刪除 general medical record。 |
| `GET /pet/medical/{petId}/medication` | `GET /pets/{petID}/medication-record` | `PetMedicalRecord` | 取得 medication records。 |
| `POST /pet/medical/{petId}/medication` | `POST /pets/{petID}/medication-record` | `PetMedicalRecord` | 建立 medication record。 |
| `PATCH /pet/medical/{petId}/medication/{medicationId}` | `PUT /pets/{petID}/medication-record/{medicationID}` | `PetMedicalRecord` | 更新 medication record。 |
| `DELETE /pet/medical/{petId}/medication/{medicationId}` | `DELETE /pets/{petID}/medication-record/{medicationID}` | `PetMedicalRecord` | 刪除 medication record。 |
| `GET /pet/medical/{petId}/deworming` | `GET /pets/{petID}/deworm-record` | `PetMedicalRecord` | 取得 deworming records。 |
| `POST /pet/medical/{petId}/deworming` | `POST /pets/{petID}/deworm-record` | `PetMedicalRecord` | 建立 deworming record。 |
| `PATCH /pet/medical/{petId}/deworming/{dewormId}` | `PUT /pets/{petID}/deworm-record/{dewormID}` | `PetMedicalRecord` | 更新 deworming record。 |
| `DELETE /pet/medical/{petId}/deworming/{dewormId}` | `DELETE /pets/{petID}/deworm-record/{dewormID}` | `PetMedicalRecord` | 刪除 deworming record。 |
| `GET /pet/medical/{petId}/blood-test` | `GET /v2/pets/{petID}/blood-test-record` | `PetMedicalRecord` | 取得 blood-test records。 |
| `POST /pet/medical/{petId}/blood-test` | `POST /v2/pets/{petID}/blood-test-record` | `PetMedicalRecord` | 建立 blood-test record。 |
| `PATCH /pet/medical/{petId}/blood-test/{bloodTestId}` | `PUT /v2/pets/{petID}/blood-test-record/{bloodTestID}` | `PetMedicalRecord` | 更新 blood-test record。 |
| `DELETE /pet/medical/{petId}/blood-test/{bloodTestId}` | `DELETE /v2/pets/{petID}/blood-test-record/{bloodTestID}` | `PetMedicalRecord` | 刪除 blood-test record。 |
| `GET /pet/medical/{petId}/vaccination` | `GET /pets/{petID}/vaccine-record` | `PetVaccineRecords` | 取得 vaccination records。 |
| `POST /pet/medical/{petId}/vaccination` | `POST /pets/{petID}/vaccine-record` | `PetVaccineRecords` | 建立 vaccination record。 |
| `PATCH /pet/medical/{petId}/vaccination/{vaccineId}` | `PUT /pets/{petID}/vaccine-record/{vaccineID}` | `PetVaccineRecords` | 更新 vaccination record。 |
| `DELETE /pet/medical/{petId}/vaccination/{vaccineId}` | `DELETE /pets/{petID}/vaccine-record/{vaccineID}` | `PetVaccineRecords` | 刪除 vaccination record。 |

### 7.9 Pet Analysis

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /pet/analysis/eye/{petId}` | `GET /pets/{petID}/eyeLog` | `PetBasicInfo` | 取得 eye log / eye history。 |
| `POST /pet/analysis/eye/{petId}` | `POST /analysis/eye-upload/{petId}` | `EyeUpload` | 執行 eye analysis。 |
| `PATCH /pet/analysis/eye/{petId}` | `PUT /pets/updatePetEye` | `GetAllPets` | 更新/追加 eye capture history。 |
| `GET /pet/analysis/eye/{eyeDiseaseName}` | `GET /analysis/{eyeDiseaseName}` | `GetBreed` | 取得 eye disease reference content。 |
| `POST /pet/analysis/breed` | `POST /analysis/breed` | `EyeUpload` | 執行 breed analysis。 |
| `POST /pet/analysis/uploads/image` | `POST /util/uploadImage` | `EyeUpload` | generic image upload helper。 |
| `POST /pet/analysis/uploads/breed-image` | `POST /util/uploadPetBreedImage` | `EyeUpload` | breed image upload helper。 |

### 7.10 Pet Recovery

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /pet/recovery/lost` | `GET /v2/pets/pet-lost` | `PetLostandFound` | lost pet report list。 |
| `POST /pet/recovery/lost` | `POST /v2/pets/pet-lost` | `PetLostandFound` | 建立 lost pet report。 |
| `DELETE /pet/recovery/lost/{petLostID}` | `DELETE /v2/pets/pet-lost/{petLostID}` | `PetLostandFound` | 刪除 lost pet report。 |
| `GET /pet/recovery/found` | `GET /v2/pets/pet-found` | `PetLostandFound` | found pet report list。 |
| `POST /pet/recovery/found` | `POST /v2/pets/pet-found` | `PetLostandFound` | 建立 found pet report。 |
| `DELETE /pet/recovery/found/{petFoundID}` | `DELETE /v2/pets/pet-found/{petFoundID}` | `PetLostandFound` | 刪除 found pet report。 |

### 7.11 Pet Biometric

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /pet/biometric/{petId}` | `GET /petBiometrics/{petId}` | `PetBiometricRoutes` | 取得 pet biometric reference assets。 |
| `POST /pet/biometric/registrations` | `POST /petBiometrics/register` | `PetBiometricRoutes` | 註冊或刷新 biometric reference set。 |
| `POST /pet/biometric/verifications` | `POST /petBiometrics/verifyPet` | `PetBiometricRoutes` | 驗證 biometric match。 |

### 7.12 Notifications

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /notifications/me` | `GET /v2/account/{userId}/notifications` | `PetLostandFound` | 取得目前使用者 inbox。 |
| `PATCH /notifications/me/{notificationId}` | `PUT /v2/account/{userId}/notifications/{notificationId}` | `PetLostandFound` | archive notification。 |
| `POST /notifications/dispatch` | `POST /v2/account/{userId}/notifications` | `PetLostandFound` | system dispatch notification，目標 userId 放 body。 |

### 7.13 Commerce

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `GET /commerce/catalog` | `GET /product/productList` | `GetBreed` | product catalog / reference list。 |
| `POST /commerce/catalog/events` | `POST /product/productLog` | `GetBreed` | product access/view event logging。 |
| `GET /commerce/storefront` | `GET /purchase/shop-info` | `purchaseConfirmation` | checkout/storefront metadata。 |
| `GET /commerce/orders` | `GET /purchase/orders` | `purchaseConfirmation` | order list。 |
| `POST /commerce/orders` | `POST /purchase/confirmation` | `purchaseConfirmation` | 建立 order + order verification + tag data。 |
| `GET /commerce/orders/{tempId}` | `GET /v2/orderVerification/ordersInfo/{tempId}` | `OrderVerification` | 取得 linked order info / pet contact summary。 |
| `GET /commerce/orders/operations` | `GET /v2/orderVerification/getAllOrders` | `OrderVerification` | admin/developer operations order list。 |
| `GET /commerce/fulfillment` | `GET /purchase/order-verification` | `purchaseConfirmation` | fulfillment / order-verification 管理列表。 |
| `DELETE /commerce/fulfillment/{orderVerificationId}` | `DELETE /purchase/order-verification/{orderVerificationId}` | `purchaseConfirmation` | 取消 order verification。 |
| `GET /commerce/fulfillment/tags/{tagId}` | `GET /v2/orderVerification/{tagId}` | `OrderVerification` | 以 tagId 取得 fulfillment / verification 資料。 |
| `PATCH /commerce/fulfillment/tags/{tagId}` | `PUT /v2/orderVerification/{tagId}` | `OrderVerification` | 更新 tag-bound verification 資料。 |
| `GET /commerce/fulfillment/suppliers/{orderId}` | `GET /v2/orderVerification/supplier/{orderId}` | `OrderVerification` | supplier 取得 order verification view。 |
| `PATCH /commerce/fulfillment/suppliers/{orderId}` | `PUT /v2/orderVerification/supplier/{orderId}` | `OrderVerification` | supplier 更新 verification fields。 |
| `GET /commerce/fulfillment/share-links/whatsapp/{_id}` | `GET /v2/orderVerification/whatsapp-order-link/{_id}` | `OrderVerification` | WhatsApp deep-link 資料。 |
| `POST /commerce/commands/ptag-detection-email` | `POST /purchase/send-ptag-detection-email` | `purchaseConfirmation` | 發送 PTag detection email command。 |

### 7.14 Logistics

| 新 Endpoint | Legacy Endpoint | Legacy Lambda | 功能 |
| --- | --- | --- | --- |
| `POST /logistics/lookups/areas` | `POST /sf-express-routes/get-area` | `SFExpressRoutes` | SF area lookup。 |
| `POST /logistics/lookups/net-codes` | `POST /sf-express-routes/get-netCode` | `SFExpressRoutes` | SF net code lookup。 |
| `POST /logistics/lookups/pickup-locations` | `POST /sf-express-routes/get-pickup-locations` | `SFExpressRoutes` | SF pickup location lookup。 |
| `POST /logistics/token` | `POST /sf-express-routes/get-token` | `SFExpressRoutes` | 取得 SF address/token。 |
| `POST /logistics/shipments` | `POST /sf-express-routes/create-order` | `SFExpressRoutes` | 建立 SF shipment。 |
| `POST /logistics/cloud-waybill` | `POST /v2/sf-express-routes/print-cloud-waybill` | `SFExpressRoutes` | 產生或寄送 cloud waybill。 |

---

## 8. 建議的實作順序

1. 先固定 `template.yaml` 與 `samconfig.toml`
2. 修正 GitHub Actions，使其符合 `development -> integration test -> production`
3. 以 domain lambda 逐步替換 framework sample
4. 先做 `/auth`、`/user`、`/ngo`
5. 再做 `/pet/profile`、`/pet/source`、`/pet/transfer`
6. 再做 `/pet/adoption`、`/pet/medical`、`/pet/analysis`
7. 最後做 `/notifications`、`/commerce`、`/logistics`

---

## 9. 最後結論

這次 DDD 重構的核心不是：

- 把舊 endpoint 換名字
- 把 monolith 直接拆成更多 lambda

而是：

- 把 legacy endpoint 重新歸回真正的 business domain
- 把 transport-driven / duplicated route 收斂成乾淨 contract
- 把 deployment 完整轉成 `template.yaml` + `sam build` + `sam deploy` + GitHub Actions
- 停止手動 zip upload

如果後續照本文件做，新的 `AWS_DDD_API` 會是：

- domain 清楚
- Lambda boundary 清楚
- contract 清楚
- infra 清楚
- deployment 可重現

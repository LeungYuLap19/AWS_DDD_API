# Face ID Migration Plan (PPC_reg + ML_server Inventory)

## 1) Goal

Migrate Face ID flow to AWS DDD architecture with clear separation of concerns:

1. `pet-biometric` Lambda as public API + orchestration
2. `ml-inference` Lambda as private ML runtime
3. MongoDB as Face ID data store (including embeddings)
4. S3 as image store
5. ECR for ml-inference container image

## 2) Inventories

## 2.1 Frontend inventory: `PPC_reg`

Current known behavior:

1. Frontend captures raw image files.
2. Frontend can send multipart requests to backend biometric endpoints.

Migration requirement:

1. Frontend should send multipart/form-data directly to:
   - `POST /pet/biometric/{petId}/registrations`
   - `POST /pet/biometric/{petId}/verifications`

## 2.2 ML inventory: `ML_server`

Current useful assets:

1. Face quality + angle decision logic
2. Embedding extraction logic
3. Verification similarity logic
4. ML-style response semantics:
   - enroll-like: `status`, `angle`, `score`
   - verify-like: `status`, `similarity`, `angle`

Migration requirement:

1. Reuse ML core logic only.
2. Do not use local filesystem gallery as persistence source of truth.
3. Replace HTTP multipart interface with Lambda-to-Lambda payload contract.

## 3) Target Infra and Ownership

## 3.1 MongoDB (Face ID data store)

Owns:

1. Minimal biometric document per `petId`
2. Stored embeddings needed for verify

## 3.2 S3 (image store)

Owns:

1. Enrollment/verification source images
2. Optional cropped images/debug artifacts if needed

## 3.3 ECR (ml-inference image registry)

Owns:

1. Versioned `ml-inference` container images
2. Deployment input for `MlInferenceImageUri`

## 3.4 pet-biometric Lambda (public)

Owns:

1. Auth + ownership + request validation
2. Mongo reads/writes
3. S3 reference checks
4. Lambda invoke to `ml-inference`
5. API response mapping

## 3.5 ml-inference Lambda (private)

Owns:

1. ML inference execution for register/verify
2. S3 image fetch + decode for query images
3. Response payload for caller persistence/decision

Does not own:

1. Mongo writes
2. Public API exposure

## 4) Endpoint Responsibility Split

## 4.1 Pure DB operations

1. `GET /pet/biometric/{petId}`
   - Mongo-only read
   - no ml-inference invoke

2. `DELETE /pet/biometric/{petId}`
   - Mongo delete
   - optional S3 cleanup
   - no ml-inference invoke

## 4.2 DB + S3 + ML operations

1. `POST /pet/biometric/{petId}/registrations`
   - frontend sends multipart request with:
     - `petType`
     - one or more `image` files
   - `pet-biometric` uploads files to S3 internally
   - call `ml-inference` `register` with the S3 image reference
   - `ml-inference` reads image from S3, checks face/quality/angle, and extracts embedding
   - if result is accepted, persist to Mongo:
     - create biometric document if missing
     - append uploaded key into `imageKeys[]`
     - append returned `{ angle, embedding }` into `embeddings[]`
   - return success to frontend
   - if `ml-inference` returns reject status such as `no_face` or `low_quality`, do not store and return failure to frontend

2. `POST /pet/biometric/{petId}/verifications`
   - frontend sends multipart request with:
     - `petType`
     - one `image` file
     - optional `threshold`
   - `pet-biometric` uploads probe image to S3 internally
   - read candidate embeddings from Mongo by `petId`
   - call `ml-inference` `verify` with:
     - probe image S3 reference
     - candidate embeddings from Mongo
   - `ml-inference` reads probe image from S3, extracts query embedding, and compares against Mongo-loaded candidates
   - return matched / no_match / no_face / low_quality / no_enrollment result to frontend

## 5) Data Model (MongoDB)

Use one collection:

1. `pet_biometrics`
   - `petId`, `userId`, `petType`, `createdAt`, `imageKeys[]`, `embeddings[]`
   - each embedding item contains `angle`, `embedding`

Detailed storage rules:

- `dev_docs/developers/faceid_migration/DATA_STORAGE.md`

Index:

1. `pet_biometrics`: `{ petId: 1 }` unique

## 6) Contract Alignment

Use the companion contract document as implementation truth:

- `dev_docs/developers/faceid_migration/CONTRACT.md`

Key points:

1. `register` response includes `embedding` for Mongo persistence.
2. public `verify` request does not include `candidates`; `pet-biometric` loads them from Mongo.
3. `ml-inference` returns stable `ok` envelope for success/error mapping.

## 7) Execution Plan

1. Finalize contract fields in `CONTRACT.md` and freeze names.
2. Implement `pet-biometric` DB logic:
   - GET/DELETE pure DB
   - register/verify orchestration with Mongo + invoke
3. Integrate ML core into `ml-inference` service handlers:
   - keep router/contract unchanged
4. Wire S3 access paths and IAM prefix restrictions.
5. Build/push `ml-inference` image to ECR.
6. Deploy stack with `MlInferenceImageUri`.
7. Run integration tests:
   - register happy/fail
   - verify match/no-match/no-enrollment
   - GET/DELETE DB-only behavior

## 8) Testing Checklist

1. Contract-level tests
   - invalid `petType`
   - missing multipart image
   - invalid threshold

2. Register flow tests
   - returns embedding
   - embedding persisted to Mongo

3. Verify flow tests
   - candidates loaded from Mongo
   - ml response mapped correctly

4. DB-only endpoint tests
   - GET does not invoke ml-inference
   - DELETE does not invoke ml-inference

5. Deployment test with local real web app

## 9) Deployment Notes

1. Keep `ml-inference` private (no API Gateway event).
2. Use single-platform image build (`linux/arm64`) for Lambda compatibility.
3. Set timeout budget so caller timeout exceeds callee timeout.
4. Keep S3 and Lambdas region-aligned with Mongo region when possible for latency.

## 10) Non-goals for this phase

1. Introducing external vector DB/search engine
2. Migrating all historical legacy gallery files
3. Frontend UX redesign

This phase goal is production-valid flow with Mongo + S3 + Lambda orchestration.

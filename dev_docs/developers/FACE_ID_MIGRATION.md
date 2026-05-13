# Face ID Migration Plan (Current-State -> Lambda Target)

## 1) What Exists Today

### `PPC_reg` (frontend)
- Calls backend endpoints through `VITE_API_BASE_URL`.
- Registration flow:
  1. upload images via `/util/uploadPetBreedImage`
  2. send returned URLs to `/petBiometrics/register`
- Verification flow:
  1. upload image via `/util/uploadPetBreedImage`
  2. send URL to `/petBiometrics/verifyPet`

Important:
- `PPC_reg` is client wrapper + UI only, not backend business logic.

### `ML_server` (Python/FastAPI)
- Has real ML logic.
- Endpoint contract is different from `PPC_reg`:
  - `POST /enroll/frame` (multipart `image`)
  - `POST /verify/frame` (multipart `image`)
- Storage is local filesystem (`gallery/...`) with json embeddings and local images.
- No MongoDB or S3 integration in this server.

### `AWS_DDD_API` status (as of now)
- `functions/pet-biometric/src/router.ts` already has correct target business routes:
  - `GET /pet/biometric/{petId}`
  - `DELETE /pet/biometric/{petId}`
  - `POST /pet/biometric/{petId}/registrations`
  - `POST /pet/biometric/{petId}/verifications`
- `functions/pet-biometric/src/services/biometric.ts` is still stub (no logic).
- `functions/ml-inference/` is currently empty.
- `template.yaml` has `PetBiometricFunction`, but **no** `MlInferenceFunction` yet.

Conclusion:
- There is no single ready backend to copy directly into Lambda.
- We must compose the solution from:
  - ML core reused from `ML_server`
  - new business/orchestration layer in `pet-biometric`

---

## 2) Target Architecture

Use split architecture:

1. `pet-biometric` Lambda (Node.js/TypeScript, public via API Gateway)
- Owns public API contract and all business rules.
- Handles auth context + owner check + request validation + rate limit.
- Reads/writes MongoDB.
- Orchestrates S3 and invokes `ml-inference`.

2. `ml-inference` Lambda (Python + PyTorch, container image, internal only)
- Owns inference only:
  - detect face angle and quality
  - generate embedding
  - compare/query embedding similarity
- No public API Gateway route.
- Called only by `pet-biometric` via AWS SDK invoke.

Why this split:
- Keeps DDD/business logic in existing TS stack.
- Keeps heavy ML dependencies isolated.
- Makes model upgrades independent of public API behavior.

---

## 3) Public API Contract (`pet-biometric`)

### 3.1 GET `/pet/biometric/{petId}`
Purpose:
- fetch biometric enrollment status for a pet.

Response example:
```json
{
  "petId": "665f...",
  "animalType": "cat",
  "isRegistered": true,
  "countsByAngle": {
    "front-face": 3,
    "high-face": 1,
    "low-face": 1,
    "left-face": 0,
    "right-face": 0
  },
  "updatedAt": "2026-05-13T10:20:30.000Z"
}
```

### 3.2 DELETE `/pet/biometric/{petId}`
Purpose:
- remove biometric data for a pet.

Behavior:
- delete (or soft-delete) embeddings and records in Mongo.
- optional cleanup of S3 objects if configured.

### 3.3 POST `/pet/biometric/{petId}/registrations`
Purpose:
- enroll biometric from one or more uploaded images.

Request example:
```json
{
  "animalType": "cat",
  "images": [
    { "bucket": "my-bucket", "key": "user-uploads/biometric/pet123/front-1.jpg" },
    { "bucket": "my-bucket", "key": "user-uploads/biometric/pet123/front-2.jpg" },
    { "bucket": "my-bucket", "key": "user-uploads/biometric/pet123/front-3.jpg" }
  ]
}
```

Response example:
```json
{
  "registered": true,
  "accepted": 3,
  "rejected": 0,
  "countsByAngle": {
    "front-face": 3
  }
}
```

### 3.4 POST `/pet/biometric/{petId}/verifications`
Purpose:
- verify one query image against stored enrollment embedding(s).

Request example:
```json
{
  "animalType": "cat",
  "image": { "bucket": "my-bucket", "key": "user-uploads/biometric/verify/pet123-20260513.jpg" }
}
```

Response example:
```json
{
  "matched": true,
  "score": 0.87,
  "threshold": 0.5,
  "angle": "front-face"
}
```

---

## 4) Internal API Contract (`pet-biometric` -> `ml-inference`)

### 4.1 Operation: `extract_embeddings`
Request:
```json
{
  "op": "extract_embeddings",
  "petId": "665f...",
  "animalType": "cat",
  "images": [
    { "bucket": "my-bucket", "key": "user-uploads/biometric/pet123/front-1.jpg" }
  ]
}
```

Response:
```json
{
  "ok": true,
  "items": [
    {
      "imageKey": "user-uploads/biometric/pet123/front-1.jpg",
      "angle": "front-face",
      "qualityScore": 78.2,
      "accepted": true,
      "embedding": [0.01, -0.02, 0.03]
    }
  ]
}
```

### 4.2 Operation: `verify_embedding`
Request:
```json
{
  "op": "verify_embedding",
  "animalType": "cat",
  "image": { "bucket": "my-bucket", "key": "user-uploads/biometric/verify/pet123.jpg" },
  "candidates": [
    { "angle": "front-face", "embedding": [0.01, -0.02, 0.03] }
  ],
  "threshold": 0.5
}
```

Response:
```json
{
  "ok": true,
  "matched": true,
  "score": 0.87,
  "threshold": 0.5,
  "angle": "front-face"
}
```

Notes:
- Keep this contract stable and versioned.
- Return machine-parseable error codes for mapping in `pet-biometric`.

---

## 5) How Images Should Be Passed

### Recommended: S3 object references (bucket/key)
- Frontend uploads image to S3 first.
- Frontend sends S3 key(s) to `pet-biometric`.
- `pet-biometric` invokes `ml-inference` with bucket/key.
- `ml-inference` reads image bytes from S3.

Why this is recommended:
- avoids Lambda 6MB sync invoke payload pressure from base64 images
- avoids API Gateway body-size issues
- easier retries and traceability

### Not recommended (except tiny payloads)
- Passing raw/base64 images in Lambda invoke payload.

---

## 6) MongoDB Data Model (Suggested)

### `pet_biometrics`
- `petId` (unique per active biometric profile)
- `userId`
- `animalType`
- `isRegistered`
- `countsByAngle`
- `createdAt`, `updatedAt`, optional `deletedAt`

### `pet_biometric_embeddings`
- `petId`
- `angle`
- `embedding` (512-d vector)
- `qualityScore`
- `imageKey`
- `createdAt`

### `pet_biometric_verifications`
- `petId`
- `userId`
- `imageKey`
- `matched`
- `score`
- `threshold`
- `angle`
- `modelVersion`
- `createdAt`

Vector strategy:
- If using Mongo Atlas Vector Search, create vector index on `embedding` (dimension 512, cosine).

---

## 7) Reuse Strategy from `ML_server`

Reuse directly:
- `core/detector.py`
- `core/recognizer.py`
- `core/iresnet.py`
- `checkpoints/...`
- similarity approach (dot product on normalized vectors + threshold)

Adapt:
- endpoint layer (`main.py`) into Lambda handler style
- replace local `gallery/...` persistence with MongoDB writes via caller (`pet-biometric`)

Do not keep for target architecture:
- `gallery_manager` as source of truth
- local filesystem gallery as persistent storage

---

## 8) `template.yaml` / Infra Changes

### 8.1 Keep `PetBiometricFunction`
- Current generic root/proxy API mapping is acceptable for router dispatch.
- Optional hardening later: reduce to only explicit methods/paths needed.

### 8.2 Add `MlInferenceFunction` (container image)
Use `PackageType: Image`, no API events, internal-only.

Example:
```yaml
MlInferenceFunction:
  Type: AWS::Serverless::Function
  Properties:
    FunctionName: !Sub '${ProjectName}-${StageName}-ml-inference'
    PackageType: Image
    Role: !GetAtt SharedFunctionRole.Arn
    Timeout: 25
    MemorySize: 1024
    Architectures:
      - arm64
    Environment:
      Variables:
        MODEL_VERIFY_THRESHOLD: '0.5'
        MODEL_QUALITY_THRESHOLD: '30'
  Metadata:
    Dockerfile: Dockerfile
    DockerContext: functions/ml-inference
    DockerTag: latest
```

### 8.3 IAM updates
- Allow `pet-biometric` role to invoke ML:
  - `lambda:InvokeFunction` on `MlInferenceFunction` and its alias.
- Ensure S3 permissions:
  - `pet-biometric`: `s3:GetObject` and optional `s3:PutObject` for biometric prefixes.
  - `ml-inference`: `s3:GetObject` for biometric prefixes.

### 8.4 CI/CD updates
- Deploy with image support:
  - `sam deploy --resolve-image-repos ...`
- Ensure pipeline role has ECR permissions for image push/pull.

---

## 9) Lambda-to-Lambda Invoke Pattern

In `pet-biometric`:
- use `@aws-sdk/client-lambda`
- `InvocationType: RequestResponse`
- parse `Payload`
- if `FunctionError` exists, map to stable API error

Error mapping guideline:
- model unavailable -> `503 common.serviceUnavailable`
- bad image/no face -> `422` domain error key
- timeout -> `504` or `503` based on API policy

Timeout budget:
- API Gateway > `pet-biometric` timeout > `ml-inference` timeout.
- Example: 29s > 25s > 20s.

---

## 10) Build Sequence (Execution Plan)

1. Scaffold `functions/ml-inference` container Lambda.
2. Port minimal ML core from `ML_server` and return deterministic JSON.
3. Add `MlInferenceFunction` to `template.yaml`.
4. Add IAM invoke + S3 permissions.
5. Implement `POST /registrations` in `pet-biometric`.
6. Implement `POST /verifications`.
7. Implement `GET` and `DELETE`.
8. Add integration tests for:
   - registration success/failure
   - verification match/no-match
   - timeout/error mapping
9. Update frontend endpoint contract (`PPC_reg`) from legacy `/petBiometrics/*` to new `/pet/biometric/*` paths, or provide temporary compatibility routes.

---

## 11) Is Current `router.ts` Enough?

Yes for route shape, no for full feature.

What is already enough:
- Correct public route structure exists in router.

What is still missing:
- real handler logic
- schemas
- db models
- ML invoke client
- `ml-inference` function + infra wiring

---

## 12) Final Decision Summary

- Build business logic yourself in `pet-biometric`.
- Reuse ML core from `ML_server` in a new internal `ml-inference` Lambda.
- Pass images by S3 key (not URL string business dependency, not base64 payload by default).
- Keep `ml-inference` private (no API Gateway exposure).

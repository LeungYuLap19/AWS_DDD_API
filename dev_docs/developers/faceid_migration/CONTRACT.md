# Face ID Contract (Current Implementation)

This document defines the active contract between:

1. Public API: `pet-biometric` Lambda endpoints
2. Internal API: `pet-biometric` -> `ml-inference` Lambda invoke

The public API is multipart-only.

## 1) Public API (`pet-biometric`)

Routes:

1. `GET /pet/biometric/{petId}`
2. `DELETE /pet/biometric/{petId}`
3. `POST /pet/biometric/{petId}/registrations`
4. `POST /pet/biometric/{petId}/verifications`

## 1.1 `GET /pet/biometric/{petId}`

Behavior:

1. auth required
2. pet ownership check required
3. Mongo-only read
4. no `ml-inference` invoke

Success response:

```json
{
  "message": "success.retrieved",
  "data": {
    "petId": "pet123",
    "userId": "user456",
    "hasFaceId": true,
    "biometric": {
      "petId": "pet123",
      "userId": "user456",
      "petType": "cat",
      "createdAt": "2026-05-14T10:30:00Z",
      "imageKeys": [
        "user-uploads/pets/pet123/face-id/registrations/abc.jpg"
      ],
      "embeddings": [
        {
          "angle": "front-face",
          "embedding": [0.01, -0.02, 0.03]
        }
      ]
    }
  }
}
```

## 1.2 `DELETE /pet/biometric/{petId}`

Behavior:

1. auth required
2. pet ownership check required
3. Mongo-only delete
4. no `ml-inference` invoke

Success response:

```json
{
  "message": "success.deleted",
  "data": {
    "petId": "pet123",
    "deleted": true
  }
}
```

## 1.3 `POST /pet/biometric/{petId}/registrations`

Content type:

```text
multipart/form-data
```

Required multipart fields:

1. `petType`
   - must be `cat` or `dog`
2. one or more `image` files

Notes:

1. frontend sends files directly to `pet-biometric`
2. `pet-biometric` uploads files to S3 internally
3. `pet-biometric` calls `ml-inference` once per uploaded image
4. only accepted ML results are persisted to MongoDB

Success response:

```json
{
  "message": "success.retrieved",
  "data": {
    "petId": "pet123",
    "petType": "cat",
    "accepted": [
      {
        "imageKey": "user-uploads/pets/pet123/face-id/registrations/a.jpg",
        "embedding": [0.01, -0.02, 0.03],
        "status": "accepted",
        "angle": "front-face",
        "score": 100.0,
        "counts": {},
        "can_finish": false,
        "front_image": null
      }
    ],
    "rejected": [
      {
        "imageKey": "user-uploads/pets/pet123/face-id/registrations/b.jpg",
        "status": "low_quality",
        "angle": "left-face",
        "score": 12.3,
        "counts": {},
        "can_finish": false,
        "front_image": null
      }
    ]
  }
}
```

Failure behavior:

1. if multipart is missing required fields, return validation error
2. if no file is uploaded, return validation error
3. if all uploaded images are rejected by ML, return error and do not persist

## 1.4 `POST /pet/biometric/{petId}/verifications`

Content type:

```text
multipart/form-data
```

Required multipart fields:

1. `petType`
   - must be `cat` or `dog`
2. exactly one `image` file

Optional multipart fields:

1. `threshold`
   - number `>= 0`

Notes:

1. frontend sends probe file directly to `pet-biometric`
2. `pet-biometric` uploads the probe image to S3 internally
3. `pet-biometric` loads candidate embeddings from MongoDB by `petId`
4. frontend does not send `candidates`

Success response:

```json
{
  "message": "success.retrieved",
  "data": {
    "petId": "pet123",
    "petType": "cat",
    "imageKey": "user-uploads/pets/pet123/face-id/verifications/q.jpg",
    "candidatesCount": 3,
    "result": {
      "status": "no_match",
      "similarity": 0.0,
      "angle": "front-face",
      "threshold": 0.5,
      "petId": "pet123",
      "petType": "cat",
      "image": {
        "bucket": "petpetclub",
        "key": "user-uploads/pets/pet123/face-id/verifications/q.jpg"
      },
      "candidateCount": 3
    }
  }
}
```

## 2) Internal API (`pet-biometric` -> `ml-inference`)

Invocation is synchronous `RequestResponse` with JSON payload:

```json
{
  "op": "register",
  "petId": "pet123",
  "body": {},
  "requestId": "apigw-request-id"
}
```

Top-level rules:

1. `op` required string
2. `petId` required non-empty string
3. `body` optional object
4. `requestId` optional non-empty string

Supported operations:

1. `register`
2. `verify`

## 2.1 `register` operation

Request payload:

```json
{
  "op": "register",
  "petId": "pet123",
  "body": {
    "petType": "cat",
    "image": {
      "bucket": "petpetclub",
      "key": "user-uploads/pets/pet123/face-id/registrations/a.jpg"
    }
  },
  "requestId": "req-1"
}
```

Success envelope returned by `ml-inference`:

```json
{
  "ok": true,
  "op": "register",
  "data": {
    "status": "accepted",
    "angle": "front-face",
    "score": 100.0,
    "counts": {},
    "can_finish": false,
    "front_image": null,
    "embedding": [],
    "petId": "pet123",
    "petType": "cat",
    "image": {
      "bucket": "petpetclub",
      "key": "user-uploads/pets/pet123/face-id/registrations/a.jpg"
    }
  }
}
```

Notes:

1. `embedding` is required for MongoDB persistence by `pet-biometric`
2. `pet-biometric` treats `accepted` and `angle_full` as persistable statuses

## 2.2 `verify` operation

Request payload:

```json
{
  "op": "verify",
  "petId": "pet123",
  "body": {
    "petType": "cat",
    "image": {
      "bucket": "petpetclub",
      "key": "user-uploads/pets/pet123/face-id/verifications/q.jpg"
    },
    "candidates": [
      {
        "angle": "front-face",
        "embedding": [0.01, -0.02, 0.03]
      }
    ],
    "threshold": 0.5
  },
  "requestId": "req-2"
}
```

Success envelope returned by `ml-inference`:

```json
{
  "ok": true,
  "op": "verify",
  "data": {
    "status": "no_match",
    "similarity": 0.0,
    "angle": "front-face",
    "threshold": 0.5,
    "petId": "pet123",
    "petType": "cat",
    "image": {
      "bucket": "petpetclub",
      "key": "user-uploads/pets/pet123/face-id/verifications/q.jpg"
    },
    "candidateCount": 1
  }
}
```

Special verify case:

1. if Mongo returns no embeddings, `pet-biometric` still invokes `ml-inference` with `candidates: []`
2. `ml-inference` returns:
   - `status: "no_enrollment"`
   - `similarity: null`
   - `angle: null`

## 3) Error Envelope From `ml-inference`

When validation or domain errors happen, `ml-inference` returns:

```json
{
  "ok": false,
  "statusCode": 400,
  "errorKey": "mlInference.invalidRequest",
  "message": "field must be ...",
  "op": "register"
}
```

`pet-biometric` behavior:

1. if `ok: false`, map `statusCode/errorKey` to API error response
2. if Lambda invoke has `FunctionError`, map to `common.serviceUnavailable`

## 4) Storage Alignment

MongoDB persistence follows:

- `dev_docs/developers/faceid_migration/DATA_STORAGE.md`

Minimal persisted fields:

1. `petId`
2. `userId`
3. `petType`
4. `createdAt`
5. `imageKeys[]`
6. `embeddings[]`

## 5) Compatibility Note

If field names change later, update all of:

1. `functions/pet-biometric/src/services/biometric.ts`
2. `functions/ml-inference/src/services.py`
3. `dev_docs/developers/faceid_migration/FACE_ID_MIGRATION_PLAN.md`
4. this `CONTRACT.md`

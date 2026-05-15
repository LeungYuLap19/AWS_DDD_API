# Face ID Data Storage

This document defines the minimum MongoDB storage needed to make the Face ID
flow work in the current migration.

Scope:

1. `GET /pet/biometric/{petId}` can tell whether Face ID exists
2. `DELETE /pet/biometric/{petId}` can remove Face ID data
3. register flow can store ML response data
4. verify flow can load embeddings to send to `ml-inference`

This document intentionally avoids long-term design and keeps a single
collection mental model.

## 1) Single Collection

Use one collection:

```text
pet_biometrics
```

Store one document per pet.

## 2) Required Fields

Only store these fields:

```json
{
  "_id": "pet123",
  "petId": "pet123",
  "userId": "user456",
  "petType": "cat",
  "createdAt": "2026-05-14T10:30:00Z",
  "imageKeys": [
    "pets/pet123/front-face/20260514T103000Z.jpg"
  ],
  "embeddings": [
    {
      "angle": "front-face",
      "embedding": [0.01, -0.02, 0.03]
    }
  ]
}
```

Required top-level fields:

1. `petId`
2. `userId`
3. `petType`
4. `createdAt`
5. `imageKeys`
6. `embeddings`

Required per-embedding fields:

1. `angle`
2. `embedding`

## 3) Why These Fields Are Enough

### `petId`

Needed for:

1. lookup by pet
2. GET Face ID status
3. DELETE Face ID data

### `userId`

Needed for:

1. ownership checks
2. avoiding cross-user access mistakes

### `petType`

Needed for:

1. choosing dog/cat ML path
2. keeping registration and verification consistent

### `createdAt`

Needed for:

1. basic record tracking
2. minimal audit/debug value

### `imageKeys`

Needed for:

1. keeping source image references for future retraining
2. optional S3 cleanup on delete
3. retaining enrollment image history without adding another collection

### `embeddings`

Needed for:

1. storing result from register
2. loading candidates for verify
3. knowing whether Face ID exists

### `angle`

Needed for:

1. verify request contract to `ml-inference`
2. keeping embedding meaning consistent

## 4) What You Do Not Need Right Now

Do not store these unless a real requirement appears:

1. full S3 URL
2. S3 bucket, if bucket is fixed in Lambda env
3. verification logs
4. score
5. similarity history
6. threshold history
7. front image base64
8. counts by angle
9. `updatedAt`
10. model version

## 5) S3 Rule

Bucket should come from env, for example:

```text
FACE_ID_IMAGE_BUCKET=pet-biometric-prod
```

Because the current minimal schema keeps `imageKeys[]`, backend can resolve S3
objects directly from Mongo data, for example:

```text
s3://<bucket-from-env>/pets/<petId>/...
```

You do not need to store the full URL in Mongo. Storing `imageKeys[]` is enough
for the current flow.

## 6) How Each Operation Uses This One Collection

### GET `/pet/biometric/{petId}`

Query:

1. find one document by `petId`

Has Face ID rule:

1. count accepted front-facing embeddings (`front-face`, `high-face`, `low-face`)
2. if cumulative accepted count is `>= 10`, then `hasFaceId = true`
3. otherwise `hasFaceId = false`

### DELETE `/pet/biometric/{petId}`

Query:

1. find one document by `petId`
2. optionally delete S3 objects listed in `imageKeys`
3. delete the document

### Register flow

After successful `ml-inference register` response:

1. create document if not exists
2. append uploaded S3 key into `imageKeys`
3. append one item into `embeddings`
4. store:
   - `angle`
   - `embedding`
5. persist each accepted image immediately (do not wait for entire batch)
6. if a batch contains mixed accepted/rejected images:
   - accepted ones are persisted
   - rejected ones are skipped

### Verify flow

Before calling `ml-inference verify`:

1. load document by `petId`
2. map `embeddings` into `candidates`
3. send each candidate as:
   - `angle`
   - `embedding`

## 7) Minimal Index

Only one index is required now:

1. unique `{ petId: 1 }`

If ownership lookups are common, optional:

1. `{ petId: 1, userId: 1 }`

## 8) Final Recommendation

For this deadline-driven phase, use exactly this:

1. one collection: `pet_biometrics`
2. one document per pet
3. top-level fields:
   - `petId`
   - `userId`
   - `petType`
   - `createdAt`
   - `imageKeys`
   - `embeddings`
4. per-embedding fields:
   - `angle`
   - `embedding`

That is enough to support:

1. have Face ID check
2. delete Face ID
3. persist register result
4. load verify candidates

## 9) Optional Add-Back

If later you want better traceability, add this back per embedding:

```json
{
  "imageKey": "pets/pet123/front-face/20260514T103000Z.jpg"
}
```

It is useful, but not required for the minimal implementation.

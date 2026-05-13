#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" || "${2:-}" == "" ]]; then
  echo "Usage: script/build-ml-inference-image.sh <ecr_repo_uri> <tag>"
  echo "Example: script/build-ml-inference-image.sh 123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/my-repo ml-inference-v2"
  exit 1
fi

ECR_REPO_URI="$1"
IMAGE_TAG="$2"
IMAGE_URI="${ECR_REPO_URI}:${IMAGE_TAG}"

REGISTRY_HOST="${ECR_REPO_URI%%/*}"
AWS_REGION="$(echo "${REGISTRY_HOST}" | cut -d'.' -f4)"
AWS_ACCOUNT_ID="$(echo "${REGISTRY_HOST}" | cut -d'.' -f1)"
REPO_NAME="${ECR_REPO_URI#*/}"

echo "Building and pushing ${IMAGE_URI} for linux/arm64..."
docker buildx build \
  --platform linux/arm64 \
  --provenance=false \
  --sbom=false \
  --output type=image,push=true \
  -t "${IMAGE_URI}" \
  functions/ml-inference

echo "Inspecting pushed image media type..."
MEDIA_TYPE="$(aws ecr describe-images \
  --region "${AWS_REGION}" \
  --registry-id "${AWS_ACCOUNT_ID}" \
  --repository-name "${REPO_NAME}" \
  --image-ids imageTag="${IMAGE_TAG}" \
  --query 'imageDetails[0].imageManifestMediaType' \
  --output text)"

echo "imageManifestMediaType=${MEDIA_TYPE}"
if [[ "${MEDIA_TYPE}" == "application/vnd.oci.image.index.v1+json" ]]; then
  echo "ERROR: Lambda does not accept OCI index manifest for this function image. Rebuild command must produce a single image manifest."
  exit 2
fi

echo "OK: ${IMAGE_URI}"

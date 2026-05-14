#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_ENV_FILE="${REPO_ROOT}/env.development.json"

if [[ "${1:-}" == "" || "${2:-}" == "" ]]; then
  echo "Usage: script/build-ml-inference-image.sh <ecr_repo_uri> <tag> [env_file]"
  echo "Example: script/build-ml-inference-image.sh 123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/my-repo ml-inference-v2 env.development.json"
  exit 1
fi

ECR_REPO_URI="$1"
IMAGE_TAG="$2"
IMAGE_URI="${ECR_REPO_URI}:${IMAGE_TAG}"
ENV_FILE_INPUT="${3:-${DEFAULT_ENV_FILE}}"

if [[ "${ENV_FILE_INPUT}" = /* ]]; then
  ENV_FILE="${ENV_FILE_INPUT}"
else
  ENV_FILE="${REPO_ROOT}/${ENV_FILE_INPUT}"
fi

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
  "${REPO_ROOT}/functions/ml-inference"

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

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env file not found: ${ENV_FILE}"
  exit 3
fi

echo "Updating ML_INFERENCE_IMAGE_URI in ${ENV_FILE}..."
node -e '
const fs = require("fs");
const envFile = process.argv[1];
const imageUri = process.argv[2];
const content = fs.readFileSync(envFile, "utf8");
const json = JSON.parse(content);
if (!json.Parameters || typeof json.Parameters !== "object") {
  throw new Error("Missing Parameters object in env file");
}
json.Parameters.ML_INFERENCE_IMAGE_URI = imageUri;
fs.writeFileSync(envFile, `${JSON.stringify(json, null, 2)}\n`);
' "${ENV_FILE}" "${IMAGE_URI}"

echo "OK: ${IMAGE_URI}"
echo "Updated: ${ENV_FILE}"

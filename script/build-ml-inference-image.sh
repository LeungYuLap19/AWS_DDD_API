#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_ENV_FILE="${REPO_ROOT}/env.development.json"

IMAGE_TAG="${2:-${ML_IMAGE_TAG:-ml-inference-latest}}"
ENV_FILE_INPUT="${3:-${ML_ENV_FILE:-${DEFAULT_ENV_FILE}}}"

if [[ "${ENV_FILE_INPUT}" = /* ]]; then
  ENV_FILE="${ENV_FILE_INPUT}"
else
  ENV_FILE="${REPO_ROOT}/${ENV_FILE_INPUT}"
fi

infer_repo_from_env_file() {
  local env_file="$1"
  if [[ ! -f "${env_file}" ]]; then
    return 0
  fi

  node -e '
const fs = require("fs");
const envFile = process.argv[1];
try {
  const content = fs.readFileSync(envFile, "utf8");
  const json = JSON.parse(content);
  const uri = json?.Parameters?.ML_INFERENCE_IMAGE_URI;
  if (typeof uri !== "string" || uri.trim() === "") {
    process.exit(0);
  }
  let image = uri.trim();
  if (image.includes("@")) {
    image = image.split("@")[0];
  }
  const lastColon = image.lastIndexOf(":");
  const lastSlash = image.lastIndexOf("/");
  if (lastColon > lastSlash) {
    image = image.slice(0, lastColon);
  }
  process.stdout.write(image);
} catch {
  process.exit(0);
}
' "${env_file}"
}

INFERRED_ECR_REPO_URI="$(infer_repo_from_env_file "${ENV_FILE}")"

# Accept either positional args or environment variables.
# Priority: positional args > environment variables > inferred value from env file.
ECR_REPO_URI="${1:-${ML_ECR_REPO_URI:-${INFERRED_ECR_REPO_URI}}}"

if [[ -z "${ECR_REPO_URI}" ]]; then
  echo "ERROR: missing ECR repo URI."
  echo "Provide arg1, set ML_ECR_REPO_URI, or set Parameters.ML_INFERENCE_IMAGE_URI in ${ENV_FILE}."
  echo "Usage: script/build-ml-inference-image.sh <ecr_repo_uri> <tag> [env_file]"
  echo "Example: script/build-ml-inference-image.sh 123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/my-repo ml-inference-v2 env.development.json"
  exit 1
fi

IMAGE_URI="${ECR_REPO_URI}:${IMAGE_TAG}"

REGISTRY_HOST="${ECR_REPO_URI%%/*}"
AWS_REGION="$(echo "${REGISTRY_HOST}" | cut -d'.' -f4)"
AWS_ACCOUNT_ID="$(echo "${REGISTRY_HOST}" | cut -d'.' -f1)"
REPO_NAME="${ECR_REPO_URI#*/}"

echo "Preflight AWS/ECR checks..."
CALLER_ACCOUNT="$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null || true)"
CALLER_ARN="$(aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null || true)"

if [[ -z "${CALLER_ACCOUNT}" || "${CALLER_ACCOUNT}" == "None" ]]; then
  echo "ERROR: unable to resolve AWS caller identity."
  echo "Check AWS credentials/profile/region and network access."
  exit 4
fi

echo "AWS caller: ${CALLER_ARN}"
if [[ "${CALLER_ACCOUNT}" != "${AWS_ACCOUNT_ID}" ]]; then
  echo "WARN: pushing cross-account image (caller=${CALLER_ACCOUNT}, target=${AWS_ACCOUNT_ID})."
  echo "Ensure the caller role/user has cross-account ECR push permissions on ${REPO_NAME}."
fi

if ! aws ecr describe-repositories \
  --region "${AWS_REGION}" \
  --registry-id "${AWS_ACCOUNT_ID}" \
  --repository-names "${REPO_NAME}" >/dev/null 2>&1; then
  echo "ERROR: ECR repository not found or not accessible: ${ECR_REPO_URI}"
  echo "Create the repo or grant ecr:DescribeRepositories permission."
  exit 5
fi

echo "Logging in to ECR registry ${REGISTRY_HOST}..."
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY_HOST}" >/dev/null

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

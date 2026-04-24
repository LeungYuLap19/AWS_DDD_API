# AWS DDD API

This repository is the base framework for the new DDD serverless API.

It now includes:

- a REST API in SAM
- Lambda proxy-style route handlers
- a shared Lambda layer
- a Lambda token authorizer
- API Gateway request-model validation
- per-function version publishing and aliases
- explicit IAM roles
- deploy-safe config and secret wiring
- one small public smoke-test Lambda for CI/CD verification

This is the infrastructure baseline for the fresh API, not a hello-world starter.

## Base framework features

### 1. Shared layer

`layers/shared-runtime` exposes the `@aws-ddd-api/shared` package for common helpers.

Functions import it normally:

```js
const { json } = require('@aws-ddd-api/shared');
```

No function code imports `/opt/...` directly.

### 2. Proxy-style Lambda handlers

The API uses standard API Gateway proxy integration for Lambda-backed routes.

Example public proxy routes:

- `GET /framework/proxy`
- `GET /framework/proxy/{proxy+}`
- `POST /framework/proxy/{proxy+}`

### 3. Authorizer

`RequestAuthorizerFunction` is configured as the default REST API authorizer.

- public routes explicitly override it with `Authorizer: NONE`
- protected routes inherit it automatically

The base authorizer supports:

- local bypass mode via `AUTH_BYPASS=true`
- shared bearer-token mode via `AUTH_SHARED_TOKEN`

### 4. Request validation

`POST /framework/protected/widgets` uses API Gateway request-model validation before Lambda execution.

### 5. Versions and aliases

Each Lambda uses:

- `AutoPublishAlias`

The default alias name is `live`, configurable with the `LambdaAliasName` parameter.

### 6. IAM roles

The template defines explicit roles for:

- normal app functions
- authorizer function

### 7. Secrets and config

Base environment wiring is included:

- `PROJECT_NAME`
- `STAGE_NAME`
- `LAMBDA_ALIAS_NAME`
- `CONFIG_NAMESPACE`
- `AUTH_BYPASS`
- `AUTH_SHARED_TOKEN`

For local work, the template defaults are safe:

- `AUTH_BYPASS=true`
- `AUTH_SHARED_TOKEN=local-dev-token`

For AWS deploys, you can switch to dynamic references with:

- `AuthSharedTokenSecretId`
- `AuthBypassParameterPath`

## Current routes

Public:

- `ANY /pipeline/smoke`
- `GET /framework/proxy`
- `ANY /framework/proxy/{proxy+}`

Protected:

- `GET /framework/protected/config`
- `POST /framework/protected/widgets`

## Files

- `template.yaml`: SAM infrastructure baseline
- `functions/request-authorizer/index.js`: Lambda authorizer
- `functions/pipeline-smoke/index.js`: tiny CI/CD smoke-test Lambda
- `functions/framework-proxy/index.js`: proxy-style REST handler example
- `functions/framework-protected/index.js`: protected route example
- `layers/shared-runtime/...`: shared layer package
- `events/pipeline-smoke-get.json`: REST API sample event
- `.github/workflows/deploy.yml`: GitHub Actions deployment flow
- `bootstrap/github-oidc-role.yaml`: GitHub OIDC bootstrap

## Local commands

```bash
sam validate --lint --template-file template.yaml
npm_config_cache=/tmp/aws-ddd-api-npm-cache sam build --template-file template.yaml
sam local invoke PipelineSmokeFunction --event events/pipeline-smoke-get.json --template template.yaml
sam local start-api --template template.yaml
```

If `sam build` fails with an npm cache permissions error, use the `npm_config_cache=/tmp/aws-ddd-api-npm-cache` prefix shown above or fix the ownership of your local `~/.npm` directory.

## Local auth behavior

Because the template defaults `AUTH_BYPASS` to `true`, protected routes work locally without secret setup.

If you want to test the authorizer path locally, deploy or override env so:

- `AUTH_BYPASS=false`
- `AUTH_SHARED_TOKEN=local-dev-token`

Then call protected routes with:

```bash
curl -H "Authorization: Bearer local-dev-token" "$API_URL/framework/protected/config"
```

## Deploy parameters

Default deploy parameters in `samconfig.toml`:

- `StageName=development`
- `ProjectName=aws-ddd-api`
- `LambdaAliasName=development`
- `ConfigNamespace=/aws-ddd-api/development`
- `AllowedOrigins=*`

Configured deploy environments:

- `development`
  - stack: `aws-ddd-api-development`
  - API base path: `/development/...`
- `production`
  - stack: `aws-ddd-api-production`
  - API base path: `/production/...`

Example deploy commands:

```bash
sam deploy --config-env development
sam deploy --config-env production
```

Optional secure parameters:

- `AuthSharedTokenSecretId`
- `AuthBypassParameterPath`

## One-time GitHub OIDC setup

Deploy the bootstrap stack after replacing the parameter values:

```bash
aws cloudformation deploy \
  --template-file AWS_DDD_API/bootstrap/github-oidc-role.yaml \
  --stack-name aws-ddd-api-github-bootstrap \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubOrg=YOUR_GITHUB_USERNAME_OR_ORG \
    GitHubRepo=YOUR_REPO_NAME \
    BranchName=main \
    ProjectStackPrefix=aws-ddd-api
```

Then get the deploy role ARN:

```bash
aws cloudformation describe-stacks \
  --stack-name aws-ddd-api-github-bootstrap \
  --query "Stacks[0].Outputs[?OutputKey=='GitHubActionsRoleArn'].OutputValue" \
  --output text
```

Add it as the GitHub repository secret:

- `AWS_DEPLOY_ROLE_ARN`

## Notes

- This template is a base framework, not the final domain deployment layout.
- The smoke-test Lambda should stay small....
- Real domain Lambdas can now be added into `functions/` on top of this baseline.

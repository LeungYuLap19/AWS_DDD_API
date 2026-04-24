# SAM CI/CD Starter

This folder is a minimal example of:

- one Lambda
- four HTTP API endpoints
- one SAM template that defines the app infrastructure
- one GitHub Actions workflow that builds and deploys to AWS

For a real repository, use the contents of `sam-cicd-starter/` as the repository root.
In particular, GitHub only detects workflows from the repo root `.github/workflows/`.

## Endpoints

- `GET /hello`
- `POST /hello`
- `PUT /hello/{id}`
- `DELETE /hello/{id}`

## What the template creates

- one Lambda function
- one API Gateway HTTP API
- four API routes wired to the Lambda

You do not need to add Lambda triggers manually in the AWS console. `sam deploy` creates them from `template.yaml`.

## Files

- `template.yaml`: app infrastructure
- `src/app.js`: Lambda handler
- `.github/workflows/deploy.yml`: CI/CD pipeline
- `bootstrap/github-oidc-role.yaml`: one-time AWS bootstrap for GitHub OIDC deploy access

## One-time setup

### 1. Deploy the bootstrap stack

Run this once from your machine after replacing the parameter values:

```bash
aws cloudformation deploy \
  --template-file sam-cicd-starter/bootstrap/github-oidc-role.yaml \
  --stack-name hello-api-github-bootstrap \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubOrg=YOUR_GITHUB_USERNAME_OR_ORG \
    GitHubRepo=YOUR_REPO_NAME \
    BranchName=main \
    ProjectStackPrefix=hello-api
```

### 2. Get the deploy role ARN

```bash
aws cloudformation describe-stacks \
  --stack-name hello-api-github-bootstrap \
  --query "Stacks[0].Outputs[?OutputKey=='GitHubActionsRoleArn'].OutputValue" \
  --output text
```

### 3. Add one GitHub repository secret

Add this secret in GitHub repository settings:

- `AWS_DEPLOY_ROLE_ARN`: the ARN from the bootstrap stack output

## Deploy flow

1. Push to `main`
2. GitHub Actions runs validation, build, and deploy
3. SAM updates the stack in AWS

## Local commands

```bash
cd sam-cicd-starter
sam validate --lint --template-file template.yaml
sam build --template-file template.yaml
sam deploy --guided
```

## After deploy

Get the API URL:

```bash
aws cloudformation describe-stacks \
  --stack-name hello-api-dev \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text
```

Example calls:

```bash
curl "$API_URL/hello"
curl -X POST "$API_URL/hello" -H "content-type: application/json" -d '{"name":"jimmy"}'
curl -X PUT "$API_URL/hello/123" -H "content-type: application/json" -d '{"name":"updated"}'
curl -X DELETE "$API_URL/hello/123"
```

## Notes

- This example keeps things intentionally simple.
- The bootstrap role uses broad permissions so it is easy to learn with.
- After you understand the flow, tighten the IAM policies for production use.

#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const {
  LambdaClient,
  GetAliasCommand,
  GetFunctionConfigurationCommand,
} = require('@aws-sdk/client-lambda');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) continue;
    const key = part.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function parseAliasedFunctions(templatePath, projectName, stageName) {
  const lines = fs.readFileSync(templatePath, 'utf8').split('\n');
  const physicalNames = [];
  let current = null;

  function flush() {
    if (!current) return;
    if (current.hasAlias && current.suffix) {
      physicalNames.push(`${projectName}-${stageName}-${current.suffix}`);
    }
    current = null;
  }

  for (const line of lines) {
    const resourceMatch = line.match(/^  ([A-Za-z0-9]+):\s*$/);
    if (resourceMatch) {
      flush();
      current = {
        logicalId: resourceMatch[1],
        hasAlias: false,
        suffix: null,
      };
      continue;
    }

    if (!current) continue;

    if (/^\s+AutoPublishAlias:\s+/.test(line)) {
      current.hasAlias = true;
      continue;
    }

    const functionNameMatch = line.match(
      /^\s+FunctionName:\s+!Sub '\$\{ProjectName\}-\$\{StageName\}-(.+)'\s*$/
    );
    if (functionNameMatch) {
      current.suffix = functionNameMatch[1];
    }
  }

  flush();
  return physicalNames;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function compareEnv(aliasEnv, latestEnv) {
  const diffs = [];
  const keys = new Set([...Object.keys(aliasEnv), ...Object.keys(latestEnv)]);
  for (const key of [...keys].sort()) {
    const aliasValue = Object.prototype.hasOwnProperty.call(aliasEnv, key) ? aliasEnv[key] : null;
    const latestValue = Object.prototype.hasOwnProperty.call(latestEnv, key) ? latestEnv[key] : null;
    if (aliasValue === latestValue) continue;
    diffs.push(
      `env ${key} differs (alias=${aliasValue == null ? 'missing' : digest(aliasValue)}, latest=${latestValue == null ? 'missing' : digest(latestValue)})`
    );
  }
  return diffs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const templatePath = args.template || 'template.yaml';
  const projectName = args.project || 'aws-ddd-api';
  const stageName = args.stage || 'development';
  const aliasName = args.alias || stageName;

  const functions = parseAliasedFunctions(templatePath, projectName, stageName);
  if (functions.length === 0) {
    throw new Error(`No aliased functions found in ${templatePath}`);
  }

  const client = new LambdaClient({});
  const failures = [];

  for (const functionName of functions) {
    const [alias, aliasConfig, latestConfig] = await Promise.all([
      client.send(new GetAliasCommand({ FunctionName: functionName, Name: aliasName })),
      client.send(new GetFunctionConfigurationCommand({ FunctionName: functionName, Qualifier: aliasName })),
      client.send(new GetFunctionConfigurationCommand({ FunctionName: functionName })),
    ]);

    const diffs = [];
    if ((aliasConfig.CodeSha256 || null) !== (latestConfig.CodeSha256 || null)) {
      diffs.push(
        `code differs (alias=${aliasConfig.CodeSha256 || 'missing'}, latest=${latestConfig.CodeSha256 || 'missing'})`
      );
    }

    diffs.push(
      ...compareEnv(
        aliasConfig.Environment?.Variables || {},
        latestConfig.Environment?.Variables || {}
      )
    );

    if (diffs.length > 0) {
      failures.push({
        functionName,
        aliasVersion: alias.FunctionVersion || 'unknown',
        latestVersion: latestConfig.Version || '$LATEST',
        diffs,
      });
    }
  }

  if (failures.length > 0) {
    console.error(`Alias drift detected for ${failures.length} function(s):`);
    for (const failure of failures) {
      console.error(
        `- ${failure.functionName} alias=${aliasName}:${failure.aliasVersion} latest=${failure.latestVersion}`
      );
      for (const diff of failure.diffs) {
        console.error(`  ${diff}`);
      }
    }
    process.exit(1);
  }

  console.log(
    `Verified ${functions.length} aliased function(s): ${aliasName} matches $LATEST code and configured environment.`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

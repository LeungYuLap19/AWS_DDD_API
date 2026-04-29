const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');

function copyFile(relativeFrom, relativeTo) {
  const source = path.join(repoRoot, relativeFrom);
  const target = path.join(repoRoot, relativeTo);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

copyFile(
  'functions/request-authorizer/package.json',
  'dist/functions/request-authorizer/package.json'
);

copyFile(
  'functions/auth/package.json',
  'dist/functions/auth/package.json'
);

copyFile(
  'functions/user/package.json',
  'dist/functions/user/package.json'
);

if (fs.existsSync(path.join(repoRoot, 'functions/request-authorizer/package-lock.json'))) {
  copyFile(
    'functions/request-authorizer/package-lock.json',
    'dist/functions/request-authorizer/package-lock.json'
  );
}

copyFile(
  'layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/package.json',
  'dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/package.json'
);

const sharedSourceDir = path.join(
  repoRoot,
  'layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared'
);
const sharedTargetDir = path.join(
  repoRoot,
  'dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared'
);

function transpileSharedTs(relativePath) {
  const sourcePath = path.join(sharedSourceDir, relativePath);
  const targetPath = path.join(sharedTargetDir, relativePath.replace(/\.ts$/, '.js'));
  const sharedSource = fs.readFileSync(sourcePath, 'utf8');
  const transpiledShared = ts.transpileModule(sharedSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, transpiledShared.outputText);
}

function copySharedJs(relativePath) {
  const sourcePath = path.join(sharedSourceDir, relativePath);
  const targetPath = path.join(sharedTargetDir, relativePath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectory(relativeFrom, relativeTo) {
  const sourceDir = path.join(repoRoot, relativeFrom);
  const targetDir = path.join(repoRoot, relativeTo);

  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function copyNodeModule(moduleName) {
  copyDirectory(
    `node_modules/${moduleName}`,
    `dist/layers/shared-runtime/nodejs/node_modules/${moduleName}`
  );
}

function copyNodeModuleDependencyClosure(moduleName, visited = new Set()) {
  if (visited.has(moduleName)) {
    return visited;
  }

  const packageJsonPath = path.join(repoRoot, 'node_modules', moduleName, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Missing node_modules dependency required for layer packaging: ${moduleName}`);
  }

  visited.add(moduleName);
  copyNodeModule(moduleName);

  const packageJson = readJson(packageJsonPath);
  const dependencies = Object.keys(packageJson.dependencies || {});
  for (const dependencyName of dependencies) {
    copyNodeModuleDependencyClosure(dependencyName, visited);
  }

  return visited;
}

function walkSharedFiles(dir = sharedSourceDir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relativePath = path.join(prefix, entry.name);
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkSharedFiles(fullPath, relativePath);
      continue;
    }

    if (entry.name.endsWith('.ts')) {
      transpileSharedTs(relativePath);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.json')) {
      copySharedJs(relativePath);
    }
  }
}

walkSharedFiles();

copyNodeModuleDependencyClosure('zod');
copyNodeModuleDependencyClosure('jsonwebtoken');

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const distLayersDir = path.join(repoRoot, 'dist', 'layers');

const layerNames = [
  'shared-core',
  'shared-mongo',
  'shared-multipart',
  'shared-s3',
  'shared-network',
  // Compatibility mirror for existing tests and local tooling that resolve
  // the shared package from the old dist path. This directory is not attached
  // to Lambda functions in template.yaml.
  'shared-runtime',
];

const layerNodeModulesDirs = {
  'shared-core': path.join(distLayersDir, 'shared-core', 'nodejs', 'node_modules'),
  'shared-mongo': path.join(distLayersDir, 'shared-mongo', 'nodejs', 'node_modules'),
  'shared-multipart': path.join(distLayersDir, 'shared-multipart', 'nodejs', 'node_modules'),
  'shared-s3': path.join(distLayersDir, 'shared-s3', 'nodejs', 'node_modules'),
  'shared-network': path.join(distLayersDir, 'shared-network', 'nodejs', 'node_modules'),
  'shared-runtime': path.join(distLayersDir, 'shared-runtime', 'nodejs', 'node_modules'),
};

const sharedPackageName = '@aws-ddd-api/shared';
const sharedSourceDir = path.join(
  repoRoot,
  'layers',
  'shared-runtime',
  'nodejs',
  'node_modules',
  '@aws-ddd-api',
  'shared'
);
const sharedTargetDirs = [
  path.join(layerNodeModulesDirs['shared-core'], '@aws-ddd-api', 'shared'),
  path.join(layerNodeModulesDirs['shared-runtime'], '@aws-ddd-api', 'shared'),
];

function copyFile(relativeFrom, relativeTo) {
  const source = path.join(repoRoot, relativeFrom);
  const target = path.join(repoRoot, relativeTo);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(relativeFrom, relativeTo) {
  const sourceDir = path.join(repoRoot, relativeFrom);
  const targetDir = path.join(repoRoot, relativeTo);

  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cleanLayerDirectories() {
  for (const layerName of layerNames) {
    const layerDir = path.join(distLayersDir, layerName);
    if (fs.existsSync(layerDir)) {
      fs.rmSync(layerDir, { recursive: true, force: true });
    }
  }
}

function transpileSharedTs(relativePath) {
  const sourcePath = path.join(sharedSourceDir, relativePath);
  const sharedSource = fs.readFileSync(sourcePath, 'utf8');
  const transpiledShared = ts.transpileModule(sharedSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });

  for (const targetDir of sharedTargetDirs) {
    const targetPath = path.join(targetDir, relativePath.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, transpiledShared.outputText);
  }
}

function copySharedRuntimeAsset(relativePath) {
  const sourcePath = path.join(sharedSourceDir, relativePath);

  for (const targetDir of sharedTargetDirs) {
    const targetPath = path.join(targetDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
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
      copySharedRuntimeAsset(relativePath);
    }
  }
}

function copyNodeModuleToLayer(layerName, moduleName) {
  const sourceDir = path.join(repoRoot, 'node_modules', moduleName);
  const targetDir = path.join(layerNodeModulesDirs[layerName], moduleName);

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function copyNodeModuleDependencyClosure(layerName, moduleName, visited = new Set()) {
  if (visited.has(moduleName)) {
    return visited;
  }

  const packageJsonPath = path.join(repoRoot, 'node_modules', moduleName, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Missing node_modules dependency required for layer packaging: ${moduleName}`);
  }

  visited.add(moduleName);
  copyNodeModuleToLayer(layerName, moduleName);

  const packageJson = readJson(packageJsonPath);
  const dependencies = Object.keys(packageJson.dependencies || {});
  for (const dependencyName of dependencies) {
    copyNodeModuleDependencyClosure(layerName, dependencyName, visited);
  }

  return visited;
}

function packageLayerDependencies() {
  const layerPackages = {
    'shared-core': ['zod', 'jsonwebtoken'],
    'shared-multipart': ['busboy'],
    'shared-mongo': ['mongoose'],
    'shared-s3': ['@aws-sdk/client-s3'],
    'shared-network': ['axios', 'bcryptjs', 'nodemailer'],
  };

  for (const [layerName, packages] of Object.entries(layerPackages)) {
    for (const packageName of packages) {
      copyNodeModuleDependencyClosure(layerName, packageName);
    }
  }
}

// Function package.json files are no longer copied here.
// esbuild-functions.cjs bundles each function into a single index.js with all
// non-layer dependencies inlined, so SAM does not run npm install per function.

// Static asset directories still need to be copied alongside the bundle.
copyDirectory(
  'functions/commerce-orders/static',
  'dist/functions/commerce-orders/static'
);

copyDirectory(
  'functions/commerce-fulfillment/static',
  'dist/functions/commerce-fulfillment/static'
);

cleanLayerDirectories();

for (const targetDir of sharedTargetDirs) {
  fs.mkdirSync(targetDir, { recursive: true });
}

copyFile(
  `layers/shared-runtime/nodejs/node_modules/${sharedPackageName}/package.json`,
  'dist/layers/shared-core/nodejs/node_modules/@aws-ddd-api/shared/package.json'
);
copyFile(
  `layers/shared-runtime/nodejs/node_modules/${sharedPackageName}/package.json`,
  'dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/package.json'
);

walkSharedFiles();
packageLayerDependencies();

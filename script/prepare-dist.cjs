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

const sharedSourceTsPath = path.join(
  repoRoot,
  'layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.ts'
);
const sharedSourceJsPath = path.join(
  repoRoot,
  'layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);
const sharedTargetPath = path.join(
  repoRoot,
  'dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

fs.mkdirSync(path.dirname(sharedTargetPath), { recursive: true });

if (fs.existsSync(sharedSourceTsPath)) {
  const sharedSource = fs.readFileSync(sharedSourceTsPath, 'utf8');
  const transpiledShared = ts.transpileModule(sharedSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });

  fs.writeFileSync(sharedTargetPath, transpiledShared.outputText);
} else if (fs.existsSync(sharedSourceJsPath)) {
  fs.copyFileSync(sharedSourceJsPath, sharedTargetPath);
} else {
  throw new Error(
    'Shared runtime entry not found. Expected layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.ts or index.js'
  );
}

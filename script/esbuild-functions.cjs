/**
 * esbuild bundler for all Lambda functions.
 *
 * Bundles each function into a single dist/functions/{name}/index.js with all
 * dependencies inlined for minimal cold-start latency. Only AWS SDK packages
 * remain external (provided by the Lambda Node.js runtime).
 *
 * Run: node script/esbuild-functions.cjs
 */

'use strict';

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const sharedPkgDir = path.join(
  repoRoot,
  'layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared'
);

const resolveSharedPlugin = {
  name: 'resolve-shared-ts',
  setup(build) {
    build.onResolve({ filter: /^@aws-ddd-api\/shared/ }, (args) => {
      const subpath = args.path.replace('@aws-ddd-api/shared', '');
      if (!subpath || subpath === '/') {
        return { path: path.join(sharedPkgDir, 'index.ts') };
      }
      const directFile = path.join(sharedPkgDir, subpath + '.ts');
      if (fs.existsSync(directFile)) {
        return { path: directFile };
      }
      return { path: path.join(sharedPkgDir, subpath, 'index.ts') };
    });
  },
};

const domainExternal = [
  '@aws-sdk/*',
];

// All functions with an index.ts entry point.
const functions = [
  'auth',
  'commerce-catalog',
  'commerce-fulfillment',
  'commerce-orders',
  'logistics',
  'ngo',
  'notifications',
  'pet-adoption',
  'pet-analysis',
  'pet-biometric',
  'pet-reference',
  'pet-medical',
  'pet-profile',
  'pet-recovery',
  'pet-source',
  'pet-transfer',
  'pipeline-smoke',
  'request-authorizer',
  'user',
];

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
};

function externalForFunction(_name) {
  return domainExternal;
}

async function buildAll() {
  const start = Date.now();

  // Clean stale function build artifacts before writing fresh bundles.
  // This prevents old tsc-emitted files (package.json, src/) from causing SAM
  // to run npm install or pick up outdated modules.
  const functionsDistDir = path.join(repoRoot, 'dist', 'functions');
  if (fs.existsSync(functionsDistDir)) {
    for (const name of functions) {
      const fnDir = path.join(functionsDistDir, name);
      if (fs.existsSync(fnDir)) {
        fs.rmSync(fnDir, { recursive: true, force: true });
      }
    }
  }

  await Promise.all(
    functions.map((name) =>
      esbuild.build({
        ...sharedOptions,
        external: externalForFunction(name),
        plugins: [resolveSharedPlugin],
        entryPoints: [path.join(repoRoot, 'functions', name, 'index.ts')],
        outfile: path.join(repoRoot, 'dist', 'functions', name, 'index.js'),
      })
    )
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`esbuild: bundled ${functions.length} functions in ${elapsed}s`);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

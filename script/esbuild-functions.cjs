/**
 * esbuild bundler for all Lambda functions.
 *
 * Replaces the tsc emit step for functions. Each function is bundled into a
 * single dist/functions/{name}/index.js with all non-layer dependencies
 * inlined. Packages already provided by the shared Lambda layer are marked
 * external so the runtime layer copy is used instead.
 *
 * Layer-provided packages (must stay external):
 *   @aws-ddd-api/shared, zod, jsonwebtoken, busboy
 *
 * Run: node script/esbuild-functions.cjs
 */

'use strict';

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

// Packages provided by the shared Lambda layer — do not bundle these.
const external = [
  '@aws-ddd-api/shared',
  'zod',
  'jsonwebtoken',
  'busboy',
  // Runtime dependencies kept external so jest module mocks can intercept them
  // and so the shared layer provides them to all Lambda functions.
  'mongoose',
  '@aws-sdk/client-s3',
  'axios',
  'bcryptjs',
  'nodemailer',
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
  external,
};

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

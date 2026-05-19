const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const MIN_TEST_TIMEOUT_MS = 60000;

const repoRoot = path.resolve(__dirname);
const distLayersDir = path.join(repoRoot, 'dist', 'layers');

if (fs.existsSync(distLayersDir)) {
  const layerNodePaths = fs
    .readdirSync(distLayersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(distLayersDir, entry.name, 'nodejs', 'node_modules'))
    .filter((nodeModulesPath) => fs.existsSync(nodeModulesPath));

  if (layerNodePaths.length > 0) {
    const existingNodePath = process.env.NODE_PATH
      ? process.env.NODE_PATH.split(path.delimiter).filter(Boolean)
      : [];
    process.env.NODE_PATH = [...layerNodePaths, ...existingNodePath].join(path.delimiter);
    Module._initPaths();
  }
}

const originalSetTimeout = jest.setTimeout.bind(jest);

jest.setTimeout = (timeoutMs) => originalSetTimeout(Math.max(timeoutMs, MIN_TEST_TIMEOUT_MS));
originalSetTimeout(MIN_TEST_TIMEOUT_MS);

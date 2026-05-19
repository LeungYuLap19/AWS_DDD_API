const fs = require('node:fs');
const path = require('node:path');

const distLayersDir = path.join(__dirname, 'dist', 'layers');
const layerModulePaths = fs.existsSync(distLayersDir)
  ? fs
      .readdirSync(distLayersDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(distLayersDir, entry.name, 'nodejs', 'node_modules'))
      .filter((nodeModulesPath) => fs.existsSync(nodeModulesPath))
  : [];

module.exports = {
  testTimeout: 120000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  modulePaths: layerModulePaths,
  modulePathIgnorePatterns: ['<rootDir>/.aws-sam/', '<rootDir>/dist/'],
};

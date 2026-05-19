const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function copyDirectory(relativeFrom, relativeTo) {
  const sourceDir = path.join(repoRoot, relativeFrom);
  const targetDir = path.join(repoRoot, relativeTo);

  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

// Static asset directories still need to be copied alongside the bundle.
copyDirectory(
  'functions/commerce-orders/static',
  'dist/functions/commerce-orders/static'
);

copyDirectory(
  'functions/commerce-fulfillment/static',
  'dist/functions/commerce-fulfillment/static'
);

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const functionsDir = path.join(repoRoot, 'functions');

const barrelImportPattern = /from\s+['"]@aws-ddd-api\/shared['"]/;
const targetExtensions = new Set(['.ts', '.js']);

function listFiles(dir) {
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(fullPath));
      continue;
    }

    if (targetExtensions.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }

  return out;
}

function findViolations(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const matches = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (barrelImportPattern.test(lines[index])) {
      matches.push({
        line: index + 1,
        text: lines[index].trim(),
      });
    }
  }

  return matches;
}

const files = listFiles(functionsDir);
const violations = [];

for (const file of files) {
  const matches = findViolations(file);
  for (const match of matches) {
    violations.push({
      file: path.relative(repoRoot, file),
      line: match.line,
      text: match.text,
    });
  }
}

if (violations.length > 0) {
  console.error('Found disallowed root imports from @aws-ddd-api/shared. Use subpath imports instead.');
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line} ${violation.text}`);
  }
  process.exit(1);
}

console.log('No root-barrel imports from @aws-ddd-api/shared found in functions/.');

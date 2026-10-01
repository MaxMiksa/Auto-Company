#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { auditFixture } = require('../src/audit');

function printUsage() {
  process.stdout.write('Usage: npm run audit -- path/to/fixture.json [--pretty]\n');
}

function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }
  const pretty = args.includes('--pretty');
  const paths = args.filter((arg) => arg !== '--pretty');
  if (paths.length !== 1) {
    printUsage();
    throw new Error('Provide exactly one local JSON fixture path');
  }

  const fixturePath = path.resolve(process.cwd(), paths[0]);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const result = auditFixture(fixture);
  process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`Audit failed: ${error.message}\n`);
  process.exitCode = 1;
}

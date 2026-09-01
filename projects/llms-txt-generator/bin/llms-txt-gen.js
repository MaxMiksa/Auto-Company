#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { generateLlmsTxt } = require('../src/generate');

const HELP = `llms-txt-gen — generate an llms.txt manifest from your markdown docs

Usage:
  llms-txt-gen [options]

Options:
  --dir <path>       Directory to scan (default: current directory)
  --output <path>    Where to write the file (default: llms.txt in --dir)
  --config <path>    Path to a config file (default: <dir>/.llms-txt.config.json)
  --base-url <url>   Prefix for generated links, e.g. https://example.com
  --title <string>   Override the top-level title
  --summary <string> Override the one-line blockquote summary
  --check            Exit with code 1 if the generated file would differ from
                      the existing one on disk (useful as a CI gate). Does
                      not write anything.
  --stdout           Print the generated file to stdout instead of writing it
  -h, --help         Show this help

Examples:
  llms-txt-gen
  llms-txt-gen --dir ./docs --base-url https://example.com
  llms-txt-gen --check
`;

function parseArgs(argv) {
  const args = { dir: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--dir':
        args.dir = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--config':
        args.config = argv[++i];
        break;
      case '--base-url':
        args.baseUrl = argv[++i];
        break;
      case '--title':
        args.title = argv[++i];
        break;
      case '--summary':
        args.summary = argv[++i];
        break;
      case '--check':
        args.check = true;
        break;
      case '--stdout':
        args.stdout = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${HELP}`);
    }
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const rootDir = path.resolve(args.dir);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    process.stderr.write(`Error: --dir "${args.dir}" is not a directory.\n`);
    process.exit(1);
  }

  let result;
  try {
    result = generateLlmsTxt(rootDir, {
      configPath: args.config ? path.resolve(args.config) : undefined,
      title: args.title,
      summary: args.summary,
      baseUrl: args.baseUrl,
    });
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  for (const warning of result.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  if (args.stdout) {
    process.stdout.write(result.content);
    return;
  }

  const outputPath = path.resolve(rootDir, args.output || 'llms.txt');

  if (args.check) {
    const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
    if (existing !== result.content) {
      process.stderr.write(
        `llms.txt is out of date at ${outputPath}. Run llms-txt-gen to regenerate it.\n`
      );
      process.exit(1);
    }
    process.stdout.write('llms.txt is up to date.\n');
    return;
  }

  fs.writeFileSync(outputPath, result.content, 'utf8');
  process.stdout.write(`Wrote ${path.relative(process.cwd(), outputPath) || outputPath}\n`);
}

main();

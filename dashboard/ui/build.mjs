import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const cwd = fileURLToPath(new URL('.', import.meta.url));
await build({entryPoints:[resolve(cwd,'src/index.tsx')],bundle:true,minify:true,format:'iife',target:'es2022',outfile:resolve(cwd,'../ui-assets/ui.js'),tsconfig:resolve(cwd,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},legalComments:'external'});
const result = spawnSync(process.execPath,[resolve(cwd,'node_modules/@tailwindcss/cli/dist/index.mjs'),'-i',resolve(cwd,'src/theme.css'),'-o',resolve(cwd,'../ui-assets/ui.css'),'--minify'],{cwd,stdio:'inherit'});
if (result.status !== 0) process.exit(result.status || 1);

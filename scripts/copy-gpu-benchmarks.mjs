#!/usr/bin/env node
/**
 * Self-hosts detect-gpu's benchmark data under public/gpu-benchmarks, so tier
 * detection makes no CDN request (the CSP allows only 'self'). Runs before
 * `dev` and `build`; the copy is git-ignored and always matches the installed
 * package version.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The package exports only its entry (dist/index.mjs); the data sits beside it.
const distDir = dirname(fileURLToPath(import.meta.resolve('@pmndrs/detect-gpu')));
const from = join(distDir, 'benchmarks');
const to = join(process.cwd(), 'public', 'gpu-benchmarks');

if (!existsSync(from)) {
  console.error(`copy-gpu-benchmarks: ${from} not found`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log('copy-gpu-benchmarks: public/gpu-benchmarks updated');

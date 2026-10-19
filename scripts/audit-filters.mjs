#!/usr/bin/env node
/**
 * `npm run audit:filters` - fails on Mongoose query operators that are not wrapped in
 * `mongoose.trusted()`. The rules (and why) live in scripts/lib/filters.mjs.
 *
 * Scans src/ and scripts/. Test files are skipped, decided on the path RELATIVE to the
 * repository so a checkout that lives under a folder named `src/test` is not skipped whole.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findUntrustedOperators } from './lib/filters.mjs';

const root = process.cwd();

export const isScanned = (rel) =>
  /\.(ts|tsx|mts)$/.test(rel) && !/\.test\./.test(rel) && !rel.startsWith(join('src', 'test') + sep);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (isScanned(relative(root, path))) yield path;
  }
}

const findings = [];
let scanned = 0;
for (const dir of ['src', 'scripts']) {
  for (const file of walk(join(root, dir))) {
    scanned++;
    for (const f of findUntrustedOperators(readFileSync(file, 'utf8'), file)) {
      findings.push(`${relative(root, file)}:${f.line}  ${f.operator}  ${f.text}`);
    }
  }
}

if (findings.length > 0) {
  console.error('Un-trusted Mongoose query operators (wrap them in mongoose.trusted()):\n');
  for (const f of findings) console.error('  ' + f);
  console.error('\nSee the long comment in src/lib/db/mongoose.ts and scripts/lib/filters.mjs.');
  process.exit(1);
}
console.log(`audit:filters ok (${scanned} files scanned)`);

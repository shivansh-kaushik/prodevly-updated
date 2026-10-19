#!/usr/bin/env node
/**
 * `npm run check:copy` - fails the build when public copy contains an invented
 * number or claim. Scans src/content and the strings in src/three.
 * See scripts/lib/public-copy.mjs for the rules.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanSource } from './lib/public-copy.mjs';

const root = process.cwd();
const DIRS = ['src/content', 'src/three'];
const EXT = /\.(ts|tsx|mjs|js|json)$/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // folder does not exist yet
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXT.test(name) && !/\.test\./.test(name)) yield path;
  }
}

let scanned = 0;
const violations = [];
const exemptions = [];

for (const d of DIRS) {
  for (const file of walk(join(root, d))) {
    scanned++;
    const { violations: v, exemptions: e } = scanSource(readFileSync(file, 'utf8'));
    for (const x of v) violations.push({ file: relative(root, file), ...x });
    for (const x of e) exemptions.push({ file: relative(root, file), ...x });
  }
}

for (const x of exemptions) console.log(`exempt   ${x.file}:${x.line}  ${x.reason}`);

if (violations.length > 0) {
  console.error('\nInvented-looking claims in public copy:\n');
  for (const x of violations) console.error(`  ${x.file}:${x.line}  ${x.reason}\n    "${x.text}"`);
  console.error(
    '\nNo number or claim may appear on the public site unless a database record backs it.\n' +
      'If a match is a false positive, add "// copy-ok: reason" to that line.',
  );
  process.exit(1);
}

console.log(`check:copy ok (${scanned} file${scanned === 1 ? '' : 's'} scanned)`);

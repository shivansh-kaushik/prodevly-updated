/**
 * Environment loading for the command-line scripts.
 *
 * `@next/env` (what Next itself uses) EXPANDS `$name` inside values, so a password
 * such as `p$word-with-$HOME` would be silently rewritten before it is hashed. For
 * the two scripts that take a password, those values are read RAW from the env
 * files instead, with the same precedence Next uses: shell > .env.local > .env.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { loadEnvConfig } from '@next/env';

let shell: NodeJS.ProcessEnv | null = null;

/** Call once, first. Snapshots the shell environment, then loads the env files as Next does. */
export function loadScriptEnv(cwd = process.cwd()): void {
  shell ??= { ...process.env };
  loadEnvConfig(cwd);
}

/** The literal value of `name`, with no `$` expansion. */
export function rawEnv(name: string, cwd = process.cwd()): string | undefined {
  const fromShell = (shell ?? process.env)[name];
  if (fromShell !== undefined) return fromShell;
  for (const file of ['.env.local', '.env']) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const value = parseEnv(readFileSync(path, 'utf8'))[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** A copy of `process.env` whose listed variables are replaced by their raw values. */
export function envWithRaw(names: readonly string[], cwd = process.cwd()): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of names) {
    const value = rawEnv(name, cwd);
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export const isLocalMongoUri = (uri: string | undefined): boolean =>
  /^mongodb(\+srv)?:\/\/([^/?]*@)?(localhost|127\.0\.0\.1|\[::1\])([:/?]|$)/.test(uri ?? '');

/**
 * tsx does not set NODE_ENV, so "production" cannot be detected from it. A database that
 * is not on this machine needs an explicit `--confirm-production`, whatever NODE_ENV says.
 */
export function assertConfirmedIfRemote(argv: readonly string[], uri: string | undefined): void {
  const local = isLocalMongoUri(uri);
  const production = process.env.NODE_ENV === 'production';
  if ((production || !local) && !argv.includes('--confirm-production')) {
    console.error(
      `${production ? 'NODE_ENV is "production"' : 'MONGODB_URI is not a local database'}. ` +
        'Re-run with --confirm-production if you really mean to run this against it.',
    );
    process.exit(1);
  }
}

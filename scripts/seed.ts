/**
 * `npm run seed`: create the three superadmins (Aman Gupta, Lakshya Sharma,
 * Shivansh Kaushik), the settings document and the internal client.
 *
 * Emails and initial passwords come from SEED_*_EMAIL / SEED_*_PASSWORD in
 * .env.local, never from code. Safe to run again: existing accounts are left alone.
 * Each seeded account must choose a new password on first sign-in; remove the six
 * SEED_* variables once everyone has signed in.
 */
import { disconnectFromDatabase } from '../src/lib/db/mongoose';
import { readSeedEnv, runSeed, SUPERADMINS } from '../src/services/seed.service';
import { assertConfirmedIfRemote, envWithRaw, loadScriptEnv } from './lib/env';

loadScriptEnv();

function maskUri(uri: string): string {
  return uri.replace(/\/\/[^@/]*@/, '//***:***@');
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env.local (and run `npm run dev:db` for a local database).');
    process.exit(1);
  }
  assertConfirmedIfRemote(process.argv, uri);

  // Passwords are read literally: `$` must not be expanded.
  const result = readSeedEnv(envWithRaw(SUPERADMINS.map((s) => `SEED_${s.key}_PASSWORD`)));
  if (!result.ok) {
    console.error('Cannot seed. Fix these in .env.local:\n');
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`Seeding ${maskUri(uri)}\n`);

  const summary = await runSeed(result.accounts);
  for (const a of summary.superadmins) {
    console.log(`  ${a.created ? 'created       ' : 'already there '} ${a.name} <${a.email}>${a.warning ? `  !! ${a.warning}` : ''}`);
  }
  console.log(`  ${summary.settingsCreated ? 'created       ' : 'already there '} settings`);
  console.log(`  ${summary.internalClientCreated ? 'created       ' : 'already there '} internal client "ProDevly (internal)"`);
  console.log('\nEach new superadmin must set a new password on first sign-in.');
  console.log('Remove the six SEED_* variables from .env.local once everyone has signed in.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());

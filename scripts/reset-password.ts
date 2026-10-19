/**
 * `npm run admin:reset-password -- --email someone@example.com [--reactivate] [--confirm-production]`
 *
 * Break-glass reset for when NO superadmin can sign in. The new password comes from
 * RESET_PASSWORD (never from the command line, so it stays out of shell history) and is
 * read literally, so `$` in it is not expanded. The account must set another password
 * on next sign-in, every session ends, any lockout and sign-in rate-limit window is
 * cleared, and the reset is written to the audit log in the same transaction.
 *
 * A DEACTIVATED account is refused unless you pass `--reactivate`: this script must not
 * quietly undo a deliberate removal. Against a database that is not on this machine it
 * also needs `--confirm-production`. The logic lives in `breakGlassReset` (tested).
 */
import { disconnectFromDatabase } from '../src/lib/db/mongoose';
import { breakGlassReset } from '../src/services/break-glass.service';
import { assertConfirmedIfRemote, loadScriptEnv, rawEnv } from './lib/env';

loadScriptEnv();

async function main() {
  const flag = process.argv.indexOf('--email');
  const email = flag >= 0 ? process.argv[flag + 1] : undefined;
  const password = rawEnv('RESET_PASSWORD');
  if (!email) throw new Error('Pass --email <address>');
  if (!password) throw new Error('Set RESET_PASSWORD in .env.local (and remove it afterwards)');
  assertConfirmedIfRemote(process.argv, process.env.MONGODB_URI);

  const done = await breakGlassReset({ email, password, reactivate: process.argv.includes('--reactivate') });
  console.log(`${done.reactivated ? 'Reactivated and reset' : 'Password reset for'} ${done.name} <${done.email}>. They must set a new password on next sign-in.`);
  console.log('Remove RESET_PASSWORD from .env.local now.');
}

main()
  .catch((error: unknown) => {
    const fields = (error as { fields?: Record<string, string> } | null)?.fields;
    console.error(fields ? Object.values(fields).join(' ') : error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());

import { z } from 'zod';
import { hashPassword } from '@/lib/auth/password';
import { checkPasswordPolicy } from '@/lib/auth/password-policy';
import { connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { Admin, Client, Settings, SETTINGS_ID } from '@/models';
import { audit, SEED_ACTOR } from './audit.service';
import { nextRef } from './refs';

/**
 * The seed. Creates the three superadmins, the settings document and the internal
 * client, and nothing else: no fake projects, payments or people.
 *
 * Idempotent: an account that already exists keeps its password, role and status,
 * so running the seed again changes nothing. Emails and initial passwords come ONLY
 * from environment variables, never from code.
 */
export const SUPERADMINS = [
  { key: 'AMAN', name: 'Aman Gupta' },
  { key: 'LAKSHYA', name: 'Lakshya Sharma' },
  { key: 'SHIVANSH', name: 'Shivansh Kaushik' },
] as const;

export interface SeedAccount {
  name: string;
  email: string;
  password: string;
}

export type SeedEnv = Partial<Record<string, string | undefined>>;

export type SeedEnvResult = { ok: true; accounts: SeedAccount[] } | { ok: false; errors: string[] };

/** Validates every value BEFORE connecting, and names the variable that is wrong. */
export function readSeedEnv(env: SeedEnv): SeedEnvResult {
  const errors: string[] = [];
  const accounts: SeedAccount[] = [];
  const emailCheck = z.email();

  for (const { key, name } of SUPERADMINS) {
    const emailVar = `SEED_${key}_EMAIL`;
    const passVar = `SEED_${key}_PASSWORD`;
    const email = env[emailVar]?.trim().toLowerCase();
    const password = env[passVar];

    if (!email) errors.push(`${emailVar} is missing`);
    else if (!emailCheck.safeParse(email).success) errors.push(`${emailVar} is not a valid email address`);

    if (!password) errors.push(`${passVar} is missing`);
    else {
      const reason = checkPasswordPolicy(password, { email: email ?? '', name });
      if (reason) errors.push(`${passVar}: ${reason}`);
    }
    if (email && password) accounts.push({ name, email, password });
  }

  const emails = accounts.map((a) => a.email);
  if (new Set(emails).size !== emails.length) errors.push('The three SEED_*_EMAIL values must all be different');
  return errors.length > 0 ? { ok: false, errors } : { ok: true, accounts };
}

export interface SeedSummary {
  /** `warning` is set when the account already existed but is NOT an active superadmin; seeding never changes it. */
  superadmins: { name: string; email: string; created: boolean; warning?: string }[];
  settingsCreated: boolean;
  internalClientCreated: boolean;
}

export async function runSeed(accounts: readonly SeedAccount[]): Promise<SeedSummary> {
  await connectToDatabase();
  const summary: SeedSummary = { superadmins: [], settingsCreated: false, internalClientCreated: false };

  for (const account of accounts) {
    const passwordHash = await hashPassword(account.password); // slow: before the transaction
    const { created, existing } = await withTransaction(async (session) => {
      const result = await Admin.updateOne(
        { email: account.email },
        {
          $setOnInsert: {
            name: account.name,
            email: account.email,
            passwordHash,
            role: 'superadmin',
            grants: [],
            status: 'active',
            // Seeded accounts must choose their own password on first sign-in.
            mustChangePassword: true,
            tokenVersion: 0,
            failedLoginAttempts: 0,
            passwordChangedAt: new Date(),
            profile: { skills: [] },
            createdBy: { id: null, name: SEED_ACTOR.name },
          },
        },
        { upsert: true, session },
      );
      const wasCreated = result.upsertedCount > 0;
      if (wasCreated) {
        // The account and the record that it was seeded commit together or not at all.
        await audit(
          {
            actor: SEED_ACTOR,
            action: 'seed.superadmin_created',
            entity: { type: 'admin', id: String(result.upsertedId), label: account.name },
            summary: `Seeded superadmin ${account.email}`,
          },
          session,
        );
        return { created: true, existing: null };
      }
      return { created: false, existing: await Admin.findOne({ email: account.email }).select('role status').session(session).lean() };
    });
    const warning =
      existing && existing.status !== 'active'
        ? 'this account is deactivated; seeding does not reactivate it'
        : existing && existing.role !== 'superadmin'
          ? `this account is a ${existing.role}, not a superadmin; seeding does not change roles`
          : undefined;
    summary.superadmins.push({ name: account.name, email: account.email, created, ...(warning ? { warning } : {}) });
  }

  const settings = await Settings.updateOne({ _id: SETTINGS_ID }, { $setOnInsert: {} }, { upsert: true, setDefaultsOnInsert: true });
  summary.settingsCreated = settings.upsertedCount > 0;

  if (!(await Client.exists({ isInternal: true }))) {
    try {
      await withTransaction(async (session) => {
        const [client] = await Client.create(
          [
            {
              ref: await nextRef('client', session),
              name: 'ProDevly (internal)',
              kind: 'company',
              status: 'active',
              isInternal: true,
              billingCurrency: 'INR',
              createdBy: { id: null, name: SEED_ACTOR.name },
            },
          ],
          { session },
        );
        if (!client) throw new Error('Internal client was not created');
        await audit(
          {
            actor: SEED_ACTOR,
            action: 'seed.internal_client_created',
            entity: { type: 'client', id: String(client._id), ref: client.ref, label: client.name },
          },
          session,
        );
      });
      summary.internalClientCreated = true;
    } catch (error) {
      // A concurrent seed won the race; the partial unique index guarantees exactly one.
      if (!(typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000)) throw error;
    }
  }
  return summary;
}

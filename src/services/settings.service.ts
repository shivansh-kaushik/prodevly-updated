import { cache } from 'react';
import type { ClientSession } from 'mongoose';
import { connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { validationFailed } from '@/lib/api/errors';
import { fieldErrors } from '@/lib/validation/common';
import { updateSettingsSchema, type UpdateSettingsInput } from '@/lib/validation/settings';
import { Settings, SETTINGS_ID, type SettingsDoc } from '@/models';
import { DEFAULT_ENABLED_CURRENCIES } from '@/config/currencies';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_PAYMENT_MODES, DEFAULT_THIRD_PARTY_TYPES } from '@/config/statuses';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields } from './audit.service';

/**
 * Organisation settings as a plain object. Reads fall back to the defaults when the document
 * does not exist yet (a fresh database before `npm run seed`), so no screen has to handle "no
 * settings". Cached per request.
 */
export interface SettingsDTO {
  orgName: string;
  timezone: string;
  fyStartMonth: number;
  enabledCurrencies: string[];
  paymentModes: string[];
  expenseCategories: string[];
  thirdPartyTypes: string[];
  budgetRanges: string[];
  workLogEditWindowDays: number;
  fxStaleDays: number;
}

export const SETTINGS_DEFAULTS: SettingsDTO = {
  orgName: 'ProDevly',
  timezone: 'Asia/Kolkata',
  fyStartMonth: 4,
  enabledCurrencies: [...DEFAULT_ENABLED_CURRENCIES],
  paymentModes: [...DEFAULT_PAYMENT_MODES],
  expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
  thirdPartyTypes: [...DEFAULT_THIRD_PARTY_TYPES],
  budgetRanges: [],
  workLogEditWindowDays: 7,
  fxStaleDays: 7,
};

const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS) as Array<keyof SettingsDTO>;

/** A copy, so nobody can change the shared defaults by pushing onto an array they were handed. */
function defaults(): SettingsDTO {
  return {
    ...SETTINGS_DEFAULTS,
    enabledCurrencies: [...SETTINGS_DEFAULTS.enabledCurrencies],
    paymentModes: [...SETTINGS_DEFAULTS.paymentModes],
    expenseCategories: [...SETTINGS_DEFAULTS.expenseCategories],
    thirdPartyTypes: [...SETTINGS_DEFAULTS.thirdPartyTypes],
    budgetRanges: [...SETTINGS_DEFAULTS.budgetRanges],
  };
}

function toDTO(doc: SettingsDoc): SettingsDTO {
  const d = SETTINGS_DEFAULTS;
  return {
    orgName: doc.orgName ?? d.orgName,
    timezone: doc.timezone ?? d.timezone,
    fyStartMonth: doc.fyStartMonth ?? d.fyStartMonth,
    enabledCurrencies: [...(doc.enabledCurrencies ?? d.enabledCurrencies)],
    paymentModes: [...(doc.paymentModes ?? d.paymentModes)],
    expenseCategories: [...(doc.expenseCategories ?? d.expenseCategories)],
    thirdPartyTypes: [...(doc.thirdPartyTypes ?? d.thirdPartyTypes)],
    budgetRanges: [...(doc.budgetRanges ?? d.budgetRanges)],
    workLogEditWindowDays: doc.workLogEditWindowDays ?? d.workLogEditWindowDays,
    fxStaleDays: doc.fxStaleDays ?? d.fxStaleDays,
  };
}

/**
 * The settings, optionally inside a transaction (pass the session so the read sees the same
 * snapshot as the write that follows). Services that already hold a session use this; screens use
 * `getSettings`.
 */
export async function loadSettings(session?: ClientSession): Promise<SettingsDTO> {
  await connectToDatabase();
  const doc = await Settings.findById(SETTINGS_ID)
    .session(session ?? null)
    .lean();
  return doc ? toDTO(doc) : defaults();
}

export const getSettings = cache(() => loadSettings());

/** The settings for the editor and its API: superadmins only. Everyone else reads them through `getSettings`. */
export async function readSettings(viewer: SessionUser): Promise<SettingsDTO> {
  assertCapability(viewer, 'settings:edit');
  return loadSettings();
}

const LABELS: Record<keyof SettingsDTO, string> = {
  orgName: 'organisation name',
  timezone: 'time zone',
  fyStartMonth: 'financial year start',
  enabledCurrencies: 'enabled currencies',
  paymentModes: 'payment modes',
  expenseCategories: 'expense categories',
  thirdPartyTypes: 'third-party types',
  budgetRanges: 'enquiry budget ranges',
  workLogEditWindowDays: 'work-log edit window',
  fxStaleDays: 'FX stale days',
};

/**
 * Changes the organisation settings. Only the fields sent are touched; a field whose value is
 * already what was sent is not a change, and a request that changes nothing writes nothing and
 * leaves no audit entry. Every real change is audited with before and after in the same
 * transaction. The rules (INR always on, at least one payment mode and expense category, valid
 * time zone, list cleaning) live in `updateSettingsSchema`, which runs here as well as in the route.
 */
export async function updateSettings(actor: SessionUser, input: UpdateSettingsInput, meta: ServiceMeta = {}): Promise<SettingsDTO> {
  assertCapability(actor, 'settings:edit');
  const parsed = updateSettingsSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const patch = parsed.data;

  return withTransaction(async (session) => {
    const before = await loadSettings(session);
    const set: Partial<SettingsDTO> = {};
    for (const key of SETTINGS_KEYS) {
      const next = patch[key];
      if (next !== undefined && JSON.stringify(next) !== JSON.stringify(before[key])) (set as Record<string, unknown>)[key] = next;
    }
    const changed = Object.keys(set) as Array<keyof SettingsDTO>;
    if (changed.length === 0) return before;

    const doc = await Settings.findOneAndUpdate(
      { _id: SETTINGS_ID },
      { $set: set },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true, session },
    ).lean();
    if (!doc) throw new Error('Settings were not saved');
    const after = toDTO(doc);

    await audit(
      {
        actor: { id: actor.id, name: actor.name, role: actor.role },
        action: 'settings.update',
        entity: { type: 'settings', label: 'Organisation settings' },
        summary: `Changed ${changed.map((k) => LABELS[k]).join(', ')}`,
        changes: diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, changed),
        meta,
      },
      session,
    );
    return after;
  });
}

import type { ClientSession } from 'mongoose';
import { BASE_CURRENCY, isCurrencyCode } from '@/config/currencies';
import { deriveRate, type FxLookup } from '@/components/admin/fx-field-model';
import { formatDate, formatInr } from '@/lib/admin/format';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { conflict, fxRateMissing, notFound, unauthorized, validationFailed } from '@/lib/api/errors';
import { assertCapability } from '@/lib/auth/guard';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { connectToDatabase, mongoose, withTransaction } from '@/lib/db/mongoose';
import { bankToleranceMinor, buildMoney, isValidRate, toInrMinor } from '@/lib/money/fx';
import {
  createFxRateSchema,
  fxListQuerySchema,
  type CreateFxRateInput,
  type FxListQuery,
  type UpdateFxRateInput,
  updateFxRateSchema,
} from '@/lib/validation/fx';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import { FxRate, type FxRateDoc, type MoneyDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields } from './audit.service';
import { loadSettings } from './settings.service';

/**
 * Exchange rates and the one function every money entry calls to convert.
 *
 * THE CONTRACT OTHER MODULES RELY ON
 * ----------------------------------
 *   resolveFx({ currency, on, amountMinor, manualRate?, settledInrMinor? }, session?) -> Promise<MoneyDoc>
 *
 * returns the complete `Money` subdocument to embed in a payment, payout or expense:
 * { amountMinor, currency, fxRate, fxDate, fxSource, inrMinor }. The caller never computes an INR
 * value and never trusts one from the client.
 *
 *   INR            identity: rate 1, source "identity", `manualRate` and `settledInrMinor` are ignored.
 *   manualRate     source "manual": the exact rate the bank applied, INR per 1 unit, at most 6 decimals.
 *   settledInrMinor  source "bank": the INR that actually arrived (paise). The rate is DERIVED from it
 *                  to 6 decimals, and `buildMoney` checks the pieces agree. When a current table rate
 *                  exists the figure must also be within the bank tolerance of it (5%, never less than
 *                  INR 1), which catches a dropped digit; with no table rate to compare the bank's
 *                  figure stands on its own.
 *   neither        source "table": the latest `fxRates` row for the currency ON OR BEFORE `on`. If there
 *                  is none, or it is older than `settings.fxStaleDays` before `on`, it throws
 *                  FX_RATE_MISSING (422, field `fxRate`) and the form asks for a rate.
 *
 * `fxDate` is the day the rate APPLIES to: the table row's own date for "table" (so the stored entry
 * names the exact row it used, even when `on` is a Sunday and the row is Friday's), and `on` for every
 * other source. `on` is a calendar date; any time of day is dropped (UTC midnight, as `parseDateOnly`
 * gives). Both `manualRate` and `settledInrMinor` together is a validation error. A currency that is not
 * in `settings.enabledCurrencies` is a validation error on the field `currency`. Pass the transaction's
 * `session` so the settings and rate reads see the same snapshot as the write.
 *
 * "Stale" means: the days from the rate's date to `on` are MORE than `fxStaleDays`. With 7, a rate
 * exactly 7 days old still works; 8 days old does not.
 */
export interface ResolveFxInput {
  currency: string;
  on: Date;
  amountMinor: number;
  manualRate?: number;
  settledInrMinor?: number;
}

export type RateSource = 'manual' | 'ecb' | 'identity';

export interface RateLookup {
  /** INR per 1 unit. */
  rate: number;
  /** The day the rate is for (UTC midnight). */
  rateOn: Date;
  source: RateSource;
  /** Older than `fxStaleDays` before the date asked about. The row is still returned so a screen can say how old it is. */
  stale: boolean;
}

const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Math.floor(d.getTime() / DAY) * DAY);

function normaliseCurrency(raw: string): string {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!isCurrencyCode(code)) throw validationFailed({ currency: 'Pick a supported currency' });
  return code;
}

function validDay(on: Date, field = 'date'): Date {
  if (!(on instanceof Date) || Number.isNaN(on.getTime())) throw validationFailed({ [field]: 'Enter a valid date' });
  return utcDay(on);
}

async function findRate(currency: string, on: Date, staleDays: number, session?: ClientSession): Promise<RateLookup | null> {
  const row = await FxRate.findOne({ currency, rateOn: mongoose.trusted({ $lte: on }) })
    .sort({ rateOn: -1 })
    .session(session ?? null)
    .lean();
  if (!row) return null;
  const age = Math.round((on.getTime() - row.rateOn.getTime()) / DAY);
  return { rate: row.rate, rateOn: row.rateOn, source: row.source, stale: age > staleDays };
}

/**
 * The latest table rate on or before `on`, or null when none has ever been entered for the
 * currency. INR answers 1 with source "identity". Needs no capability: any signed-in admin's
 * forms use it, and it reads only the rate table.
 */
export async function lookupRate(currency: string, on: Date, session?: ClientSession): Promise<RateLookup | null> {
  const code = normaliseCurrency(currency);
  const day = validDay(on);
  if (code === BASE_CURRENCY) return { rate: 1, rateOn: day, source: 'identity', stale: false };
  const settings = await loadSettings(session);
  return findRate(code, day, settings.fxStaleDays, session);
}

export async function resolveFx(input: ResolveFxInput, session?: ClientSession): Promise<MoneyDoc> {
  const currency = normaliseCurrency(input.currency);
  const on = validDay(input.on);
  const { amountMinor, manualRate, settledInrMinor } = input;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw validationFailed({ amountMinor: 'Enter an amount above zero' });

  const settings = await loadSettings(session);
  if (currency !== BASE_CURRENCY && !settings.enabledCurrencies.includes(currency)) {
    throw validationFailed({ currency: `${currency} is not turned on. A superadmin can enable it in Settings.` });
  }
  if (currency === BASE_CURRENCY) return buildMoney({ amountMinor, currency, fxDate: on }) as MoneyDoc;

  if (manualRate !== undefined && settledInrMinor !== undefined) {
    throw validationFailed({ fxRate: 'Give either the exact rate or the INR amount that arrived, not both' });
  }

  if (manualRate !== undefined) {
    if (!isValidRate(manualRate)) throw validationFailed({ fxRate: 'The rate must be above zero, with at most 6 decimals' });
    return build({ amountMinor, currency, fxRate: manualRate, fxDate: on, fxSource: 'manual' }, 'fxRate');
  }

  if (settledInrMinor !== undefined) {
    if (!Number.isSafeInteger(settledInrMinor) || settledInrMinor < 1) {
      throw validationFailed({ settledInrMinor: 'Enter the INR amount that arrived' });
    }
    const fxRate = deriveRate(amountMinor, currency, settledInrMinor);
    if (fxRate === null) throw validationFailed({ settledInrMinor: 'That INR amount does not work out to a usable rate. Check it.' });
    const table = await findRate(currency, on, settings.fxStaleDays, session);
    if (table && !table.stale) {
      const expected = toInrMinor(amountMinor, currency, table.rate);
      if (Math.abs(settledInrMinor - expected) > bankToleranceMinor(expected)) {
        throw validationFailed({
          settledInrMinor: `That is far from the table rate (about ${formatInr(expected)} for this amount). Check the amount, or enter the exact rate instead.`,
        });
      }
    }
    return build({ amountMinor, currency, fxRate, fxDate: on, fxSource: 'bank', settledInrMinor }, 'settledInrMinor');
  }

  const table = await findRate(currency, on, settings.fxStaleDays, session);
  if (!table || table.stale) throw fxRateMissing(currency);
  return build({ amountMinor, currency, fxRate: table.rate, fxDate: table.rateOn, fxSource: 'table' }, 'fxRate');
}

/** `buildMoney` throws plain Errors for an incoherent entry; a caller's bad input must be a 422 on a field, never a 500. */
function build(input: Parameters<typeof buildMoney>[0], field: string): MoneyDoc {
  try {
    return buildMoney(input) as MoneyDoc;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'That amount cannot be converted';
    // "Amount is too large" and "cannot be computed from this amount" are about the amount, not the rate.
    throw validationFailed({ [/^Amount|this amount/.test(message) ? 'amountMinor' : field]: message });
  }
}

/** The form helper behind GET /api/admin/fx-rates/lookup: the table rate for a currency and day, and what an amount comes to. */
export async function lookupFx(
  viewer: SessionUser,
  input: { currency: string; date: Date; amountMinor?: number },
): Promise<FxLookup> {
  if (!viewer) throw unauthorized();
  const currency = normaliseCurrency(input.currency);
  const day = validDay(input.date);
  const settings = await loadSettings();
  if (currency !== BASE_CURRENCY && !settings.enabledCurrencies.includes(currency)) {
    throw validationFailed({ currency: `${currency} is not turned on` });
  }
  if (currency === BASE_CURRENCY) {
    return { currency, rate: 1, rateOn: formatDateOnly(day), source: 'identity', stale: false, staleDays: settings.fxStaleDays, inrMinor: input.amountMinor };
  }
  const found = await findRate(currency, day, settings.fxStaleDays);
  if (!found) return { currency, rate: null, rateOn: null, source: null, stale: true, staleDays: settings.fxStaleDays };
  const out: FxLookup = { currency, rate: found.rate, rateOn: formatDateOnly(found.rateOn), source: found.source, stale: found.stale, staleDays: settings.fxStaleDays };
  if (input.amountMinor && !found.stale) {
    try {
      out.inrMinor = toInrMinor(input.amountMinor, currency, found.rate);
    } catch {
      /* an amount too large to convert: the form shows no preview, the save reports it */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The rate table: read, enter, correct.

export interface FxRateDTO {
  id: string;
  currency: string;
  /** "YYYY-MM-DD" */
  rateOn: string;
  rate: number;
  source: 'manual' | 'ecb';
  enteredBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRateDTO(doc: FxRateDoc): FxRateDTO {
  return {
    id: String(doc._id),
    currency: doc.currency,
    rateOn: formatDateOnly(doc.rateOn),
    rate: doc.rate,
    source: doc.source,
    enteredBy: doc.enteredBy?.name ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export interface FxRateSearch {
  currency?: string;
  source?: 'manual' | 'ecb';
  /** Matches the start of the currency code, or part of the name of whoever entered the rate. Literal text. */
  q?: string;
  /** Date-only, inclusive. */
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

/** The rate table, newest day first. Any signed-in admin may read it (plan section 1: "A can read FX rates"). */
export async function searchFxRates(viewer: SessionUser, params: FxRateSearch = {}): Promise<{ rows: FxRateDTO[]; meta: PageMeta }> {
  if (!viewer) throw unauthorized();
  await connectToDatabase();
  const filter: Record<string, unknown> = {};
  if (params.currency) filter.currency = normaliseCurrency(params.currency);
  if (params.source) {
    if (params.source !== 'manual' && params.source !== 'ecb') throw validationFailed({ source: 'Pick manual or ECB' });
    filter.source = params.source;
  }
  const q = params.q?.trim().slice(0, 40);
  if (q) filter.$or = [{ currency: new RegExp(`^${escapeRegex(q)}`, 'i') }, { 'enteredBy.name': new RegExp(escapeRegex(q), 'i') }];
  if (params.from || params.to) {
    filter.rateOn = mongoose.trusted({
      ...(params.from ? { $gte: validDay(params.from, 'from') } : {}),
      ...(params.to ? { $lte: validDay(params.to, 'to') } : {}),
    });
  }
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const total = await FxRate.countDocuments(filter);
  const meta = pageMeta(Math.max(params.page ?? 1, 1), pageSize, total);
  const docs = await FxRate.find(filter)
    .sort({ rateOn: -1, currency: 1 })
    .skip((meta.page - 1) * pageSize)
    .limit(pageSize)
    .lean();
  return { rows: docs.map(toRateDTO), meta };
}

/** The route's GET: the same search from query-string text. */
export async function listFxRates(viewer: SessionUser, query: unknown) {
  const parsed = fxListQuerySchema.safeParse(query);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const q: FxListQuery = parsed.data;
  return searchFxRates(viewer, {
    currency: q.currency,
    source: q.source,
    q: q.q,
    from: q.from ? (parseDateOnly(q.from) ?? undefined) : undefined,
    to: q.to ? (parseDateOnly(q.to) ?? undefined) : undefined,
    page: q.page,
    pageSize: q.pageSize,
  });
}

const actorOf = (v: SessionUser) => ({ id: v.id, name: v.name, role: v.role });

async function assertDateAllowed(rateOn: Date, timezone: string, now: Date): Promise<void> {
  // A rate cannot be known before the day it is for. "Today" is the organisation's today, which
  // can already be tomorrow in UTC.
  if (rateOn.getTime() > todayDateOnly(now, timezone).getTime()) throw validationFailed({ rateOn: 'A rate cannot be dated in the future' });
}

const duplicate = (currency: string, rateOn: Date) =>
  conflict(`There is already a ${currency} rate for ${formatDate(rateOn)}. Edit that one instead.`, { rateOn: 'A rate for this day already exists' });

/** Enters a rate by hand. Needs `fx:edit`. One rate per currency per day; the source is always "manual". */
export async function createFxRate(viewer: SessionUser, input: CreateFxRateInput, meta: ServiceMeta = {}, now = new Date()): Promise<FxRateDTO> {
  assertCapability(viewer, 'fx:edit');
  const parsed = createFxRateSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const { currency, rate } = parsed.data;
  const rateOn = parseDateOnly(parsed.data.rateOn) as Date;

  return withTransaction(async (session) => {
    const settings = await loadSettings(session);
    if (!settings.enabledCurrencies.includes(currency)) {
      throw validationFailed({ currency: `${currency} is not turned on. A superadmin can enable it in Settings.` });
    }
    await assertDateAllowed(rateOn, settings.timezone, now);
    if (await FxRate.exists({ currency, rateOn }).session(session)) throw duplicate(currency, rateOn);

    const [doc] = await FxRate.create(
      [{ currency, rateOn, rate, source: 'manual', enteredBy: { id: viewer.id, name: viewer.name } }],
      { session },
    );
    if (!doc) throw new Error('Rate was not saved');
    await audit(
      {
        actor: actorOf(viewer),
        action: 'fxRate.create',
        entity: { type: 'fxRate', id: String(doc._id), label: `${currency} ${formatDate(rateOn)}` },
        summary: `1 ${currency} = INR ${rate}`,
        changes: [
          { path: 'currency', after: currency },
          { path: 'rateOn', after: formatDateOnly(rateOn) },
          { path: 'rate', after: rate },
          { path: 'source', after: 'manual' },
        ],
        meta,
      },
      session,
    );
    return toRateDTO(doc.toObject());
  });
}

/**
 * Corrects a rate's value or its day. Needs `fx:edit`. Saved ledger entries keep the rate they were
 * made with, so this never changes a past entry. An edit makes the row a manual one (the ECB fetch
 * must not overwrite it afterwards); saving the same values again changes nothing and is not audited.
 */
export async function updateFxRate(
  viewer: SessionUser,
  id: string,
  patch: UpdateFxRateInput,
  meta: ServiceMeta = {},
  now = new Date(),
): Promise<FxRateDTO> {
  assertCapability(viewer, 'fx:edit');
  const rateId = parseObjectId(id);
  const parsed = updateFxRateSchema.safeParse(patch);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const nextOn = parsed.data.rateOn ? (parseDateOnly(parsed.data.rateOn) as Date) : undefined;

  return withTransaction(async (session) => {
    const before = await FxRate.findById(rateId).session(session).lean();
    if (!before) throw notFound('We could not find that rate');
    const rate = parsed.data.rate ?? before.rate;
    const rateOn = nextOn ?? before.rateOn;
    if (rate === before.rate && rateOn.getTime() === before.rateOn.getTime()) return toRateDTO(before);

    if (rateOn.getTime() !== before.rateOn.getTime()) {
      const settings = await loadSettings(session);
      await assertDateAllowed(rateOn, settings.timezone, now);
      const clash = await FxRate.exists({ currency: before.currency, rateOn, _id: mongoose.trusted({ $ne: before._id }) }).session(session);
      if (clash) throw duplicate(before.currency, rateOn);
    }

    const after = await FxRate.findOneAndUpdate(
      { _id: before._id },
      { $set: { rate, rateOn, source: 'manual', enteredBy: { id: viewer.id, name: viewer.name } } },
      { returnDocument: 'after', session, runValidators: true },
    ).lean();
    if (!after) throw notFound('We could not find that rate');

    await audit(
      {
        actor: actorOf(viewer),
        action: 'fxRate.update',
        entity: { type: 'fxRate', id: String(after._id), label: `${after.currency} ${formatDate(after.rateOn)}` },
        changes: diffFields(
          { rate: before.rate, rateOn: formatDateOnly(before.rateOn), source: before.source },
          { rate: after.rate, rateOn: formatDateOnly(after.rateOn), source: after.source },
          ['rate', 'rateOn', 'source'],
        ),
        meta,
      },
      session,
    );
    return toRateDTO(after);
  });
}

// The ECB feed (fetchAndStoreRates), the cron secret check and their types live in ./fx-feed and are re-exported here.
export * from './fx-feed';

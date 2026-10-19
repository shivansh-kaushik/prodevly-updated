import { Schema, type Types } from 'mongoose';
import { CURRENCY_CODES } from '@/config/currencies';
import { FX_SOURCES, type ProjectStatus } from '@/config/statuses';
import { moneyProblem } from '@/lib/money/fx';

/** Whole numbers only: amounts are integers in the currency's minor unit, never floats. */
export const wholeNumber = {
  validator: Number.isSafeInteger,
  message: '{PATH} must be a whole number',
};

/** An optional non-negative integer field (minor units, minutes, counts). */
export const minorField = (required = false) => ({ type: Number, required, min: 0, validate: wholeNumber });

export const text = (max: number, required = false) => ({ type: String, required, trim: true, maxlength: max });

/** A date with no time of day: exactly UTC midnight. */
export const isUtcMidnight = (value: Date): boolean => value instanceof Date && value.getTime() % 86_400_000 === 0;

/**
 * A calendar date, stored as UTC midnight and never shifted. Enforced, not just documented:
 * period totals bucket by this value and `FxRate` is unique per (currency, day), so
 * 13:45 on the same day must not be a second, different row.
 */
export const dateOnly = (required = false) => ({
  type: Date,
  required,
  validate: { validator: (value: Date | null | undefined) => value == null || isUtcMidnight(value), message: '{PATH} must be a calendar date (midnight UTC)' },
});

/**
 * Actor snapshot stored on records and history entries, so audit views render
 * without joins and keep the person's name after their account is removed.
 */
export interface ActorDoc {
  id: Types.ObjectId | null;
  name: string;
}

export const actorSchema = new Schema<ActorDoc>(
  {
    id: { type: Schema.Types.ObjectId, default: null },
    name: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false },
);

export interface StatusHistoryEntry<S extends string = string> {
  from: S | null;
  to: S;
  at: Date;
  by: ActorDoc;
  note?: string;
}

export function statusHistorySchema<S extends string>(values: readonly S[]) {
  // Mongoose's schema typings cannot relate a generic enum to `S`; the `enum`
  // option is what actually guarantees the value, so the cast is safe here.
  return new Schema(
    {
      from: { type: String, enum: [...values, null], default: null },
      to: { type: String, enum: values, required: true },
      at: { type: Date, required: true, default: Date.now },
      by: { type: actorSchema, required: true },
      note: text(500),
    },
    { _id: false },
  ) as unknown as Schema<StatusHistoryEntry<S>>;
}

export type ProjectStatusHistoryEntry = StatusHistoryEntry<ProjectStatus>;

/**
 * Every ledger entry embeds this. The client sends `amountMinor` and `currency`;
 * the SERVER resolves the rate and computes `inrMinor`, so the INR value that all
 * dashboards sum can never be spoofed. INR entries are always rate 1.
 */
export interface MoneyDoc {
  amountMinor: number;
  currency: string;
  /** INR per 1 unit of `currency`, up to 6 decimals. Exactly 1 for INR. */
  fxRate: number;
  /** The date the rate applies to. */
  fxDate: Date;
  fxSource: (typeof FX_SOURCES)[number];
  /** Integer paise, computed on the server. */
  inrMinor: number;
}

export const moneySchema = new Schema<MoneyDoc>(
  {
    amountMinor: { type: Number, required: true, min: 1, validate: wholeNumber },
    currency: { type: String, required: true, uppercase: true, trim: true, enum: CURRENCY_CODES },
    fxRate: { type: Number, required: true, min: 0 },
    fxDate: { type: Date, required: true },
    fxSource: { type: String, enum: FX_SOURCES, required: true },
    inrMinor: { type: Number, required: true, min: 0, validate: wholeNumber },
  },
  { _id: false },
);

/**
 * Coherence of the whole entry (see `moneyProblem`), reported on the field at fault.
 * The check is pure and never throws; a throw inside a validator would surface as a 500.
 */
function coherent(path: 'fxRate' | 'fxSource' | 'inrMinor') {
  return function (this: MoneyDoc) {
    try {
      return moneyProblem(this)?.path !== path;
    } catch {
      return false;
    }
  };
}

moneySchema.path('fxRate').validate(coherent('fxRate'), 'The rate must be above zero with at most 6 decimals, and exactly 1 for INR');
moneySchema.path('fxSource').validate(coherent('fxSource'), 'The rate source does not fit this currency (INR is identity, others are not)');
moneySchema.path('inrMinor').validate(coherent('inrMinor'), 'The INR value must match the amount at the stated rate');

export interface AddressDoc {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export const addressSchema = new Schema<AddressDoc>(
  {
    line1: text(160),
    line2: text(160),
    city: text(80),
    state: text(80),
    postalCode: text(20),
    country: { type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2 },
  },
  { _id: false },
);

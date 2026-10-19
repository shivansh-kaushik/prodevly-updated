import { z } from 'zod';
import { BASE_CURRENCY, CURRENCY_CODES } from '@/config/currencies';
import { parseDateOnly } from '@/lib/dates/date-only';
import { isValidRate } from '@/lib/money/fx';

/**
 * FX rate schemas, shared by the rate forms, the routes and the services (which parse again).
 * Dates travel as "YYYY-MM-DD" strings and become UTC-midnight Dates in the service
 * (`parseDateOnly`), exactly like every other calendar date in the system.
 */

const FOREIGN_CODES = CURRENCY_CODES.filter((c) => c !== BASE_CURRENCY) as [string, ...string[]];
const ALL_CODES = CURRENCY_CODES as unknown as [string, ...string[]];

/** Rates are quoted for foreign currencies only: INR to INR is always exactly 1 and never stored. */
export const foreignCurrencySchema = z
  .string({ error: 'Pick a currency' })
  .trim()
  .toUpperCase()
  .pipe(z.enum(FOREIGN_CODES, { error: 'Pick a currency other than INR' }));

export const currencySchema = z
  .string({ error: 'Pick a currency' })
  .trim()
  .toUpperCase()
  .pipe(z.enum(ALL_CODES, { error: 'Pick a supported currency' }));

export const dateOnlyString = z
  .string({ error: 'Pick a date' })
  .trim()
  .refine((value) => parseDateOnly(value) !== null, { error: 'Enter a real date' });

/** INR per 1 unit: above zero, at most 6 decimals. The one definition (`isValidRate`) the money model also uses. */
export const rateSchema = z
  .number({ error: 'Enter the rate' })
  .refine(isValidRate, { error: 'The rate must be above zero, with at most 6 decimals' });

export const createFxRateSchema = z
  .object({
    currency: foreignCurrencySchema,
    rateOn: dateOnlyString,
    rate: rateSchema,
  })
  .strict();

/**
 * Only `rate` and `rateOn` can be corrected; the currency is what the row IS. There is no delete,
 * so a row entered against the wrong day is fixed by moving it. The source is never sent: an edit
 * makes the row a manual one, and the ECB fetch cannot be impersonated.
 */
export const updateFxRateSchema = z
  .object({ rate: rateSchema, rateOn: dateOnlyString })
  .partial()
  .strict()
  .refine((value) => value.rate !== undefined || value.rateOn !== undefined, { error: 'Nothing to update' });

export const fxLookupQuerySchema = z.object({
  currency: currencySchema,
  date: dateOnlyString,
  /** Integer minor units, as text from the query string. Optional: the form may not have an amount yet. */
  amount: z
    .string()
    .regex(/^\d{1,15}$/, { error: 'The amount must be a whole number of minor units' })
    .optional(),
});

export const fxListQuerySchema = z.object({
  currency: foreignCurrencySchema.optional(),
  source: z.enum(['manual', 'ecb'], { error: 'Pick manual or ECB' }).optional(),
  q: z.string().trim().max(40, { error: 'Search for at most 40 characters' }).optional(),
  from: dateOnlyString.optional(),
  to: dateOnlyString.optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * THE FIELDS EVERY MONEY API BODY CARRIES for the exchange rate, next to `amountMinor`, `currency`
 * and the entry's date. Spread them into the module's own body schema:
 *
 *   z.object({ amountMinor, currency, receivedOn, ...fxPayloadFields })
 *
 * Both are optional. Send neither to use the table rate. `<FxField>` produces them with
 * `fxValueToPayload`. `resolveFx` (src/services/fx.service.ts) does the rest.
 */
export const fxPayloadFields = {
  /** The exact rate the bank applied, INR per 1 unit. Gives `fxSource: 'manual'`. */
  manualRate: rateSchema.optional(),
  /** The INR the bank actually delivered, in paise. Gives `fxSource: 'bank'`, with the rate derived. */
  settledInrMinor: z
    .number({ error: 'Enter the INR amount that arrived' })
    .int({ error: 'Enter the INR amount that arrived' })
    .positive({ error: 'Enter the INR amount that arrived' })
    .optional(),
};

export const fxPayloadSchema = z.object(fxPayloadFields).refine((v) => !(v.manualRate !== undefined && v.settledInrMinor !== undefined), {
  error: 'Give either the exact rate or the INR amount that arrived, not both',
  path: ['manualRate'],
});

export type CreateFxRateInput = z.infer<typeof createFxRateSchema>;
export type UpdateFxRateInput = z.infer<typeof updateFxRateSchema>;
export type FxListQuery = z.infer<typeof fxListQuerySchema>;
export type FxPayload = z.infer<typeof fxPayloadSchema>;

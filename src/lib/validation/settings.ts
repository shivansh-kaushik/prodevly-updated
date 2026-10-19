import { z } from 'zod';
import { BASE_CURRENCY, CURRENCY_CODES } from '@/config/currencies';
import { cleanText, isValidTimeZone, SETTINGS_LIMITS, toCode } from './settings-text';

export { cleanText, isValidTimeZone, SETTINGS_LIMITS, timeZoneOptions, toCode } from './settings-text';

/**
 * Organisation settings, validated once and shared by the form, the route and the service
 * (the service parses again, so a caller that skips the route cannot skip the rules).
 *
 * Lists are CLEANED here, not rejected for being untidy: items are trimmed, blank rows are
 * dropped and duplicates collapse. What is rejected is what cannot be repaired: an item that is
 * too long, a list that is too long, or a list that would end up too short.
 */

/** Raw input is capped before any work is done on it, so a hostile body cannot make a list expensive to clean. */
const RAW_ITEM_MAX = 200;
const RAW_LIST_MAX = 200;

interface CodeListSpec {
  items: number;
  length: number;
  /** Fewest options the list may be left with. */
  min: number;
  noun: string;
}

function codeList({ items, length, min, noun }: CodeListSpec) {
  return z
    .array(z.string({ error: 'Each option must be text' }).max(RAW_ITEM_MAX, { error: `At most ${length} characters` }), { error: 'Send a list' })
    .max(RAW_LIST_MAX, { error: `At most ${items} options` })
    .transform((raw, ctx) => {
      const out: string[] = [];
      const seen = new Set<string>();
      raw.forEach((item, index) => {
        if (item.trim() === '') return; // a blank row is just an empty row
        const code = toCode(item);
        if (!code) {
          ctx.issues.push({ code: 'custom', message: 'Use letters or numbers', input: item, path: [index] });
          return;
        }
        if (code.length > length) {
          ctx.issues.push({ code: 'custom', message: `At most ${length} characters`, input: item, path: [index] });
          return;
        }
        if (seen.has(code)) return;
        seen.add(code);
        out.push(code);
      });
      if (out.length > items) ctx.issues.push({ code: 'custom', message: `At most ${items} options`, input: raw, path: [] });
      if (out.length < min) ctx.issues.push({ code: 'custom', message: `Keep at least ${min === 1 ? `one ${noun}` : `${min} ${noun}s`}`, input: raw, path: [] });
      return out;
    });
}

const budgetRanges = z
  .array(z.string({ error: 'Each range must be text' }).max(RAW_ITEM_MAX, { error: `At most ${SETTINGS_LIMITS.budgetRanges.length} characters` }), { error: 'Send a list' })
  .max(RAW_LIST_MAX, { error: `At most ${SETTINGS_LIMITS.budgetRanges.items} ranges` })
  .transform((raw, ctx) => {
    const out: string[] = [];
    const seen = new Set<string>();
    raw.forEach((item, index) => {
      const text = cleanText(item);
      if (!text) return;
      if (text.length > SETTINGS_LIMITS.budgetRanges.length) {
        ctx.issues.push({ code: 'custom', message: `At most ${SETTINGS_LIMITS.budgetRanges.length} characters`, input: item, path: [index] });
        return;
      }
      const key = text.toLocaleLowerCase('en');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(text);
    });
    if (out.length > SETTINGS_LIMITS.budgetRanges.items) {
      ctx.issues.push({ code: 'custom', message: `At most ${SETTINGS_LIMITS.budgetRanges.items} ranges`, input: raw, path: [] });
    }
    return out;
  });

/** INR is the base currency: every ledger entry stores an INR value, so it can never be switched off. */
const enabledCurrencies = z
  .array(z.string({ error: 'Each currency must be a code such as USD' }).max(10), { error: 'Send a list' })
  .max(CURRENCY_CODES.length * 2)
  .transform((raw, ctx) => {
    const chosen = new Set<string>();
    raw.forEach((item, index) => {
      const code = item.trim().toUpperCase();
      if (!(CURRENCY_CODES as readonly string[]).includes(code)) {
        ctx.issues.push({ code: 'custom', message: `${code || 'That'} is not a supported currency`, input: item, path: [index] });
        return;
      }
      chosen.add(code);
    });
    if (!chosen.has(BASE_CURRENCY)) {
      ctx.issues.push({ code: 'custom', message: `${BASE_CURRENCY} is the base currency and can never be turned off`, input: raw, path: [] });
    }
    // Canonical order, so a re-save with the same set is not a "change".
    return CURRENCY_CODES.filter((c) => chosen.has(c)) as string[];
  });

const integer = (label: string, min: number, max: number) =>
  z
    .number({ error: `${label} must be a whole number` })
    .int({ error: `${label} must be a whole number` })
    .min(min, { error: `${label} must be at least ${min}` })
    .max(max, { error: `${label} must be at most ${max}` });

export const updateSettingsSchema = z
  .object({
    orgName: z
      .string({ error: 'Organisation name is required' })
      .transform(cleanText)
      .pipe(
        z
          .string()
          .min(SETTINGS_LIMITS.orgName.min, { error: 'Organisation name is required' })
          .max(SETTINGS_LIMITS.orgName.max, { error: `At most ${SETTINGS_LIMITS.orgName.max} characters` }),
      ),
    timezone: z
      .string({ error: 'Time zone is required' })
      .trim()
      .max(60, { error: 'That is not a time zone' })
      .refine(isValidTimeZone, { error: 'Enter a time zone such as Asia/Kolkata' }),
    fyStartMonth: integer('The month', 1, 12),
    enabledCurrencies,
    paymentModes: codeList({ ...SETTINGS_LIMITS.paymentModes, min: 1, noun: 'payment mode' }),
    expenseCategories: codeList({ ...SETTINGS_LIMITS.expenseCategories, min: 1, noun: 'expense category' }),
    thirdPartyTypes: codeList({ ...SETTINGS_LIMITS.thirdPartyTypes, min: 1, noun: 'third-party type' }),
    budgetRanges,
    workLogEditWindowDays: integer('The window', SETTINGS_LIMITS.workLogEditWindowDays.min, SETTINGS_LIMITS.workLogEditWindowDays.max),
    fxStaleDays: integer('The number of days', SETTINGS_LIMITS.fxStaleDays.min, SETTINGS_LIMITS.fxStaleDays.max),
  })
  .partial()
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), { error: 'Nothing to update' });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

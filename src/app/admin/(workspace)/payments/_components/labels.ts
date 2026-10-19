import { fxSummary, tableBasis } from '@/components/admin/fx-field-model';
import { formatNative } from '@/components/admin/money';
import { BASE_CURRENCY } from '@/config/currencies';
import { formatInr, humanize } from '@/lib/admin/format';
import type { PaymentDTO } from '@/services/client-payment.dto';

export const TYPE_LABELS = { receipt: 'Receipt', refund: 'Refund' } as const;

/** "bank_transfer" to "Bank transfer": modes are stored as codes and shown as words. */
export const modeLabel = (mode: string): string => humanize(mode);

/** "USD 4,000.00 (INR 3,33,680.00)" per currency, for a secondary line. */
export const nativeList = (rows: ReadonlyArray<{ currency: string; amountMinor: number }>): string =>
  rows.map((r) => formatNative(r.amountMinor, r.currency)).join(', ');

/**
 * The one-line record of how a foreign amount became INR, as it was stored: the amount, the INR value, the
 * rate and where the rate came from. INR needs no conversion and says so.
 */
export function fxCaptureLine(a: PaymentDTO['amount']): string {
  if (a.currency === BASE_CURRENCY) return `Recorded in INR: ${formatInr(a.inrMinor)}. No conversion.`;
  const basis = a.fxSource === 'table' ? tableBasis(a.fxDate) : a.fxSource === 'manual' ? 'exact rate entered by hand' : 'worked out from the INR that arrived';
  return fxSummary({ currency: a.currency, amountMinor: a.amountMinor, inrMinor: a.inrMinor, rate: a.fxRate, basis });
}

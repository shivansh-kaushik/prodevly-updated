import { formatDate } from '@/lib/admin/format';
import { formatMinor } from '@/lib/money/minor';

/** How a pay profile's basis reads, and what its rate is "per". Pay profiles say "monthly"; a payout calls that a salary. */
export const PAY_TERMS_LABELS: Record<string, { label: string; per: string }> = {
  monthly: { label: 'Monthly salary', per: 'per month' },
  hourly: { label: 'Hourly', per: 'per hour' },
  per_task: { label: 'Per task', per: 'per task' },
  none: { label: 'No pay basis', per: '' },
};

export const payTermsText = (t: { basis: string; rateMinor: number; currency: string }): string => {
  const terms = PAY_TERMS_LABELS[t.basis] ?? PAY_TERMS_LABELS.none!;
  return t.basis === 'none' ? terms.label : `${formatMinor(t.rateMinor, t.currency, t.currency === 'INR' ? 'en-IN' : 'en-US')} ${terms.per}`;
};

/** "1 Apr 2026 to 30 Apr 2026". */
export const periodText = (from: string, to: string): string => (from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`);

export const PAYOUT_BASIS_LABELS: Record<string, string> = {
  salary: 'Salary',
  hours: 'Hours worked',
  tasks: 'Tasks completed',
  bonus: 'Bonus',
  other: 'Other',
};

export const basisLabel = (basis: string): string => PAYOUT_BASIS_LABELS[basis] ?? basis;

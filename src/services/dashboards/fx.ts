import type { PipelineStage } from 'mongoose';
import type { Capability } from '@/config/capabilities';
import { BASE_CURRENCY, isCurrencyCode } from '@/config/currencies';
import { unauthorized } from '@/lib/api/errors';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import type { Period } from '@/lib/dates/ranges';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { ClientPayment, Expense, FxRate, TeamPayout, ThirdPartyPayout } from '@/models';
import type { SessionUser } from '@/types/session';
import { loadSettings } from '@/services/settings.service';

export type LedgerKind = 'clientPayment' | 'thirdPartyPayout' | 'expense' | 'teamPayout';

export interface FxCurrencyRow {
  currency: string;
  rate: number | null;
  /** "YYYY-MM-DD" */
  rateOn: string | null;
  source: 'manual' | 'ecb' | null;
  /** Days from the rate's date to today. Null when there is no rate. */
  ageDays: number | null;
  /** `current` is inside the stale allowance, `stale` is older than it, `missing` has never had a rate. */
  status: 'current' | 'stale' | 'missing';
}

export interface FxDashboard {
  /** The organisation's today, "YYYY-MM-DD". */
  today: string;
  staleDays: number;
  /** One row per enabled foreign currency, in the order they are enabled. */
  currencies: FxCurrencyRow[];
  /** Currencies whose rate is stale or missing. */
  stale: string[];
  /**
   * Entries in the period (void and rejected left out) whose INR value used a hand-typed or bank rate.
   * Null when the viewer may see none of the four ledgers: the tile is omitted, never shown as zero.
   * Only the ledgers the viewer may view are counted, and `counted` says which.
   */
  manualOrBank: { total: number; byKind: Array<{ kind: LedgerKind; label: string; count: number }>; counted: LedgerKind[] } | null;
  /** The rate history line for one currency over the period. */
  history: {
    currency: string | null;
    /** Enabled currencies that have at least one rate in the period. */
    available: string[];
    points: Array<{ day: string; rate: number }>;
  };
}

const DAY = 86_400_000;

/** What a viewer needs before the entries of a ledger may be counted for them. */
const LEDGERS: Array<{ kind: LedgerKind; label: string; capability: Capability }> = [
  { kind: 'clientPayment', label: 'Client payments', capability: 'payment:view' },
  { kind: 'thirdPartyPayout', label: 'Third-party payouts', capability: 'payout:view' },
  { kind: 'expense', label: 'Expenses', capability: 'expense:view' },
  { kind: 'teamPayout', label: 'Team payouts', capability: 'team:payView' },
];

const MANUAL_OR_BANK = { $in: ['manual', 'bank'] };

/**
 * The period `$match` for each ledger, from parsed Dates only (aggregation pipelines are not
 * sanitised). The date is the settlement date; a payout still due has no paid date yet, so it falls
 * back to its due date, then to the day its rate was set.
 */
function pipelineFor(kind: LedgerKind, from: Date, to: Date): PipelineStage[] {
  const range = { $gte: from, $lte: to };
  const base = { 'amount.fxSource': MANUAL_OR_BANK };
  switch (kind) {
    case 'clientPayment':
      return [{ $match: { ...base, status: { $ne: 'void' }, receivedOn: range } }, { $count: 'n' }];
    case 'expense':
      return [{ $match: { ...base, status: { $nin: ['void', 'rejected'] }, spentOn: range } }, { $count: 'n' }];
    case 'thirdPartyPayout':
    case 'teamPayout':
      return [
        {
          $match: {
            ...base,
            status: { $ne: 'void' },
            $or: [{ paidOn: range }, { paidOn: null, dueOn: range }, { paidOn: null, dueOn: null, 'amount.fxDate': range }],
          },
        },
        { $count: 'n' },
      ];
  }
}

type Count = Array<{ n: number }>;
const COUNTERS: Record<LedgerKind, (pipeline: PipelineStage[]) => Promise<Count>> = {
  clientPayment: (p) => ClientPayment.aggregate<{ n: number }>(p).exec(),
  thirdPartyPayout: (p) => ThirdPartyPayout.aggregate<{ n: number }>(p).exec(),
  expense: (p) => Expense.aggregate<{ n: number }>(p).exec(),
  teamPayout: (p) => TeamPayout.aggregate<{ n: number }>(p).exec(),
};

/**
 * The FX section's dashboard (plan section 5): the latest rate and its date for every enabled
 * currency, which are stale, how many entries in the period leaned on a manual or bank rate, and the
 * rate history for one currency. Every figure is read from records; an empty database gives empty
 * lists and zeros. Any signed-in admin may read rates; the count of ledger entries is limited to the
 * ledgers the viewer may see.
 */
export async function getFxDashboard(
  viewer: SessionUser,
  period: Pick<Period, 'from' | 'to'>,
  options: { now?: Date; currency?: string } = {},
): Promise<FxDashboard> {
  if (!viewer) throw unauthorized();
  await connectToDatabase();
  const now = options.now ?? new Date();
  const settings = await loadSettings();
  const today = todayDateOnly(now, settings.timezone);
  const enabled = settings.enabledCurrencies.filter((c) => c !== BASE_CURRENCY);

  const visible = LEDGERS.filter((l) => viewer.capabilities.has(l.capability));
  const [latest, counts, inPeriod] = await Promise.all([
    Promise.all(
      enabled.map((currency) =>
        FxRate.findOne({ currency, rateOn: mongoose.trusted({ $lte: today }) })
          .sort({ rateOn: -1 })
          .select('rate rateOn source')
          .lean(),
      ),
    ),
    Promise.all(visible.map((l) => COUNTERS[l.kind](pipelineFor(l.kind, period.from, period.to)))),
    enabled.length === 0
      ? Promise.resolve<string[]>([])
      : FxRate.distinct('currency', { currency: mongoose.trusted({ $in: enabled }), rateOn: mongoose.trusted({ $gte: period.from, $lte: period.to }) }),
  ]);

  const currencies: FxCurrencyRow[] = enabled.map((currency, i) => {
    const row = latest[i];
    if (!row) return { currency, rate: null, rateOn: null, source: null, ageDays: null, status: 'missing' };
    const ageDays = Math.round((today.getTime() - row.rateOn.getTime()) / DAY);
    return { currency, rate: row.rate, rateOn: formatDateOnly(row.rateOn), source: row.source, ageDays, status: ageDays > settings.fxStaleDays ? 'stale' : 'current' };
  });

  const byKind = visible.map((l, i) => ({ kind: l.kind, label: l.label, count: counts[i]?.[0]?.n ?? 0 }));
  const available = enabled.filter((c) => inPeriod.includes(c));
  const wanted = options.currency && isCurrencyCode(options.currency) && enabled.includes(options.currency) ? options.currency : undefined;
  const chosen = wanted ?? available[0] ?? null;
  const points = chosen
    ? (await FxRate.find({ currency: chosen, rateOn: mongoose.trusted({ $gte: period.from, $lte: period.to }) })
        .sort({ rateOn: 1 })
        .select('rate rateOn')
        .limit(4000)
        .lean()).map((r) => ({ day: formatDateOnly(r.rateOn), rate: r.rate }))
    : [];

  return {
    today: formatDateOnly(today),
    staleDays: settings.fxStaleDays,
    currencies,
    stale: currencies.filter((c) => c.status !== 'current').map((c) => c.currency),
    manualOrBank: visible.length === 0 ? null : { total: byKind.reduce((sum, k) => sum + k.count, 0), byKind, counted: visible.map((l) => l.kind) },
    history: { currency: chosen, available, points },
  };
}

'use client';

import { formatNative } from '@/components/admin/money';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/empty-state';
import { formatCount, formatDuration } from '@/lib/admin/format';
import type { PayoutSuggestionDTO } from '@/services/team-payout.service';
import { periodText, payTermsText } from './labels';

export interface SuggestionState {
  data: PayoutSuggestionDTO | null;
  error?: string;
  loading: boolean;
  /** False until a person and a valid period are chosen. */
  enabled: boolean;
}

/**
 * What the pay profile proposes for the chosen person and period, with the facts it is made from, so a superadmin can see
 * why before accepting or changing it. It never fills anything by itself beyond what the form already does: the amount
 * button only appears when the amount in the form is not the proposed one.
 */
export function SuggestionPanel({
  state,
  amountMinor,
  currency,
  onUse,
}: {
  state: SuggestionState;
  /** The amount now in the form (minor units), or null. */
  amountMinor: number | null;
  /** The currency now in the form. */
  currency: string;
  onUse: (amountMinor: number, currency: string) => void;
}) {
  const { data } = state;
  return (
    <section aria-label="What the pay profile proposes" aria-busy={state.loading || undefined} className="rounded-pd-md bg-pd-paper p-4 shadow-[0_0_0_1px_var(--color-pd-rule)]">
      <h3 className="pd-eyebrow">Proposal</h3>
      {!state.enabled ? (
        <p className="mt-1.5 text-[13px] text-pd-ink-3">Pick a person and a period to see what their pay profile proposes.</p>
      ) : state.loading ? (
        <div className="mt-2 flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : state.error ? (
        <p role="alert" className="mt-1.5 text-[13px] font-medium text-pd-amber">{state.error} You can still enter the amount yourself.</p>
      ) : data ? (
        <div className="mt-1.5 flex flex-col gap-3">
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-pd-ink-3">Pay terms</dt>
              <dd className="text-pd-ink">{data.terms ? payTermsText(data.terms) : 'None in force'}</dd>
            </div>
            <div>
              <dt className="text-pd-ink-3">Time logged</dt>
              <dd className="pd-figure text-pd-ink">{data.minutes > 0 ? formatDuration(data.minutes) : 'None'}</dd>
            </div>
            <div>
              <dt className="text-pd-ink-3">Tasks completed</dt>
              <dd className="pd-figure text-pd-ink">{formatCount(data.taskCount)}</dd>
            </div>
          </dl>

          {data.computedMinor !== null && data.terms ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-pd-rule-soft pt-3">
              <p className="text-[13px] text-pd-ink-2">
                Proposed for {periodText(data.periodFrom, data.periodTo)}:{' '}
                <span className="pd-figure font-semibold text-pd-ink">{formatNative(data.computedMinor, data.terms.currency)}</span>
              </p>
              {data.computedMinor > 0 && (amountMinor !== data.computedMinor || currency !== data.terms.currency) ? (
                <Button size="sm" variant="secondary" onClick={() => onUse(data.computedMinor as number, (data.terms as { currency: string }).currency)}>
                  Use this amount
                </Button>
              ) : null}
              {data.computedMinor === 0 ? <p className="text-[13px] text-pd-ink-3">Nothing has been earned in this period yet.</p> : null}
            </div>
          ) : (
            <p className="border-t border-pd-rule-soft pt-3 text-[13px] text-pd-ink-3">No amount is proposed. Enter the amount yourself.</p>
          )}

          {data.warnings.length > 0 ? (
            <ul className="flex flex-col gap-1 text-[13px] leading-5 font-medium text-pd-amber">
              {data.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

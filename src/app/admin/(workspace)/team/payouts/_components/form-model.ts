import { moneyToMinor, minorToInput, type MoneyValue } from '@/components/admin/money-input';
import { fxValueError, fxValueToPayload, type FxValue } from '@/components/admin/fx-field-model';
import { apportion } from '@/lib/money/apportion';
import type { PayoutSuggestionDTO } from '@/services/team-payout.service';
import { rowAmounts, type AllocationRow } from './allocation-editor';

/**
 * The pure half of the payout form: what the proposal turns into, and what is sent. No React, so the rules are tested
 * directly. Nothing computed here is stored: the server rebuilds the amount's INR value and every allocation's share.
 */

/** The proposed split: the amount in the form shared across the projects they logged time on, by minutes. Archived ones are left out. */
export function proposeRows(data: PayoutSuggestionDTO | null, amountMinor: number | null, currency: string): AllocationRow[] {
  if (!data) return [];
  const worked = data.projects.filter((p) => !p.archived && p.minutes > 0);
  if (worked.length === 0) return [];
  const shares = amountMinor && amountMinor > 0 ? apportion(amountMinor, worked.map((p) => p.minutes)) : worked.map(() => 0);
  return worked.map((p, i) => ({
    projectId: p.projectId,
    label: p.projectName,
    ref: p.projectRef,
    minutes: p.minutes,
    amount: shares[i] ? minorToInput(shares[i], currency) : '',
  }));
}

/** How many archived projects hold time in the period: they cannot take a new cost, so they are left out of the proposal. */
export const archivedWithTime = (data: PayoutSuggestionDTO | null): number => (data ? data.projects.filter((p) => p.archived && p.minutes > 0).length : 0);

/** The amount the proposal puts in the form, or the current one when there is nothing to propose. */
export function suggestedMoney(data: PayoutSuggestionDTO | null, current: MoneyValue): MoneyValue {
  if (data && data.terms && data.computedMinor && data.computedMinor > 0) {
    return { amount: minorToInput(data.computedMinor, data.terms.currency), currency: data.terms.currency };
  }
  return current;
}

export interface PayoutDraft {
  personId: string | null;
  basis: string;
  periodFrom: string;
  periodTo: string;
  money: MoneyValue;
  dueOn: string;
  note: string;
  rows: readonly AllocationRow[];
  fx: FxValue;
}

export type PayloadResult = { ok: true; body: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

/**
 * The request body for POST (with `adminId`) or PATCH (without: the person cannot change), or the per-field messages the
 * form shows in place. The server checks every one of these again; this only saves a round trip and says it in the right place.
 */
export function buildPayload(draft: PayoutDraft, mode: 'create' | 'edit'): PayloadResult {
  const errors: Record<string, string> = {};
  if (mode === 'create' && !draft.personId) errors.adminId = 'Pick the person being paid';
  if (!draft.periodFrom) errors.periodFrom = 'Pick the first day';
  if (!draft.periodTo) errors.periodTo = 'Pick the last day';
  if (draft.periodFrom && draft.periodTo && draft.periodTo < draft.periodFrom) errors.periodTo = 'The period cannot end before it starts';
  if (!draft.dueOn) errors.dueOn = 'Pick the due date';

  const amountMinor = moneyToMinor(draft.money);
  if (amountMinor === null) errors.amountMinor = 'Enter the amount, like 50,000.00';

  const fxProblem = draft.money.currency !== 'INR' ? fxValueError(draft.fx) : null;
  if (fxProblem) errors.fxRate = fxProblem;

  const parsed = rowAmounts(draft.rows, draft.money.currency);
  if (parsed.some((a) => a === null)) errors.allocations = 'Fix the amounts in the split first';
  const allocations = draft.rows
    .map((r, i) => ({ projectId: r.projectId, amountMinor: parsed[i] ?? 0 }))
    .filter((a) => a.amountMinor > 0);
  const charged = allocations.reduce((s, a) => s + a.amountMinor, 0);
  if (amountMinor !== null && charged > amountMinor && !errors.allocations) errors.allocations = 'The split is more than the payout. Lower an amount.';

  if (Object.keys(errors).length > 0 || amountMinor === null) return { ok: false, errors };
  return {
    ok: true,
    body: {
      ...(mode === 'create' ? { adminId: draft.personId } : {}),
      basis: draft.basis,
      periodFrom: draft.periodFrom,
      periodTo: draft.periodTo,
      amountMinor,
      currency: draft.money.currency,
      dueOn: draft.dueOn,
      note: draft.note.trim(),
      allocations,
      ...(draft.money.currency !== 'INR' ? fxValueToPayload(draft.fx) : {}),
    },
  };
}

import type { PickerValue } from '@/components/admin/entity-picker';
import { fxValueError, fxValueToPayload, TABLE_FX, type FxValue } from '@/components/admin/fx-field-model';
import type { MoneyValue } from '@/components/admin/money-input';
import { minorToDecimal, parseMinor } from '@/lib/money/minor';
import type { ExpenseDTO } from '@/services/expense.service';

/**
 * The expense form without React: what the person has typed, what is sent to the API, and what changed.
 * The server re-checks everything (and derives the client, the INR value and the payer); these checks only
 * save a round trip and put the message beside the field. Kept pure so it is tested directly.
 */
// Pure on purpose: server pages call `emptyState` and `stateFromExpense`, and a function imported from a 'use client'
// module cannot be called on the server. So nothing here imports a runtime value from a component file.
const toMinor = (m: MoneyValue): number | null => {
  const minor = parseMinor(m.amount, m.currency);
  return minor !== null && minor > 0 ? minor : null;
};

export type PaidFrom = 'company' | 'admin';
export type Scope = 'company' | 'project';

export interface ReceiptItem {
  id: string;
  filename: string;
  size: number | null;
}

// A type alias (not an interface) so it satisfies `useForm`'s Record<string, unknown> constraint.
export type ExpenseFormState = {
  paidFrom: PaidFrom;
  scope: Scope;
  project: PickerValue | null;
  task: PickerValue | null;
  category: string;
  description: string;
  payee: string;
  money: MoneyValue;
  /** "YYYY-MM-DD" */
  spentOn: string;
  fx: FxValue;
  paidOn: string;
  mode: string;
  transactionRef: string;
  receipts: ReceiptItem[];
};

export type Built = { ok: true; body: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

/** The blank form. `paidFrom` is who is paying; `today` and `currency` seed the date and the money. */
export function emptyState(o: { paidFrom: PaidFrom; today: string; currency: string; project?: PickerValue | null }): ExpenseFormState {
  return {
    paidFrom: o.paidFrom,
    scope: o.project ? 'project' : 'company',
    project: o.project ?? null,
    task: null,
    category: '',
    description: '',
    payee: '',
    money: { amount: '', currency: o.currency },
    spentOn: o.today,
    fx: TABLE_FX,
    paidOn: o.today,
    mode: '',
    transactionRef: '',
    receipts: [],
  };
}

/** The form as it stands for an expense that already exists (the edit page). */
export function stateFromExpense(e: ExpenseDTO): ExpenseFormState {
  const fx: FxValue =
    e.fx.source === 'manual'
      ? { choice: 'manual', manualRate: String(e.fx.rate), settledInr: '' }
      : e.fx.source === 'bank'
        ? { choice: 'bank', manualRate: '', settledInr: minorToDecimal(e.amount.inrMinor, 'INR') }
        : TABLE_FX;
  return {
    paidFrom: e.paidFrom,
    scope: e.scope,
    project: e.project ? { id: e.project.id, label: e.project.name, ref: e.project.ref } : null,
    task: e.task ? { id: e.task.id, label: e.task.title, ref: e.task.ref } : null,
    category: e.category,
    description: e.description,
    payee: e.payee ?? '',
    money: { amount: minorToDecimal(e.amount.amountMinor, e.amount.currency), currency: e.amount.currency },
    spentOn: e.spentOn,
    fx,
    paidOn: e.paidOn ?? '',
    mode: e.mode ?? '',
    transactionRef: e.transactionRef ?? '',
    receipts: e.receipts.map((r) => ({ id: r.id, filename: r.filename, size: r.size })),
  };
}

/** Problems with the fields every expense has. Keys are the API's field names, so server and form messages meet in the same place. */
function commonErrors(s: ExpenseFormState): { errors: Record<string, string>; amountMinor: number | null } {
  const errors: Record<string, string> = {};
  if (s.description.trim().length < 2) errors.description = 'Say what this was for';
  if (!s.category) errors.category = 'Pick a category';
  const amountMinor = toMinor(s.money);
  if (amountMinor === null) errors.amountMinor = 'Enter an amount above zero, for example 1,250.50';
  if (!s.spentOn) errors.spentOn = 'Pick the date it was spent';
  const fx = fxValueError(s.fx);
  if (fx && s.money.currency !== 'INR') errors[s.fx.choice === 'bank' ? 'settledInrMinor' : 'fxRate'] = fx;
  if (s.scope === 'project' && !s.project) errors.projectId = 'Pick the project this was spent on';
  return { errors, amountMinor };
}

const fxPayload = (s: ExpenseFormState) => (s.money.currency === 'INR' ? {} : fxValueToPayload(s.fx));

/** The body of POST /api/admin/expenses, or the messages to show. */
export function buildCreateBody(s: ExpenseFormState): Built {
  const { errors, amountMinor } = commonErrors(s);
  const company = s.paidFrom === 'company';
  if (company && !s.paidOn) errors.paidOn = 'Enter the date it was paid';
  if (company && !s.mode) errors.mode = 'Pick how it was paid';
  if (Object.keys(errors).length > 0 || amountMinor === null) return { ok: false, errors };
  return {
    ok: true,
    body: {
      scope: s.scope,
      ...(s.scope === 'project' && s.project ? { projectId: s.project.id, ...(s.task ? { taskId: s.task.id } : {}) } : {}),
      category: s.category,
      description: s.description.trim(),
      ...(s.payee.trim() ? { payee: s.payee.trim() } : {}),
      amountMinor,
      currency: s.money.currency,
      spentOn: s.spentOn,
      ...fxPayload(s),
      paidFrom: s.paidFrom,
      ...(company ? { paidOn: s.paidOn, mode: s.mode, ...(s.transactionRef.trim() ? { transactionRef: s.transactionRef.trim() } : {}) } : {}),
      receiptMediaIds: s.receipts.map((r) => r.id),
    },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The body of PATCH /api/admin/expenses/[id]: only what changed. `body` is null when nothing did. Money fields travel
 * together (amount, currency, date and the rate choice) because changing any of them re-resolves the rate; the receipts
 * the person could not see (`hiddenReceiptIds`) are kept.
 */
export function buildPatchBody(initial: ExpenseFormState, s: ExpenseFormState, o: { paid: boolean; hiddenReceiptIds: readonly string[] }): Built | { ok: true; body: null } {
  const { errors, amountMinor } = commonErrors(s);
  if (o.paid) {
    if (!s.paidOn) errors.paidOn = 'Enter the date it was paid';
    if (!s.mode) errors.mode = 'Pick how it was paid';
  }
  if (Object.keys(errors).length > 0 || amountMinor === null) return { ok: false, errors };

  const body: Record<string, unknown> = {};
  if (s.category !== initial.category) body.category = s.category;
  if (s.description.trim() !== initial.description) body.description = s.description.trim();
  if (s.payee.trim() !== initial.payee) body.payee = s.payee.trim() || null;

  if (s.scope !== initial.scope || s.project?.id !== initial.project?.id || s.task?.id !== initial.task?.id) {
    body.scope = s.scope;
    if (s.scope === 'project' && s.project) {
      body.projectId = s.project.id;
      body.taskId = s.task?.id ?? null;
    }
  }

  const moneyChanged =
    amountMinor !== toMinor(initial.money) || s.money.currency !== initial.money.currency || s.spentOn !== initial.spentOn || !same(s.fx, initial.fx);
  if (moneyChanged) Object.assign(body, { amountMinor, currency: s.money.currency, spentOn: s.spentOn, ...fxPayload(s) });

  if (o.paid) {
    if (s.paidOn !== initial.paidOn) body.paidOn = s.paidOn;
    if (s.mode !== initial.mode) body.mode = s.mode;
    if (s.transactionRef.trim() !== initial.transactionRef) body.transactionRef = s.transactionRef.trim() || null;
  }

  if (!same(s.receipts.map((r) => r.id), initial.receipts.map((r) => r.id))) {
    body.receiptMediaIds = [...o.hiddenReceiptIds, ...s.receipts.map((r) => r.id)];
  }
  return { ok: true, body: Object.keys(body).length > 0 ? body : null };
}

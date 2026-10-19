import { fxValueError, fxValueToPayload, TABLE_FX, type FxValue } from '@/components/admin/fx-field-model';
import { moneyToMinor } from '@/components/admin/money-input';
import { BASE_CURRENCY } from '@/config/currencies';
import { minorToDecimal, parseMinor } from '@/lib/money/minor';
import type { PaymentDTO } from '@/services/client-payment.dto';

/**
 * The pure half of the payment form: what the person typed, and the request body it becomes. No React and
 * no network, so the rules (what is sent, what is left out, which text is a real amount) are tested directly.
 *
 * The browser never sends an INR value: it sends the amount, the currency and (only if the person chose to)
 * the exact rate or the INR that arrived. The server converts.
 */
export interface PaymentFormState {
  type: 'receipt' | 'refund';
  /** Decimal text in `currency`, as typed ("1,250.50"). */
  amount: string;
  currency: string;
  /** "YYYY-MM-DD" */
  receivedOn: string;
  mode: string;
  transactionRef: string;
  invoiceRef: string;
  note: string;
  /** Decimal text in `currency`; empty means none. */
  tds: string;
  charges: string;
  /** Decimal text in the project's contract currency; empty means "work it out from the rates". */
  contractEq: string;
  advance: boolean;
  projectId: string | null;
  taskId: string | null;
  /** '' means no milestone. */
  milestoneId: string;
  fx: FxValue;
  attachmentIds: string[];
}

export interface FormContext {
  /** Null until the project's context has loaded. */
  contractCurrency: string | null;
}

export type Built = { ok: true; body: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

const AMOUNT_HINT = 'Enter an amount such as 1,250.50';

/** The FxValue that reproduces how an entry was settled, so the field shows what was stored. */
export function fxFromPayment(amount: PaymentDTO['amount']): FxValue {
  if (amount.fxSource === 'manual') return { choice: 'manual', manualRate: String(amount.fxRate), settledInr: '' };
  if (amount.fxSource === 'bank') return { choice: 'bank', manualRate: '', settledInr: minorToDecimal(amount.inrMinor, BASE_CURRENCY) };
  return { ...TABLE_FX };
}

export function stateFromPayment(p: PaymentDTO): PaymentFormState {
  const cur = p.amount.currency;
  return {
    type: p.type,
    amount: minorToDecimal(p.amount.amountMinor, cur),
    currency: cur,
    receivedOn: p.receivedOn,
    mode: p.mode,
    transactionRef: p.transactionRef ?? '',
    invoiceRef: p.invoiceRef ?? '',
    note: p.note ?? '',
    tds: p.tdsMinor ? minorToDecimal(p.tdsMinor, cur) : '',
    charges: p.chargesMinor ? minorToDecimal(p.chargesMinor, cur) : '',
    contractEq: cur !== p.contractCurrency ? minorToDecimal(p.contractEquivalentMinor, p.contractCurrency) : '',
    advance: false,
    projectId: p.project.id,
    taskId: p.task?.id ?? null,
    milestoneId: p.milestone?.id ?? '',
    fx: fxFromPayment(p.amount),
    attachmentIds: [...p.attachmentMediaIds],
  };
}

/** Text to minor units; '' is "none" (undefined), and anything that is not an amount is an error. */
function side(text: string, currency: string, field: string, errors: Record<string, string>): number | undefined | null {
  const t = text.trim();
  if (t === '') return undefined;
  const minor = parseMinor(t, currency);
  if (minor === null) {
    errors[field] = AMOUNT_HINT;
    return null;
  }
  return minor;
}

interface Parsed {
  errors: Record<string, string>;
  amountMinor: number | null;
  tdsMinor: number | undefined | null;
  chargesMinor: number | undefined | null;
  contractEquivalentMinor: number | undefined | null;
}

function parse(state: PaymentFormState, ctx: FormContext): Parsed {
  const errors: Record<string, string> = {};
  const amountMinor = moneyToMinor({ amount: state.amount, currency: state.currency });
  if (amountMinor === null) errors.amountMinor = state.amount.trim() === '' ? 'Enter the amount' : AMOUNT_HINT;
  if (!state.receivedOn) errors.receivedOn = 'Pick the date it was received';
  if (!state.mode) errors.mode = 'Pick how it was paid';
  const tdsMinor = side(state.tds, state.currency, 'tdsMinor', errors);
  const chargesMinor = side(state.charges, state.currency, 'chargesMinor', errors);
  let contractEquivalentMinor: number | undefined | null = undefined;
  if (state.contractEq.trim() !== '') {
    if (!ctx.contractCurrency || ctx.contractCurrency === state.currency) contractEquivalentMinor = undefined;
    else {
      contractEquivalentMinor = parseMinor(state.contractEq.trim(), ctx.contractCurrency);
      if (contractEquivalentMinor === null || contractEquivalentMinor < 1) {
        errors.contractEquivalentMinor = AMOUNT_HINT;
        contractEquivalentMinor = null;
      }
    }
  }
  if (state.currency !== BASE_CURRENCY) {
    const problem = fxValueError(state.fx);
    if (problem) errors[state.fx.choice === 'bank' ? 'settledInrMinor' : 'fxRate'] = problem;
  }
  return { errors, amountMinor, tdsMinor, chargesMinor, contractEquivalentMinor };
}

/** The body of POST /api/admin/payments, or the errors to show in place. Empty optional fields are left out. */
export function buildCreateBody(state: PaymentFormState, ctx: FormContext): Built {
  const p = parse(state, ctx);
  if (!state.projectId) p.errors.projectId = 'Pick the project this payment is for';
  if (Object.keys(p.errors).length > 0 || p.amountMinor === null) return { ok: false, errors: p.errors };
  const body: Record<string, unknown> = {
    type: state.type,
    projectId: state.projectId,
    amountMinor: p.amountMinor,
    currency: state.currency,
    receivedOn: state.receivedOn,
    mode: state.mode,
    attachmentMediaIds: state.attachmentIds,
  };
  if (state.currency !== BASE_CURRENCY) Object.assign(body, fxValueToPayload(state.fx));
  if (state.taskId) body.taskId = state.taskId;
  if (state.milestoneId) body.milestoneId = state.milestoneId;
  if (p.contractEquivalentMinor) body.contractEquivalentMinor = p.contractEquivalentMinor;
  if (p.tdsMinor) body.tdsMinor = p.tdsMinor;
  if (p.chargesMinor) body.chargesMinor = p.chargesMinor;
  for (const field of ['transactionRef', 'invoiceRef', 'note'] as const) if (state[field].trim()) body[field] = state[field].trim();
  if (state.advance) body.recordAsAdvance = true;
  return { ok: true, body };
}

const sameFx = (a: FxValue, b: FxValue) => a.choice === b.choice && a.manualRate.trim() === b.manualRate.trim() && a.settledInr.trim() === b.settledInr.trim();
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The body of PATCH /api/admin/payments/[id]: only what changed. An empty object means nothing changed.
 * Changing the amount, currency or date recomputes the INR value on the server; the rate to use is sent
 * whenever it was typed by hand or taken from the bank, and "use the table rate" only when the person
 * switched back to it.
 */
export function buildEditBody(state: PaymentFormState, initial: PaymentFormState, ctx: FormContext): Built {
  const p = parse(state, ctx);
  if (Object.keys(p.errors).length > 0 || p.amountMinor === null) return { ok: false, errors: p.errors };

  const body: Record<string, unknown> = {};
  const moneyChanged = state.amount !== initial.amount || state.currency !== initial.currency || state.receivedOn !== initial.receivedOn;
  const initialMinor = parseMinor(initial.amount, initial.currency);
  if (p.amountMinor !== initialMinor || state.currency !== initial.currency) body.amountMinor = p.amountMinor;
  if (state.currency !== initial.currency) body.currency = state.currency;
  if (state.receivedOn !== initial.receivedOn) body.receivedOn = state.receivedOn;

  if (state.currency !== BASE_CURRENCY) {
    const fxChanged = !sameFx(state.fx, initial.fx) || state.currency !== initial.currency;
    if (state.fx.choice === 'table') {
      if (initial.fx.choice !== 'table' && state.currency === initial.currency) body.useTableRate = true;
    } else if (moneyChanged || fxChanged) {
      Object.assign(body, fxValueToPayload(state.fx));
    }
  }
  if (state.contractEq.trim() !== initial.contractEq.trim() && p.contractEquivalentMinor) body.contractEquivalentMinor = p.contractEquivalentMinor;

  const sideChanged = (key: 'tds' | 'charges', minor: number | undefined | null, field: 'tdsMinor' | 'chargesMinor') => {
    const text = state[key].trim();
    // The same text in another currency is a different amount in minor units, so it is sent again.
    if (text === initial[key].trim() && (text === '' || state.currency === initial.currency)) return;
    body[field] = minor ?? null;
  };
  sideChanged('tds', p.tdsMinor, 'tdsMinor');
  sideChanged('charges', p.chargesMinor, 'chargesMinor');

  if (state.mode !== initial.mode) body.mode = state.mode;
  for (const field of ['transactionRef', 'invoiceRef', 'note'] as const) {
    if (state[field].trim() !== initial[field].trim()) body[field] = state[field].trim() || null;
  }
  if (state.taskId !== initial.taskId) body.taskId = state.taskId;
  if (state.milestoneId !== initial.milestoneId) body.milestoneId = state.milestoneId || null;
  if (!sameList(state.attachmentIds, initial.attachmentIds)) body.attachmentMediaIds = state.attachmentIds;
  if (state.advance && Object.keys(body).length > 0) body.recordAsAdvance = true;
  return { ok: true, body };
}

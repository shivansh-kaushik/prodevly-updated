import { fxSummary } from '@/components/admin/fx-field-model';
import { formatDate } from '@/lib/admin/format';
import type { ThirdPartyDTO } from '@/services/third-party.service';
import type { PayoutDTO } from '@/services/third-party-payout.service';
import type { WorkOrderDTO } from '@/services/work-order.service';
import type { PayoutFormInitial } from './payout-form';
import type { ThirdPartyFormInitial } from './third-party-form';
import type { WorkOrderFormInitial } from './work-order-form';

/** Plain DTOs in, the shape each edit form starts from out. Pure, so a page can build them on the server. */

export function thirdPartyFormInitial(t: ThirdPartyDTO): ThirdPartyFormInitial {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    skills: t.skills,
    contactName: t.contactName ?? '',
    email: t.email ?? '',
    phone: t.phone ?? '',
    country: t.country ?? '',
    defaultCurrency: t.defaultCurrency ?? '',
    gstin: t.gstin ?? '',
    notes: t.notes ?? '',
    status: t.status,
    paymentNote: t.payDetails?.note ?? '',
  };
}

export function workOrderFormInitial(w: WorkOrderDTO, hasPayouts: boolean): WorkOrderFormInitial {
  return {
    id: w.id,
    title: w.title,
    scope: w.scope ?? '',
    amountMinor: w.agreed.amountMinor,
    currency: w.agreed.currency,
    dueOn: w.dueOn ?? '',
    projectId: w.projectId,
    task: w.taskId ? { id: w.taskId, label: w.taskTitle ?? 'Task', ref: w.taskRef ?? undefined } : null,
    hasPayouts,
  };
}

/** "1 USD = INR 83 (table, 3 Oct 2026)": the rate captured on the payout, for a person to judge. */
export function captureText(p: Pick<PayoutDTO, 'amount'>): string {
  const { currency, fxRate, fxSource, fxDate } = p.amount;
  return fxSummary({ currency, amountMinor: null, inrMinor: null, rate: fxRate, basis: `${fxSource === 'identity' ? 'INR' : fxSource}, ${formatDate(fxDate)}` });
}

export function payoutFormInitial(p: PayoutDTO): PayoutFormInitial {
  return {
    id: p.id,
    amountMinor: p.amount.amountMinor,
    currency: p.amount.currency,
    dueOn: p.dueOn ?? '',
    tdsMinor: p.tdsMinor,
    note: p.note ?? '',
    thirdPartyName: p.thirdPartyName,
    projectName: p.projectName,
    workOrder: p.workOrderId ? { id: p.workOrderId, ref: p.workOrderRef ?? '', title: p.workOrderTitle ?? '' } : null,
    projectId: p.projectId,
    task: p.taskId ? { id: p.taskId, label: p.taskTitle ?? 'Task', ref: p.taskRef ?? undefined } : null,
    attachments: p.attachments.map((a) => ({ id: a.id, filename: a.filename, url: a.url, size: a.size })),
    capture: captureText(p),
  };
}

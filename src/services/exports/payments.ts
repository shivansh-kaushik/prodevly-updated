import { getPeriod } from '@/lib/admin/period';
import { parseListParams } from '@/lib/admin/search-params';
import { assertCapability } from '@/lib/auth/guard';
import { PAYMENT_SORT_KEYS, parsePaymentFilters, type PaymentSortKey } from '@/lib/validation/payment';
import { searchPayments } from '@/services/client-payment.service';
import { amount, describePeriod, filterLines, inr, words, yesNo } from './format';
import { gather } from './gather';
import type { ExportSection } from './types';

/**
 * Money received from clients, with the same filters, period and sort as /admin/payments. The payment's note
 * is deliberately not a column: notes are free text that can carry bank details.
 */
export const paymentsExport: ExportSection = {
  id: 'payments',
  noun: 'client payments',
  assertAccess: (viewer) => assertCapability(viewer, 'payment:view'),
  async build({ viewer, sp, cap }) {
    const period = await getPeriod(sp);
    const sorting = parseListParams(sp, { sortable: PAYMENT_SORT_KEYS, defaultSort: 'receivedOn', defaultDir: 'desc' });
    const filters = parsePaymentFilters(sp);

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await searchPayments(viewer, { ...filters, from: period.from, to: period.to, sort: sorting.sort as PaymentSortKey, dir: sorting.dir, page, pageSize });
      return { items: result.items, total: result.meta.total };
    });

    return {
      header: [
        'Reference', 'Received on', 'Type', 'Status', 'Client', 'Project reference', 'Project', 'Task reference', 'Milestone', 'Amount', 'Currency', 'Exchange rate to INR', 'Amount (INR)',
        'TDS', 'Bank charges', 'Mode', 'Transaction reference', 'Invoice reference', 'Recorded as advance', 'Void reason', 'Recorded by',
      ],
      rows: items.map((p) => [
        p.ref,
        p.receivedOn,
        words(p.type),
        words(p.status),
        p.client.name,
        p.project.ref,
        p.project.name,
        p.task?.ref,
        p.milestone?.title,
        amount(p.amount.amountMinor, p.amount.currency),
        p.amount.currency,
        p.amount.fxRate,
        inr(p.amount.inrMinor),
        amount(p.tdsMinor, p.amount.currency),
        amount(p.chargesMinor, p.amount.currency),
        words(p.mode),
        p.transactionRef,
        p.invoiceRef,
        yesNo(p.recordedAsAdvance),
        p.voidReason,
        p.recordedBy,
      ]),
      total,
      truncated,
      filters: [
        ...filterLines([['search', filters.q], ['client', filters.clientId], ['project', filters.projectId], ['status', filters.status], ['type', filters.type], ['mode', filters.mode], ['currency', filters.currency], ['sort', `${sorting.sort} ${sorting.dir}`]]),
        describePeriod(period),
      ],
    };
  },
};

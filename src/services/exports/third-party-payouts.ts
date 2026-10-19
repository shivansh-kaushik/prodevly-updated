import { parseListParams } from '@/lib/admin/search-params';
import { assertCapability } from '@/lib/auth/guard';
import { PAYOUT_SORTS, parsePayoutFilter, type PayoutSort } from '@/lib/validation/third-party-payout';
import { searchPayouts } from '@/services/third-party-payout.service';
import { amount, filterLines, inr, words, yesNo } from './format';
import { gather } from './gather';
import type { ExportSection } from './types';

/**
 * What we owe and have paid third parties, with the same filters and sort as /admin/third-parties/payouts.
 * The payout note (payment details) is never a column; that is for the person with thirdParty:payDetails to read on screen.
 */
export const thirdPartyPayoutsExport: ExportSection = {
  id: 'third-party-payouts',
  noun: 'third-party payouts',
  assertAccess: (viewer) => assertCapability(viewer, 'payout:view'),
  async build({ viewer, sp, cap }) {
    const sorting = parseListParams(sp, { sortable: PAYOUT_SORTS, defaultSort: 'createdAt', defaultDir: 'desc' });
    const filter = parsePayoutFilter(sp);

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await searchPayouts(viewer, { ...filter, sort: sorting.sort as PayoutSort, dir: sorting.dir, page, pageSize });
      return { items: result.items, total: result.meta.total };
    });

    return {
      header: [
        'Reference', 'Third party', 'Work order reference', 'Client', 'Project reference', 'Project', 'Task reference', 'Amount', 'Currency', 'Exchange rate to INR', 'Amount (INR)', 'TDS',
        'Status', 'Due on', 'Paid on', 'Overdue', 'Mode', 'Transaction reference', 'Void reason',
      ],
      rows: items.map((p) => [
        p.ref,
        p.thirdPartyName,
        p.workOrderRef,
        p.clientName,
        p.projectRef,
        p.projectName,
        p.taskRef,
        amount(p.amount.amountMinor, p.amount.currency),
        p.amount.currency,
        p.amount.fxRate,
        inr(p.amount.inrMinor),
        amount(p.tdsMinor, p.amount.currency),
        words(p.status),
        p.dueOn,
        p.paidOn,
        yesNo(p.overdue),
        words(p.mode),
        p.transactionRef,
        p.voidReason,
      ]),
      total,
      truncated,
      filters: filterLines([
        ['search', filter.q], ['status', filter.status], ['overdue', filter.overdue], ['third party', filter.thirdPartyId], ['work order', filter.workOrderId], ['project', filter.projectId], ['client', filter.clientId],
        ['sort', `${sorting.sort} ${sorting.dir}`],
      ]),
    };
  },
};

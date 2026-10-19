import { getPeriod } from '@/lib/admin/period';
import { parseListParams } from '@/lib/admin/search-params';
import { assertCapability } from '@/lib/auth/guard';
import { PAYOUT_SORTS, parsePayoutFilter } from '@/lib/validation/team-payout';
import { searchTeamPayouts, type PayoutSort } from '@/services/team-payout.service';
import { amount, describePeriod, filterLines, inr, list, words } from './format';
import { gather } from './gather';
import type { ExportSection } from './types';

/**
 * Payouts to team members, with the same filters, period and sort as /admin/team/payouts (team:payView). The payout note and the
 * suggestion snapshot are not columns: they sit next to pay profile data, which is for the screen, not a file.
 */
export const teamPayoutsExport: ExportSection = {
  id: 'team-payouts',
  noun: 'team payouts',
  assertAccess: (viewer) => assertCapability(viewer, 'team:payView'),
  async build({ viewer, sp, cap }) {
    const period = await getPeriod(sp);
    const sorting = parseListParams(sp, { sortable: PAYOUT_SORTS, defaultSort: 'createdAt', defaultDir: 'desc' });
    const filter = parsePayoutFilter(sp);

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await searchTeamPayouts(viewer, { ...filter, from: period.from, to: period.to, page, pageSize, sort: sorting.sort as PayoutSort, dir: sorting.dir });
      return { items: result.items, total: result.meta.total };
    });

    return {
      header: [
        'Reference', 'Person', 'Basis', 'Period from', 'Period to', 'Amount', 'Currency', 'Exchange rate to INR', 'Amount (INR)', 'Status', 'Due on', 'Paid on', 'Mode', 'Transaction reference',
        'Charged to projects', 'Allocated to projects (INR)', 'Company overhead (INR)',
      ],
      rows: items.map((p) => [
        p.ref,
        p.adminName,
        words(p.basis),
        p.periodFrom,
        p.periodTo,
        amount(p.amount.amountMinor, p.amount.currency),
        p.amount.currency,
        p.amount.fxRate,
        inr(p.amount.inrMinor),
        words(p.status),
        p.dueOn,
        p.paidOn,
        words(p.mode),
        p.transactionRef,
        p.detail ? list(p.detail.allocations.map((a) => a.projectRef || a.projectName)) : null,
        p.detail ? inr(p.detail.allocatedInrMinor) : null,
        p.detail ? inr(p.detail.unallocatedInrMinor) : null,
      ]),
      total,
      truncated,
      filters: [...filterLines([['person', filter.adminId], ['status', filter.status], ['search', filter.q], ['sort', `${sorting.sort} ${sorting.dir}`]]), describePeriod(period)],
    };
  },
};

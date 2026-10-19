import { parseListParams } from '@/lib/admin/search-params';
import { assertCapability } from '@/lib/auth/guard';
import { parseWorkOrderFilter, WORK_ORDER_SORTS, type WorkOrderSort } from '@/lib/validation/work-order';
import { searchWorkOrders } from '@/services/work-order.service';
import { amount, dayIn, filterLines, words, yesNo } from './format';
import { gather } from './gather';
import type { ExportSection } from './types';

/**
 * What we agreed to pay third parties, with the same filters and sort as /admin/third-parties/work-orders.
 * Amounts are in the work order's own currency (a work order carries no INR figure; payouts do).
 */
export const workOrdersExport: ExportSection = {
  id: 'work-orders',
  noun: 'work orders',
  assertAccess: (viewer) => assertCapability(viewer, 'payout:view'),
  async build({ viewer, sp, cap, timeZone }) {
    const sorting = parseListParams(sp, { sortable: WORK_ORDER_SORTS, defaultSort: 'updatedAt', defaultDir: 'desc' });
    const filter = parseWorkOrderFilter(sp);

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await searchWorkOrders(viewer, { ...filter, sort: sorting.sort as WorkOrderSort, dir: sorting.dir, page, pageSize });
      return { items: result.items, total: result.meta.total };
    });

    return {
      header: [
        'Reference', 'Title', 'Third party', 'Client', 'Project reference', 'Project', 'Task reference', 'Currency', 'Agreed amount', 'Paid', 'Due to pay', 'Balance to record', 'Due on', 'Overdue', 'Status', 'Updated on',
      ],
      rows: items.map((w) => [
        w.ref,
        w.title,
        w.thirdPartyName,
        w.clientName,
        w.projectRef,
        w.projectName,
        w.taskRef,
        w.agreed.currency,
        amount(w.agreed.amountMinor, w.agreed.currency),
        amount(w.paidMinor, w.agreed.currency),
        amount(w.dueMinor, w.agreed.currency),
        amount(w.balanceMinor, w.agreed.currency),
        w.dueOn,
        yesNo(w.overdue),
        words(w.status),
        dayIn(w.updatedAt, timeZone),
      ]),
      total,
      truncated,
      filters: filterLines([['search', filter.q], ['status', filter.status], ['third party', filter.thirdPartyId], ['project', filter.projectId], ['client', filter.clientId], ['sort', `${sorting.sort} ${sorting.dir}`]]),
    };
  },
};

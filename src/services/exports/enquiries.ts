import { LEAD_STATUSES } from '@/config/statuses';
import { getPeriod } from '@/lib/admin/period';
import { first, objectIdParam, oneOf, parseListParams } from '@/lib/admin/search-params';
import { assertCapability } from '@/lib/auth/guard';
import { parseSourceFilter } from '@/lib/validation/lead';
import { LEAD_SORT_KEYS, searchLeads } from '@/services/lead.service';
import { dayIn, describePeriod, filterLines, list, words } from './format';
import { gather } from './gather';
import type { ExportSection } from './types';

/**
 * Contact-form enquiries, with the same filters, period and sort as /admin/enquiries. The visitor's address hash, user agent and
 * message hash never reach a list item, so they cannot reach a file. The message is untrusted visitor text: the CSV layer
 * neutralises it like every other text cell.
 */
export const enquiriesExport: ExportSection = {
  id: 'enquiries',
  noun: 'enquiries',
  assertAccess: (viewer) => assertCapability(viewer, 'lead:view'),
  async build({ viewer, sp, cap, timeZone }) {
    const sorting = parseListParams(sp, { sortable: LEAD_SORT_KEYS, defaultSort: 'createdAt', defaultDir: 'desc' });
    const status = oneOf(sp, 'status', [...LEAD_STATUSES, 'open']);
    const assignee = oneOf(sp, 'assignee', ['me', 'unassigned']) ?? objectIdParam(sp, 'assignee');
    const followUp = oneOf(sp, 'followUp', ['due']);
    const source = parseSourceFilter(first(sp, 'source'));
    const period = await getPeriod(sp);
    const now = new Date();

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await searchLeads(viewer, { q: sorting.q, status, assignee, followUp, source, period, sort: sorting.sort as (typeof LEAD_SORT_KEYS)[number], dir: sorting.dir, page, pageSize, now });
      return { items: result.items, total: result.meta.total };
    });

    return {
      header: ['Reference', 'Received on', 'Name', 'Email', 'Company', 'Services', 'Status', 'Assigned to', 'Follow up on', 'First reply on', 'Message (first 140 characters)'],
      rows: items.map((l) => [
        l.ref,
        dayIn(l.createdAt, timeZone),
        l.name,
        l.email,
        l.company,
        list(l.services),
        words(l.status),
        l.assignedTo?.name,
        l.followUpOn,
        dayIn(l.firstResponseAt, timeZone),
        l.excerpt,
      ]),
      total,
      truncated,
      filters: [
        ...filterLines([['search', sorting.q], ['status', status], ['assignee', assignee], ['follow-up', followUp], ['source', source ? `${source.kind}:${source.value}` : undefined], ['sort', `${sorting.sort} ${sorting.dir}`]]),
        // A follow-up queue ignores the period, as it does on the page.
        ...(followUp === 'due' ? [] : [describePeriod(period)]),
      ],
    };
  },
};

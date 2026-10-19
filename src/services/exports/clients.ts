import { CLIENT_KINDS, CLIENT_STATUSES } from '@/config/statuses';
import { dayIn, filterLines, regionName, words, yesNo } from './format';
import { first, oneOf, parseListParams } from '@/lib/admin/search-params';
import { assertCapability } from '@/lib/auth/guard';
import { CLIENT_SORTS, listClients } from '@/services/client.service';
import { gather } from './gather';
import type { ExportSection } from './types';

/** The Clients list, with the same filters and sort as /admin/clients. */
export const clientsExport: ExportSection = {
  id: 'clients',
  noun: 'clients',
  assertAccess: (viewer) => assertCapability(viewer, 'client:view'),
  async build({ viewer, sp, cap, timeZone }) {
    const list = parseListParams(sp, { sortable: CLIENT_SORTS, defaultSort: 'updatedAt', defaultDir: 'desc' });
    const status = oneOf(sp, 'status', CLIENT_STATUSES);
    const kind = oneOf(sp, 'kind', CLIENT_KINDS);
    const archived = oneOf(sp, 'archived', ['only', 'include'] as const);
    const country = first(sp, 'country')?.toUpperCase();

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await listClients(viewer, { q: list.q, status, kind, country, archived, sort: list.sort as (typeof CLIENT_SORTS)[number], dir: list.dir, page, pageSize });
      return { items: result.items, total: result.meta.total };
    });

    return {
      header: ['Reference', 'Name', 'Kind', 'Status', 'Country', 'Billing currency', 'Primary contact', 'Contact email', 'Account owner', 'Projects', 'Archived', 'Updated on'],
      rows: items.map((c) => [
        c.ref,
        c.name,
        words(c.kind),
        words(c.status),
        regionName(c.country),
        c.billingCurrency,
        c.primaryContact?.name,
        c.primaryContact?.email,
        c.accountOwner,
        c.projectCount,
        yesNo(c.archived),
        dayIn(c.updatedAt, timeZone),
      ]),
      total,
      truncated,
      filters: filterLines([['search', list.q], ['status', status], ['kind', kind], ['country', country], ['archived', archived], ['sort', `${list.sort} ${list.dir}`]]),
    };
  },
};

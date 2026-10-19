import { PROJECT_HEALTH, PROJECT_STATUSES, PROJECT_TYPES } from '@/config/statuses';
import { objectIdParam, oneOf, parseListParams } from '@/lib/admin/search-params';
import { assertCapability } from '@/lib/auth/guard';
import { amount, dayIn, filterLines, words, yesNo } from './format';
import { listProjects, PROJECT_SORTS } from '@/services/project.service';
import { gather } from './gather';
import type { ExportSection } from './types';

/**
 * The Projects list, with the same filters and sort as /admin/projects. The contract columns belong to
 * viewers who may see money (payment:view), exactly like the list's own contract figure.
 */
export const projectsExport: ExportSection = {
  id: 'projects',
  noun: 'projects',
  assertAccess: (viewer) => assertCapability(viewer, 'project:view'),
  async build({ viewer, sp, cap, timeZone }) {
    const list = parseListParams(sp, { sortable: PROJECT_SORTS, defaultSort: 'updatedAt', defaultDir: 'desc' });
    const status = oneOf(sp, 'status', PROJECT_STATUSES);
    const health = oneOf(sp, 'health', PROJECT_HEALTH);
    const type = oneOf(sp, 'type', PROJECT_TYPES);
    const archived = oneOf(sp, 'archived', ['only', 'include'] as const);
    const clientId = objectIdParam(sp, 'client');
    const money = viewer.capabilities.has('payment:view');

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await listProjects(viewer, { q: list.q, status, health, type, archived, clientId, sort: list.sort as (typeof PROJECT_SORTS)[number], dir: list.dir, page, pageSize });
      return { items: result.items, total: result.meta.total };
    });

    return {
      header: [
        'Reference', 'Name', 'Client', 'Type', 'Status', 'Health', 'Priority', 'Project lead', 'Members', 'Start date', 'Deadline', 'Delivered on', 'Overdue', 'Archived', 'Updated on',
        ...(money ? ['Pricing model', 'Contract amount', 'Contract currency'] : []),
      ],
      rows: items.map((p) => [
        p.ref,
        p.name,
        p.clientName,
        words(p.type),
        words(p.status),
        words(p.health),
        words(p.priority),
        p.lead,
        p.memberCount,
        p.startOn,
        p.deadlineOn,
        p.deliveredOn,
        yesNo(p.overdue),
        yesNo(p.archived),
        dayIn(p.updatedAt, timeZone),
        ...(money ? [words(p.contract?.pricingModel), p.contract ? amount(p.contract.amountMinor, p.contract.currency) : null, p.contract?.currency] : []),
      ]),
      total,
      truncated,
      filters: filterLines([['search', list.q], ['status', status], ['health', health], ['type', type], ['archived', archived], ['client', clientId], ['sort', `${list.sort} ${list.dir}`]]),
    };
  },
};

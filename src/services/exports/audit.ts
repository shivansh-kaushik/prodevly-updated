import { getPeriod } from '@/lib/admin/period';
import { describeAction } from '@/lib/admin/audit-text';
import { parseAuditSearch } from '@/lib/validation/audit';
import { auditScopeOf, listAudit } from '@/services/audit-log.service';
import { redactChanges } from '@/services/audit.service';
import { dayIn, describePeriod, filterLines, list, timeIn } from './format';
import { gather } from './gather';
import type { ExportSection } from './types';

/** "export.third_party_payouts" reads as "exported third party payouts"; every other action keeps the feed's own wording. */
const actionWords = (action: string, entityType: string) =>
  action.startsWith('export.') ? `exported ${action.slice('export.'.length).replaceAll('_', ' ')}` : describeAction(action, entityType);

/** The same test the audit writer uses to redact a value: a path it would redact is not named in a file either. */
const isSecretPath = (path: string) => redactChanges([{ path, before: 1, after: 1 }])[0]?.before === '[redacted]';

/**
 * The audit log, with the same filters and period as /admin/audit. Every signed-in admin has a trail: audit:viewAll widens it from
 * "my entries" to everyone's, and listAudit enforces that whatever the URL says. Values before and after a change, the address hash and the user
 * agent are not columns: only the names of the fields that changed.
 */
export const auditExport: ExportSection = {
  id: 'audit',
  noun: 'audit entries',
  assertAccess: () => undefined,
  async build({ viewer, sp, cap, timeZone }) {
    const period = await getPeriod(sp);
    const urlFilters = parseAuditSearch(sp);
    const scope = auditScopeOf(viewer);

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await listAudit(viewer, { ...urlFilters, from: period.fromInstant, to: period.toInstant }, { page, pageSize });
      return { items: result.entries, total: result.meta.total };
    });

    return {
      header: ['Date', `Time (${timeZone})`, 'Person', 'Action', 'Action code', 'Record type', 'Record reference', 'Record', 'Summary', 'Fields changed', 'Request id'],
      rows: items.map((e) => [
        dayIn(e.at, timeZone),
        timeIn(e.at, timeZone),
        e.actorName,
        actionWords(e.action, e.entity.type),
        e.action,
        e.entity.type,
        e.entity.ref,
        e.entity.label,
        e.summary,
        list(e.changes.map((c) => (isSecretPath(c.path) ? '(sensitive field)' : c.path))),
        e.requestId,
      ]),
      total,
      truncated,
      filters: [
        ...filterLines([
          ['scope', scope === 'own' ? 'own entries only' : undefined],
          ['search', urlFilters.q], ['person', scope === 'all' ? urlFilters.actorId : undefined], ['action', urlFilters.action], ['record type', urlFilters.entityType],
          ['client', urlFilters.clientId], ['project', urlFilters.projectId], ['sensitive only', urlFilters.sensitive],
        ]),
        describePeriod(period),
      ],
    };
  },
};

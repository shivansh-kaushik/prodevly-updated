import type { PipelineStage } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import type { Period } from '@/lib/dates/ranges';
import { AuditLog } from '@/models';
import type { SessionUser } from '@/types/session';
import { auditScopeOf, resolveZone, scopeFilter, SENSITIVE, SENSITIVE_ANY, type AuditScope } from '@/services/audit-log.service';
import { lastDays } from '@/services/dashboards/admins';

/**
 * The audit log's dashboard (plan section 5). Every figure is a count of audit entries, so there is
 * nothing to invent and nothing money-shaped to hide. A viewer without audit:viewAll gets the same
 * figures over THEIR OWN entries only (the scope is the same `scopeFilter` the list uses).
 */
export interface AuditDashboard {
  scope: AuditScope;
  /** Entries in the chosen period. */
  actions: number;
  /** Entries in the chosen period that are sensitive. `total` is not the sum of the parts if one action fits two. */
  sensitive: { total: number; adminManagement: number; voids: number; failedSignIns: number };
  /** The last 30 days in the organisation's zone, oldest first, zero-filled. Independent of the period. */
  actionsByDay: Array<{ day: string; actions: number }>;
  /** Busiest people in the period, top 10. Empty for a viewer who sees only their own entries. */
  byPerson: Array<{ id: string | null; name: string; actions: number }>;
  /** Busiest record types in the period, top 8; `type: null` is everything else. */
  byEntityType: Array<{ type: string | null; actions: number }>;
}

const DAY = 86_400_000;
const TOP_PEOPLE = 10;
const TOP_ENTITY_TYPES = 8;

/** 1 when the action matches, else 0, for summing a category. */
const flag = (regex: string) => ({ $cond: [{ $regexMatch: { input: '$action', regex } }, 1, 0] });

interface FacetResult {
  totals: Array<{ actions: number; sensitive: number; adminManagement: number; voids: number; failedSignIns: number }>;
  perDay: Array<{ _id: string; n: number }>;
  byPerson?: Array<{ _id: unknown; name: string; actions: number }>;
  byEntity: Array<{ _id: string; actions: number }>;
}

export async function getAuditDashboard(
  viewer: SessionUser,
  period: Pick<Period, 'fromInstant' | 'toInstant'>,
  options: { now?: Date; timeZone?: string } = {},
): Promise<AuditDashboard> {
  await connectToDatabase();
  const now = options.now ?? new Date();
  const zone = resolveZone(options.timeZone);
  const scope = auditScopeOf(viewer);

  // One more day than shown, so the oldest bucket is complete whatever the zone's offset.
  const windowStart = new Date(now.getTime() - 31 * DAY);
  const windowEnd = new Date(now.getTime() + 1);
  const inPeriod = { at: { $gte: period.fromInstant, $lt: period.toInstant } };
  const inWindow = { at: { $gte: windowStart, $lt: windowEnd } };

  const facets: Record<string, PipelineStage.FacetPipelineStage[]> = {
    totals: [
      { $match: inPeriod },
      {
        $group: {
          _id: null,
          actions: { $sum: 1 },
          sensitive: { $sum: flag(SENSITIVE_ANY) },
          adminManagement: { $sum: flag(SENSITIVE.adminManagement) },
          voids: { $sum: flag(SENSITIVE.voids) },
          failedSignIns: { $sum: flag(SENSITIVE.failedSignIns) },
        },
      },
    ],
    perDay: [
      { $match: inWindow },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: zone } }, n: { $sum: 1 } } },
    ],
    byEntity: [{ $match: inPeriod }, { $group: { _id: { $ifNull: ['$entity.type', 'unknown'] }, actions: { $sum: 1 } } }, { $sort: { actions: -1, _id: 1 } }],
  };
  // Leaving the facet out (an empty sub-pipeline is an error) is also cheaper than computing a chart nobody sees.
  if (scope === 'all') {
    facets.byPerson = [
      { $match: inPeriod },
      // People are told apart by id; the system and scripts have none, so they group by their name.
      { $group: { _id: { $ifNull: ['$actor.id', '$actor.name'] }, name: { $first: '$actor.name' }, actions: { $sum: 1 } } },
      { $sort: { actions: -1, name: 1 } },
      { $limit: TOP_PEOPLE },
    ];
  }

  // Both windows are matched up front (an $or of two index ranges), so the scan is the union, not the gap.
  const [result] = await AuditLog.aggregate<FacetResult>([
    { $match: { ...scopeFilter(viewer), $or: [inPeriod, inWindow] } },
    { $facet: facets },
  ]);

  const totals = result?.totals[0];
  const perDay = new Map((result?.perDay ?? []).map((d) => [d._id, d.n]));
  const entityRows = result?.byEntity ?? [];
  const topEntities = entityRows.slice(0, TOP_ENTITY_TYPES).map((r) => ({ type: r._id as string | null, actions: r.actions }));
  const restEntities = entityRows.slice(TOP_ENTITY_TYPES).reduce((sum, r) => sum + r.actions, 0);

  return {
    scope,
    actions: totals?.actions ?? 0,
    sensitive: {
      total: totals?.sensitive ?? 0,
      adminManagement: totals?.adminManagement ?? 0,
      voids: totals?.voids ?? 0,
      failedSignIns: totals?.failedSignIns ?? 0,
    },
    actionsByDay: lastDays(30, now, zone).map((day) => ({ day, actions: perDay.get(day) ?? 0 })),
    byPerson: (result?.byPerson ?? []).map((r) => ({ id: r._id == null || typeof r._id === 'string' ? null : String(r._id), name: r.name ?? 'Unknown', actions: r.actions })),
    byEntityType: restEntities > 0 ? [...topEntities, { type: null, actions: restEntities }] : topEntities,
  };
}

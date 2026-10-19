import { notFound, stepUpRequired } from '@/lib/api/errors';
import type { RawSearchParams } from '@/lib/admin/search-params';
import { assertCapability } from '@/lib/auth/guard';
import { toCsv } from '@/lib/csv';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { connectToDatabase } from '@/lib/db/mongoose';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit } from './audit.service';
import { auditExport } from './exports/audit';
import { clientsExport } from './exports/clients';
import { enquiriesExport } from './exports/enquiries';
import { expensesExport } from './exports/expenses';
import { EXPORT_ROW_CAP } from './exports/limits';
import { paymentsExport } from './exports/payments';
import { projectsExport } from './exports/projects';
import { tasksExport } from './exports/tasks';
import { teamPayoutsExport } from './exports/team-payouts';
import { thirdPartyPayoutsExport } from './exports/third-party-payouts';
import { isExportSection, type ExportSection, type ExportSectionId } from './exports/types';
import { workLogsExport } from './exports/work-logs';
import { workOrdersExport } from './exports/work-orders';
import { loadSettings } from './settings.service';

/**
 * CSV exports (plan section 1 "CSV export", section 8 `exports/[section]`).
 *
 * WHO: export:data (superadmins; a grant for an admin) AND an open step-up AND the section's own view capability. A section
 * reads through the SAME list function as its screen, so the filters, the sort and the capability scoping (an admin sees only
 * their own audit entries and their own out-of-pocket expenses) are the screen's, not a copy of them.
 *
 * WHAT: every row that matches, up to EXPORT_ROW_CAP, and the result says when it was cut short. Money columns appear only for
 * viewers who may see money; notes, address hashes and anything password-shaped are never columns.
 *
 * AUDIT: one entry per export (`export.<section>`), written only after the file is built and before it is handed back, so an
 * export that fails to log is not delivered.
 */
const SECTIONS: Record<ExportSectionId, ExportSection> = {
  clients: clientsExport,
  projects: projectsExport,
  tasks: tasksExport,
  'work-logs': workLogsExport,
  payments: paymentsExport,
  'third-party-payouts': thirdPartyPayoutsExport,
  'work-orders': workOrdersExport,
  expenses: expensesExport,
  'team-payouts': teamPayoutsExport,
  enquiries: enquiriesExport,
  audit: auditExport,
};

export interface ExportResult {
  section: ExportSectionId;
  /** "prodevly-clients-2026-10-12.csv" */
  filename: string;
  /** The whole file, BOM first. */
  csv: string;
  /** Data rows in the file. */
  rows: number;
  /** Rows that matched the filters. More than `rows` when truncated. */
  total: number;
  truncated: boolean;
}

export interface ExportOptions {
  /** Row cap. Only tests change it. */
  cap?: number;
  now?: Date;
}

const SUMMARY_MAX = 480;

export async function exportSection(
  viewer: SessionUser,
  sectionId: string,
  sp: RawSearchParams,
  meta: ServiceMeta = {},
  options: ExportOptions = {},
): Promise<ExportResult> {
  assertCapability(viewer, 'export:data');
  if (!viewer.stepUpValid) throw stepUpRequired();
  if (!isExportSection(sectionId)) throw notFound('We could not find that export');
  const section = SECTIONS[sectionId];
  section.assertAccess(viewer);

  await connectToDatabase();
  const { timezone } = await loadSettings();
  const cap = options.cap ?? EXPORT_ROW_CAP;
  const table = await section.build({ viewer, sp, cap, timeZone: timezone });
  const csv = toCsv(table.header, table.rows);
  const rows = table.rows.length;

  const filters = table.filters.length > 0 ? table.filters.join('; ') : 'none';
  const cut = table.truncated ? ` (cut at ${cap} of ${table.total})` : '';
  await audit({
    actor: { id: viewer.id, name: viewer.name, role: viewer.role },
    action: `export.${sectionId.replaceAll('-', '_')}`,
    entity: { type: 'export', ref: sectionId, label: `${section.noun} export` },
    summary: `Exported ${rows} ${section.noun} to CSV${cut}. Filters: ${filters}`.slice(0, SUMMARY_MAX),
    meta,
  });

  const day = formatDateOnly(todayDateOnly(options.now ?? new Date(), timezone));
  return { section: sectionId, filename: `prodevly-${sectionId}-${day}.csv`, csv, rows, total: table.total, truncated: table.truncated };
}

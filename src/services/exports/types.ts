import type { RawSearchParams } from '@/lib/admin/search-params';
import type { CsvCell } from '@/lib/csv';
import type { SessionUser } from '@/types/session';

/** The sections that can be exported. The URL segment, the file name and the audit action all use these ids. */
export const EXPORT_SECTIONS = [
  'clients',
  'projects',
  'tasks',
  'work-logs',
  'payments',
  'third-party-payouts',
  'work-orders',
  'expenses',
  'team-payouts',
  'enquiries',
  'audit',
] as const;
export type ExportSectionId = (typeof EXPORT_SECTIONS)[number];

export const isExportSection = (value: string): value is ExportSectionId => (EXPORT_SECTIONS as readonly string[]).includes(value);

export interface ExportContext {
  viewer: SessionUser;
  /** The list page's own query parameters, exactly as its URL carries them. */
  sp: RawSearchParams;
  /** Rows to stop at. */
  cap: number;
  /** The organisation's time zone: instants become the calendar date they fall on there. */
  timeZone: string;
}

/** What a section hands back: a header, the rows, and what it filtered on, for the audit entry. */
export interface SectionTable {
  header: string[];
  rows: CsvCell[][];
  /** Rows that match the filters, which can be more than `rows.length` when the cap cut it short. */
  total: number;
  truncated: boolean;
  /** "status=active" style lines describing the filters that applied. */
  filters: string[];
}

export interface ExportSection {
  id: ExportSectionId;
  /** What one row is, plural, for the audit summary ("clients"). */
  noun: string;
  /** Throws FORBIDDEN unless the viewer may read this section. The list function checks again. */
  assertAccess(viewer: SessionUser): void;
  build(context: ExportContext): Promise<SectionTable>;
}

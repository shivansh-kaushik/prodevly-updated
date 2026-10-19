'use client';

import { Download } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError, type DownloadResult } from '@/lib/admin/api-client';
import { formatCount } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';

/**
 * "Export CSV" for a list page: downloads every row the page's current filters match (up to the server's cap) as a spreadsheet file.
 *
 * The page passes its own URL search params, so the file matches what is on screen. The server needs an open step-up, so the
 * request goes through the provider's `download`, which opens the password dialog on STEP_UP_REQUIRED and retries once. The file is
 * read as bytes and saved through a Blob URL, so the byte order mark and every character survive. A toast reports the result; a cut-short
 * file and a failure also leave a note beside the button that stays until the next click.
 *
 * The button renders without the API provider or the toast provider (the provider-dependent part mounts only once it is clicked), so a
 * page that shows it can be rendered anywhere.
 */

/** The sections the server exports (src/services/exports/types.ts). A test keeps the two lists equal. */
export const EXPORT_SECTION_IDS = [
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
export type ExportSectionId = (typeof EXPORT_SECTION_IDS)[number];

/** The route for a section with the page's filters. `page` is dropped: an export is not paged. */
export function exportUrl(section: ExportSectionId, params: RawSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (key === 'page') continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return `/api/admin/exports/${section}${text ? `?${text}` : ''}`;
}

interface Notice {
  tone: 'success' | 'warning' | 'error';
  text: string;
}

const rowsOf = (n: number) => `${formatCount(n)} ${n === 1 ? 'row' : 'rows'}`;

/** What to tell the person once the file has been saved. */
export function successNotice(result: Pick<DownloadResult, 'rows' | 'total' | 'truncated'>): Notice {
  const rows = result.rows ?? 0;
  if (result.truncated && result.total !== null) {
    return {
      tone: 'warning',
      text: `Only the first ${rowsOf(rows)} of ${formatCount(result.total)} were exported. Narrow the filters (a period, a status or a search) to get the rest.`,
    };
  }
  return { tone: 'success', text: `Exported ${rowsOf(rows)}.` };
}

/** A failure in words a person can act on. */
export function failureNotice(error: unknown): Notice {
  if (error instanceof ApiError) {
    if (error.code === 'STEP_UP_REQUIRED') return { tone: 'error', text: 'Exports need your password. Confirm it and try again.' };
    if (error.code === 'FORBIDDEN') return { tone: 'error', text: 'Your access does not allow exporting this.' };
    if (error.code === 'RATE_LIMITED') {
      const wait = error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds} ${error.retryAfterSeconds === 1 ? 'second' : 'seconds'}.` : ' Try again shortly.';
      return { tone: 'error', text: `You have exported a lot just now.${wait}` };
    }
    return { tone: 'error', text: error.message };
  }
  return { tone: 'error', text: 'The export did not finish. Please try again.' };
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // The browser reads the Blob asynchronously; give it time before letting go.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** One export, from request to saved file. Mounted by a click and keyed per click, so each click is one request. */
function ExportRun({ url, onSettled }: { url: string; onSettled: (notice: Notice) => void }) {
  const { download } = useAdminApi();
  const toast = useToast();
  // Development double-runs effects; a ref survives that, so one click is one download and one audit entry.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      let notice: Notice;
      try {
        const result = await download(url);
        saveBlob(result.blob, result.filename);
        notice = successNotice(result);
      } catch (error) {
        notice = failureNotice(error);
      }
      toast.show(notice.text, notice.tone === 'error' ? 'error' : 'success');
      onSettled(notice);
    })();
  }, [download, onSettled, toast, url]);

  return null;
}

export function ExportButton({ section, params, canExport }: { section: ExportSectionId; params: RawSearchParams; canExport: boolean }) {
  const [clicks, setClicks] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const settle = useCallback((n: Notice) => {
    setNotice(n);
    setBusy(false);
  }, []);

  // Only people with export:data are offered it (the route enforces that again).
  if (!canExport) return null;

  return (
    <>
      <Button
        variant="secondary"
        loading={busy}
        title="Download the rows this list matches as a CSV file"
        onClick={() => {
          setBusy(true);
          setNotice(null);
          setClicks((n) => n + 1);
        }}
      >
        {busy ? null : <Download className="size-4" aria-hidden />}
        {busy ? 'Preparing' : 'Export CSV'}
      </Button>
      {clicks > 0 ? <ExportRun key={clicks} url={exportUrl(section, params)} onSettled={settle} /> : null}
      {notice && notice.tone !== 'success' ? (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`max-w-xs text-[12px] leading-4 font-medium ${notice.tone === 'error' ? 'text-pd-rubric' : 'text-pd-amber'}`}>
          {notice.text}
        </p>
      ) : null}
    </>
  );
}

import { FileText } from 'lucide-react';
import { formatBytes } from '@/lib/media/rules';
import type { MediaDTO } from '@/lib/media/types';

/**
 * The receipts attached to an expense, as links that open the private file in a new tab (the serving route checks the
 * viewer again). Receipts this viewer may not open are counted, never listed.
 */
export function ReceiptsList({ receipts, attached }: { receipts: MediaDTO[]; attached: number }) {
  const hidden = attached - receipts.length;
  if (attached === 0) return <p className="text-[14px] text-pd-ink-3">No receipt is attached.</p>;
  return (
    <div className="flex flex-col gap-2">
      {receipts.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {receipts.map((r) => (
            <li key={r.id}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-9 items-center gap-2 rounded-pd-sm bg-pd-well px-3 py-1.5 text-[14px] text-pd-ink hover:bg-pd-rule-soft pointer-coarse:min-h-11"
              >
                <FileText className="size-4 shrink-0 text-pd-ink-3" aria-hidden />
                <span className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">{r.filename}</span>
                <span className="pd-figure shrink-0 text-[12px] text-pd-ink-3">{formatBytes(r.size)}</span>
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? <p className="text-[13px] text-pd-ink-3">{hidden === 1 ? '1 more receipt is attached that you cannot open.' : `${hidden} more receipts are attached that you cannot open.`}</p> : null}
    </div>
  );
}

import { formatDateTime } from '@/lib/admin/format';
import { StatusBadge } from '@/components/ui/status-badge';

export interface StatusHistoryItem {
  from: string | null;
  to: string;
  at: string;
  by: string;
  note?: string | null;
}

/** Every move a project, task or work order has made, newest first, with who and why. */
export function StatusHistory({ items }: { items: ReadonlyArray<StatusHistoryItem> }) {
  if (items.length === 0) return <p className="text-[13px] text-pd-ink-3">No status changes yet.</p>;
  return (
    <ol className="flex flex-col">
      {[...items].reverse().map((h, i) => (
        <li key={`${h.at}-${i}`} className="flex flex-col gap-1 border-b border-pd-rule-soft py-2.5 last:border-b-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-pd-ink-2">
            {h.from ? <><StatusBadge status={h.from} /><span aria-label="to">→</span></> : <span>Started as</span>}
            <StatusBadge status={h.to} />
            <span className="text-pd-ink-3">by {h.by}, {formatDateTime(h.at)}</span>
          </div>
          {h.note ? <p className="text-[13px] text-pd-ink-2">{h.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

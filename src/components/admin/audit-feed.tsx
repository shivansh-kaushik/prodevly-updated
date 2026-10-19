import { describeAction } from '@/lib/admin/audit-text';
import { formatAgo, formatDateTime, initials } from '@/lib/admin/format';
import type { ActivityEntry } from '@/services/activity.service';
import { EmptyState } from '@/components/ui/empty-state';

function show(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'empty';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

/** A readable activity feed: who did what to what, when, with the before and after one click away. */
export function AuditFeed({ entries, emptyTitle = 'No activity yet' }: { entries: ActivityEntry[]; emptyTitle?: string }) {
  if (entries.length === 0) return <EmptyState title={emptyTitle} className="py-8" />;
  const now = new Date();
  return (
    <ol className="flex flex-col">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3 border-b border-pd-rule-soft py-3 last:border-b-0">
          <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-pd-well text-[11px] font-medium text-pd-ink-2">{initials(e.actorName)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-5 text-pd-ink">
              <span className="font-medium">{e.actorName}</span> {describeAction(e.action, e.entity.type)}
              {e.entity.label || e.entity.ref ? (
                <>
                  {' '}
                  <span className="font-medium">{e.entity.label ?? ''}</span>
                  {e.entity.ref ? <span className="ml-1.5 font-pd-mono text-[12px] text-pd-ink-3">{e.entity.ref}</span> : null}
                </>
              ) : null}
            </p>
            {e.summary ? <p className="mt-0.5 text-[13px] leading-5 text-pd-ink-3">{e.summary}</p> : null}
            {e.changes.length > 0 ? (
              <details className="mt-1 text-[13px]">
                <summary className="w-fit cursor-pointer text-pd-ink-3 hover:text-pd-ink">{e.changes.length} {e.changes.length === 1 ? 'change' : 'changes'}</summary>
                <ul className="mt-1.5 flex flex-col gap-1 rounded-pd-sm bg-pd-well p-2.5">
                  {e.changes.map((c, i) => (
                    <li key={`${c.path}-${i}`} className="break-words">
                      <span className="font-pd-mono text-[12px] text-pd-ink-2">{c.path}</span>{' '}
                      <span className="text-pd-ink-3">{show(c.before)}</span> <span aria-label="changed to">→</span> <span className="font-medium text-pd-ink">{show(c.after)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          <time dateTime={e.at} title={formatDateTime(e.at)} className="shrink-0 pt-0.5 text-[12px] text-pd-ink-3">{formatAgo(e.at, now)}</time>
        </li>
      ))}
    </ol>
  );
}

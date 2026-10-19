import { AuditFeed } from '@/components/admin/audit-feed';
import { Panel } from '@/components/ui/panel';
import type { ActivityEntry } from '@/services/activity.service';
import { resolveZone, type AuditEntryDTO, type DayGroup } from '@/services/audit-log.service';

/** A hash is 64 hex characters with no break points: show enough to tell sources apart without widening a phone screen. */
const SHORT_HASH = 12;

/**
 * The feed shows one muted line under an entry (its summary) and a relative time ("5 h ago") whose
 * exact value sits in a tooltip that a phone never shows. An audit log must say WHEN, so the clock
 * time leads that line, followed by what the log has to show and the feed has no slot for: the
 * request id and, for viewers who may see it, where the request came from.
 */
function forFeed(entry: AuditEntryDTO, clock: Intl.DateTimeFormat): ActivityEntry {
  const parts = [
    clock.format(new Date(entry.at)),
    entry.summary,
    entry.requestId ? `Request ${entry.requestId}` : null,
    // The key exists only when the service decided this viewer may see it.
    entry.ipHash ? `IP hash ${entry.ipHash.slice(0, SHORT_HASH)}` : null,
  ].filter(Boolean);
  return { ...entry, summary: parts.join(' · ') };
}

/**
 * One page of the log, grouped by calendar day in the organisation's zone. The day heading carries the
 * exact date, each row the clock time, and each group is an ordinary `AuditFeed`, so a row reads and
 * expands the same way as on every record's activity tab.
 */
export function AuditList({ groups, timeZone }: { groups: ReadonlyArray<DayGroup<AuditEntryDTO>>; timeZone: string }) {
  const clock = new Intl.DateTimeFormat('en-IN', { timeZone: resolveZone(timeZone), hour: 'numeric', minute: '2-digit', hour12: true });
  return (
    <Panel className="flex flex-col gap-6">
      {/* The charts above use h2, the day headings are h3: this keeps the outline in order for screen readers. */}
      <h2 className="sr-only">Log entries</h2>
      {groups.map((g) => (
        <section key={g.day} aria-labelledby={`audit-day-${g.day}`}>
          <h3 id={`audit-day-${g.day}`} className="pd-eyebrow border-b border-pd-rule-strong pb-1.5">
            {g.label}
          </h3>
          <AuditFeed entries={g.entries.map((e) => forFeed(e, clock))} />
        </section>
      ))}
    </Panel>
  );
}

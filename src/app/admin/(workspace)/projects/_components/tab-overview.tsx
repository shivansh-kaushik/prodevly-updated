import Link from 'next/link';
import { StatusHistory } from '@/components/admin/status-history';
import { formatNative } from '@/components/admin/money';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate, formatDateTime } from '@/lib/admin/format';
import type { ProjectDTO } from '@/services/project.service';
import { HEALTH_LABELS, PRIORITY_LABELS, safeHref, typeLabel } from './labels';

const LINKS = [['repo', 'Repository'], ['staging', 'Staging'], ['live', 'Live site'], ['design', 'Design files']] as const;

/** Where scope, price and deadline stand now against what was first agreed. Drift is shown, never hidden. */
function AgreedPanel({ project: p }: { project: ProjectDTO }) {
  const a = p.agreed;
  if (!a) return null;
  const scopeChanged = (a.scope ?? '') !== (p.scopeSummary ?? '');
  const deadlineChanged = (a.deadlineOn ?? '') !== (p.deadlineOn ?? '');
  const agreedPrice = p.money?.agreedAmount;
  const priceChanged = Boolean(p.money && agreedPrice && (agreedPrice.amountMinor !== p.money.contract.amountMinor || agreedPrice.currency !== p.money.contract.currency));
  const rows: Array<{ label: string; was: React.ReactNode; now: React.ReactNode; changed: boolean }> = [
    { label: 'Scope', was: a.scope || 'Not recorded', now: p.scopeSummary || 'Not set', changed: scopeChanged },
    { label: 'Deadline', was: a.deadlineOn ? formatDate(a.deadlineOn) : 'None', now: p.deadlineOn ? formatDate(p.deadlineOn) : 'None', changed: deadlineChanged },
  ];
  if (p.money && agreedPrice) {
    rows.push({
      label: 'Price',
      was: formatNative(agreedPrice.amountMinor, agreedPrice.currency),
      now: formatNative(p.money.contract.amountMinor, p.money.contract.currency),
      changed: priceChanged,
    });
  }
  return (
    <Panel flush>
      <div className="px-5 pt-5">
        <PanelHeader title="As first agreed" hint={`Recorded ${formatDateTime(a.capturedAt)} by ${a.capturedBy}, when the project first became active. It never changes.`} />
      </div>
      <TableFrame className="rounded-none shadow-none">
        <Table caption="Agreed scope, deadline and price against now" className="min-w-0">
          <THead>
            <tr><Th>&nbsp;</Th><Th>First agreed</Th><Th>Now</Th><Th><span className="sr-only">Changed</span></Th></tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.label}>
                <Td className="align-top font-medium">{r.label}</Td>
                <Td className="max-w-64 py-2 align-top break-words whitespace-pre-line">{r.was}</Td>
                <Td className="max-w-64 py-2 align-top break-words whitespace-pre-line">{r.now}</Td>
                <Td className="align-top">{r.changed ? <Badge tone="amber">Changed</Badge> : <span className="text-[12px] text-pd-ink-3">Same</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableFrame>
    </Panel>
  );
}

export function OverviewTab({ project: p, canViewClient }: { project: ProjectDTO; canViewClient: boolean }) {
  const links = LINKS.flatMap(([key, label]) => {
    const href = safeHref(p.links[key]);
    return href ? [{ label, href }] : [];
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-6">
        <Panel>
          <PanelHeader title="Details" />
          <DescriptionList
            items={[
              { label: 'Client', value: canViewClient ? <Link href={`/admin/clients/${p.clientId}`} prefetch={false} className="underline-offset-2 hover:underline">{p.clientName}</Link> : p.clientName },
              { label: 'Type', value: typeLabel(p.type) },
              { label: 'Priority', value: PRIORITY_LABELS[p.priority] ?? p.priority },
              { label: 'Health', value: <StatusBadge status={p.health} label={HEALTH_LABELS[p.health]} /> },
              { label: 'Lead', value: p.lead?.name },
              { label: 'Started', value: formatDate(p.startOn) },
              { label: 'Deadline', value: formatDate(p.deadlineOn) },
              { label: 'Delivered', value: formatDate(p.deliveredOn) },
              {
                label: 'Links',
                value: links.length ? (
                  <ul className="flex flex-col gap-1">
                    {links.map((l) => (
                      <li key={l.label}><a href={l.href} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">{l.label}</a></li>
                    ))}
                  </ul>
                ) : null,
              },
              { label: 'Tags', value: p.tags.length ? <span className="flex flex-wrap gap-1">{p.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> : null },
            ]}
          />
        </Panel>
        <Panel>
          <PanelHeader title="Scope" />
          {p.scopeSummary ? <p className="text-[14px] leading-6 whitespace-pre-line text-pd-ink">{p.scopeSummary}</p> : <EmptyState title="No scope summary yet" body="Add one from Edit: it is recorded as agreed when the project first becomes active." className="py-6" />}
        </Panel>
        <AgreedPanel project={p} />
      </div>
      <Panel>
        <PanelHeader title="Status history" />
        <StatusHistory items={p.statusHistory} />
      </Panel>
    </div>
  );
}

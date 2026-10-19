import { Money } from '@/components/admin/money';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { formatInr } from '@/lib/admin/format';
import type { ClientMoneyReport } from '@/services/dashboards/clients';

/**
 * What this client has paid, what is still owed, what it cost us, and the margin. Figures are all time. `paymentsHref` (the payments
 * list narrowed to this client) is given only to holders of `payment:view`, the people the Money tab is shown to anyway.
 */
export function MoneyTab({ report, paymentsHref }: { report: ClientMoneyReport; paymentsHref?: string }) {
  if (report.projects.length === 0) {
    return <Panel flush><EmptyState title="No projects yet" body="Money appears here once this client has a project with payments against it." /></Panel>;
  }
  const t = report.totals;
  return (
    <div className="flex flex-col gap-6">
      {report.isInternal ? <p className="rounded-pd-sm bg-pd-well px-3 py-2 text-[13px] text-pd-ink-2">This is our own client. Nothing here counts as revenue; costs count in the company totals.</p> : null}
      <Panel>
        <PanelHeader
          title="Margin"
          hint="All time, in rupees. Received less third-party, expense and team costs."
          action={paymentsHref ? <LinkButton href={paymentsHref} variant="secondary" size="sm" prefetch={false}>View payments</LinkButton> : undefined}
        />
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-5">
          {[
            ['Received', t.receivedInrMinor], ['Third parties', t.thirdPartyInrMinor], ['Expenses', t.expenseInrMinor], ['Team', t.teamInrMinor],
          ].map(([label, value]) => (
            <div key={label as string}><dt className="pd-eyebrow">{label}</dt><dd className="pd-figure mt-0.5 font-pd-serif text-[20px] font-semibold">{formatInr(value as number)}</dd></div>
          ))}
          <div>
            <dt className="pd-eyebrow">Margin</dt>
            <dd className="pd-figure mt-0.5 font-pd-serif text-[20px] font-semibold">{formatInr(t.marginInrMinor)}{t.marginPct !== null ? <span className="ml-1.5 font-pd-ui text-[13px] font-normal text-pd-ink-3">{t.marginPct}%</span> : null}</dd>
          </div>
        </dl>
      </Panel>
      <TableFrame>
        <Table caption="Money by project">
          <THead>
            <tr>
              <Th>Project</Th><Th>Status</Th><Th numeric>Billable</Th><Th numeric>Received</Th><Th numeric>Outstanding</Th><Th numeric>Margin</Th>
            </tr>
          </THead>
          <tbody>
            {report.projects.map((p) => (
              <Tr key={p.id}>
                <Td><RowLink href={`/admin/projects/${p.id}?tab=money`}>{p.name}</RowLink><span className="ml-2 font-pd-mono text-[12px] text-pd-ink-3">{p.ref}</span></Td>
                <Td><StatusBadge status={p.status} /></Td>
                <Td numeric><Money amountMinor={p.billableMinor} currency={p.currency} /></Td>
                <Td numeric><Money amountMinor={p.receivedContractMinor} currency={p.currency} /></Td>
                <Td numeric>
                  {p.outstandingMinor < 0 ? <span title="More was received than is billable"><Money amountMinor={-p.outstandingMinor} currency={p.currency} /> <span className="text-[12px] text-pd-ink-3">advance</span></span> : <Money amountMinor={p.outstandingMinor} currency={p.currency} />}
                </Td>
                <Td numeric>{formatInr(p.marginInrMinor)}</Td>
              </Tr>
            ))}
            <TotalRow>
              <Td colSpan={5}>Total margin (rupees)</Td>
              <Td numeric>{formatInr(t.marginInrMinor)}</Td>
            </TotalRow>
          </tbody>
        </Table>
      </TableFrame>
    </div>
  );
}

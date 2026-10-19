import { formatNative } from '@/components/admin/money';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { formatCount, formatInr } from '@/lib/admin/format';
import type { PaymentsDashboard } from '@/services/dashboards/payments';

/**
 * What clients still owe, project by project: the billable total less what was received toward the
 * contract, in the contract currency, with the INR value at the latest table rate beside it.
 */
export function OutstandingPanel({ outstanding }: { outstanding: PaymentsDashboard['outstanding'] }) {
  const { rows, projects, totalInr, missingRates } = outstanding;
  return (
    <Panel flush>
      <div className="px-5 pt-5">
        <PanelHeader title="Outstanding by project" hint="Billable less received, at the latest rates. Proposals and cancelled projects are left out." />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing outstanding" body="Every billable project is paid up, or none has a contract amount or an invoiced milestone yet." className="py-8" />
      ) : (
        <TableFrame className="rounded-none shadow-none">
          <Table caption="Outstanding by project" className="min-w-[34rem]">
            <THead>
              <tr>
                <Th>Project</Th>
                <Th numeric>Billable</Th>
                <Th numeric>Received</Th>
                <Th numeric>Outstanding</Th>
                <Th numeric>INR</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.projectId}>
                  <Td className="max-w-56">
                    <RowLink href={`/admin/payments?project=${r.projectId}`}>{r.projectName}</RowLink>
                    <span className="block truncate text-[12px] text-pd-ink-3"><span className="font-pd-mono">{r.projectRef}</span> · {r.clientName}</span>
                  </Td>
                  <Td numeric>{formatNative(r.billableMinor, r.currency)}</Td>
                  <Td numeric>{formatNative(r.receivedMinor, r.currency)}</Td>
                  <Td numeric>{formatNative(r.outstandingMinor, r.currency)}</Td>
                  <Td numeric>{r.outstandingInr === null ? <span className="text-pd-ink-3">No {r.currency} rate</span> : formatInr(r.outstandingInr)}</Td>
                </Tr>
              ))}
              <TotalRow>
                <Td>{projects > rows.length ? `All ${formatCount(projects)} projects` : 'Total'}</Td>
                <Td numeric>&nbsp;</Td>
                <Td numeric>&nbsp;</Td>
                <Td numeric>&nbsp;</Td>
                <Td numeric>{totalInr === null ? '' : formatInr(totalInr)}</Td>
              </TotalRow>
            </tbody>
          </Table>
        </TableFrame>
      )}
      {projects > rows.length ? <p className="px-5 py-3 text-[12px] text-pd-ink-3">Showing the {formatCount(rows.length)} largest of {formatCount(projects)}. The total covers all of them.</p> : null}
      {missingRates.length > 0 ? (
        <p className="px-5 pb-4 text-[12px] font-medium text-pd-amber">
          No exchange rate on file for {missingRates.join(', ')}: those balances are not in the INR total. A superadmin or someone with FX access can add one in Settings.
        </p>
      ) : null}
    </Panel>
  );
}

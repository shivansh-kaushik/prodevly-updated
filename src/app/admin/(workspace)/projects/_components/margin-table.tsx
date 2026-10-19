import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { formatCount, formatInr } from '@/lib/admin/format';
import type { ProjectsDashboard } from '@/services/dashboards/projects';

type Money = NonNullable<ProjectsDashboard['money']>;
const pct = (p: number | null) => (p === null ? '-' : `${p}%`);

/**
 * Margin per project for the period: received, then the three costs, then margin and its percent
 * (only when something was received). Internal projects are one row of costs, never revenue.
 */
export function MarginTable({ money, periodLabel }: { money: Money; periodLabel: string }) {
  const empty = money.rows.length === 0 && !money.internal;
  return (
    <Panel flush className="mb-8">
      <div className="px-5 pt-5">
        <PanelHeader title="Margin by project" hint={`${periodLabel}. Received minus third-party, expense and team cost, in INR.`} />
      </div>
      {empty ? (
        <EmptyState title="No settled money in this period" body="Received payments and paid costs show here once they are recorded." className="py-8" />
      ) : (
        <TableFrame className="rounded-none shadow-none">
          <Table caption={`Margin by project, ${periodLabel}`} className="min-w-[46rem]">
            <THead>
              <tr>
                <Th>Project</Th>
                <Th numeric>Received</Th>
                <Th numeric>Third-party</Th>
                <Th numeric>Expenses</Th>
                <Th numeric>Team</Th>
                <Th numeric>Margin</Th>
                <Th numeric>Margin %</Th>
              </tr>
            </THead>
            <tbody>
              {money.rows.map((r) => (
                <Tr key={r.projectId} flag={r.marginInr < 0}>
                  <Td>
                    <RowLink href={`/admin/projects/${r.projectId}`}>{r.name}</RowLink>
                    <span className="block text-[12px] text-pd-ink-3"><span className="font-pd-mono">{r.ref}</span> · {r.clientName}</span>
                  </Td>
                  <Td numeric>{formatInr(r.receivedInr)}</Td>
                  <Td numeric>{formatInr(r.thirdPartyInr)}</Td>
                  <Td numeric>{formatInr(r.expenseInr)}</Td>
                  <Td numeric>{formatInr(r.teamInr)}</Td>
                  <Td numeric>{formatInr(r.marginInr)}</Td>
                  <Td numeric>{pct(r.marginPct)}</Td>
                </Tr>
              ))}
              {money.internal ? (
                <Tr>
                  <Td>
                    <span className="font-medium">Internal</span>
                    <span className="block text-[12px] text-pd-ink-3">{formatCount(money.internal.projects)} {money.internal.projects === 1 ? 'project' : 'projects'} of our own: costs only, never revenue</span>
                  </Td>
                  <Td numeric>-</Td>
                  <Td numeric>{formatInr(money.internal.thirdPartyInr)}</Td>
                  <Td numeric>{formatInr(money.internal.expenseInr)}</Td>
                  <Td numeric>{formatInr(money.internal.teamInr)}</Td>
                  <Td numeric>{formatInr(-money.internal.costInr)}</Td>
                  <Td numeric>-</Td>
                </Tr>
              ) : null}
              <TotalRow>
                <Td>Client projects{money.projectsWithMoney > money.rows.length ? `, all ${formatCount(money.projectsWithMoney)}` : ''}</Td>
                <Td numeric>{formatInr(money.receivedInr)}</Td>
                <Td numeric>{formatInr(money.thirdPartyInr)}</Td>
                <Td numeric>{formatInr(money.expenseInr)}</Td>
                <Td numeric>{formatInr(money.teamInr)}</Td>
                <Td numeric>{formatInr(money.marginInr)}</Td>
                <Td numeric>{pct(money.marginPct)}</Td>
              </TotalRow>
            </tbody>
          </Table>
        </TableFrame>
      )}
      {money.projectsWithMoney > money.rows.length ? (
        <p className="px-5 py-3 text-[12px] text-pd-ink-3">
          Showing the {formatCount(money.rows.length)} projects with the most received of {formatCount(money.projectsWithMoney)}. The total covers all of them.
        </p>
      ) : null}
    </Panel>
  );
}

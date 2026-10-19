import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatInr } from '@/lib/admin/format';
import type { OverviewDashboard, TopProject } from '@/services/dashboards/overview';

const pct = (p: number | null) => (p === null ? '-' : `${p}%`);

/**
 * The best margins of the period: received minus third-party, expense and team cost. Our own projects are
 * costs without revenue and are not ranked. A loss shows as a negative figure and takes the red margin
 * line, so it is never told by colour alone.
 */
export function TopProjectsPanel({ projects, period }: { projects: TopProject[]; period: OverviewDashboard['period'] }) {
  return (
    <Panel flush>
      <div className="px-5 pt-5">
        <PanelHeader title="Top projects by margin" hint={`${period.label}. Received minus third-party, expense and team cost.`} />
      </div>
      {projects.length === 0 ? (
        <EmptyState title="No settled money in this period" body="Received payments and paid costs show here once they are recorded." className="py-8" />
      ) : (
        <TableFrame className="rounded-none shadow-none">
          <Table caption={`Top projects by margin, ${period.label}`} className="min-w-0">
            <THead>
              <tr>
                <Th>Project</Th>
                <Th numeric>Margin</Th>
                <Th numeric>%</Th>
              </tr>
            </THead>
            <tbody>
              {projects.map((p) => (
                <Tr key={p.projectId} flag={p.marginInr < 0}>
                  <Td className="py-2">
                    <RowLink href={`/admin/projects/${p.projectId}`}>{p.name}</RowLink>
                    <span className="block text-[12px] text-pd-ink-3"><span className="font-pd-mono">{p.ref}</span> · {p.clientName}</span>
                    <span className="pd-figure block text-[12px] text-pd-ink-3">Received {formatInr(p.receivedInr)}</span>
                  </Td>
                  <Td numeric>{formatInr(p.marginInr)}</Td>
                  <Td numeric>{pct(p.marginPct)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableFrame>
      )}
    </Panel>
  );
}

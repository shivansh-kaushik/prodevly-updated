import { formatNative } from '@/components/admin/money';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatAgo, formatDate, humanize } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { ProjectListItem } from '@/services/project.service';
import { PRICING_LABELS, typeLabel } from './labels';
import type { PricingModelKey } from './types';

/** The project register. Server-rendered: sorting is a link, so it works without client JS. */
export function ProjectsTable({
  items,
  params,
  sort,
  dir,
  showMoney,
}: {
  items: ProjectListItem[];
  params: RawSearchParams;
  sort: string;
  dir: 'asc' | 'desc';
  showMoney: boolean;
}) {
  const sortable = (key: string) => ({ key, path: '/admin/projects', params, active: sort, dir });
  return (
    <TableFrame>
      <Table caption="Projects" className="min-w-[54rem]">
        <THead>
          <tr>
            <Th sort={sortable('name')}>Project</Th>
            <Th>Type</Th>
            <Th sort={sortable('status')}>Status</Th>
            <Th>Health</Th>
            <Th>Lead</Th>
            <Th sort={sortable('deadlineOn')}>Deadline</Th>
            {showMoney ? <Th numeric>Contract</Th> : null}
            <Th sort={sortable('updatedAt')}>Updated</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((p) => (
            <Tr key={p.id} flag={p.overdue || (p.health === 'off_track' && !p.archived)}>
              <Td className="max-w-72">
                <RowLink href={`/admin/projects/${p.id}`}>{p.name}</RowLink>
                {p.archived ? <Badge className="ml-2">Archived</Badge> : null}
                <span className="block truncate text-[12px] text-pd-ink-3"><span className="font-pd-mono">{p.ref}</span> · {p.clientName}</span>
              </Td>
              <Td muted>{typeLabel(p.type)}</Td>
              <Td><StatusBadge status={p.status} /></Td>
              <Td><StatusBadge status={p.health} label={humanize(p.health)} /></Td>
              <Td muted>{p.lead ?? 'No lead'}</Td>
              <Td className="whitespace-nowrap">
                {p.deadlineOn ? formatDate(p.deadlineOn) : <span className="text-pd-ink-3">No deadline</span>}
                {p.overdue ? <Badge tone="rubric" className="ml-2">Overdue</Badge> : null}
              </Td>
              {showMoney ? (
                <Td numeric>
                  {p.contract && p.contract.amountMinor > 0 ? (
                    formatNative(p.contract.amountMinor, p.contract.currency)
                  ) : (
                    <span className="text-pd-ink-3">{p.contract ? PRICING_LABELS[p.contract.pricingModel as PricingModelKey] : ''}</span>
                  )}
                </Td>
              ) : null}
              <Td muted className="whitespace-nowrap">{formatAgo(p.updatedAt)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableFrame>
  );
}

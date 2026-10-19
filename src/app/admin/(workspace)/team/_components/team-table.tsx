import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatCount, formatHours, humanize } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { TeamMemberDTO } from '@/services/team.service';

const PATH = '/admin/team';
const SKILLS_SHOWN = 4;

/**
 * The directory. No pay column and no pay link: this table is read by every admin, and pay is not in its data. A name links to the
 * person page only where that page opens for the viewer (their own, or `canOpenPeople` for a holder of `audit:viewAll`); for anyone
 * else the page is a 404, so the name is plain text.
 */
export function TeamTable({
  members,
  sp,
  sort,
  dir,
  viewerId,
  filtered,
  canCreateAccounts,
  canOpenPeople = false,
}: {
  members: TeamMemberDTO[];
  sp: RawSearchParams;
  sort: string;
  dir: 'asc' | 'desc';
  viewerId: string;
  filtered: boolean;
  canCreateAccounts: boolean;
  canOpenPeople?: boolean;
}) {
  const sortOf = (key: string) => ({ key, path: PATH, params: sp, active: sort, dir });
  return (
    <TableFrame>
      <Table caption="Team directory" className="min-w-[58rem]">
        <THead>
          <tr>
            <Th sort={sortOf('name')}>Person</Th>
            <Th sort={sortOf('jobRole')}>Job role</Th>
            <Th>Employment</Th>
            <Th numeric>Capacity</Th>
            <Th numeric sort={sortOf('openTasks')}>Open tasks</Th>
            <Th numeric sort={sortOf('loggedMinutes')}>Hours</Th>
            <Th numeric sort={sortOf('utilisation')}>Utilisation</Th>
            <Th>Skills</Th>
          </tr>
        </THead>
        <tbody>
          {members.map((m) => (
            <Tr key={m.id} flag={m.overdueTasks > 0}>
              <Td className="min-w-48 py-2">
                {canOpenPeople || m.id === viewerId ? <RowLink href={`/admin/team/${m.id}`}>{m.name}</RowLink> : <span className="font-medium text-pd-ink">{m.name}</span>}
                {m.id === viewerId ? <span className="ml-2 text-[12px] text-pd-ink-3">(you)</span> : null}
                {m.status === 'deactivated' ? <Badge tone="rubric" className="ml-2">Removed</Badge> : null}
                <span className="block text-[12px] text-pd-ink-3">{m.email}</span>
              </Td>
              <Td className="min-w-40 py-2">
                {m.jobRole ? (
                  <>
                    <span>{m.jobRole.name}</span>
                    {m.jobRole.archived ? <span className="ml-1.5 text-[12px] text-pd-ink-3">(archived)</span> : null}
                  </>
                ) : (
                  <span className="text-pd-ink-3">Not set</span>
                )}
                {m.designation ? <span className="block text-[12px] text-pd-ink-3">{m.designation}</span> : null}
              </Td>
              <Td muted>{m.employmentType ? humanize(m.employmentType) : 'Not set'}</Td>
              <Td numeric muted={m.weeklyCapacityHours === null}>{m.weeklyCapacityHours === null ? 'Not set' : `${m.weeklyCapacityHours} h/week`}</Td>
              <Td numeric className="py-2">
                {formatCount(m.openTasks)}
                {m.overdueTasks > 0 ? <span className="mt-0.5 block text-[12px] font-medium text-pd-rubric">{formatCount(m.overdueTasks)} overdue</span> : null}
              </Td>
              <Td numeric>{formatHours(m.loggedMinutes)}</Td>
              <Td numeric muted={m.utilisationPercent === null}>
                {m.utilisationPercent === null ? (
                  <span title={m.weeklyCapacityHours === null ? 'Set a weekly capacity to see this' : 'Not available for this period'}>–</span>
                ) : (
                  `${m.utilisationPercent}%`
                )}
              </Td>
              <Td className="min-w-40 py-2">
                {m.skills.length === 0 ? (
                  <span className="text-pd-ink-3">None listed</span>
                ) : (
                  <ul className="flex flex-wrap gap-1">
                    {m.skills.slice(0, SKILLS_SHOWN).map((s) => (
                      <li key={s} className="rounded-pd-sm bg-pd-well px-1.5 py-0.5 text-[12px] text-pd-ink-2">{s}</li>
                    ))}
                    {m.skills.length > SKILLS_SHOWN ? <li className="px-1 py-0.5 text-[12px] text-pd-ink-3">+{m.skills.length - SKILLS_SHOWN} more</li> : null}
                  </ul>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {members.length === 0 ? (
        <EmptyState
          title={filtered ? 'No one matches' : 'No people yet'}
          body={filtered ? 'Try a different search, or clear the filters.' : 'People appear here once their accounts are created.'}
          action={
            filtered ? (
              <Link href={PATH} className="text-[14px] underline" prefetch={false}>Clear filters</Link>
            ) : canCreateAccounts ? (
              <Link href="/admin/admins/new" className="text-[14px] underline" prefetch={false}>Create an account</Link>
            ) : undefined
          }
          className="py-10"
        />
      ) : null}
    </TableFrame>
  );
}

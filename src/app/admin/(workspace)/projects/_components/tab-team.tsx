import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { formatHours } from '@/lib/admin/format';
import type { ProjectTeamDTO } from '@/services/dashboards/projects';
import { TeamEditor } from './team-editor';

/** Who is on the project and the hours logged against it. Per-person hours need worklog:viewAll; everyone sees the total. */
export function TeamTab({ projectId, team, canEdit }: { projectId: string; team: ProjectTeamDTO; canEdit: boolean }) {
  const onTeam = team.members.filter((m) => m.member).map((m) => ({ id: m.id, label: m.name }));
  const lead = team.lead?.id ? { id: team.lead.id, label: team.lead.name } : null;
  return (
    <Panel flush>
      <div className="px-5 pt-5">
        <PanelHeader title="Team and hours" hint="Hours are the time logged on this project's tasks." action={canEdit ? <TeamEditor projectId={projectId} lead={lead} members={onTeam} /> : undefined} />
      </div>
      {team.members.length === 0 ? (
        <EmptyState title="No one on the team yet" body="Add a lead and the people working on this project." className="py-8" />
      ) : (
        <TableFrame className="rounded-none shadow-none">
          <Table caption="Project team and logged hours" className="min-w-[32rem]">
            <THead>
              <tr><Th>Person</Th><Th numeric>Hours</Th><Th numeric>Billable</Th></tr>
            </THead>
            <tbody>
              {team.members.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <span className="font-medium">{m.name}</span>
                    {m.isLead ? <Badge tone="blue" className="ml-2">Lead</Badge> : null}
                    {!m.active ? <Badge tone="rubric" className="ml-2">Removed</Badge> : null}
                    {!m.member ? <Badge className="ml-2">Not on the team</Badge> : null}
                    {m.designation ? <span className="block text-[12px] text-pd-ink-3">{m.designation}</span> : null}
                  </Td>
                  <Td numeric>{m.minutes === null ? '-' : formatHours(m.minutes)}</Td>
                  <Td numeric>{m.billableMinutes === null ? '-' : formatHours(m.billableMinutes)}</Td>
                </Tr>
              ))}
              <TotalRow>
                <Td>Project total</Td>
                <Td numeric>{formatHours(team.totalMinutes)}</Td>
                <Td />
              </TotalRow>
            </tbody>
          </Table>
        </TableFrame>
      )}
      {!team.sawAllHours ? <p className="px-5 py-3 text-[12px] text-pd-ink-3">You can see your own hours and the project total. Seeing everyone&apos;s hours needs work-log access.</p> : null}
    </Panel>
  );
}

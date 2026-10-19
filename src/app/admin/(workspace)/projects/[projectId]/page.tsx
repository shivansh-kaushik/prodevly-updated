import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { TabLinks } from '@/components/ui/tabs';
import { AppError } from '@/lib/api/errors';
import { oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import { getCurrentAdmin, requireAdminPage } from '@/lib/auth/page-guard';
import { parseObjectId } from '@/lib/validation/common';
import { getProjectActivity, getProjectMoney, getProjectTasks, getProjectTeam } from '@/services/dashboards/projects';
import { canReopenProjects, getProject, type ProjectDTO } from '@/services/project.service';
import { projectMoneyLinks } from '../_components/money-links';
import { ProjectActions } from '../_components/project-actions';
import { MoneyTab } from '../_components/tab-money';
import { OverviewTab } from '../_components/tab-overview';
import { TasksTab } from '../_components/tab-tasks';
import { TeamTab } from '../_components/tab-team';
import { HEALTH_LABELS } from '../_components/labels';

/** A missing or malformed project is a 404; anything else (the database is down) is a real error. */
async function loadOrNull(load: () => Promise<ProjectDTO>): Promise<ProjectDTO | null> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }): Promise<Metadata> {
  const { admin } = await getCurrentAdmin();
  if (!admin) return { title: 'Project' };
  const project = await loadOrNull(async () => getProject(admin, (await params).projectId)).catch(() => null);
  return { title: project?.name ?? 'Project' };
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/projects', { capability: 'project:view' });
  const id = parseObjectId((await params).projectId);
  const sp = await searchParams;
  const project = await loadOrNull(() => getProject(viewer, id));
  if (!project) notFound();

  const caps = viewer.capabilities;
  const canEdit = caps.has('project:edit') && !project.archivedAt;
  const canEditMoney = canEdit && caps.has('payment:record');
  const tabs = [
    { key: 'overview', label: 'Overview' },
    ...(caps.has('task:view') ? [{ key: 'tasks', label: 'Tasks' }] : []),
    ...(caps.has('payment:view') ? [{ key: 'money', label: 'Money' }] : []),
    { key: 'team', label: 'Team' },
    { key: 'activity', label: 'Activity' },
  ];
  const tab = oneOf(sp, 'tab', tabs.map((t) => t.key)) ?? 'overview';
  const base = `/admin/projects/${project.id}`;

  let body: React.ReactNode;
  if (tab === 'tasks') {
    // Tasks are created from the Tasks section with the project chosen; that form is for task:edit and refuses an archived project.
    const addTaskHref = caps.has('task:edit') && !project.archivedAt ? `/admin/tasks/new?projectId=${project.id}` : undefined;
    body = <TasksTab tasks={await getProjectTasks(viewer, project.id)} addTaskHref={addTaskHref} />;
  } else if (tab === 'money' && project.money) {
    body = (
      <MoneyTab
        project={{ ...project, money: project.money }}
        report={await getProjectMoney(viewer, project.id)}
        canEdit={canEditMoney}
        links={projectMoneyLinks(caps, Boolean(project.archivedAt))}
      />
    );
  } else if (tab === 'team') {
    body = <TeamTab projectId={project.id} team={await getProjectTeam(viewer, project.id)} canEdit={canEdit} />;
  } else if (tab === 'activity') {
    body = (
      <Panel>
        <AuditFeed entries={await getProjectActivity(viewer, project.id, 40)} emptyTitle="No activity on this project yet" />
      </Panel>
    );
  } else {
    body = <OverviewTab project={project} canViewClient={caps.has('client:view')} />;
  }

  return (
    <>
      <PageHeader
        title={project.name}
        description={
          caps.has('client:view') ? (
            <>For <Link href={`/admin/clients/${project.clientId}`} prefetch={false} className="underline underline-offset-2">{project.clientName}</Link></>
          ) : (
            `For ${project.clientName}`
          )
        }
        crumbs={[{ label: 'Projects', href: '/admin/projects' }, { label: project.name }]}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-pd-mono text-[12px] text-pd-ink-3">{project.ref}</span>
            <StatusBadge status={project.status} />
            <StatusBadge status={project.health} label={HEALTH_LABELS[project.health]} />
            {project.archivedAt ? <Badge>Archived</Badge> : null}
          </span>
        }
        actions={
          <ProjectActions
            id={project.id}
            name={project.name}
            status={project.status}
            archived={Boolean(project.archivedAt)}
            canEdit={caps.has('project:edit')}
            canArchive={caps.has('project:archive')}
            canReopen={canReopenProjects(viewer)}
          />
        }
      />
      <div className="mb-6">
        <TabLinks tabs={tabs} active={tab} path={base} params={sp} />
      </div>
      {body}
    </>
  );
}

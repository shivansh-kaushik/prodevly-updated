import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { AppError } from '@/lib/api/errors';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { parseObjectId } from '@/lib/validation/common';
import { getProjectTeam } from '@/services/dashboards/projects';
import { getProject, type ProjectDTO } from '@/services/project.service';
import { getSettings } from '@/services/settings.service';
import { ProjectForm } from '../../_components/project-form';

export const metadata: Metadata = { title: 'Edit project' };

export default async function EditProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const viewer = await requireAdminPage('/admin/projects', { capability: 'project:edit' });
  const id = parseObjectId((await params).projectId);

  let project: ProjectDTO;
  try {
    project = await getProject(viewer, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  // An archived project is read-only until it is restored.
  if (project.archivedAt) redirect(`/admin/projects/${project.id}`);

  const [team, settings] = await Promise.all([getProjectTeam(viewer, id), getSettings()]);
  const canEditMoney = viewer.capabilities.has('payment:record') && project.money !== null;
  const currencies = [...new Set([...settings.enabledCurrencies, ...(project.money ? [project.money.contract.currency] : [])])];

  return (
    <>
      <PageHeader
        title="Edit project"
        description={`${project.ref}. Status changes are made from the project page, so each one keeps its note.`}
        crumbs={[{ label: 'Projects', href: '/admin/projects' }, { label: project.name, href: `/admin/projects/${project.id}` }, { label: 'Edit' }]}
      />
      <ProjectForm
        canEditMoney={canEditMoney}
        currencies={currencies}
        initial={{
          id: project.id,
          clientId: project.clientId,
          clientName: project.clientName,
          name: project.name,
          type: project.type,
          priority: project.priority,
          health: project.health,
          lead: project.lead?.id ? { id: project.lead.id, label: project.lead.name } : null,
          members: team.members.filter((m) => m.member).map((m) => ({ id: m.id, label: m.name })),
          startOn: project.startOn,
          deadlineOn: project.deadlineOn,
          scopeSummary: project.scopeSummary,
          links: project.links,
          tags: project.tags,
          contract: canEditMoney && project.money ? project.money.contract : null,
          costBudgetInrMinor: canEditMoney && project.money ? project.money.costBudgetInrMinor : null,
          currencyLocked: Boolean(project.money && project.money.milestones.length > 0),
        }}
      />
    </>
  );
}

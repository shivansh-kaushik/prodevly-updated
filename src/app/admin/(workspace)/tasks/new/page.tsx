import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { objectIdParam, type RawSearchParams } from '@/lib/admin/search-params';
import { getProjectLabel } from '@/services/task.service';
import { TaskForm } from '../_components/task-form';

export const metadata: Metadata = { title: 'New task' };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/tasks/new', { capability: 'task:edit' });
  // `?projectId=` lets a project page link straight here with its project already chosen.
  const projectId = objectIdParam(await searchParams, 'projectId');
  const project = projectId ? await getProjectLabel(viewer, projectId) : null;
  return (
    <>
      <PageHeader
        title="New task"
        description="A task belongs to one project. Its client follows the project."
        crumbs={[{ label: 'Tasks', href: '/admin/tasks' }, { label: 'New task' }]}
      />
      <TaskForm initialProject={project ? { id: project.id, label: project.label, ref: project.ref } : null} />
    </>
  );
}

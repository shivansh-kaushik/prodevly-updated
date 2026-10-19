import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import type { OverviewDashboard } from '@/services/dashboards/overview';

/**
 * What to do on an empty database. Every figure on the page is a total of records, so until there are
 * records the next step is to add the first one. It names a step only for someone who can take it.
 */
export function FirstSteps({ setup, canAddClient, canAddProject }: { setup: OverviewDashboard['setup']; canAddClient: boolean; canAddProject: boolean }) {
  if (setup.hasClients === false) {
    return (
      <Panel flush className="mb-6">
        <EmptyState
          title="No clients yet"
          body="Projects, tasks and payments are all recorded against a client, so start there. The figures below fill in as records are added."
          action={canAddClient ? <LinkButton href="/admin/clients/new" variant="primary">Add your first client</LinkButton> : undefined}
          className="py-10"
        />
      </Panel>
    );
  }
  if (setup.hasProjects === false) {
    return (
      <Panel flush className="mb-6">
        <EmptyState
          title="No projects yet"
          body="Add a project to track its deadline, tasks and money."
          action={canAddProject ? <LinkButton href="/admin/projects/new" variant="primary">Add your first project</LinkButton> : undefined}
          className="py-10"
        />
      </Panel>
    );
  }
  return null;
}

import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { listTeamRoles } from '@/services/team-role.service';
import { RolesManager } from './_components/roles-manager';

export const metadata: Metadata = { title: 'Job roles' };

export default async function JobRolesPage() {
  const viewer = await requireAdminPage('/admin/team/roles', { capability: 'settings:edit' });
  const roles = await listTeamRoles(viewer);
  return (
    <>
      <PageHeader
        title="Job roles"
        description="The labels people carry on the team: Frontend developer, Project manager. A job role gives no access to anything."
        crumbs={[{ label: 'Team', href: '/admin/team' }, { label: 'Job roles' }]}
      />
      <RolesManager roles={roles} />
    </>
  );
}

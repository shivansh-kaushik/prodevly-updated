import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { objectIdParam, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getClientOption } from '@/services/project.service';
import { getSettings } from '@/services/settings.service';
import { ProjectForm } from '../_components/project-form';

export const metadata: Metadata = { title: 'New project' };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/projects/new', { capability: 'project:edit' });
  const sp = await searchParams;
  // "New project for this client" links carry the client in the URL; accept either spelling.
  const clientId = objectIdParam(sp, 'client') ?? objectIdParam(sp, 'clientId');
  const [settings, client] = await Promise.all([
    getSettings(),
    clientId && viewer.capabilities.has('client:view') ? getClientOption(viewer, clientId) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="New project"
        description="Pick the client, name the work and say who leads it. Money can be added now or later by someone with payment access."
        crumbs={[{ label: 'Projects', href: '/admin/projects' }, { label: 'New project' }]}
      />
      <ProjectForm
        canEditMoney={viewer.capabilities.has('payment:record')}
        currencies={settings.enabledCurrencies}
        defaultClient={client ? { id: client.id, label: client.label, ref: client.ref } : null}
      />
    </>
  );
}

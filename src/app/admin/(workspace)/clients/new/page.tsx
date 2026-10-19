import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getClientFormOptions } from '@/services/client.service';
import { blankClient, ClientForm } from '../_components/client-form';

export const metadata: Metadata = { title: 'New client' };

export default async function NewClientPage() {
  await requireAdminPage('/admin/clients/new', { capability: 'client:edit' });
  const { currencies } = await getClientFormOptions();
  return (
    <>
      <PageHeader title="New client" description="Start with a name. Everything else can be filled in later." crumbs={[{ label: 'Clients', href: '/admin/clients' }, { label: 'New client' }]} />
      <ClientForm initial={blankClient()} currencies={currencies} />
    </>
  );
}

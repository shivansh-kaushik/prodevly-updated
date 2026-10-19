import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { parseObjectId } from '@/lib/validation/common';
import { getClientById, getClientFormOptions } from '@/services/client.service';
import { blankClient, ClientForm, type ClientFormValues } from '../../_components/client-form';
import { emptyContact } from '../../_components/contacts-editor';

export const metadata: Metadata = { title: 'Edit client' };

export default async function EditClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const viewer = await requireAdminPage('/admin/clients', { capability: 'client:edit' });
  const id = parseObjectId((await params).clientId);
  const [client, { currencies }] = await Promise.all([getClientById(viewer, id), getClientFormOptions()]);

  const initial: ClientFormValues = {
    ...blankClient(),
    name: client.name,
    kind: client.kind,
    status: client.status,
    industry: client.industry ?? '',
    source: client.source ?? '',
    country: client.country ?? '',
    billingCurrency: client.billingCurrency ?? '',
    gstin: client.gstin ?? '',
    taxId: client.taxId ?? '',
    website: client.website ?? '',
    address: {
      line1: client.address.line1 ?? '', line2: client.address.line2 ?? '', city: client.address.city ?? '',
      state: client.address.state ?? '', postalCode: client.address.postalCode ?? '', country: client.address.country ?? '',
    },
    contacts: client.contacts.length > 0
      ? client.contacts.map((c) => ({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', designation: c.designation ?? '', isPrimary: c.isPrimary }))
      : [emptyContact(true)],
    owner: client.accountOwner?.id ? { id: client.accountOwner.id, label: client.accountOwner.name } : null,
    tags: client.tags.join(', '),
    notes: client.notes ?? '',
  };
  return (
    <>
      <PageHeader title={`Edit ${client.name}`} crumbs={[{ label: 'Clients', href: '/admin/clients' }, { label: client.name, href: `/admin/clients/${client.id}` }, { label: 'Edit' }]} />
      <ClientForm initial={initial} clientId={client.id} currencies={currencies} internal={client.isInternal} />
    </>
  );
}

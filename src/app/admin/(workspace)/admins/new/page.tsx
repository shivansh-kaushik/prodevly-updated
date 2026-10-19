import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { CreateAdminForm } from '../_components/create-admin-form';

export const metadata: Metadata = { title: 'New account' };

export default async function NewAdminPage() {
  await requireAdminPage('/admin/admins/new', { capability: 'admin:manage' });
  return (
    <>
      <PageHeader
        title="New account"
        description="They sign in with this email and the temporary password, and must choose their own straight away."
        crumbs={[{ label: 'Admins', href: '/admin/admins' }, { label: 'New account' }]}
      />
      <CreateAdminForm />
    </>
  );
}

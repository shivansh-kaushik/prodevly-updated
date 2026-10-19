import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatDate, formatDateTime, humanize } from '@/lib/admin/format';
import { parseObjectId } from '@/lib/validation/common';
import { getAdminById, listOpenTasksFor } from '@/services/admin.service';
import { getActivity } from '@/services/activity.service';
import { AccessPanel } from '../_components/access-panel';
import { AccountActions } from '../_components/account-actions';

export async function generateMetadata({ params }: { params: Promise<{ adminId: string }> }): Promise<Metadata> {
  const admin = await getAdminById((await params).adminId).catch(() => null);
  return { title: admin?.name ?? 'Account' };
}

export default async function AdminAccessPage({ params }: { params: Promise<{ adminId: string }> }) {
  const viewer = await requireAdminPage('/admin/admins', { capability: 'admin:manage' });
  const id = parseObjectId((await params).adminId);
  const [admin, openTasks, activity] = await Promise.all([
    getAdminById(id).catch(() => null),
    listOpenTasksFor(id),
    getActivity({ entityType: 'admin', entityId: id }, { limit: 15 }),
  ]);
  if (!admin) notFound();

  const self = admin.id === viewer.id;
  const removed = admin.status === 'deactivated';
  const lockedReason = self
    ? 'You cannot change your own access. Another superadmin can.'
    : removed
      ? 'Reactivate this account before changing its access.'
      : undefined;

  return (
    <>
      <PageHeader
        title={admin.name}
        description={admin.email}
        crumbs={[{ label: 'Admins', href: '/admin/admins' }, { label: admin.name }]}
        meta={
          <span className="flex items-center gap-1.5">
            <Badge tone={admin.role === 'superadmin' ? 'rubric' : 'neutral'}>{admin.role === 'superadmin' ? 'Superadmin' : 'Admin'}</Badge>
            <StatusBadge status={admin.status} label={removed ? 'Removed' : undefined} />
            {self ? <Badge>You</Badge> : null}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Access" hint="Takes effect on their next click." />
            <AccessPanel id={admin.id} role={admin.role} grants={admin.grants} locked={self || removed} lockedReason={lockedReason} />
          </Panel>
          <Panel>
            <PanelHeader title="Activity" />
            <AuditFeed entries={activity} emptyTitle="No activity on this account yet" />
            <p className="pt-3 text-[13px]"><Link href={`/admin/audit?actor=${admin.id}`} prefetch={false} className="text-pd-ink-2 underline-offset-2 hover:underline">Everything this person has done</Link></p>
          </Panel>
        </div>
        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Account" />
            <DescriptionList
              columns={1}
              items={[
                { label: 'Created', value: formatDate(admin.createdAt) },
                { label: 'Last sign-in', value: admin.lastLoginAt ? formatDateTime(admin.lastLoginAt) : 'Never' },
                { label: 'Password', value: admin.mustChangePassword ? 'Temporary: they must set their own' : 'Set by them' },
                { label: 'Sign-in', value: admin.locked ? 'Locked after failed attempts (clears itself in 15 minutes)' : 'Open' },
                ...(removed ? [{ label: 'Removed', value: `${formatDate(admin.deactivatedAt)} by ${admin.deactivatedBy ?? 'a superadmin'}: ${admin.deactivationReason ?? ''}` }] : []),
                ...(admin.profile.designation ? [{ label: 'Title', value: admin.profile.designation }] : []),
                ...(admin.profile.employmentType ? [{ label: 'Employment', value: humanize(admin.profile.employmentType) }] : []),
              ]}
            />
          </Panel>
          {!self ? (
            <Panel>
              <PanelHeader title="Actions" />
              <AccountActions id={admin.id} name={admin.name} active={!removed} openTasks={openTasks} />
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

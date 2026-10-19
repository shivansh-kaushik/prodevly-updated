import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { humanize } from '@/lib/admin/format';
import { getOwnProfile } from '@/services/team.service';
import { OwnProfileForm } from './own-profile-form';
import { SignOutEverywhere } from './sign-out-everywhere';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountPage() {
  const admin = await requireAdminPage('/admin/account');
  const capabilities = [...admin.capabilities].sort();
  const profile = await getOwnProfile(admin);
  return (
    <>
      <PageHeader title="Your account" description="Who you are signed in as, and what you can do here." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Profile" />
            <DescriptionList
              items={[
                { label: 'Name', value: admin.name },
                { label: 'Email', value: admin.email },
                { label: 'Access', value: <Badge tone={admin.role === 'superadmin' ? 'rubric' : 'neutral'}>{admin.role === 'superadmin' ? 'Superadmin' : 'Admin'}</Badge> },
              ]}
              columns={3}
            />
          </Panel>
          <Panel>
            <PanelHeader title="Team profile" hint="What your colleagues see in the team directory." />
            <OwnProfileForm profile={profile} />
          </Panel>
          <Panel>
            <PanelHeader title="What you can do" hint="Your access is read fresh on every click. A superadmin can change it." />
            <ul className="flex flex-wrap gap-1.5">
              {capabilities.map((c) => (
                <li key={c}><span className="rounded-pd-sm bg-pd-well px-2 py-1 font-pd-mono text-[12px] text-pd-ink-2">{c}</span></li>
              ))}
            </ul>
            <p className="pt-3 text-[12px] text-pd-ink-3">{humanize(admin.role)} role, {capabilities.length} permissions.</p>
          </Panel>
        </div>
        <Panel className="flex h-fit flex-col gap-5">
          <div>
            <PanelHeader title="Password" />
            <p className="mb-3 text-[13px] text-pd-ink-3">Changing it signs you out on every other device.</p>
            <Link href="/admin/account/password" className={buttonClass('secondary')} prefetch={false}>Change password</Link>
          </div>
          <div className="border-t border-pd-rule pt-5">
            <PanelHeader title="Sessions" />
            <p className="mb-3 text-[13px] text-pd-ink-3">Lost a laptop, or signed in somewhere you should not have? End every other session.</p>
            <SignOutEverywhere />
          </div>
        </Panel>
      </div>
    </>
  );
}

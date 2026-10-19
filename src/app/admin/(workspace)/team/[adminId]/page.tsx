import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { PersonDashboardView } from '@/components/admin/person-dashboard';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { TabLinks } from '@/components/ui/tabs';
import { AppError } from '@/lib/api/errors';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { humanize } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { first, oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { parseObjectId } from '@/lib/validation/common';
import { getPersonDashboard } from '@/services/dashboards/person';
import { getPayProfile } from '@/services/pay-profile.service';
import { getSettings } from '@/services/settings.service';
import { listPersonPayouts } from '@/services/team-payout.service';
import { getTeamMember } from '@/services/team.service';
import { PaySection } from './_components/pay-section';

export const metadata: Metadata = { title: 'Team member' };

/** A person you may not open, and one who does not exist, look the same: a 404. Anything else (the database is down) is a real error. */
async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
}

export default async function PersonPage({ params, searchParams }: { params: Promise<{ adminId: string }>; searchParams: Promise<RawSearchParams> }) {
  const { adminId } = await params;
  const viewer = await requireAdminPage(`/admin/team/${adminId}`, { capability: 'team:view' });
  const id = await orNotFound(async () => parseObjectId(adminId));
  const sp = await searchParams;

  const caps = viewer.capabilities;
  const self = id === viewer.id.toLowerCase();
  // The same rule as the person dashboard: the person themself, or someone who may read other people's activity.
  if (!self && !caps.has('audit:viewAll')) notFound();
  const canSeePay = self || caps.has('team:payView');

  const period = await getPeriod(sp);
  const range = { from: period.from, to: period.to };
  const settings = await getSettings();
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));
  const member = await orNotFound(() => getTeamMember(viewer, id, range));

  const tabs = [{ key: 'overview', label: 'Overview' }, ...(canSeePay ? [{ key: 'pay', label: 'Pay' }] : [])];
  const tab = oneOf(sp, 'tab', tabs.map((t) => t.key)) ?? 'overview';
  const base = `/admin/team/${id}`;

  let body: React.ReactNode;
  if (tab === 'pay') {
    const [profile, payouts] = await orNotFound(() => Promise.all([getPayProfile(viewer, id), listPersonPayouts(viewer, id, 15)]));
    body = (
      <PaySection
        person={{ id, name: member.name }}
        profile={profile}
        payouts={payouts}
        canEditProfile={caps.has('team:payView') && !self}
        canRecord={caps.has('teamPayout:record')}
        canSeeAll={caps.has('team:payView')}
        currencies={settings.enabledCurrencies}
        today={today}
        self={self}
      />
    );
  } else {
    const dashboard = await orNotFound(() => getPersonDashboard(viewer, id, period));
    body = (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-pd-serif text-[20px] leading-7 font-semibold text-pd-ink">{self ? 'My numbers' : `${member.name}'s numbers`}</h2>
          <PeriodPicker current={period.key} from={first(sp, 'from')} to={first(sp, 'to')} />
        </div>
        <PersonDashboardView data={dashboard} isSelf={self} tasksHref={caps.has('task:view') ? `/admin/tasks?assignee=admin:${id}` : undefined} />
        <Panel className="mt-6">
          <PanelHeader title="Profile" />
          <DescriptionList
            columns={3}
            items={[
              { label: 'Email', value: member.email },
              { label: 'Job role', value: member.jobRole ? `${member.jobRole.name}${member.jobRole.archived ? ' (archived)' : ''}` : '' },
              { label: 'Employment', value: member.employmentType ? humanize(member.employmentType) : '' },
              { label: 'Weekly capacity', value: member.weeklyCapacityHours ? `${member.weeklyCapacityHours} hours` : '' },
              { label: 'Skills', value: member.skills.join(', ') },
            ]}
          />
        </Panel>
      </>
    );
  }

  const subtitle = [member.jobRole?.name, member.designation].filter(Boolean).join(', ');
  return (
    <>
      <PageHeader
        title={member.name}
        description={subtitle || member.email}
        crumbs={[{ label: 'Team', href: '/admin/team' }, { label: member.name }]}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            {member.status === 'deactivated' ? <Badge tone="rubric">Removed</Badge> : null}
            {self ? <Badge>You</Badge> : null}
          </span>
        }
        actions={
          caps.has('teamPayout:record') ? (
            <LinkButton href={`/admin/team/payouts/new?adminId=${id}`} variant="secondary">Record a payout</LinkButton>
          ) : undefined
        }
      />
      {tabs.length > 1 ? (
        <div className="mb-6">
          <TabLinks tabs={tabs} active={tab} path={base} params={sp} />
        </div>
      ) : null}
      {body}
    </>
  );
}

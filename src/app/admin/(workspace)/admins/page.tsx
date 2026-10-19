import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { AuditFeed } from '@/components/admin/audit-feed';
import { ChartCard } from '@/components/admin/chart-card';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { PageHeader } from '@/components/admin/page-header';
import { StatBand } from '@/components/admin/stat-band';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatAgo, formatCount, formatDateTime } from '@/lib/admin/format';
import { first, oneOf, parseListParams, withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { ADMIN_ROLES } from '@/config/capabilities';
import { ADMIN_STATUSES } from '@/config/statuses';
import { searchAdmins } from '@/services/admin.service';
import { getAdminsDashboard } from '@/services/dashboards/admins';

export const metadata: Metadata = { title: 'Admins' };

const SORTABLE = ['name', 'lastLoginAt', 'createdAt'] as const;

export default async function AdminsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/admins', { capability: 'admin:manage' });
  const sp = await searchParams;
  const list = parseListParams(sp, { sortable: SORTABLE, defaultSort: 'name', defaultDir: 'asc' });
  const status = oneOf(sp, 'status', ADMIN_STATUSES);
  const role = oneOf(sp, 'role', ADMIN_ROLES);

  const [dashboard, admins] = await Promise.all([
    getAdminsDashboard(viewer),
    searchAdmins({ q: list.q, status, role, sort: list.sort as (typeof SORTABLE)[number], dir: list.dir }),
  ]);
  const filtered = Boolean(first(sp, 'q') || status || role);

  return (
    <>
      <PageHeader
        title="Admins"
        description="People who can sign in. Only superadmins manage accounts."
        actions={<LinkButton href="/admin/admins/new" variant="primary"><Plus className="size-4" aria-hidden /> New account</LinkButton>}
      />

      <StatBand
        stats={[
          { label: 'Active accounts', value: formatCount(dashboard.active), sub: `${formatCount(dashboard.superadmins)} ${dashboard.superadmins === 1 ? 'superadmin' : 'superadmins'}`, href: withParams('/admin/admins', {}, { status: 'active' }) },
          { label: 'Removed', value: formatCount(dashboard.deactivated), href: withParams('/admin/admins', {}, { status: 'deactivated' }) },
          { label: 'Waiting for first password', value: formatCount(dashboard.pendingPasswordChange), attention: dashboard.pendingPasswordChange > 0 },
          { label: 'Locked now', value: formatCount(dashboard.locked), attention: dashboard.locked > 0 },
          { label: 'Failed sign-ins, 7 days', value: formatCount(dashboard.failedSignIns7d), attention: dashboard.failedSignIns7d >= 10 },
        ]}
        className="mb-6"
      />

      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title="Failed sign-ins"
          hint="Last 30 days"
          type="bar"
          data={dashboard.failuresByDay.map((d) => ({ day: d.day.slice(5), failures: d.failures }))}
          xKey="day"
          xLabel="Day"
          series={[{ key: 'failures', label: 'Failed sign-ins', color: '#b3301d' }]}
          kind="count"
          totals
          height={220}
          emptyBody="No failed sign-ins in the last 30 days."
        />
        <Panel>
          <PanelHeader title="Recent account changes" />
          <AuditFeed entries={dashboard.recentActions} emptyTitle="No account changes yet" />
        </Panel>
      </div>

      <DataToolbar
        searchPlaceholder="Search name or email"
        filters={[
          { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'deactivated', label: 'Removed' }] },
          { key: 'role', label: 'Access', options: [{ value: 'superadmin', label: 'Superadmin' }, { value: 'admin', label: 'Admin' }] },
        ]}
      />

      <TableFrame>
        <Table caption="Admin accounts">
          <THead>
            <tr>
              <Th sort={{ key: 'name', path: '/admin/admins', params: sp, active: list.sort, dir: list.dir }}>Name</Th>
              <Th>Access</Th>
              <Th>Status</Th>
              <Th sort={{ key: 'lastLoginAt', path: '/admin/admins', params: sp, active: list.sort, dir: list.dir }}>Last sign-in</Th>
              <Th>Notes</Th>
            </tr>
          </THead>
          <tbody>
            {admins.map((a) => (
              <Tr key={a.id} flag={a.locked}>
                <Td>
                  <RowLink href={`/admin/admins/${a.id}`}>{a.name}</RowLink>
                  {a.id === viewer.id ? <span className="ml-2 text-[12px] text-pd-ink-3">(you)</span> : null}
                  <span className="block text-[12px] text-pd-ink-3">{a.email}</span>
                </Td>
                <Td><Badge tone={a.role === 'superadmin' ? 'rubric' : 'neutral'}>{a.role === 'superadmin' ? 'Superadmin' : 'Admin'}</Badge></Td>
                <Td><StatusBadge status={a.status} label={a.status === 'deactivated' ? 'Removed' : undefined} /></Td>
                <Td muted>
                  {a.lastLoginAt ? <span title={formatDateTime(a.lastLoginAt)}>{formatAgo(a.lastLoginAt)}</span> : 'Never'}
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {a.locked ? <Badge tone="rubric">Locked</Badge> : null}
                    {a.mustChangePassword && a.status === 'active' ? <Badge tone="amber">Password not set</Badge> : null}
                  </span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {admins.length === 0 ? (
          <EmptyState
            title={filtered ? 'No accounts match' : 'No accounts yet'}
            body={filtered ? 'Try a different search or clear the filters.' : 'Create the first account.'}
            action={filtered ? <Link href="/admin/admins" className="text-[14px] underline">Clear filters</Link> : undefined}
            className="py-10"
          />
        ) : null}
      </TableFrame>
    </>
  );
}

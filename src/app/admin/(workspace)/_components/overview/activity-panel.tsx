import { AuditFeed } from '@/components/admin/audit-feed';
import { LinkButton } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/ui/panel';
import type { OverviewDashboard } from '@/services/dashboards/overview';

/**
 * The latest entries of the viewer's part of the audit log. The service already scoped them (everyone's for
 * a viewer of the whole log, otherwise only their own), and the wording says which it is.
 */
export function ActivityPanel({ activity }: { activity: OverviewDashboard['activity'] }) {
  const all = activity.scope === 'all';
  return (
    <Panel>
      <PanelHeader
        title={all ? 'Recent activity' : 'Your recent activity'}
        hint={all ? 'The latest changes by everyone' : 'The latest things you changed. Only superadmins see everyone’s.'}
        action={<LinkButton href="/admin/audit" variant="ghost" size="sm">View all</LinkButton>}
      />
      <AuditFeed entries={activity.entries} emptyTitle="No activity yet" />
    </Panel>
  );
}

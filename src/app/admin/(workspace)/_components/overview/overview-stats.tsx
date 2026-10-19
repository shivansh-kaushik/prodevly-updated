import { StatBand, type Stat } from '@/components/admin/stat-band';
import { formatCount, formatInr } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import type { OverviewDashboard } from '@/services/dashboards/overview';

/**
 * The totals bands of the Overview. Every tile is passed to the band only when the viewer may see it
 * (the service leaves the rest `null`), so a tile is never shown as zero for someone who may not see the
 * figure. The first tile of each band leads: company net when the viewer may see it, otherwise whichever
 * money tile comes first. Native amounts and counts are quiet sub-lines under the INR figure.
 */

/** "FY27" for a financial year, else the period's own label ("This month"). */
export const periodTag = (p: OverviewDashboard['period']) => p.fyLabel ?? p.label;

const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;
const joinCodes = (codes: readonly string[]) => (codes.length <= 2 ? codes.join(' and ') : `${codes.slice(0, -1).join(', ')} and ${codes.at(-1)}`);

/** Links to a section keep the chosen period (the section page reads the same params) and nothing else. */
function periodLink(path: string, params: RawSearchParams): string {
  return withParams(path, { period: params.period, from: params.from, to: params.to }, {});
}

export function buildMoneyStats(d: OverviewDashboard, params: RawSearchParams): Stat[] {
  const { money: m } = d;
  const tag = periodTag(d.period);
  const stats: Stat[] = [];

  // Leads the band, so it takes the double rule: the figure everything else adds up to.
  if (m.net) {
    stats.push({
      label: 'Company net',
      value: formatInr(m.net.inrMinor),
      sub: `${tag}: received less every cost paid`,
      attention: m.net.inrMinor < 0,
    });
  }
  if (m.received) {
    stats.push({ label: 'Received from clients', value: formatInr(m.received.inrMinor), sub: `${tag}, net of refunds`, href: periodLink('/admin/payments', params) });
  }
  if (m.thirdParties) {
    stats.push({
      label: 'Paid to third parties',
      value: formatInr(m.thirdParties.inrMinor),
      sub: `${plural(m.thirdParties.payouts, 'payout')}, ${tag}`,
      href: '/admin/third-parties/payouts?status=paid',
    });
  }
  if (m.expenses) {
    stats.push({
      label: 'Expenses',
      value: formatInr(m.expenses.inrMinor),
      sub: `${plural(m.expenses.count, 'expense')} approved or paid, ${tag}`,
      href: periodLink('/admin/expenses', params),
    });
  }
  if (m.team) {
    stats.push({ label: 'Team payouts', value: formatInr(m.team.inrMinor), sub: `Paid, ${tag}`, href: '/admin/team/payouts' });
  }
  if (m.outstanding) {
    const o = m.outstanding;
    const notes = ['At latest rates'];
    if (o.missingRates.length > 0) notes.push(`No rate for ${joinCodes(o.missingRates)}${o.inrMinor === null ? '' : ', left out'}`);
    if (o.overdueMilestones > 0) notes.push(`${plural(o.overdueMilestones, 'milestone')} overdue`);
    stats.push({
      label: 'Outstanding from clients',
      value: o.inrMinor === null ? 'Needs a rate' : formatInr(o.inrMinor),
      sub: `${notes.join('. ')}.`,
      attention: o.overdueMilestones > 0 || o.missingRates.length > 0,
      href: '/admin/payments',
    });
  }
  if (m.payables) {
    const p = m.payables;
    const notes = [`Due payouts ${formatInr(p.duePayouts.inrMinor)}`, `Reimbursements ${formatInr(p.reimbursements.inrMinor)}`];
    if (p.duePayouts.overdueCount > 0) notes.push(`${plural(p.duePayouts.overdueCount, 'payout')} overdue`);
    stats.push({
      label: 'Payables',
      value: formatInr(p.inrMinor),
      sub: `${notes.join('. ')}.`,
      attention: p.duePayouts.overdueCount > 0,
      href: '/admin/third-parties/payouts?status=due',
    });
  }
  return stats;
}

export function buildWorkStats(d: OverviewDashboard): Stat[] {
  const tag = periodTag(d.period);
  const stats: Stat[] = [];
  if (d.projects) {
    stats.push({ label: 'Active projects', value: formatCount(d.projects.active), sub: `${formatCount(d.projects.total)} in all`, href: '/admin/projects?status=active' });
    stats.push({ label: 'Overdue projects', value: formatCount(d.projects.overdue), sub: 'Deadline passed, not delivered', attention: d.projects.overdue > 0 });
  }
  if (d.tasks) {
    stats.push({
      label: 'Open tasks',
      value: formatCount(d.tasks.open),
      sub: d.tasks.blocked > 0 ? `${formatCount(d.tasks.blocked)} blocked` : `${formatCount(d.tasks.inProgress)} in progress`,
      href: '/admin/tasks?status=open',
    });
    stats.push({ label: 'Overdue tasks', value: formatCount(d.tasks.overdue), sub: 'Past their due date', attention: d.tasks.overdue > 0, href: '/admin/tasks?overdue=1' });
  }
  if (d.enquiries) {
    stats.push({ label: 'New enquiries', value: formatCount(d.enquiries.newInPeriod), sub: `Received, ${tag}`, href: '/admin/enquiries' });
    stats.push({
      label: 'Waiting for a first reply',
      value: formatCount(d.enquiries.waitingForFirstReply),
      sub: 'Still marked new',
      attention: d.enquiries.waitingForFirstReply > 0,
      href: '/admin/enquiries?status=new',
    });
  }
  return stats;
}

/** One ruled band under a small heading. Renders nothing when the viewer may see none of its tiles. */
export function OverviewBand({ id, title, stats }: { id: string; title: string; stats: Stat[] }) {
  if (stats.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mb-6">
      <h2 id={id} className="pd-eyebrow mb-2">{title}</h2>
      <StatBand stats={stats} />
    </section>
  );
}

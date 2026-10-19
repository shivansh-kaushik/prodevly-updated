import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { cx } from '@/lib/cx';
import { formatInr } from '@/lib/admin/format';
import type { ProjectsDashboard } from '@/services/dashboards/projects';

/** How much of each project's internal cost budget has been spent (all-time costs against the budget). The percent is always printed: the bar colour is a hint, never the message. */
export function BudgetPanel({ budgets }: { budgets: NonNullable<ProjectsDashboard['money']>['budgets'] }) {
  return (
    <Panel>
      <PanelHeader title="Cost budget used" hint="Projects with a cost budget, all-time costs" />
      {budgets.length === 0 ? (
        <EmptyState title="No cost budgets set" body="Add a cost budget to a project to see how much of it has been used." className="py-10" />
      ) : (
        <ul className="flex flex-col gap-4">
          {budgets.map((b) => (
            <li key={b.projectId} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Link href={`/admin/projects/${b.projectId}`} prefetch={false} className="min-w-0 truncate text-[14px] font-medium text-pd-ink hover:underline">{b.name}</Link>
                <span className={cx('pd-figure shrink-0 text-[14px] font-semibold', b.usedPct > 100 ? 'text-pd-rubric' : 'text-pd-ink')}>
                  {b.usedPct}%{b.usedPct > 100 ? ' over budget' : ''}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${b.name} cost budget used`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.round(b.usedPct))}
                className="h-2 overflow-hidden rounded-pd-sm bg-pd-well"
              >
                <div
                  className={cx('h-full', b.usedPct > 100 ? 'bg-pd-rubric' : b.usedPct >= 80 ? 'bg-pd-amber' : 'bg-pd-credit')}
                  style={{ width: `${Math.min(100, b.usedPct)}%` }}
                />
              </div>
              <p className="pd-figure text-[12px] text-pd-ink-3">{formatInr(b.costInr)} of {formatInr(b.budgetInr)}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

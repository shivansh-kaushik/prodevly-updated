import { formatNative } from '@/components/admin/money';
import { StatBand } from '@/components/admin/stat-band';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { cx } from '@/lib/cx';
import { formatDate, formatInr } from '@/lib/admin/format';
import type { ProjectMoneyReport } from '@/services/dashboards/projects';
import type { ProjectDTO } from '@/services/project.service';
import { MilestonesEditor } from './milestones-editor';
import { MoneyLinks, type ProjectMoneyLinks } from './money-links';
import { PRICING_LABELS } from './labels';

const pct = (p: number | null) => (p === null ? '' : `${p}%`);

/**
 * Contract, what has been received and what is owed, then where the margin stands now and where it is heading. `links` are the
 * shortcuts into the payments, expenses and third-party pages for this project (see `projectMoneyLinks`).
 */
export function MoneyTab({
  project,
  report,
  canEdit,
  links,
}: {
  project: ProjectDTO & { money: NonNullable<ProjectDTO['money']> };
  report: ProjectMoneyReport;
  canEdit: boolean;
  links?: ProjectMoneyLinks;
}) {
  const { contract, milestones } = project.money;
  const cur = contract.currency;
  const m = report.margin;
  const foreign = report.receivedByCurrency.filter((c) => c.currency !== 'INR');
  const proj = report.projected;

  return (
    <div className="flex flex-col gap-6">
      {links ? <MoneyLinks projectId={project.id} links={links} /> : null}
      <StatBand
        stats={[
          { label: 'Billable', value: formatNative(report.billableMinor, cur), sub: PRICING_LABELS[contract.pricingModel] },
          {
            label: 'Received',
            value: formatNative(report.receivedContractMinor, cur),
            sub: foreign.length ? foreign.map((c) => `${formatNative(c.nativeMinor, c.currency)} (${formatInr(c.inrMinor)})`).join(', ') : 'Net of refunds',
          },
          {
            label: report.outstandingMinor < 0 ? 'Received in advance' : 'Outstanding',
            value: formatNative(Math.abs(report.outstandingMinor), cur),
            sub: report.outstandingMinor < 0 ? 'More received than billable' : 'Billable less received',
          },
          { label: 'Margin', value: formatInr(m.marginInr), sub: m.marginPct !== null ? `${m.marginPct}% of received` : 'Nothing received yet', attention: m.marginInr < 0 },
          {
            label: 'Projected margin',
            value: proj ? formatInr(proj.projectedMarginInr) : 'Needs a rate',
            sub: proj ? (proj.projectedMarginPct !== null ? `${proj.projectedMarginPct}% at latest rates` : 'At latest rates') : `No exchange rate for ${report.missingRates.join(', ')}`,
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel flush>
          <div className="px-5 pt-5"><PanelHeader title="Margin so far" hint="Settled money only, in INR. Voided entries and rejected expenses are left out." /></div>
          <TableFrame className="rounded-none shadow-none">
            <Table caption="Margin so far" className="min-w-0">
              <THead><tr><Th>&nbsp;</Th><Th numeric>INR</Th></tr></THead>
              <tbody>
                <Tr><Td>Received, net of refunds</Td><Td numeric>{formatInr(m.receivedInr)}</Td></Tr>
                <Tr><Td>Third-party payouts paid</Td><Td numeric>{formatInr(-m.thirdPartyInr)}</Td></Tr>
                <Tr><Td>Expenses</Td><Td numeric>{formatInr(-m.expenseInr)}</Td></Tr>
                <Tr><Td>Team cost allocated</Td><Td numeric>{formatInr(-m.teamInr)}</Td></Tr>
                <TotalRow><Td>Margin {m.marginPct !== null ? <span className="font-normal text-pd-ink-3">({pct(m.marginPct)})</span> : null}</Td><Td numeric>{formatInr(m.marginInr)}</Td></TotalRow>
              </tbody>
            </Table>
          </TableFrame>
        </Panel>

        <Panel flush>
          <div className="px-5 pt-5">
            <PanelHeader
              title="Projected margin"
              hint={report.rate ? `Billable converted at ${report.rate.rate} INR per ${cur}, the latest rate (${formatDate(report.rate.rateOn)}).` : 'Billable total less everything paid or committed.'}
            />
          </div>
          {proj && report.billableInr !== null && report.committed.openWorkOrderInr !== null ? (
            <TableFrame className="rounded-none shadow-none">
              <Table caption="Projected margin" className="min-w-0">
                <THead><tr><Th>&nbsp;</Th><Th numeric>INR</Th></tr></THead>
                <tbody>
                  <Tr><Td>Billable total</Td><Td numeric>{formatInr(report.billableInr)}</Td></Tr>
                  <Tr><Td>Costs already paid</Td><Td numeric>{formatInr(-m.costInr)}</Td></Tr>
                  <Tr><Td>Third-party payouts due</Td><Td numeric>{formatInr(-report.committed.dueThirdPartyInr)}</Td></Tr>
                  <Tr><Td>Open work-order balances</Td><Td numeric>{formatInr(-report.committed.openWorkOrderInr)}</Td></Tr>
                  <Tr><Td>Team cost due</Td><Td numeric>{formatInr(-report.committed.dueTeamInr)}</Td></Tr>
                  <TotalRow><Td>Projected margin {proj.projectedMarginPct !== null ? <span className="font-normal text-pd-ink-3">({pct(proj.projectedMarginPct)})</span> : null}</Td><Td numeric>{formatInr(proj.projectedMarginInr)}</Td></TotalRow>
                </tbody>
              </Table>
            </TableFrame>
          ) : (
            <p className="px-5 pb-5 text-[14px] text-pd-ink-2">
              The projection needs an exchange rate for {report.missingRates.join(', ') || cur}. A superadmin or someone with FX access can add one in Settings.
            </p>
          )}
        </Panel>
      </div>

      {report.budget ? (
        <Panel>
          <PanelHeader title="Cost budget" hint="Internal. Costs paid so far against the budget you set." />
          <p className="pd-figure text-[14px] text-pd-ink">
            {formatInr(report.budget.costInr)} of {formatInr(report.budget.budgetInr)}
            <span className={cx('ml-2 font-semibold', (report.budget.usedPct ?? 0) > 100 && 'text-pd-rubric')}>
              {report.budget.usedPct === null ? '' : `${report.budget.usedPct}% used${report.budget.usedPct > 100 ? ', over budget' : ''}`}
            </span>
          </p>
        </Panel>
      ) : null}

      <MilestonesEditor
        projectId={project.id}
        currency={cur}
        pricingModel={contract.pricingModel}
        contractAmountMinor={contract.amountMinor}
        milestones={milestones}
        canEdit={canEdit}
      />

      <Panel>
        <PanelHeader title="Contract" />
        <DescriptionList
          items={[
            { label: 'Pricing', value: PRICING_LABELS[contract.pricingModel] },
            { label: 'Contract value', value: contract.amountMinor > 0 ? formatNative(contract.amountMinor, cur) : null },
            { label: 'Hourly rate', value: contract.hourlyRateMinor ? formatNative(contract.hourlyRateMinor, cur) : null },
            { label: 'Monthly fee', value: contract.retainerMonthlyMinor ? formatNative(contract.retainerMonthlyMinor, cur) : null },
            { label: 'Cost budget', value: project.money.costBudgetInrMinor ? formatInr(project.money.costBudgetInrMinor) : null },
            { label: 'Currency', value: cur },
          ]}
        />
      </Panel>
    </div>
  );
}

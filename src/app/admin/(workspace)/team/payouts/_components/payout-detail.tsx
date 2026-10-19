import Link from 'next/link';
import { fxSummary } from '@/components/admin/fx-field-model';
import { formatNative, Money } from '@/components/admin/money';
import { EmptyState } from '@/components/ui/empty-state';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { formatCount, formatDate, formatDateTime, formatDuration, formatInr, humanize } from '@/lib/admin/format';
import type { TeamPayoutDTO } from '@/services/team-payout.service';
import { basisLabel, payTermsText, periodText } from './labels';

const SOURCE_TEXT: Record<string, string> = {
  table: 'table rate',
  manual: 'rate entered by hand',
  bank: 'worked out from the INR that left the account',
};

/** The payout's own facts. A person reading their own payout gets exactly the fields the service gave them: nothing here asks for more. */
export function PayoutFacts({ payout }: { payout: TeamPayoutDTO }) {
  const { amount, detail } = payout;
  const foreign = amount.currency !== 'INR';
  return (
    <Panel>
      <PanelHeader title="Payout" />
      <DescriptionList
        items={[
          { label: 'Person', value: <Link href={`/admin/team/${payout.adminId}`} prefetch={false} className="underline underline-offset-2">{payout.adminName}</Link> },
          { label: 'Kind', value: basisLabel(payout.basis) },
          { label: 'Period', value: periodText(payout.periodFrom, payout.periodTo) },
          { label: 'Status', value: <StatusBadge status={payout.status} /> },
          {
            label: 'Amount',
            value: (
              <span className="flex flex-col">
                <Money amountMinor={amount.amountMinor} currency={amount.currency} inrMinor={amount.inrMinor} inline />
                {foreign ? (
                  <span className="pd-figure text-[12px] text-pd-ink-3">
                    {fxSummary({ currency: amount.currency, amountMinor: amount.amountMinor, inrMinor: amount.inrMinor, rate: amount.fxRate, basis: `${SOURCE_TEXT[amount.fxSource] ?? amount.fxSource}, ${formatDate(amount.fxDate)}` })}
                  </span>
                ) : null}
              </span>
            ),
          },
          { label: 'Due on', value: payout.dueOn ? formatDate(payout.dueOn) : '' },
          ...(payout.paidOn ? [{ label: 'Paid on', value: formatDate(payout.paidOn) }] : []),
          ...(payout.mode ? [{ label: 'Payment mode', value: humanize(payout.mode) }] : []),
          ...(payout.transactionRef ? [{ label: 'Transaction reference', value: <span className="font-pd-mono text-[13px]">{payout.transactionRef}</span> }] : []),
          ...(detail
            ? [
                { label: 'Recorded by', value: detail.recordedBy },
                ...(detail.paidBy ? [{ label: 'Marked paid by', value: detail.paidBy }] : []),
                ...(payout.status === 'void'
                  ? [{ label: 'Voided', value: `${detail.voidedBy ?? 'A superadmin'}${detail.voidedAt ? `, ${formatDateTime(detail.voidedAt)}` : ''}: ${detail.voidReason ?? ''}` }]
                  : []),
                ...(detail.note ? [{ label: 'Note', value: detail.note }] : []),
              ]
            : []),
        ]}
      />
    </Panel>
  );
}

/** The split across projects, with the totals closed the accountant's way: what is charged, what is overhead, the payout. */
export function AllocationsPanel({ payout, canViewProjects }: { payout: TeamPayoutDTO; canViewProjects: boolean }) {
  const detail = payout.detail;
  if (!detail) return null;
  const { amount } = payout;
  const nativeCharged = detail.allocations.reduce((s, a) => s + a.amountMinor, 0);
  return (
    <Panel flush className="p-5">
      <PanelHeader title="Charged to projects" hint={payout.status === 'paid' ? 'These shares count in each project\'s margin.' : 'These shares count in each project\'s margin once the payout is paid.'} />
      {detail.allocations.length === 0 ? (
        <EmptyState title="Not charged to any project" body="All of this payout is company overhead." className="py-8" />
      ) : (
        <TableFrame>
          <Table caption="Allocations to projects" className="min-w-[36rem]">
            <THead>
              <tr>
                <Th>Project</Th>
                <Th numeric>Time logged</Th>
                <Th numeric>Amount</Th>
                {amount.currency !== 'INR' ? <Th numeric>Share in INR</Th> : null}
              </tr>
            </THead>
            <tbody>
              {detail.allocations.map((a) => (
                <Tr key={a.projectId}>
                  <Td className="min-w-48 py-2">
                    {canViewProjects ? (
                      <Link href={`/admin/projects/${a.projectId}`} prefetch={false} className="font-medium underline-offset-2 hover:underline">{a.projectName}</Link>
                    ) : (
                      <span className="font-medium">{a.projectName}</span>
                    )}
                    {a.archived ? <span className="ml-1.5 text-[12px] text-pd-ink-3">(archived)</span> : null}
                    <span className="block text-[12px] text-pd-ink-3"><span className="font-pd-mono">{a.projectRef}</span> · {a.clientName}</span>
                  </Td>
                  <Td numeric muted={a.minutes === 0}>{a.minutes > 0 ? formatDuration(a.minutes) : 'None'}</Td>
                  <Td numeric>{formatNative(a.amountMinor, amount.currency)}</Td>
                  {amount.currency !== 'INR' ? <Td numeric>{formatInr(a.inrMinor)}</Td> : null}
                </Tr>
              ))}
              <TotalRow>
                <Td className="pl-4">Charged to projects</Td>
                <Td numeric />
                <Td numeric>{formatNative(nativeCharged, amount.currency)}</Td>
                {amount.currency !== 'INR' ? <Td numeric>{formatInr(detail.allocatedInrMinor)}</Td> : null}
              </TotalRow>
            </tbody>
          </Table>
        </TableFrame>
      )}
      <dl className="pd-figure mt-3 grid max-w-sm grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
        <dt className="text-pd-ink-3">Company overhead</dt>
        <dd className="text-right font-medium text-pd-ink">{formatInr(detail.unallocatedInrMinor)}</dd>
        <dt className="text-pd-ink-3">Payout in INR</dt>
        <dd className="text-right font-medium text-pd-ink">{formatInr(amount.inrMinor)}</dd>
      </dl>
    </Panel>
  );
}

/** What the system proposed, next to what was agreed, so a difference stays visible. */
export function ProposalPanel({ payout }: { payout: TeamPayoutDTO }) {
  const s = payout.detail?.suggestion;
  if (!s) return null;
  const { amount } = payout;
  const diff = s.currency === amount.currency ? amount.amountMinor - s.computedMinor : null;
  return (
    <Panel>
      <PanelHeader title="What was proposed" hint="From the pay profile when this payout was recorded." />
      <dl className="pd-figure grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
        <dt className="text-pd-ink-3">Proposed</dt>
        <dd className="text-right text-pd-ink">{formatNative(s.computedMinor, s.currency)}</dd>
        <dt className="text-pd-ink-3">Agreed</dt>
        <dd className="text-right font-medium text-pd-ink">{formatNative(amount.amountMinor, amount.currency)}</dd>
        {diff !== null && diff !== 0 ? (
          <>
            <dt className="text-pd-ink-3">Difference</dt>
            <dd className="text-right text-pd-ink">{diff > 0 ? '+' : '-'}{formatNative(Math.abs(diff), amount.currency)}</dd>
          </>
        ) : null}
      </dl>
      <p className="mt-3 text-[12px] leading-4 text-pd-ink-3">
        {payTermsText({ basis: s.rateMinor > 0 ? basisToPay(payout.basis) : 'none', rateMinor: s.rateMinor, currency: s.currency })}; {formatDuration(s.minutes)} logged; {formatCount(s.taskCount)} {s.taskCount === 1 ? 'task' : 'tasks'} completed.
      </p>
    </Panel>
  );
}

/** The pay-profile word for a payout basis, to read the stored rate back ("salary" was "monthly"). */
function basisToPay(basis: string): string {
  return basis === 'salary' ? 'monthly' : basis === 'hours' ? 'hourly' : basis === 'tasks' ? 'per_task' : 'none';
}

/** Whether paying locked time, will lock time, or never will. */
export function LockPanel({ payout }: { payout: TeamPayoutDTO }) {
  const d = payout.detail;
  if (!d) return null;
  const period = periodText(payout.periodFrom, payout.periodTo);
  let text: string;
  if (payout.status === 'paid') text = `${formatCount(d.lockedLogs ?? 0)} of ${payout.adminName}'s time ${d.lockedLogs === 1 ? 'entry' : 'entries'} dated ${period} ${d.lockedLogs === 1 ? 'is' : 'are'} locked by this payout. Nobody can change them or add time on those days.`;
  else if (payout.status === 'due') text = `Marking this paid will lock ${formatCount(d.logsToLock ?? 0)} of ${payout.adminName}'s time ${d.logsToLock === 1 ? 'entry' : 'entries'} dated ${period}, and refuse new time on those days.`;
  else text = 'This payout is void, so it locks no time.';
  return (
    <Panel>
      <PanelHeader title="Time logs" />
      <p className="text-[13px] leading-5 text-pd-ink-2">{text}</p>
    </Panel>
  );
}

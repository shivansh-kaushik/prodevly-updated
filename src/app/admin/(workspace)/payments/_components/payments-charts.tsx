import { ChartCard } from '@/components/admin/chart-card';
import { formatNative } from '@/components/admin/money';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { CHART_COLORS } from '@/lib/admin/chart-colors';
import { formatInr } from '@/lib/admin/format';
import type { PaymentsDashboard } from '@/services/dashboards/payments';
import { modeLabel } from './labels';

export function ReceivedPerMonthChart({ dashboard: d, periodLabel }: { dashboard: PaymentsDashboard; periodLabel: string }) {
  return (
    <ChartCard
      title="Received per month"
      hint={`${periodLabel}, INR, net of refunds`}
      type="bar"
      data={d.byMonth.map((m) => ({ month: m.label, received: m.receivedInr }))}
      xKey="month"
      xLabel="Month"
      series={[{ key: 'received', label: 'Received', color: CHART_COLORS.credit }]}
      kind="inr"
      totals
      height={240}
      emptyBody="No money was received in this period."
    />
  );
}

export function ReceivedByModeChart({ dashboard: d }: { dashboard: PaymentsDashboard }) {
  return (
    <ChartCard
      title="Received by mode"
      hint="INR, net of refunds"
      type="ranked"
      data={d.byMode.map((m) => ({ mode: modeLabel(m.mode), received: m.inrMinor }))}
      xKey="mode"
      xLabel="Mode"
      series={[{ key: 'received', label: 'Received', color: CHART_COLORS.blue }]}
      kind="inr"
      totals
      emptyBody="No money was received in this period."
    />
  );
}

/** Native totals with their INR value: the native figure is what the client paid, the INR column is what adds up. */
export function ReceivedByCurrencyPanel({ dashboard: d }: { dashboard: PaymentsDashboard }) {
  const total = d.byCurrency.reduce((s, c) => s + c.inrMinor, 0);
  return (
    <Panel flush>
      <div className="px-5 pt-5">
        <PanelHeader title="Received by currency" hint="What each currency came to in its own terms, and in INR at the rate of each entry." />
      </div>
      {d.byCurrency.length === 0 ? (
        <EmptyState title="No records yet" body="No money was received in this period." className="py-8" />
      ) : (
        <TableFrame className="rounded-none shadow-none">
          <Table caption="Received by currency" className="min-w-0">
            <THead>
              <tr>
                <Th>Currency</Th>
                <Th numeric>Paid in</Th>
                <Th numeric>INR</Th>
              </tr>
            </THead>
            <tbody>
              {d.byCurrency.map((c) => (
                <Tr key={c.currency}>
                  <Td className="font-medium">{c.currency}</Td>
                  <Td numeric>{formatNative(c.nativeMinor, c.currency)}</Td>
                  <Td numeric>{formatInr(c.inrMinor)}</Td>
                </Tr>
              ))}
              <TotalRow>
                <Td>Total</Td>
                <Td numeric>&nbsp;</Td>
                <Td numeric>{formatInr(total)}</Td>
              </TotalRow>
            </tbody>
          </Table>
        </TableFrame>
      )}
    </Panel>
  );
}

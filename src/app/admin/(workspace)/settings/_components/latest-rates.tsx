import Link from 'next/link';
import { formatRate } from '@/components/admin/fx-field-model';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Table, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/admin/format';
import type { FxCurrencyRow } from '@/services/dashboards/fx';

const AGE = (days: number | null) => (days === null ? '' : days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`);

/** The newest rate for every enabled foreign currency, and whether it is still usable. */
export function LatestRates({ rows, staleDays, canEditSettings }: { rows: FxCurrencyRow[]; staleDays: number; canEditSettings: boolean }) {
  return (
    <Panel flush>
      <div className="px-5 pt-5">
        <PanelHeader title="Latest rate per currency" hint={`INR per 1 unit. A rate may be up to ${staleDays} days old before it must be re-entered.`} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Only INR is turned on"
          body="Turn on other currencies to track their rates."
          action={canEditSettings ? <Link href="/admin/settings" className="text-[14px] underline">Open currency settings</Link> : undefined}
          className="py-10"
        />
      ) : (
        <div className="overflow-x-auto">
          <Table caption="Latest exchange rate for each enabled currency" className="min-w-[30rem]">
            <THead>
              <tr>
                <Th>Currency</Th>
                <Th numeric>Rate</Th>
                <Th>As of</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.currency} flag={r.status !== 'current'}>
                  <Td><span className="font-medium">{r.currency}</span></Td>
                  <Td numeric>{r.rate === null ? <span className="text-pd-ink-3">No rate</span> : formatRate(r.rate)}</Td>
                  <Td muted>{r.rateOn ? <>{formatDate(r.rateOn)}<span className="block text-[12px]">{AGE(r.ageDays)}{r.source === 'ecb' ? ', ECB' : ', manual'}</span></> : ''}</Td>
                  <Td>
                    {r.status === 'current' ? <Badge tone="credit">Current</Badge> : r.status === 'stale' ? <Badge tone="amber">Out of date</Badge> : <Badge tone="rubric">No rate</Badge>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

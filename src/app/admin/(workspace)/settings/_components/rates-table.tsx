import Link from 'next/link';
import { formatRate } from '@/components/admin/fx-field-model';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/admin/format';
import type { FxRateDTO } from '@/services/fx.service';
import { AddRateButton, EditRateButton } from './rate-dialog';

/** The rate table for the chosen period and filters. Editing is offered only to people who may edit. */
export function RatesTable({ rows, canEdit, currencies, today, filtered }: { rows: FxRateDTO[]; canEdit: boolean; currencies: string[]; today: string; filtered: boolean }) {
  return (
    <TableFrame>
      <Table caption="Exchange rates">
        <THead>
          <tr>
            <Th>Date</Th>
            <Th>Currency</Th>
            <Th numeric>Rate (INR per 1)</Th>
            <Th>Source</Th>
            <Th>Entered by</Th>
            {canEdit ? <Th><span className="sr-only">Actions</span></Th> : null}
          </tr>
        </THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td>{formatDate(r.rateOn)}</Td>
              <Td><span className="font-medium">{r.currency}</span></Td>
              <Td numeric>{formatRate(r.rate)}</Td>
              <Td>{r.source === 'ecb' ? <Badge tone="blue">ECB</Badge> : <Badge>Manual</Badge>}</Td>
              <Td muted>{r.enteredBy ?? ''}</Td>
              {canEdit ? (
                <Td className="w-12 text-right">
                  <EditRateButton row={{ id: r.id, currency: r.currency, rateOn: r.rateOn, rate: r.rate, source: r.source }} currencies={currencies} today={today} />
                </Td>
              ) : null}
            </Tr>
          ))}
        </tbody>
      </Table>
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No rates match' : 'No rates in this period'}
          body={
            filtered
              ? 'Try a different search, or clear the filters.'
              : canEdit
                ? 'Add a rate by hand. The ECB fetch fills in the currencies it publishes.'
                : 'A rate appears here once someone with FX access adds one.'
          }
          action={
            filtered ? <Link href="/admin/settings/fx" className="text-[14px] underline">Clear filters</Link> : canEdit ? <AddRateButton currencies={currencies} today={today} /> : undefined
          }
          className="py-10"
        />
      ) : null}
    </TableFrame>
  );
}

'use client';

import { useState } from 'react';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { cx } from '@/lib/cx';
import { BarSeries, formatValue, LineSeries, RankedBars, type Row, type Series, type ValueKind } from './charts';

/**
 * A chart in a panel, with the data one click away as a table for keyboard and screen-reader
 * users (and for anyone who wants the exact figures). The chart is decoration over the table,
 * never the only way to read a number. Empty data shows "No records yet" instead of a blank plot.
 */
export interface ChartCardProps {
  title: string;
  hint?: string;
  type: 'bar' | 'line' | 'ranked';
  data: Row[];
  xKey: string;
  xLabel: string;
  series: Series[];
  kind: ValueKind;
  /** Show a Total row under the table (money and counts that add up, not rates). */
  totals?: boolean;
  emptyBody?: string;
  height?: number;
  className?: string;
}

export function ChartCard({ title, hint, type, data, xKey, xLabel, series, kind, totals, emptyBody, height, className }: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasData = data.some((row) => series.some((s) => Number(row[s.key] ?? 0) !== 0));
  const Chart = type === 'line' ? LineSeries : type === 'ranked' ? RankedBars : BarSeries;

  const toggle = (
    <div role="group" aria-label={`${title} view`} className="inline-flex rounded-pd-sm bg-pd-well p-0.5 text-[12px] font-medium">
      {(['chart', 'table'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => setView(v)}
          className={cx('h-6 rounded-[3px] px-2 capitalize transition-colors', view === v ? 'bg-pd-sheet text-pd-ink shadow-[0_0_0_1px_var(--color-pd-rule)]' : 'text-pd-ink-3 hover:text-pd-ink')}
        >
          {v === 'chart' ? 'Chart' : 'Table'}
        </button>
      ))}
    </div>
  );

  return (
    <Panel className={className}>
      <PanelHeader title={title} hint={hint} action={hasData ? toggle : undefined} />
      {!hasData ? (
        <EmptyState title="No records yet" body={emptyBody ?? 'Nothing in this period.'} className="py-10" />
      ) : view === 'chart' ? (
        <Chart data={data} xKey={xKey} series={series} kind={kind} height={height} />
      ) : (
        <TableFrame className="max-h-80 overflow-y-auto">
          <Table caption={`${title}, as a table`} className="min-w-0">
            <THead>
              <tr>
                <Th>{xLabel}</Th>
                {series.map((s) => <Th key={s.key} numeric>{s.label}</Th>)}
              </tr>
            </THead>
            <tbody>
              {data.map((row) => (
                <Tr key={String(row[xKey])}>
                  <Td>{String(row[xKey])}</Td>
                  {series.map((s) => <Td key={s.key} numeric>{formatValue(kind, Number(row[s.key] ?? 0))}</Td>)}
                </Tr>
              ))}
              {totals ? (
                <TotalRow>
                  <Td>Total</Td>
                  {series.map((s) => <Td key={s.key} numeric>{formatValue(kind, data.reduce((sum, r) => sum + Number(r[s.key] ?? 0), 0))}</Td>)}
                </TotalRow>
              ) : null}
            </tbody>
          </Table>
        </TableFrame>
      )}
    </Panel>
  );
}

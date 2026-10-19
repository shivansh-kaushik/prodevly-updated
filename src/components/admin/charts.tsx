'use client';

import { useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/empty-state';
import { SERIES_PALETTE } from '@/lib/admin/chart-colors';
import { formatCount, formatDuration, formatInr, formatInrCompact } from '@/lib/admin/format';

/** What a number MEANS, so axes, tooltips and the table all format it the same way. */
export type ValueKind = 'inr' | 'count' | 'minutes' | 'rate';

export function formatValue(kind: ValueKind, value: number, compact = false): string {
  if (kind === 'inr') return compact ? formatInrCompact(value) : formatInr(value);
  if (kind === 'minutes') return formatDuration(value);
  if (kind === 'rate') return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return formatCount(value);
}

export interface Series {
  key: string;
  label: string;
  color?: string;
  /** Series that share a stackId are stacked. */
  stackId?: string;
}

export type Row = Record<string, string | number>;

const AXIS = { fontSize: 12, fill: '#5d6679' } as const;

/** False during server render and hydration, true afterwards: charts measure the browser, so they wait for it. */
function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

interface TipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: string | number; value?: number | string; color?: string; name?: string }>;
  label?: string | number;
}

function Tip({ active, payload, label, kind, series }: TipProps & { kind: ValueKind; series: Series[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-pd-md bg-pd-sheet px-3 py-2 text-[13px] shadow-pd-float">
      <p className="mb-1 font-medium text-pd-ink">{label}</p>
      <ul className="flex flex-col gap-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-6">
            <span className="inline-flex items-center gap-1.5 text-pd-ink-2">
              <span aria-hidden className="size-2 rounded-[2px]" style={{ background: p.color }} />
              {series.find((s) => s.key === p.dataKey)?.label ?? p.name}
            </span>
            <span className="pd-figure font-medium text-pd-ink">{formatValue(kind, Number(p.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ChartProps {
  data: Row[];
  xKey: string;
  series: Series[];
  kind: ValueKind;
  height?: number;
}

const colorOf = (s: Series, i: number) => s.color ?? SERIES_PALETTE[i % SERIES_PALETTE.length];

/** Columns over a category or time axis; series with a shared stackId stack. */
export function BarSeries({ data, xKey, series, kind, height = 260 }: ChartProps) {
  const mounted = useMounted();
  if (!mounted) return <Skeleton className="w-full" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="rgba(28,35,50,0.08)" />
        <XAxis dataKey={xKey} tick={AXIS} axisLine={{ stroke: 'rgba(28,35,50,0.26)' }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => formatValue(kind, v, true)} />
        <Tooltip cursor={{ fill: 'rgba(28,35,50,0.05)' }} content={(p) => <Tip {...(p as TipProps)} kind={kind} series={series} />} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s, i)} stackId={s.stackId} isAnimationActive={false} radius={s.stackId ? 0 : [2, 2, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Lines over a time axis. */
export function LineSeries({ data, xKey, series, kind, height = 260 }: ChartProps) {
  const mounted = useMounted();
  if (!mounted) return <Skeleton className="w-full" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="rgba(28,35,50,0.08)" />
        <XAxis dataKey={xKey} tick={AXIS} axisLine={{ stroke: 'rgba(28,35,50,0.26)' }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => formatValue(kind, v, true)} />
        <Tooltip content={(p) => <Tip {...(p as TipProps)} kind={kind} series={series} />} />
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colorOf(s, i)} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** A ranked list as horizontal bars (top clients by receipts). One series, categories down the side. */
export function RankedBars({ data, xKey, series, kind, height }: ChartProps) {
  const mounted = useMounted();
  const h = height ?? Math.max(180, data.length * 34 + 24);
  if (!mounted) return <Skeleton className="w-full" />;
  const s = series[0];
  if (!s) return null;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} stroke="rgba(28,35,50,0.08)" />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatValue(kind, v, true)} />
        <YAxis type="category" dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} width={120} />
        <Tooltip cursor={{ fill: 'rgba(28,35,50,0.05)' }} content={(p) => <Tip {...(p as TipProps)} kind={kind} series={series} />} />
        <Bar dataKey={s.key} name={s.label} fill={colorOf(s, 0)} isAnimationActive={false} radius={[0, 2, 2, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

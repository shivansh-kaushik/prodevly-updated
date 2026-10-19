'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { PERIOD_KEYS, PERIOD_LABELS, type PeriodKey } from '@/lib/dates/ranges';

/**
 * Chooses the period every tile, chart and table on the page is showing. It writes `?period=`
 * (and `from`/`to` for a custom range) into the URL, so the server renders the new range and the
 * view can be shared. The default is the current financial year.
 */
export function PeriodPicker({ current, from, to }: { current: PeriodKey; from?: string; to?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState({ from: from ?? '', to: to ?? '' });
  const [mode, setMode] = useState<PeriodKey>(current);

  function go(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete('page');
    startTransition(() => router.push(params.toString() ? `${pathname}?${params}` : pathname));
  }

  const canApply = Boolean(custom.from && custom.to && custom.from <= custom.to);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      <label className="sr-only" htmlFor="period-preset">Period</label>
      <div className="w-52">
        <Select
          id="period-preset"
          value={mode}
          onChange={(e) => {
            const key = e.target.value as PeriodKey;
            setMode(key);
            if (key !== 'custom') go({ period: key === 'this_fy' ? undefined : key, from: undefined, to: undefined });
          }}
        >
          {PERIOD_KEYS.map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
        </Select>
      </div>
      {mode === 'custom' ? (
        <>
          <Input type="date" aria-label="From" className="w-40" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <span aria-hidden className="text-pd-ink-3">to</span>
          <Input type="date" aria-label="To" className="w-40" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          <Button variant="secondary" disabled={!canApply} onClick={() => go({ period: 'custom', from: custom.from, to: custom.to })}>Apply</Button>
        </>
      ) : null}
    </div>
  );
}

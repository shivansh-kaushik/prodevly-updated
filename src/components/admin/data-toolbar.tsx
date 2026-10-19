'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';

/**
 * The bar above a list: search and filters, all written into the URL (so a filtered view can be
 * bookmarked and the server renders it). Search waits for a pause in typing. `children` is for
 * the period picker or a screen's own extra controls.
 */
export interface ToolbarFilter {
  key: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  allLabel?: string;
}

export function DataToolbar({ searchPlaceholder = 'Search', filters = [], children }: { searchPlaceholder?: string; filters?: ToolbarFilter[]; children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const urlQ = sp.get('q') ?? '';
  const [q, setQ] = useState(urlQ);
  // The last search text THIS toolbar wrote to the URL. When the URL changes to something else (back
  // button, a Clear link) the field follows it; while the person is typing it never overrides them.
  const [pushedQ, setPushedQ] = useState(urlQ);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  if (urlQ !== pushedQ) {
    setPushedQ(urlQ);
    setQ(urlQ);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  function push(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete('page');
    startTransition(() => router.replace(params.toString() ? `${pathname}?${params}` : pathname));
  }

  const active = filters.some((f) => sp.get(f.key)) || Boolean(urlQ);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-busy={pending || undefined}>
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-pd-ink-3" />
        <Input
          type="search"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          className="pl-9"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            clearTimeout(timer.current);
            const value = e.target.value;
            timer.current = setTimeout(() => {
              setPushedQ(value.trim());
              push({ q: value.trim() || undefined });
            }, 300);
          }}
        />
      </div>
      {filters.map((f) => (
        <div key={f.key} className="w-44">
          <Select aria-label={f.label} value={sp.get(f.key) ?? ''} onChange={(e) => push({ [f.key]: e.target.value || undefined })}>
            <option value="">{f.allLabel ?? `All ${f.label.toLowerCase()}`}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      ))}
      {children}
      {active ? (
        <Button variant="ghost" size="sm" onClick={() => { setQ(''); setPushedQ(''); push({ q: undefined, ...Object.fromEntries(filters.map((f) => [f.key, undefined])) }); }}>
          <X className="size-3.5" aria-hidden /> Clear
        </Button>
      ) : null}
    </div>
  );
}

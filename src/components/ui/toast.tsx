'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { cx } from '@/lib/cx';

/** Brief confirmations ("Client saved") in a polite live region. Errors that need action belong in the form, not here. */
type ToastTone = 'success' | 'error';
interface ToastItem {
  id: number;
  title: string;
  tone: ToastTone;
}

const ToastContext = createContext<{ show: (title: string, tone?: ToastTone) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (title: string, tone: ToastTone = 'success') => {
      const id = next.current++;
      setItems((all) => [...all.slice(-3), { id, title, tone }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 3500);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-pd-md bg-pd-ink px-3.5 py-2.5 text-[14px] text-white shadow-pd-float',
              'animate-[pd-pop_180ms_var(--ease-pd-out)]',
            )}
          >
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-300" aria-hidden />}
            <span className="min-w-0">{t.title}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-mr-1 ml-1 grid size-6 shrink-0 place-items-center rounded-pd-sm text-white/70 hover:bg-white/10 hover:text-white">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

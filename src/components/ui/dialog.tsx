'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cx } from '@/lib/cx';
import { IconButton } from './button';

/**
 * Dialogs on the native <dialog> element: the browser supplies the focus trap, Escape, the inert
 * page and focus return. This adds the backdrop click, scroll lock, a labelled title and the
 * entry animation. `variant="drawer"` slides in from the right for forms that need room.
 */
let scrollLocks = 0;

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'modal' | 'drawer';
  /** When false, Escape and the backdrop do not close it (a save is in flight). */
  dismissible?: boolean;
}

const WIDTH = { sm: 'w-[min(92vw,26rem)]', md: 'w-[min(92vw,34rem)]', lg: 'w-[min(94vw,48rem)]' } as const;

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', variant = 'modal', dismissible = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      scrollLocks += 1;
      document.body.style.overflow = 'hidden';
      return () => {
        scrollLocks = Math.max(0, scrollLocks - 1);
        if (scrollLocks === 0) document.body.style.overflow = '';
        if (el.open) el.close();
      };
    }
    if (!open && el.open) el.close();
  }, [open]);

  const drawer = variant === 'drawer';
  return (
    <dialog
      ref={ref}
      className={cx('pd-dialog', drawer && 'ml-auto h-svh')}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClose={() => onCloseRef.current()}
      onCancel={(e) => {
        if (!dismissible) e.preventDefault();
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        className={cx(
          'flex max-h-[min(92svh,46rem)] flex-col bg-pd-sheet text-pd-ink shadow-pd-float',
          drawer ? 'pd-drawer-panel h-svh max-h-svh w-[min(100vw,34rem)] rounded-l-pd-lg' : cx('pd-dialog-panel rounded-pd-lg', WIDTH[size]),
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-pd-rule px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="font-pd-serif text-[20px] leading-7 font-semibold tracking-[-0.01em]">{title}</h2>
            {description ? <p id={`${id}-desc`} className="mt-0.5 text-[13px] leading-5 text-pd-ink-3">{description}</p> : null}
          </div>
          {dismissible ? (
            <IconButton label="Close" onClick={() => onCloseRef.current()} className="-mt-1 -mr-2">
              <X className="size-4" aria-hidden />
            </IconButton>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-pd-rule px-5 py-3">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

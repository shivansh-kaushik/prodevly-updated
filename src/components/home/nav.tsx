'use client';

import { useEffect, useRef, useState } from 'react';
import { NAV_LABELS } from '@/content/home';
import { onChapterChange, scroll } from '@/lib/scroll-store';
import { SITE } from '@/content/site';
import { ArrowGlyph, type KeyTone } from '@/components/home/key';

/**
 * The keyboard case: a solid graphite bar whose keys are the sections. The key of
 * the section on screen is pressed in, and every section visited keeps its LED lit,
 * so the nav records your path. The state changes only when the nearest station
 * changes (a rare event), never per frame. On a phone the keys shrink to a row of
 * caps and the full list moves into a native <dialog>.
 */
export type NavKey = keyof typeof NAV_LABELS;
const TONE: Record<NavKey, KeyTone> = { services: 'chalk', work: 'yolk', pricing: 'mint', team: 'tomato', contact: 'graphite' };

/** `base` is '' on the home page and '/' on other pages, so section links lead back to the home page. */
export function Nav({ keys, base = '' }: { keys: readonly NavKey[]; base?: '' | '/' }) {
  const [active, setActive] = useState('');
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    return onChapterChange((index) => {
      const key = scroll.keys[index] ?? '';
      setActive(key);
      setSeen((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    });
  }, []);

  const close = () => dialog.current?.close();

  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-graphite text-chalk">
      <div className="mx-auto flex h-14 max-w-[88rem] items-center gap-3 px-4 pd-split:px-10">
        <a href={`${base}#top`} className="pd-display flex items-center gap-2 text-lg" style={{ fontWeight: 880 }}>
          <i className="inline-block size-[0.8em] rounded-[0.22em] bg-tomato shadow-[inset_0_-0.16em_0_var(--color-tomato-side)]" />
          {SITE.name}
        </a>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1.5 pd-split:flex">
          {keys.map((k) => (
            <a
              key={k}
              href={`${base}#${k}`}
              data-on={String(active === k)}
              data-seen={String(seen.has(k))}
              className={`pd-key pd-nav-key pd-nav-key--${TONE[k]} pd-key--${TONE[k]} text-[0.8125rem]`}
              style={{ padding: '0.6em 1.05em' }}
            >
              {NAV_LABELS[k]}
            </a>
          ))}
          <a href={`${base}#contact`} className="pd-key ml-2 text-[0.8125rem]" style={{ padding: '0.6em 1.15em' }}>
            <span>Start a project</span>
            <ArrowGlyph />
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2 pd-split:hidden">
          <span aria-hidden="true" className="flex items-center gap-1.5">
            {keys.map((k) => (
              <a
                key={k}
                href={`${base}#${k}`}
                tabIndex={-1}
                data-on={String(active === k)}
                data-seen={String(seen.has(k))}
                className={`pd-key pd-nav-key pd-key--${TONE[k]} pd-nav-key--${TONE[k]} !size-3.5 !p-0 after:!hidden`}
              >
                <span className="sr-only">{NAV_LABELS[k]}</span>
              </a>
            ))}
          </span>
          <button type="button" className="pd-key pd-key--chalk text-xs" style={{ padding: '0.6em 1.1em' }} onClick={() => dialog.current?.showModal()}>
            Menu
          </button>
        </div>
      </div>

      <dialog ref={dialog} aria-label="Menu" className="m-0 h-dvh max-h-none w-dvw max-w-none bg-graphite p-5 text-chalk backdrop:bg-black/60 open:flex open:flex-col pd-on-dark">
        <div className="flex justify-end">
          <button type="button" className="pd-key pd-key--chalk text-xs" style={{ padding: '0.6em 1.1em' }} onClick={close}>
            Close
          </button>
        </div>
        <ul className="mt-6 grid gap-3">
          {keys.map((k) => (
            <li key={k}>
              <a href={`${base}#${k}`} onClick={close} className={`pd-key pd-key--${TONE[k]} w-full text-lg`}>
                {NAV_LABELS[k]}
              </a>
            </li>
          ))}
          <li>
            <a href={`${base}#contact`} onClick={close} className="pd-key w-full text-lg">
              <span>Start a project</span>
              <ArrowGlyph />
            </a>
          </li>
        </ul>
      </dialog>
    </header>
  );
}

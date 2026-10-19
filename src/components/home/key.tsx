import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/**
 * Every action on the page is a flat pill (`.pd-key`, keycap.css) in a colourway tone.
 * The arrow marks an action that takes you somewhere.
 */
export type KeyTone = 'tomato' | 'chalk' | 'white' | 'graphite' | 'yolk' | 'mint' | 'cobalt';

const toneClass = (tone: KeyTone) => (tone === 'tomato' ? '' : ` pd-key--${tone}`);

export function ArrowGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`size-[1.1em] shrink-0 ${className}`}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

type LinkProps = ComponentPropsWithoutRef<'a'> & { tone?: KeyTone; enter?: boolean; children: ReactNode };

export function KeyLink({ tone = 'tomato', enter = false, className = '', children, ...rest }: LinkProps) {
  return (
    <a {...rest} className={`pd-key${toneClass(tone)} ${className}`}>
      <span>{children}</span>
      {enter ? <ArrowGlyph /> : null}
    </a>
  );
}

type ButtonProps = ComponentPropsWithoutRef<'button'> & { tone?: KeyTone; enter?: boolean; children: ReactNode };

export function KeyButton({ tone = 'tomato', enter = false, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={`pd-key${toneClass(tone)} ${className}`}>
      <span>{children}</span>
      {enter ? <ArrowGlyph /> : null}
    </button>
  );
}

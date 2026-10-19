'use client';

import { Children, type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { type StageInput, setInput } from '@/lib/stage-data';

/**
 * Binds a list of DOM items to the 3D piece they stand for (docs/plan/engineering.html
 * section 2): hovering or focusing an item lifts its piece, and in a horizontal rail
 * the item nearest the middle is the featured one. It writes `stageInput` only from
 * events (rare), never per frame; the stage reads it in its own frame loop.
 */
type Field = Extract<keyof StageInput, 'service' | 'project' | 'plan' | 'person'>;

export function BoundList({
  field,
  className = '',
  itemClassName = '',
  label,
  style,
  children,
}: {
  field: Field;
  className?: string;
  itemClassName?: string;
  label?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const rest = field === 'project' ? null : -1; // a project stays featured; the others let go

  // A scrolling rail: the item nearest its middle is the one in focus.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (el.scrollWidth <= el.clientWidth + 1) return;
        const middle = el.scrollLeft + el.clientWidth / 2;
        let best = 0;
        let bestDistance = Infinity;
        Array.from(el.children).forEach((child, i) => {
          const c = child as HTMLElement;
          const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - middle);
          if (d < bestDistance) {
            bestDistance = d;
            best = i;
          }
        });
        setInput(field, best);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, [field]);

  return (
    <ul ref={ref} aria-label={label} className={className} style={style}>
      {Children.map(children, (child, i) => (
        <li
          className={itemClassName}
          onPointerEnter={() => setInput(field, i)}
          onFocus={() => setInput(field, i)}
          onPointerLeave={() => rest !== null && setInput(field, rest)}
          onBlur={() => rest !== null && setInput(field, rest)}
        >
          {child}
        </li>
      ))}
    </ul>
  );
}

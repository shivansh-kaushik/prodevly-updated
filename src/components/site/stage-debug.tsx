'use client';

import { useEffect, useRef } from 'react';
import { scroll } from '@/lib/scroll-store';
import { stage } from '@/lib/stage-store';

/**
 * `?debug=stage` (dev and opted-in preview builds only): the follower state,
 * renderer counters and tier, plus the pose's safe rect (dashed) and the
 * subject's projected bounds (solid) drawn over the page, so the two can be
 * compared at every station. Reads the stores 4 times a second and writes the
 * DOM directly; it never re-renders React and never touches the frame loop.
 */
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function StageDebug() {
  const text = useRef<HTMLPreElement>(null);
  const safe = useRef<HTMLDivElement>(null);
  const bounds = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = stage.stats;
      if (text.current) {
        text.current.textContent = [
          `tier ${stage.tier ?? '-'} (${stage.reason}) ${stage.status}${stage.reducedMotion ? ' reduced' : ''}`,
          `target ${s.target.toFixed(3)}  subject ${s.subject.toFixed(3)}  camera ${s.camera.toFixed(3)}`,
          `speed ${s.speed.toFixed(2)} ch/s  opacity ${s.opacity.toFixed(2)}  cuts ${s.cuts}`,
          `fps ${s.fps.toFixed(0)}  calls ${s.calls}  tris ${s.triangles}  programs ${s.programs}`,
          `geo ${s.geometries}  tex ${s.textures}  frames ${s.frames}  resizes ${s.resizes}`,
          `stations ${scroll.keys.join(' ') || '-'}  in view ${stage.inView}`,
        ].join('\n');
      }
      for (const [el, r] of [
        [safe.current, s.safe],
        [bounds.current, s.bounds],
      ] as const) {
        if (!el) continue;
        el.style.left = pct(r.x);
        el.style.top = pct(r.y);
        el.style.width = pct(r.w);
        el.style.height = pct(r.h);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="pd-stage-debug" aria-hidden="true">
      <div ref={safe} className="pd-stage-debug__safe" />
      <div ref={bounds} className="pd-stage-debug__bounds" />
      <pre ref={text} className="pd-stage-debug__text" />
    </div>
  );
}

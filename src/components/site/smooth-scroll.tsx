'use client';

import gsap from 'gsap';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { type ReactNode, useEffect } from 'react';
import { onFpsCap, runFrame } from '@/lib/clock';
import { requestSnap, setCentres, setScrollY, setViewY } from '@/lib/scroll-store';
import { setStage } from '@/lib/stage-store';

/**
 * The one clock and the scroll input (docs/CONTRACT.md section 2).
 *
 * - One `gsap.ticker` callback per frame, lag smoothing off: Lenis advances,
 *   the scroll store takes Lenis's TARGET scroll (never the smoothed value), then
 *   `runFrame` drives the followers and the R3F frame.
 * - Lenis smooths the wheel only (`syncTouch: false`), so touch keeps native
 *   momentum. With reduced motion there is no Lenis: native scroll, and the stage
 *   holds the nearest station.
 * - Station centres come from the rendered `[data-chapter]` sections, measured
 *   after mount, after fonts load and on body resize (debounced), never per frame.
 *   So do their stage zones (`[data-stage-zone]`): where each sits at rest.
 * - `stage.inView` is true while any station section intersects the viewport;
 *   the stage stops drawing otherwise (behind the footer, for instance).
 */
const RESIZE_DEBOUNCE = 150;

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let lenis: Lenis | null = null;

    const applyMotion = () => {
      setStage({ reducedMotion: reduced.matches });
      if (reduced.matches && lenis) {
        lenis.destroy();
        lenis = null;
      } else if (!reduced.matches && !lenis) {
        lenis = new Lenis({ autoRaf: false, syncTouch: false });
      }
    };
    applyMotion();
    reduced.addEventListener('change', applyMotion);

    gsap.ticker.lagSmoothing(0);
    const tick = (time: number, deltaMs: number) => {
      if (lenis) {
        lenis.raf(time * 1000);
        setScrollY(lenis.targetScroll);
        setViewY(lenis.animatedScroll);
      } else {
        setScrollY(window.scrollY);
        setViewY(window.scrollY);
      }
      runFrame(time, deltaMs / 1000);
    };
    gsap.ticker.add(tick);
    const offCap = onFpsCap((fps) => gsap.ticker.fps(fps || 240));

    // Which station sections are on screen.
    const visible = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      setStage({ inView: visible.size > 0 });
    });

    let first = true;
    const measure = () => {
      const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]'));
      const vh = window.innerHeight;
      const max = Math.max(0, document.documentElement.scrollHeight - vh);
      const centres = sections.map((el) => {
        const r = el.getBoundingClientRect();
        const y = r.top + window.scrollY + r.height / 2 - vh / 2;
        return Math.min(max, Math.max(0, y));
      });
      // Each station's zone, in pixels, where it sits in the viewport when that station is at rest.
      const zones = sections.map((el, i) => {
        const zone = el.querySelector<HTMLElement>('[data-stage-zone]');
        if (!zone) return null;
        const z = zone.getBoundingClientRect();
        if (z.width < 1 || z.height < 1) return null;
        return { x: z.left, y: z.top + window.scrollY - centres[i]!, w: z.width, h: z.height };
      });
      setCentres(
        centres,
        sections.map((el) => el.dataset.chapter ?? ''),
        zones,
      );
      io.disconnect();
      visible.clear();
      sections.forEach((el) => io.observe(el));
      if (sections.length === 0) setStage({ inView: false });
      if (first) {
        first = false;
        requestSnap(); // a restored scroll position snaps instead of gliding from the top
      }
    };

    let timer = 0;
    const debounced = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, RESIZE_DEBOUNCE);
    };
    const ro = new ResizeObserver(debounced);
    ro.observe(document.body);
    const raf = requestAnimationFrame(measure);
    let alive = true;
    void document.fonts.ready.then(() => alive && measure());

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      ro.disconnect();
      io.disconnect();
      offCap();
      gsap.ticker.remove(tick);
      reduced.removeEventListener('change', applyMotion);
      lenis?.destroy();
    };
  }, []);

  return children;
}

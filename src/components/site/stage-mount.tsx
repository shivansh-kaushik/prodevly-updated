'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { setFpsCap } from '@/lib/clock';
import { detectTier, QUALITY, stageDevTools, type LiveTier, type Tier } from '@/lib/gpu-tier';
import { scroll } from '@/lib/scroll-store';
import { clampStageData, EMPTY_STAGE_DATA, stageInput, type StageData } from '@/lib/stage-data';
import { setStage, stage, subscribeStage, type StageStatus } from '@/lib/stage-store';
import type { StageProps } from '@/three/stage';
import { StageDebug } from '@/components/site/stage-debug';

/**
 * Mounts the one 3D stage behind the page (docs/plan/engineering.html section 3).
 *
 * 1. Picks the tier BEFORE three.js is requested. Tier 0 never downloads it.
 * 2. Lazy-loads the direction's stage entry (`next/dynamic`, ssr: false).
 * 3. Publishes the status on <html data-stage>, which the posters' CSS reads:
 *    posters show until the canvas has drawn, and again after a context loss or
 *    a performance failure. The page is complete without the canvas.
 * 4. Context loss: poster, then one remount on restore. A second loss in the
 *    visit means tier 0. A tier only ever steps down.
 */
type EntryProps = Omit<StageProps, 'direction'> & { data: StageData };

const ENTRIES = {
  fixture: dynamic<EntryProps>(() => import('@/three/entries/fixture'), { ssr: false }),
  keycap: dynamic<EntryProps>(() => import('@/three/entries/keycap'), { ssr: false }),
} as const;

export type StageDirectionId = keyof typeof ENTRIES;

/** The tier lives in the stage store; StageMount re-renders from its subscription. */
function applyTier(next: Tier, reason: string, status?: StageStatus) {
  setFpsCap(next === 0 ? 0 : QUALITY[next].fpsCap);
  setStage({ tier: next, reason, status: status ?? (next === 0 ? 'off' : 'loading') });
}

const events: EntryProps['events'] = {
  onReady: () => setStage({ status: 'ready' }),
  onDecline: () => {
    const current = stage.tier ?? 1;
    if (current > 1) applyTier((current - 1) as LiveTier, `${stage.reason}, stepped down`, stage.status);
  },
  onFail: () => applyTier(0, 'below 30 fps at tier 1', 'failed'),
  onContextLost: () => {
    const losses = stage.losses + 1;
    setStage({ losses, status: 'lost' });
    if (losses >= 2) applyTier(0, 'context lost twice', 'lost');
  },
  onContextRestored: () => {
    if (stage.losses >= 2) return;
    setStage({ status: 'loading' });
    remount?.();
  },
};
let remount: (() => void) | null = null;

export function StageMount({ direction, data = EMPTY_STAGE_DATA }: { direction: StageDirectionId; data?: StageData }) {
  const [tier, setTier] = useState<Tier | null>(null);
  const [fine, setFine] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const [debug, setDebug] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const Entry = ENTRIES[direction];
  // The page passes one stable object, so an unchanged page never rebuilds the direction.
  const clamped = useMemo(() => clampStageData(data), [data]);

  // Status -> <html data-stage>; in-view -> the wrapper (no React re-render).
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.stage = stage.status;
      if (wrapper.current) wrapper.current.dataset.inView = String(stage.inView);
    };
    apply();
    const off = subscribeStage(() => {
      apply();
      setTier(stage.tier);
    });
    remount = () => setMountKey((k) => k + 1); // a fresh canvas, renderer and programs
    return () => {
      off();
      remount = null;
      setFpsCap(0); // other pages run uncapped
      delete root.dataset.stage;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setStage({ status: 'detecting' });
    if (stageDevTools) {
      (window as unknown as { __stage: unknown }).__stage = { stage, scroll, input: stageInput };
    }
    void detectTier(stage.losses).then((decision) => {
      if (!alive) return;
      setFine(window.matchMedia('(pointer: fine)').matches);
      setDebug(stageDevTools && new URLSearchParams(window.location.search).get('debug') === 'stage');
      applyTier(decision.tier, decision.reason);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <div ref={wrapper} className="pd-stage" aria-hidden="true">
        {tier !== null && tier > 0 ? <Entry key={mountKey} tier={tier as LiveTier} fine={fine} events={events} data={clamped} /> : null}
      </div>
      {debug ? <StageDebug /> : null}
    </>
  );
}

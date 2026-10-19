import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Group, type HemisphereLight, NeutralToneMapping } from 'three';
import { QUALITY, stageDevTools, type LiveTier, type Quality } from '@/lib/gpu-tier';
import { stage } from '@/lib/stage-store';
import type { Direction } from '@/three/direction';
import { StudioEnvironment } from '@/three/look/environment';
import { Grounding } from '@/three/look/grounding';
import { Driver, type DriverEvents } from '@/three/rig/driver';
import { rig } from '@/three/rig/rig-state';

/**
 * The one WebGL canvas of the site (docs/CONTRACT.md section 4). Loaded only
 * through `next/dynamic` from StageMount, after the tier is known, so tier 0 and
 * every admin route never download three.js.
 *
 * - frameloop="never": the gsap ticker advances it through the driver.
 * - Transparent over the DOM colour fields, NeutralToneMapping, sRGB output.
 * - DPR fixed per tier; resize debounced and never on scroll.
 * - Events only for fine pointers, from document.body (the canvas itself has
 *   pointer-events: none).
 * - Context loss: three already calls preventDefault (so the context can come
 *   back); StageMount shows the poster and remounts this once on restore.
 */
export interface StageProps {
  direction: Direction;
  tier: LiveTier;
  fine: boolean;
  events: Omit<DriverEvents, 'onSettled'> & { onContextLost(): void; onContextRestored(): void };
}

export default function Stage({ direction, tier, fine, events }: StageProps) {
  const quality = QUALITY[tier];
  const subject = useRef<Group>(null);
  const secondary = useRef<Group>(null);
  const ground = useRef<Group>(null);
  const fill = useRef<HemisphereLight>(null);
  // R3F disposes an unmounted renderer with forceContextLoss(), which fires
  // 'webglcontextlost' too. Only a loss on a live, mounted canvas counts.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; // StrictMode runs effects twice in development
    return () => {
      mounted.current = false;
    };
  }, []);
  const [settled] = useState(createSignal);
  const driverEvents = useMemo<DriverEvents>(
    () => ({
      onReady: () => events.onReady(),
      onDecline: () => events.onDecline(),
      onFail: () => events.onFail(),
      onSettled: () => settled.emit(),
    }),
    [events, settled],
  );
  const { Subject, Lightformers } = direction;

  return (
    <Canvas
      frameloop="never"
      dpr={[1, quality.dpr]}
      // 'percentage' is PCF: three r186 removed PCFSoftShadowMap and falls back to it with a warning.
      shadows={direction.shadowMap && quality.shadows === 'live' ? 'percentage' : false}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance', toneMapping: NeutralToneMapping }}
      camera={{ fov: 35, near: 0.1, far: 200, position: [0, 0, 10] }}
      resize={{ scroll: false, debounce: { scroll: 0, resize: 200 } }}
      {...(fine ? { eventSource: document.body, eventPrefix: 'client' as const } : {})}
      onCreated={({ gl, scene }) => {
        scene.background = null;
        const canvas = gl.domElement;
        // The driver fades the CANVAS (Canvas's own `style` prop styles R3F's wrapper div).
        canvas.style.opacity = '0';
        let retired = false; // after a restore this canvas is replaced, never reused
        canvas.addEventListener('webglcontextlost', () => {
          if (mounted.current && !retired) events.onContextLost();
        });
        canvas.addEventListener('webglcontextrestored', () => {
          if (!mounted.current || retired) return;
          retired = true;
          events.onContextRestored();
        });
        if (stageDevTools) {
          const ext = gl.getContext().getExtension('WEBGL_lose_context');
          stage.hooks = {
            loseContext: () => ext?.loseContext(),
            restoreContext: () => ext?.restoreContext(),
            programs: () => (gl.info.programs ?? []).map((p) => p.name),
          };
        }
      }}
    >
      <StudioEnvironment Lightformers={Lightformers} resolution={quality.envResolution} />
      <hemisphereLight ref={fill} intensity={direction.fill} groundColor="#000000" />
      <group ref={ground}>
        <GroundingSlot direction={direction} quality={quality} settled={settled} />
      </group>
      <group ref={subject}>
        <group ref={secondary}>
          <Subject quality={quality} rig={rig} />
        </group>
      </group>
      <Driver
        direction={direction}
        subject={subject}
        secondary={secondary}
        ground={ground}
        fill={fill}
        tier={tier}
        fine={fine}
        events={driverEvents}
      />
    </Canvas>
  );
}

/** A tiny event: the driver fires it when the follower settles at a station. */
function createSignal() {
  const listeners = new Set<() => void>();
  return {
    emit: () => listeners.forEach((fn) => fn()),
    on: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** Owns the bake counter, so a settle re-renders the shadow only, never the subject. */
function GroundingSlot({
  direction,
  quality,
  settled,
}: {
  direction: Direction;
  quality: Quality;
  settled: ReturnType<typeof createSignal>;
}) {
  const [bake, setBake] = useState(0);
  useEffect(() => settled.on(() => setBake((n) => n + 1)), [settled]);
  if (!direction.shadow) return null;
  return <Grounding shadow={direction.shadow} mode={quality.shadows} bake={bake} />;
}

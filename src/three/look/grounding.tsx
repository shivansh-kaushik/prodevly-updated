import { ContactShadows } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { CanvasTexture } from 'three';
import type { ShadowMode } from '@/lib/gpu-tier';
import type { Shadow } from '@/three/direction';

/**
 * Grounding under the subject, by tier (docs/plan/engineering.html section 5):
 * - blob (tier 1): a soft radial texture on one quad. One draw call, no pass.
 * - baked (tier 2): ContactShadows rendered once, and again whenever `bake`
 *   changes (the driver bumps it when the follower settles at a station).
 * - live (tier 3): ContactShadows every frame, so they follow moving pieces.
 *
 * Rendered inside a group the driver keeps under the subject (position and scale,
 * no tilt), so the shadow plane stays level.
 */
export function Grounding({
  shadow,
  mode,
  bake: _bake,
}: {
  shadow: Shadow;
  mode: ShadowMode;
  /** Only its change matters: a re-render re-bakes the baked shadow. */
  bake: number;
}) {
  if (mode === 'blob') return <BlobShadow shadow={shadow} />;
  return (
    <ContactShadows
      // drei counts rendered frames in a local that resets on every render, so a
      // new `bake` value (a re-render) gives one more frame at frames={1}.
      key={mode}
      frames={mode === 'live' ? Infinity : 1}
      position={[0, shadow.y, 0]}
      scale={shadow.size}
      opacity={shadow.opacity}
      color={shadow.color}
      blur={shadow.blur}
      far={shadow.size * 0.6}
      resolution={mode === 'live' ? 512 : 256}
    />
  );
}

function BlobShadow({ shadow }: { shadow: Shadow }) {
  const texture = useMemo(() => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      // Grey levels are the alpha (alphaMap reads green); the colour comes from the material.
      g.addColorStop(0, '#fff');
      g.addColorStop(0.45, '#8c8c8c');
      g.addColorStop(1, '#000');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    return new CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={[0, shadow.y + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <planeGeometry args={[shadow.size * 0.8, shadow.size * 0.8]} />
      <meshBasicMaterial
        alphaMap={texture}
        color={shadow.color}
        transparent
        opacity={shadow.opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

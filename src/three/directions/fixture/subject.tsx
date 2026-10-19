import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type BufferGeometry, Color, type Group, LatheGeometry, MathUtils, MeshPhysicalMaterial, Vector2 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SubjectProps } from '@/three/direction';

/**
 * Engine fixture, NOT a design: a neutral stack of bevelled, lit pieces used by
 * /dev/stage to prove the engine (followers, poses, framing, tiers, fades).
 *
 * Its one assembly parameter, `split`, is a continuous transform of the SAME
 * pieces from a stacked totem (0) to a 3x2 cluster (1): the "one becomes many"
 * shape every direction's services beat takes. No crossfades.
 */
interface Piece {
  kind: 'box' | 'disc';
  size: [number, number, number];
  color: string;
  roughness: number;
  clearcoat: number;
}

const PIECES: Piece[] = [
  { kind: 'disc', size: [1.1, 0.34, 1.1], color: '#2f3a4f', roughness: 0.55, clearcoat: 0 },
  { kind: 'box', size: [1.3, 0.62, 1.3], color: '#d9d2c3', roughness: 0.35, clearcoat: 0.4 },
  { kind: 'disc', size: [0.9, 0.42, 0.9], color: '#c75b39', roughness: 0.22, clearcoat: 0.8 },
  { kind: 'box', size: [1.05, 0.5, 1.05], color: '#3d6b5a', roughness: 0.45, clearcoat: 0.2 },
  { kind: 'disc', size: [0.78, 0.3, 0.78], color: '#e3b04b', roughness: 0.3, clearcoat: 0.6 },
  { kind: 'box', size: [0.62, 0.62, 0.62], color: '#f2efe8', roughness: 0.18, clearcoat: 1 },
];

/** Bounding radius of the stack and of the cluster, for the pose tables. */
export const STACK_HEIGHT = PIECES.reduce((h, p) => h + p.size[1], 0);

const CLUSTER_GAP = 1.55;

/** Stacked offsets (centred on the stack) and cluster offsets (3 x 2), computed once. */
const LAYOUT = (() => {
  let y = -STACK_HEIGHT / 2;
  return PIECES.map((p, i) => {
    const stackY = y + p.size[1] / 2;
    y += p.size[1];
    const col = i % 3;
    const row = Math.floor(i / 3);
    return { stackY, cx: (col - 1) * CLUSTER_GAP, cy: (0.5 - row) * CLUSTER_GAP * 0.8, phase: i * 0.7 };
  });
})();

function discGeometry(radius: number, height: number, segments: number): BufferGeometry {
  // Lathe profile with a filleted rim, so the edge catches light like a real part.
  const f = Math.min(radius, height) * 0.22;
  const pts: Vector2[] = [new Vector2(0, -height / 2)];
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      pts.push(new Vector2(cx + Math.cos(a) * f, cy + Math.sin(a) * f));
    }
  };
  arc(radius - f, -height / 2 + f, -Math.PI / 2, 0);
  arc(radius - f, height / 2 - f, 0, Math.PI / 2);
  pts.push(new Vector2(0, height / 2));
  return new LatheGeometry(pts, Math.max(16, Math.round(64 * segments)));
}

export function FixtureSubject({ quality, rig }: SubjectProps) {
  const group = useRef<Group>(null);

  const parts = useMemo(
    () =>
      PIECES.map((p) => {
        const [w, h, d] = p.size;
        const geometry =
          p.kind === 'box'
            ? new RoundedBoxGeometry(w, h, d, Math.max(2, Math.round(5 * quality.segments)), Math.min(w, h, d) * 0.16)
            : discGeometry(w / 2, h, quality.segments);
        const material = new MeshPhysicalMaterial({
          color: new Color(p.color),
          roughness: p.roughness,
          metalness: 0,
          clearcoat: p.clearcoat,
          clearcoatRoughness: 0.25,
        });
        return { geometry, material, height: h };
      }),
    [quality.segments],
  );
  useEffect(
    () => () => {
      for (const p of parts) {
        p.geometry.dispose();
        p.material.dispose();
      }
    },
    [parts],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const split = rig.pose.assembly.split ?? 0;
    for (let i = 0; i < LAYOUT.length; i++) {
      const child = g.children[i];
      const l = LAYOUT[i]!;
      if (!child) continue;
      // Each piece leaves the stack a little after the one below it (stagger).
      const t = MathUtils.smootherstep(split, i * 0.06, 0.7 + i * 0.06);
      child.position.set(
        MathUtils.lerp(0, l.cx, t),
        MathUtils.lerp(l.stackY, l.cy, t),
        Math.sin(t * Math.PI) * 0.6,
      );
      child.rotation.set(0, t * (0.4 + l.phase * 0.15), Math.sin(t * Math.PI) * 0.25);
    }
  });

  return (
    <group ref={group}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={p.material} />
      ))}
    </group>
  );
}

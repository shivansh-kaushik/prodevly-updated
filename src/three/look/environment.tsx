import { Environment } from '@react-three/drei';
import type { ComponentType } from 'react';

/**
 * The studio light (docs/CONTRACT.md section 4): the direction's Lightformers,
 * rendered ONCE into a cube map (frames={1}) at the tier's resolution. Never a
 * fetched HDRI or a drei preset, which download from a CDN. A tier change
 * re-bakes at the new resolution; nothing re-renders it per frame. The yaw is
 * turned per frame through `scene.environmentRotation`, which costs nothing.
 */
export function StudioEnvironment({
  Lightformers,
  resolution,
}: {
  Lightformers: ComponentType;
  resolution: number;
}) {
  return (
    <Environment resolution={resolution} frames={1}>
      <Lightformers />
    </Environment>
  );
}

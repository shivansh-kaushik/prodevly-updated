import { useMemo } from 'react';
import type { StageData } from '@/lib/stage-data';
import { createKeycapDirection } from '@/three/directions/keycap';
import Stage, { type StageProps } from '@/three/stage';

/** Lazy entry for the Keycap Colorway home page. */
export default function KeycapStage({ data, ...props }: Omit<StageProps, 'direction'> & { data: StageData }) {
  const direction = useMemo(() => createKeycapDirection(data), [data]);
  return <Stage direction={direction} {...props} />;
}

import type { StageData } from '@/lib/stage-data';
import { fixtureDirection } from '@/three/directions/fixture';
import Stage, { type StageProps } from '@/three/stage';

/** Lazy entry for the engine fixture (/dev/stage). One entry per direction. The fixture ignores `data`. */
export default function FixtureStage(props: Omit<StageProps, 'direction'> & { data: StageData }) {
  const { data: _data, ...rest } = props;
  return <Stage direction={fixtureDirection} {...rest} />;
}

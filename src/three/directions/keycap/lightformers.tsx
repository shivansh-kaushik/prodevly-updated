import { Lightformer } from '@react-three/drei';

/**
 * The keycap studio: a warm key softbox, a cool side strip, a ring behind for the
 * rim, and a faint bounce from below. Baked once into the environment cube.
 */
export function KeycapLightformers() {
  const at: [number, number, number] = [0, 1, 0];
  return (
    <>
      <Lightformer form="rect" intensity={4} color="#fff4e6" position={[4, 6, 5]} scale={[7, 3.5, 1]} target={at} />
      <Lightformer form="rect" intensity={1.6} color="#e6eeff" position={[-7, 2, 3]} scale={[3, 6, 1]} target={at} />
      <Lightformer form="ring" intensity={1.4} color="#ffffff" position={[0, 7, -5]} scale={5} target={at} />
      <Lightformer form="rect" intensity={0.9} color="#ffffff" position={[0, -5, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
    </>
  );
}

import { Lightformer } from '@react-three/drei';
import type { Direction } from '@/three/direction';
import type { Pose, PoseSet } from '@/three/poses/types';
import { FixtureSubject } from '@/three/directions/fixture/subject';

/**
 * Engine fixture direction for /dev/stage. It exercises every part of the pose
 * format on six stations and proves the stage's rules (centred phone subject,
 * right-third desktop subject, two-of-five changes per station). It is not a
 * design and never ships on the home page; the three directions replace it on
 * their branches.
 */
const STACK_R = 1.6;
const CLUSTER_R = 2.2;
/** Half-split (pricing) spreads wider than the stack. */
const SPREAD_R = 2.1;

const pose = (p: Omit<Pose, 'env'> & { env?: Partial<Pose['env']> }): Pose => ({
  ...p,
  env: { yaw: 0, tint: '#ffffff', ...p.env },
});

// Phone (tall): the subject stays centred between copy blocks. The world moves
// around it in depth: dolly, crane, orbit; no two stations in a row share a move.
const tall: PoseSet['tall'] = {
  hero: pose({
    cam: [2.2, 1.4, 8], aim: [0, 0, 0], radius: STACK_R,
    subject: { pos: [0, 0, 0], rot: [0, -20, 0], scale: 1 },
    assembly: { split: 0 }, safe: { x: 0.08, y: 0.26, w: 0.84, h: 0.4 },
  }),
  services: pose({
    cam: [0, 6, 6], aim: [0, 0, 0], radius: CLUSTER_R,
    subject: { pos: [0, 0, 0], rot: [0, 25, 0], scale: 1 },
    assembly: { split: 1 }, safe: { x: 0.04, y: 0.2, w: 0.92, h: 0.42 },
    env: { yaw: 0.8, tint: '#e8f0ff' },
  }),
  work: pose({
    cam: [-7, 1, 3], aim: [0, 0, 0], radius: STACK_R,
    subject: { pos: [0, 0, 0], rot: [0, 90, 0], scale: 1.1 },
    assembly: { split: 0.35 }, safe: { x: 0.1, y: 0.3, w: 0.8, h: 0.38 },
  }),
  pricing: pose({
    cam: [0.5, 2, 9], aim: [0, 0, 0], radius: SPREAD_R,
    subject: { pos: [0, 0, 0], rot: [12, 180, 0], scale: 1 },
    assembly: { split: 0.6 }, safe: { x: 0.06, y: 0.22, w: 0.88, h: 0.36 },
    env: { yaw: -0.6, tint: '#fff1e0' },
  }),
  team: pose({
    cam: [5, 3.5, 5], aim: [0, 0, 0], radius: CLUSTER_R,
    subject: { pos: [0, 0, 0], rot: [0, 220, 0], scale: 1 },
    assembly: { split: 1 }, safe: { x: 0.05, y: 0.32, w: 0.9, h: 0.36 },
  }),
  contact: pose({
    cam: [0, 0.8, 8.5], aim: [0, 0, 0], radius: STACK_R,
    subject: { pos: [0, 0, 0], rot: [0, 340, 0], scale: 1.2 },
    assembly: { split: 0 }, safe: { x: 0.08, y: 0.24, w: 0.84, h: 0.44 },
    env: { yaw: 0.3 },
  }),
};

// Desktop (wide): copy on the left, the subject usually in the right third.
const wide: PoseSet['wide'] = {
  hero: pose({
    cam: [3, 1.6, 9], aim: [0, 0, 0], radius: STACK_R,
    subject: { pos: [0, 0, 0], rot: [0, -20, 0], scale: 1 },
    assembly: { split: 0 }, safe: { x: 0.54, y: 0.12, w: 0.4, h: 0.76 },
  }),
  services: pose({
    cam: [0, 7, 7], aim: [0, 0, 0], radius: CLUSTER_R,
    subject: { pos: [0, 0, 0], rot: [0, 25, 0], scale: 1 },
    assembly: { split: 1 }, safe: { x: 0.46, y: 0.14, w: 0.5, h: 0.72 },
    env: { yaw: 0.8, tint: '#e8f0ff' },
  }),
  work: pose({
    cam: [-8, 1, 3], aim: [0, 0, 0], radius: STACK_R,
    subject: { pos: [0, 0, 0], rot: [0, 90, 0], scale: 1.1 },
    assembly: { split: 0.35 }, safe: { x: 0.52, y: 0.3, w: 0.26, h: 0.42 },
  }),
  pricing: pose({
    cam: [0.5, 2.5, 10], aim: [0, 0, 0], radius: SPREAD_R,
    subject: { pos: [0, 0, 0], rot: [12, 180, 0], scale: 1 },
    assembly: { split: 0.6 }, safe: { x: 0.3, y: 0.06, w: 0.4, h: 0.4 },
    env: { yaw: -0.6, tint: '#fff1e0' },
  }),
  team: pose({
    cam: [6, 4, 6], aim: [0, 0, 0], radius: CLUSTER_R,
    subject: { pos: [0, 0, 0], rot: [0, 220, 0], scale: 1 },
    assembly: { split: 1 }, safe: { x: 0.56, y: 0.18, w: 0.38, h: 0.64 },
  }),
  contact: pose({
    cam: [0, 1, 9], aim: [0, 0, 0], radius: STACK_R,
    subject: { pos: [0, 0, 0], rot: [0, 340, 0], scale: 1.2 },
    assembly: { split: 0 }, safe: { x: 0.56, y: 0.1, w: 0.36, h: 0.8 },
    env: { yaw: 0.3 },
  }),
};

// mid (tablets, square windows) re-fits the wide tables; one override shows the hook.
const mid: PoseSet['mid'] = {
  pricing: { ...wide.pricing!, safe: { x: 0.2, y: 0.08, w: 0.6, h: 0.42 } },
};

function FixtureLightformers() {
  return (
    <>
      <Lightformer form="rect" intensity={3} color="#ffffff" position={[3, 4, 5]} scale={[6, 3, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={1.4} color="#dfe8ff" position={[-6, 1, 2]} scale={[3, 6, 1]} target={[0, 0, 0]} />
      <Lightformer form="ring" intensity={1.2} color="#fff2df" position={[0, 6, -6]} scale={4} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.6} color="#ffffff" position={[0, -5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
    </>
  );
}

export const fixtureDirection: Direction = {
  id: 'fixture',
  poses: { tall, wide, mid },
  Subject: FixtureSubject,
  Lightformers: FixtureLightformers,
  shadow: { y: -1.45, size: 7, opacity: 0.45, color: '#1b2030', blur: 2.4 },
  fill: 0.35,
};

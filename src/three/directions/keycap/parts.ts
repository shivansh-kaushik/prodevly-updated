import type { BufferGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PerspectiveCamera, ShadowMaterial } from 'three';
import type { Rig } from '@/three/direction';
import type { KeycapUserData } from '@/three/directions/keycap/keycap-geometry';
import type { Atlas, Fonts } from '@/three/directions/keycap/legends';

/** The meshes, materials and lights of the keycap scene, built once (scene.ts) and moved every frame (motion.ts). */
export interface SceneFrame {
  rig: Rig;
  dt: number;
  camera: PerspectiveCamera;
  pointer: { x: number; y: number };
  fine: boolean;
  tall: boolean;
}

export interface KeycapScene {
  group: Group;
  update(f: SceneFrame): void;
  repaint(fonts: Fonts): void;
  /** A real key was pressed: depress its cap. */
  keyDown(cap: number, time: number): void;
  dispose(): void;
}

export interface Cap {
  mesh: Mesh;
  geo: BufferGeometry;
  ud: KeycapUserData;
  shell?: MeshPhysicalMaterial;
  mat: MeshPhysicalMaterial;
  atlas: Atlas | null;
  blob: Mesh;
  blobMat: MeshBasicMaterial;
  glow: Mesh;
  glowMat: MeshBasicMaterial;
  hold: number;
  /** Plate (0-based) the cap stands on in the pricing layout, or -1. */
  plate: number;
}


export interface PlatePart {
  mesh: Mesh;
  blob: Mesh;
  blobMat: MeshBasicMaterial;
  lift: number;
  w: number;
  d: number;
}

export interface Parts {
  hemi: HemisphereLight;
  key: DirectionalLight;
  rim: DirectionalLight;
  pool: Mesh;
  poolMat: MeshBasicMaterial;
  floor: Mesh;
  floorMat: ShadowMaterial;
  caps: Cap[];
  plates: PlatePart[];
}

import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Shape,
  ShadowMaterial,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Quality } from '@/lib/gpu-tier';
import type { StageData } from '@/lib/stage-data';
import {
  BASE_LEGENDS,
  CAST,
  CMD,
  type Legend,
  type SleeveKind,
} from '@/three/directions/keycap/cast';
import { keycapGeometry, type KeycapUserData } from '@/three/directions/keycap/keycap-geometry';
import { createAtlas, type Atlas, type Fonts, paintAtlas } from '@/three/directions/keycap/legends';
import { capMaterial, createSharedTextures, PLATE_COLOR, resinMaterials } from '@/three/directions/keycap/materials';
import { HEX } from '@/three/directions/keycap/palette';
import { personCaps, sleeveCaps, type Layouts } from '@/three/directions/keycap/layouts';
import { createMotion } from '@/three/directions/keycap/motion';
import type { Cap, KeycapScene } from '@/three/directions/keycap/parts';
import { PLATE_TOP, plateSizes } from '@/three/directions/keycap/plates';

/**
 * The keycap totem: nine caps, plates and a few light quads, built once and
 * moved every frame from the pose's layout weights. Nothing here allocates per
 * frame; scratch objects live at module scope.
 *
 * Between two stations the engine lerps the layout weights. The two non-zero ones
 * name the layouts the caps are travelling between and the larger the second's
 * weight, the further along they are. Each cap starts a little later than the one
 * before it and flies on an arc, so a chapter change reads as the same nine caps
 * regrouping, never a crossfade.
 */
const SLEEVE_KINDS: SleeveKind[] = ['app', 'dash', 'site', 'shop', 'app', 'dash'];

function legendsFor(i: number, data: StageData): Legend[] {
  const row = [...BASE_LEGENDS[i]!];
  const sleeve = sleeveCaps(data.projects).indexOf(i);
  if (sleeve >= 0) {
    const kind = SLEEVE_KINDS[sleeve % SLEEVE_KINDS.length]!;
    row[2] = i === CMD ? { k: 'proj', kind, panel: HEX.yolk } : { k: 'proj', kind };
  }
  const person = personCaps(data.people.length).indexOf(i);
  if (person >= 0) row[4] = { k: 'num', t: data.people[person]! };
  return row;
}

/** A stretched "P" for the artisan cap's core: the monogram suspended in the resin. */
function monogram(): ExtrudeGeometry {
  const sh = new Shape();
  sh.moveTo(0, 0);
  sh.lineTo(0.1, 0);
  sh.lineTo(0.1, 0.14);
  sh.lineTo(0.16, 0.14);
  sh.absarc(0.16, 0.27, 0.13, -Math.PI / 2, Math.PI / 2, false);
  sh.lineTo(0, 0.4);
  sh.closePath();
  const hole = new Path();
  hole.moveTo(0.1, 0.215);
  hole.lineTo(0.16, 0.215);
  hole.absarc(0.16, 0.27, 0.055, -Math.PI / 2, Math.PI / 2, false);
  hole.lineTo(0.1, 0.325);
  hole.closePath();
  sh.holes.push(hole);
  const g = new ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.014, bevelSegments: 3, curveSegments: 14 });
  g.center();
  return g;
}

export function createKeycapScene(opts: {
  quality: Quality;
  data: StageData;
  layouts: Layouts;
  anisotropy: number;
  fonts: Fonts;
}): KeycapScene {
  const { quality, data, layouts } = opts;
  const group = new Group();
  const tex = createSharedTextures();
  const geos: BufferGeometry[] = [];
  const disposables: Array<{ dispose(): void }> = [tex];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  /* ---------- lights */
  const hemi = new HemisphereLight('#ffffff', HEX.cobalt, 0.8);
  const key = new DirectionalLight('#FFF4E6', 2.6);
  key.position.set(-5.5, 13, 5.5);
  // The key light casts the soft long shadows on tier 3; tiers 1 and 2 keep only the contact blobs.
  const shadowMap = quality.shadows === 'live';
  if (shadowMap) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 50;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
  }
  const rim = new DirectionalLight('#ffffff', 0.9);
  rim.position.set(4, 6, -9);
  rim.target.position.set(0, 1, 0);
  group.add(hemi, key, key.target, rim, rim.target);

  /* ---------- shared flat geometry for blobs, glows and the pool */
  const flat = track(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const poolMat = track(
    new MeshBasicMaterial({ map: tex.glow, color: HEX.chalk, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  const pool = new Mesh(flat, poolMat);
  pool.renderOrder = 1;
  pool.visible = false;
  group.add(pool);

  /* ---------- the floor only catches the key light's shadows, in a darker tone of the field */
  const floorMat = track(new ShadowMaterial({ color: '#000000', opacity: 0.3, depthWrite: false }));
  const floor = new Mesh(track(new PlaneGeometry(80, 80).rotateX(-Math.PI / 2)), floorMat);
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  floor.visible = shadowMap;
  group.add(floor);

  /* ---------- caps */
  const plan = data.plans > 0 ? plateSizes(data.plans) : [];
  const plateOf = (cap: number) => {
    // Plates are laid out small to large; the caps they carry are in the layout tables.
    const set = layouts.wide.plates;
    const slot = set.slots[cap]!;
    let best = -1;
    let bestD = Infinity;
    set.plates.forEach((pl, k) => {
      const d = Math.hypot(slot.x - pl.x, slot.z - pl.z);
      if (!slot.park && d < bestD && Math.abs(slot.x - pl.x) <= pl.w / 2 && Math.abs(slot.z - pl.z) <= pl.d / 2) {
        best = k;
        bestD = d;
      }
    });
    return best;
  };

  const caps: Cap[] = CAST.map((spec, i) => {
    const geo = keycapGeometry({
      u: spec.u,
      h: spec.h,
      dish: spec.dish ?? (spec.art ? 0.07 : 0.06),
      rTop: spec.art ? 0.2 : 0.13,
      rBot: spec.art ? 0.16 : 0.1,
      bevel: spec.art ? 0.11 : 0.065,
      taperX: spec.art ? 0.13 : 0.1,
      taperF: 0.13,
      taperB: spec.art ? 0.13 : 0.06,
      tilt: spec.tilt ?? 0,
      segments: quality.segments,
    });
    geos.push(geo);
    const ud = geo.userData as KeycapUserData;
    let atlas: Atlas | null = null;
    let mat: MeshPhysicalMaterial;
    let shell: MeshPhysicalMaterial | undefined;
    const mesh = new Mesh(geo);
    mesh.rotation.order = 'YXZ';
    if (spec.art) {
      const resin = resinMaterials(spec, tex);
      disposables.push(resin);
      shell = resin.shell;
      mat = resin.shell;
      mesh.material = resin.shell;
      mesh.renderOrder = 3;
      const core = new Mesh(geo, resin.core);
      core.scale.setScalar(0.92);
      core.renderOrder = 2;
      mesh.add(core);
      const mg = monogram();
      geos.push(mg);
      const mark = new Mesh(mg, resin.mark);
      mark.position.set(0, 0.33, -0.02);
      mark.scale.setScalar(0.72);
      mark.rotation.y = 0.3;
      mesh.add(mark);
      mesh.userData.mark = mark;
    } else {
      atlas = createAtlas(spec, ud, legendsFor(i, data), quality.segments, opts.anisotropy);
      disposables.push(atlas.texture);
      mat = capMaterial(spec, atlas.texture, tex);
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    group.add(mesh);

    const blobMat = track(new MeshBasicMaterial({ map: tex.blob, color: '#000000', transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false }));
    const blob = new Mesh(flat, blobMat);
    blob.renderOrder = 2;
    const glowMat = track(
      new MeshBasicMaterial({ map: tex.glow, color: new Color(spec.glow), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    const glow = new Mesh(flat, glowMat);
    glow.renderOrder = 4;
    group.add(blob, glow);
    return { mesh, geo, ud, shell, mat, atlas, blob, blobMat, glow, glowMat, hold: 0, plate: data.plans > 0 ? plateOf(i) : -1 };
  });
  for (const g of geos) disposables.push(g);

  const paint = (fonts: Fonts) => caps.forEach((cap, i) => cap.atlas && paintAtlas(cap.atlas, CAST[i]!, cap.ud, fonts));
  paint(opts.fonts);

  /* ---------- plates (pricing): one per plan, growing */
  const plateBody = track(new MeshPhysicalMaterial({ color: PLATE_COLOR.body, metalness: 0.6, roughness: 0.34, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.55 }));
  const plateTop = track(new MeshStandardMaterial({ color: PLATE_COLOR.top, metalness: 0.2, roughness: 0.7, envMapIntensity: 0.3 }));
  const plates = plan.map(({ w, d }) => {
    const mesh = new Mesh(track(new RoundedBoxGeometry(w, PLATE_TOP, d, Math.max(2, Math.round(4 * quality.segments)), 0.09)), plateBody);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const inset = new Mesh(track(new RoundedBoxGeometry(w - 0.32, 0.04, d - 0.32, 2, 0.02)), plateTop);
    inset.receiveShadow = true;
    inset.position.y = PLATE_TOP / 2 - 0.005;
    mesh.add(inset);
    mesh.visible = false;
    const blobMat = track(new MeshBasicMaterial({ map: tex.blob, color: '#000000', transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }));
    const blob = new Mesh(flat, blobMat);
    blob.renderOrder = 2;
    blob.visible = false;
    group.add(mesh, blob);
    return { mesh, blob, blobMat, lift: 0, w, d };
  });

  const motion = createMotion({ hemi, key, rim, pool, poolMat, floor, floorMat, caps, plates }, data, layouts);

  return {
    group,
    update: motion.update,
    repaint: paint,
    keyDown: motion.keyDown,
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}

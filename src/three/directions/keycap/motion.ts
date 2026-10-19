import { Color, MathUtils, type Mesh, Vector3 } from 'three';
import { stageInput, type StageData } from '@/lib/stage-data';
import { ART, CAIRN_ORDER, CAP_OF_SERVICE, CAST, ENTER, LAYOUT_NAMES, SPACE } from '@/three/directions/keycap/cast';
import { personCaps, sleeveCaps, type Layouts, type LayoutSet } from '@/three/directions/keycap/layouts';
import type { Parts, SceneFrame } from '@/three/directions/keycap/parts';
import { selectTile } from '@/three/directions/keycap/legends';
import { PLATE_TOP } from '@/three/directions/keycap/plates';

/**
 * The per-frame motion of the keycap scene. Between two stations the engine lerps the
 * layout weights. The two non-zero ones name the layouts the caps are travelling
 * between and the larger the second's weight, the further along they are. Each cap
 * is lifted, carried across and set down in turn, like keys rearranged by hand, so a
 * chapter change reads as the same nine caps regrouping, never a crossfade. Nothing here
 * allocates per frame; scratch objects live at module scope.
 */
/**
 * Each cap moves within MOVE_SPAN of the transition, the next one MOVE_STEP later, so all
 * nine are placed by about nine tenths of the way. CAP_CLEAR: how far above the higher of
 * its two resting places a cap is carried (it clears the caps it passes over).
 */
const MOVE_START = 0.04;
const MOVE_STEP = 0.065;
const MOVE_SPAN = 0.34;
const CAP_CLEAR = 1.1;

/** Per layout, each cap's turn to move: the top of the stack first, then left to right. */
const ranks = new WeakMap<object, Int8Array[]>();
function rankOf(set: LayoutSet, layoutIndex: number): Int8Array {
  let byLayout = ranks.get(set);
  if (!byLayout) {
    byLayout = LAYOUT_NAMES.map((name) => {
      const slots = set[name].slots;
      const order = slots.map((_, i) => i).sort((p, q) => slots[q]!.y - slots[p]!.y || slots[p]!.x - slots[q]!.x);
      const rank = new Int8Array(slots.length);
      order.forEach((cap, n) => (rank[cap] = n));
      return rank;
    });
    ranks.set(set, byLayout);
  }
  return byLayout[layoutIndex]!;
}
const TYPE_SEQ = [1, 5, 3, 6, 4, 2, 3, 1, 7, 5, 2, 6];
const BEAT = 0.34;

const _v = new Vector3();
const _c = new Color();
const _c2 = new Color();

const press = (t: number) => (t < 0 ? 0 : t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 11) * Math.cos((t - 0.05) * 19));
const smoother = (x: number) => MathUtils.smootherstep(x, 0, 1);

export function createMotion(parts: Parts, data: StageData, layouts: Layouts) {
  const { caps, plates, hemi, rim, pool, poolMat, floor, floorMat } = parts;
  /* ---------- per-frame state */
  const keyT = new Float32Array(CAST.length).fill(-100);
  const featured = new Float32Array(CAST.length);
  let lastSent = stageInput.sent;
  let sentAt = -100;

  function update(f: SceneFrame) {
    const { rig, dt, camera, pointer, fine, tall } = f;
    const set: LayoutSet = tall ? layouts.tall : layouts.wide;
    const w = rig.pose.assembly;
    const px = rig.pose.pos.x;
    const py = rig.pose.pos.y;
    const pz = rig.pose.pos.z;
    const reduced = rig.reducedMotion;
    const t = reduced ? 0 : rig.time;
    const k = 1 - Math.exp(-dt * 7);

    // The two layouts the caps are between, and how far along they are.
    let a = -1;
    let b = -1;
    for (let n = 0; n < LAYOUT_NAMES.length; n++) {
      if ((w[LAYOUT_NAMES[n]!] ?? 0) > 1e-4) {
        if (a < 0) a = n;
        else if (b < 0) b = n;
      }
    }
    if (a < 0) a = 0;
    const wa = w[LAYOUT_NAMES[a]!] ?? 1;
    const wb = b >= 0 ? (w[LAYOUT_NAMES[b]!] ?? 0) : 0;
    const tau = b >= 0 ? wb / Math.max(1e-6, wa + wb) : 0;
    const A = set[LAYOUT_NAMES[a]!];
    const B = b >= 0 ? set[LAYOUT_NAMES[b]!] : A;

    const wCairn = w.cairn ?? 0;
    const wCluster = w.cluster ?? 0;
    const wShelf = w.shelf ?? 0;
    const wRow = w.row ?? 0;
    const wEnter = w.enter ?? 0;
    const wPlates = w.plates ?? 0;

    /* inputs from the page: hovered row, featured card, sent form */
    const service = stageInput.service;
    const hovCap = service >= 0 ? CAP_OF_SERVICE[service] ?? -1 : -1;
    const sleeves = sleeveCaps(data.projects);
    const featCap = sleeves[stageInput.project] ?? -1;
    const people = personCaps(data.people.length);
    const personCap = stageInput.person >= 0 ? people[stageInput.person] ?? -1 : -1;
    const plan = stageInput.plan;
    if (stageInput.sent !== lastSent) {
      lastSent = stageInput.sent;
      sentAt = reduced ? -100 : rig.time;
    }

    /* typing rhythm (services) */
    const beatI = Math.floor(t / BEAT);
    const beatT = t - beatI * BEAT;
    const typed = reduced ? -1 : TYPE_SEQ[beatI % TYPE_SEQ.length]!;
    const rest = beatI % 8 === 7;

    /* hero attention: one stacked cap lit from beneath at a time, or the caps nearest the pointer */
    const att = t / 1.7;
    const attLit = CAIRN_ORDER[Math.floor(att) % CAIRN_ORDER.length]!;
    const attAmt = Math.sin(Math.PI * MathUtils.clamp((att - Math.floor(att)) * 1.15, 0, 1));
    const pointerLive = fine && !reduced && Math.abs(pointer.x) + Math.abs(pointer.y) > 0.04 && wCairn > 0.01;
    if (pointerLive) camera.updateMatrixWorld();

    /* contact: the giant Enter presses on a loop, and hard once on a successful send */
    const conT = t % 2.4;
    const conPress = reduced ? 0 : press(conT - 0.9);
    const conGlow = reduced ? 0.6 : 0.35 + 0.65 * MathUtils.clamp(1 - (conT - 0.9) / 1.4, 0, 1) * (conT > 0.9 ? 1 : 0);
    const sentT = rig.time - sentAt;
    const sentOn = sentT >= 0 && sentT < 3;

    for (let i = 0; i < caps.length; i++) {
      const cap = caps[i]!;
      const sa = A.slots[i]!;
      const sb = B.slots[i]!;
      // Placed by hand, one cap at a time, top of the source layout first: up, across at a
      // safe height, down. No spin, no tumble: the rotation turns only while it travels across.
      const start = MOVE_START + (rankOf(set, a)[i] ?? i) * MOVE_STEP;
      const u = MathUtils.clamp((tau - start) / MOVE_SPAN, 0, 1);
      // One continuous path (no stop at the corners): it starts across while still rising
      // and starts down while still finishing across.
      const T = smoother(MathUtils.clamp((u - 0.15) / 0.7, 0, 1));
      const hold = smoother(MathUtils.clamp(u / 0.35, 0, 1)) * smoother(MathUtils.clamp((1 - u) / 0.35, 0, 1));
      // A cap one layout does not use is not flown in from off screen: it is put away
      // where it stood (shrinks into its place) or set out where it will stand (grows).
      const leaving = sb.park && !sa.park;
      const arriving = sa.park && !sb.park;
      const from = arriving ? sb : sa;
      const to = leaving ? sa : sb;
      const sMid = leaving ? sa.s * (1 - smoother(u)) : arriving ? sb.s * smoother(u) : MathUtils.lerp(sa.s, sb.s, T);
      const moving = !leaving && !arriving;
      const carry = Math.max(from.y, to.y) + (moving ? CAP_CLEAR * sMid * (tall ? 0.8 : 1) : 0);
      let x = MathUtils.lerp(from.x, to.x, T);
      const base = MathUtils.lerp(from.y, to.y, T);
      let y = base + (carry - base) * hold;
      let z = MathUtils.lerp(from.z, to.z, T);
      const lift = y - MathUtils.lerp(from.y, to.y, T);
      let rx = MathUtils.lerp(from.rx, to.rx, T);
      let ry = MathUtils.lerp(from.ry, to.ry, T);
      let rz = MathUtils.lerp(from.rz, to.rz, T);
      const s = sMid;
      const ground = MathUtils.lerp(from.ground, to.ground, T);
      // A cap that waits off frame in both layouts is not drawn at all.
      const waiting = sa.park && sb.park;
      cap.mesh.visible = !waiting;
      if (waiting) {
        cap.blob.visible = false;
        cap.glow.visible = false;
        continue;
      }

      // hero: a breathing wobble, growing toward the top of the cairn
      const hw = wCairn * (1 - T);
      if (hw > 0 && !reduced && i !== SPACE && i !== ENTER && i !== 7) {
        const lvl = from.ground / 3;
        rz += Math.sin(t * 0.9) * 0.012 * lvl * hw;
        x += Math.sin(t * 0.9) * 0.03 * lvl * hw;
        ry += Math.sin(t * 0.5 + i) * 0.012 * hw;
      }

      let pressAmt = 0;
      let gl = 0;
      // services: a service row hovered or focused holds its key down; otherwise keys type in a rhythm
      cap.hold += ((i === hovCap ? 1 : 0) * wCluster - cap.hold) * k;
      if (cap.hold > 0.001) {
        pressAmt += cap.hold * 0.7;
        gl += cap.hold;
      } else if (wCluster > 0 && i === typed && !rest) {
        pressAmt += press(beatT) * wCluster;
        gl += Math.max(0, press(beatT)) * wCluster;
      }
      // work: the featured sleeve is pulled up out of the bin and turned to the viewer
      featured[i] = featured[i]! + (((i === featCap ? 1 : 0) * wShelf) - featured[i]!) * k;
      if (featured[i]! > 0.001) {
        rx -= (tall ? 0.3 : 0.38) * featured[i]!;
        y += (tall ? 0.95 : 0.85) * featured[i]!;
        z += (tall ? 0.2 : 0.12) * featured[i]!;
        gl += 0.35 * featured[i]!;
      }
      // pricing: a hovered plan lifts its plate and lights its caps
      if (plan >= 0 && cap.plate === plan && wPlates > 0) {
        y += 0.12 * wPlates;
        gl += 0.5 * wPlates;
      }
      // team: the crown cap bobs; a hovered developer's key hops
      if (wRow > 0 && i === ART && !reduced) y += Math.sin(t * 1.4) * 0.05 * wRow;
      if (wRow > 0 && i === ART) gl += 0.45 * wRow;
      if (wRow > 0 && i === personCap) {
        y += 0.25 * wRow;
        gl += 0.8 * wRow;
      }
      // contact: the giant Enter
      if (wEnter > 0 && i === ENTER) {
        pressAmt += conPress * wEnter;
        gl += conGlow * wEnter * (0.6 + 0.4 * Math.max(0, conPress));
        if (sentOn) {
          pressAmt += press(sentT - 0.15) * 1.2 * wEnter;
          gl += (1 - sentT / 3) * 1.3 * wEnter;
        }
      }
      // the visitor's own keys: travel for caps on the floor, a hop for caps in a stack
      const kp = t - keyT[i]!;
      let kpc = 0;
      if (kp >= 0 && kp < 1.4 && !reduced) {
        kpc = press(kp);
        if (ground > 0.3) y += kpc * 0.2 * s;
        else pressAmt += kpc;
        if (kpc > 0) gl += kpc;
      }
      // underglow: attention is illumination
      if (pointerLive && i !== SPACE) {
        _v.set(x, y + cap.ud.h * 0.5 * s, z).project(camera);
        const dx = _v.x - pointer.x;
        const dy = (_v.y - pointer.y) * 0.7;
        const near = 1 - MathUtils.clamp(Math.sqrt(dx * dx + dy * dy) / 0.32, 0, 1);
        gl += near * near * wCairn;
      } else if (!pointerLive && i === attLit && !reduced) gl += attAmt * wCairn * 0.9;

      y -= pressAmt * 0.13 * s;
      cap.mesh.position.set(x - px, y - py, z - pz);
      cap.mesh.rotation.set(rx, ry, rz);
      cap.mesh.scale.set(MathUtils.lerp(from.sx, to.sx, T) * s, s, s);

      // The legend swaps while the cap is in flight.
      if (cap.atlas) selectTile(cap.atlas, cap.atlas.tileOf[T < 0.5 ? a : b >= 0 ? b : a]!);

      // contact blob on the support plane
      const bOn = MathUtils.lerp(from.grounded, to.grounded, T) * (1 - MathUtils.clamp(lift / 0.8, 0, 1)) * (s > 0.02 ? 1 : 0);
      cap.blob.visible = bOn > 0.01;
      if (cap.blob.visible) {
        const ox = MathUtils.lerp(from.ox, to.ox, T);
        const oz = MathUtils.lerp(from.oz, to.oz, T);
        const cy = Math.cos(ry);
        const sy = Math.sin(ry);
        cap.blob.position.set(x + ox * cy + oz * sy - px, ground + 0.004 - py, z - ox * sy + oz * cy + 0.04 - pz);
        cap.blob.rotation.y = ry;
        const margin = i === SPACE ? 0.15 : 0.35;
        cap.blob.scale.set(MathUtils.lerp(from.bw, to.bw, T) * MathUtils.lerp(from.sx, to.sx, T) * 1.18 + margin, 1, MathUtils.lerp(from.bd, to.bd, T) * 1.22 + margin);
        cap.blobMat.opacity = (i === SPACE ? 0.55 : 0.4) * bOn;
      }

      cap.mat.emissiveIntensity = gl * (cap.shell ? 0.9 : CAST[i]!.col === 'chalk' ? 0.7 : 1.6);
      if (!cap.shell) {
        // team: a satin coat while the caps stand on the shelf (a sharper coat would bleach the colour)
        cap.mat.roughness = MathUtils.lerp(CAST[i]!.rough, 0.5, wRow);
        cap.mat.clearcoat = 0.0001 + 0.16 * wRow;
        cap.mat.clearcoatRoughness = 0.22 + 0.3 * wRow;
      }
      cap.glow.visible = gl > 0.01 && bOn > 0.5;
      if (cap.glow.visible) {
        cap.glow.position.set(x - px, ground + 0.01 - py, z - pz);
        cap.glow.rotation.y = ry;
        cap.glow.scale.set((cap.ud.hw0 * 2 + 0.45) * s * MathUtils.lerp(from.sx, to.sx, T), 1, (cap.ud.hd0 * 2 + 0.45) * s);
        cap.glowMat.opacity = MathUtils.clamp(gl, 0, 1) * 0.9;
      }
    }
    const mark = caps[ART]!.mesh.userData.mark as Mesh | undefined;
    if (mark) mark.rotation.y = 0.3 + (reduced ? 0 : Math.sin(t * 0.6) * 0.25);

    /* plates are set down in place before the caps arrive, and put away after they leave */
    const plateSlots = layouts[tall ? 'tall' : 'wide'].plates.plates;
    for (let n = 0; n < plates.length; n++) {
      const pl = plates[n]!;
      const slot = plateSlots[n]!;
      const grown = smoother(MathUtils.clamp(wPlates * 2.2 - n * 0.15, 0, 1));
      // A trace of weight left near a neighbouring station must not leave a plate showing.
      const vis = grown > 0.02;
      pl.mesh.visible = vis;
      pl.blob.visible = vis;
      if (!vis) continue;
      pl.lift += ((plan === n ? 0.12 : 0) - pl.lift) * k;
      pl.mesh.scale.set(grown, grown, grown);
      pl.mesh.position.set(slot.x - px, (PLATE_TOP / 2) * grown + pl.lift - py, slot.z - pz);
      pl.blob.position.set(slot.x - px, 0.003 - py, slot.z + 0.05 - pz);
      pl.blob.scale.set((pl.w * 1.15 + 0.6) * grown, 1, (pl.d * 1.25 + 0.6) * grown);
      pl.blobMat.opacity = 0.45 * grown;
    }

    /* the field's colour bounces onto the caps; the contact field needs a stronger rim */
    _c.copy(rig.pose.tint);
    hemi.groundColor.copy(_c);
    hemi.color.copy(_c2.set('#ffffff').lerp(_c, 0.35));
    // Shadows are black at partial opacity, never tinted: over any field they darken that
    // field's own hue, so a shadow crossing a section edge in flight never shows the wrong colour.
    floor.position.y = -py;
    const lum = 0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b;
    floorMat.opacity = MathUtils.lerp(0.42, 0.26, MathUtils.smoothstep(lum, 0.1, 0.35));
    rim.intensity = MathUtils.lerp(0.9, 1.6, wEnter);
    pool.visible = wEnter > 0.001;
    if (pool.visible) {
      pool.position.set(0.2 - px, 0.006 - py, 0.4 - pz);
      const ps = tall ? 11 : 15;
      pool.scale.set(ps, 1, ps * 0.8);
      poolMat.opacity = 0.06 * wEnter;
    }
  }

  return {
    update,
    keyDown: (cap: number, time: number) => {
      keyT[cap] = time;
    },
  };
}

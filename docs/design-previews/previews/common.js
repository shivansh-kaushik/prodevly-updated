// Shared stage + motion helpers for every direction preview.
// A preview module exports `meta` and `create(ctx)`; this file owns the
// renderer, the scroll-follow spring and the device frame so every direction
// is judged on the same footing.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export { THREE };

export const reducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** C2-continuous 0..1 ramp between `from` and `to`. */
export function band(x, from, to) {
  if (from === to) return x < from ? 0 : 1;
  const t = clamp((x - from) / (to - from), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 1 inside [a,b], easing in over `fade` before a and out over `fade` after b. */
export function window01(x, a, b, fade = 0.06) {
  return band(x, a - fade, a) * (1 - band(x, b, b + fade));
}

/** Frame-rate independent exponential approach. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/**
 * Critically damped spring (Unity SmoothDamp). `maxSpeed` caps how fast the
 * rendered value may chase the target, so a fast flick never outruns the eye.
 */
export function smoothDamp(state, target, smoothTime, dt, maxSpeed = Infinity) {
  const st = Math.max(1e-4, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const original = target;
  const maxChange = maxSpeed * st;
  const change = clamp(state.value - target, -maxChange, maxChange);
  const shifted = state.value - change;
  const temp = (state.velocity + omega * change) * dt;
  state.velocity = (state.velocity - omega * temp) * decay;
  let out = shifted + (change + temp) * decay;
  if (original - state.value > 0 === out > original) {
    out = original;
    state.velocity = dt > 0 ? (out - original) / dt : 0;
  }
  state.value = out;
  return out;
}

/** Interpolate between keyframes `[{at, ...numbers}]` sorted by `at`, with smootherstep. */
export function keyframes(frames, p) {
  if (p <= frames[0].at) return { ...frames[0] };
  const last = frames[frames.length - 1];
  if (p >= last.at) return { ...last };
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (p >= a.at && p <= b.at) {
      const t = band(p, a.at, b.at);
      const out = { at: p };
      for (const k of Object.keys(a)) {
        if (k === 'at') continue;
        const va = a[k];
        const vb = b[k] ?? va;
        out[k] = typeof va === 'number' ? lerp(va, vb, t) : t < 0.5 ? va : vb;
      }
      return out;
    }
  }
  return { ...last };
}

/**
 * Renderer, scene, camera and a PMREM room environment, sized to `host`.
 * Neutral tone mapping by default because it keeps saturated hues honest.
 */
export function createStage(host, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'stage-canvas';
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = opts.toneMapping ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;
  renderer.shadowMap.enabled = Boolean(opts.shadows);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background ?? '#f2f2f2');

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 35, 1, 0.1, 400);
  camera.position.set(0, 0, 10);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTex = pmrem.fromScene(room, 0.04).texture;
  scene.environment = envTex;
  room.dispose?.();

  const size = { width: 1, height: 1, isPhone: false, dpr: 1 };

  function resize(width, height, isPhone) {
    size.width = Math.max(1, Math.round(width));
    size.height = Math.max(1, Math.round(height));
    size.isPhone = isPhone;
    size.dpr = Math.min(window.devicePixelRatio || 1, isPhone ? 1.75 : 2);
    renderer.setPixelRatio(size.dpr);
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
      else m?.dispose?.();
    });
    envTex.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    canvas.remove();
  }

  return { THREE, renderer, scene, camera, canvas, size, resize, dispose };
}

/**
 * Mounts a preview module into a `.pv` figure and wires its controls.
 * Returns a handle with pause/resume/dispose.
 */
export async function mountPreview(figure, mod) {
  const viewport = figure.querySelector('.pv-viewport');
  const overlay = figure.querySelector('.pv-overlay');
  const slider = figure.querySelector('.pv-scrub');
  const playBtn = figure.querySelector('.pv-play');
  const chipsEl = figure.querySelector('.pv-chips');
  const readTarget = figure.querySelector('.pv-read-target');
  const readRender = figure.querySelector('.pv-read-render');
  const barTarget = figure.querySelector('.pv-bar-target');
  const barRender = figure.querySelector('.pv-bar-render');
  const deviceBtns = figure.querySelectorAll('.pv-device');

  const meta = mod.meta ?? {};
  const sections = meta.sections ?? [{ key: 'hero', label: 'Hero', at: 0 }];

  if (meta.fonts?.length && !document.querySelector(`link[data-fonts="${meta.id}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.fonts = meta.id;
    link.href =
      'https://fonts.googleapis.com/css2?' +
      meta.fonts.map((f) => 'family=' + f).join('&') +
      '&display=swap';
    document.head.appendChild(link);
  }
  if (mod.css && !document.querySelector(`style[data-pv="${meta.id}"]`)) {
    const style = document.createElement('style');
    style.dataset.pv = meta.id;
    style.textContent = mod.css;
    document.head.appendChild(style);
  }

  const stage = createStage(viewport, meta.stage ?? {});
  const state = { value: 0, velocity: 0 };
  let target = 0;
  let playing = !reducedMotion;
  let autoIndex = 0;
  let autoClock = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, active: false };
  let isPhone = figure.classList.contains('is-phone');

  const ctx = {
    THREE,
    scene: stage.scene,
    camera: stage.camera,
    renderer: stage.renderer,
    overlay,
    viewport,
    get isPhone() {
      return isPhone;
    },
    reducedMotion,
    helpers: { band, window01, damp, smoothDamp, keyframes, clamp, lerp },
  };
  const inst = mod.create(ctx) ?? {};

  // Section chips
  chipsEl.innerHTML = '';
  sections.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pv-chip';
    b.textContent = s.label;
    b.addEventListener('click', () => {
      setPlaying(false);
      target = s.at;
      autoIndex = i;
    });
    chipsEl.appendChild(b);
  });
  const chipEls = [...chipsEl.children];

  function setPlaying(v) {
    playing = v;
    playBtn.setAttribute('aria-pressed', String(v));
    playBtn.textContent = v ? 'Pause' : 'Play';
  }
  setPlaying(playing);
  playBtn.addEventListener('click', () => setPlaying(!playing));

  slider.addEventListener('input', () => {
    setPlaying(false);
    target = Number(slider.value) / 1000;
  });

  viewport.addEventListener(
    'wheel',
    (e) => {
      const next = clamp(target + e.deltaY * 0.0007, 0, 1);
      if (next === target) return; // at an end: let the page scroll on
      e.preventDefault();
      setPlaying(false);
      target = next;
    },
    { passive: false },
  );
  viewport.addEventListener('pointermove', (e) => {
    const r = viewport.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
    pointer.active = true;
  });
  viewport.addEventListener('pointerleave', () => {
    pointer.tx = 0;
    pointer.ty = 0;
    pointer.active = false;
  });

  function applySize() {
    const r = viewport.getBoundingClientRect();
    stage.resize(r.width, r.height, isPhone);
    inst.resize?.({ width: r.width, height: r.height, isPhone });
  }
  deviceBtns.forEach((btn) =>
    btn.addEventListener('click', () => {
      isPhone = btn.dataset.device === 'phone';
      figure.classList.toggle('is-phone', isPhone);
      deviceBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      requestAnimationFrame(applySize);
    }),
  );
  const ro = new ResizeObserver(applySize);
  ro.observe(viewport);
  applySize();

  let visible = true;
  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
    },
    { rootMargin: '120px' },
  );
  io.observe(figure);

  let last = performance.now();
  let time = 0;
  let raf = 0;
  let lastRead = -1;
  let lastWall = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!visible) {
      lastWall = now;
      return; // rAF already sleeps in background tabs
    }
    time += dt;

    if (playing) {
      autoClock += Math.min(0.5, Math.max(0, (now - lastWall) / 1000));
      if (autoClock > 2.6) {
        autoClock = 0;
        autoIndex = (autoIndex + 1) % sections.length;
        target = sections[autoIndex].at;
      }
    }

    // The fix for a rider that outruns the scroll: chase, don't sync.
    const progress = reducedMotion
      ? (state.value = target)
      : smoothDamp(state, target, 0.45, dt, 0.42);

    pointer.x = damp(pointer.x, pointer.tx, 4, dt);
    pointer.y = damp(pointer.y, pointer.ty, 4, dt);

    lastWall = now;
    inst.update?.({ progress, target, velocity: state.velocity, dt, time, pointer, isPhone });
    stage.renderer.render(stage.scene, stage.camera);

    if (Math.abs(progress - lastRead) > 0.002 || !playing) {
      lastRead = progress;
      if (document.activeElement !== slider) slider.value = String(Math.round(target * 1000));
      readTarget.textContent = Math.round(target * 100) + '%';
      readRender.textContent = Math.round(progress * 100) + '%';
      barTarget.style.inlineSize = target * 100 + '%';
      barRender.style.inlineSize = progress * 100 + '%';
      let current = 0;
      sections.forEach((s, i) => {
        if (progress >= s.at - 0.04) current = i;
      });
      chipEls.forEach((c, i) => c.setAttribute('aria-current', String(i === current)));
    }
  }
  raf = requestAnimationFrame(frame);

  return {
    /** Test hook: put both target and rendered progress at `p` and draw one frame. */
    jump(p, t = time) {
      setPlaying(false);
      target = clamp(p, 0, 1);
      state.value = target;
      state.velocity = 0;
      inst.update?.({ progress: target, target, velocity: 0, dt: 1 / 60, time: t, pointer, isPhone });
      stage.renderer.render(stage.scene, stage.camera);
      readTarget.textContent = readRender.textContent = Math.round(target * 100) + '%';
      barTarget.style.inlineSize = barRender.style.inlineSize = target * 100 + '%';
    },
    setPhone(v) {
      deviceBtns.forEach((b) => {
        if ((b.dataset.device === 'phone') === v) b.click();
      });
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      inst.dispose?.();
      stage.dispose();
      overlay.innerHTML = '';
    },
  };
}

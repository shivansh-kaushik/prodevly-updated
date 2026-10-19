import { useFrame, useThree } from '@react-three/fiber';
import { type ComponentType, useEffect, useMemo, useRef } from 'react';
import type { PerspectiveCamera } from 'three';
import { stage, bucketFor } from '@/lib/stage-store';
import type { StageData } from '@/lib/stage-data';
import type { SubjectProps } from '@/three/direction';
import { CODE_CAP } from '@/three/directions/keycap/cast';
import type { Layouts } from '@/three/directions/keycap/layouts';
import { FALLBACK_FONTS, type Fonts } from '@/three/directions/keycap/legends';
import { createKeycapScene } from '@/three/directions/keycap/scene';

/** CSS font-family strings from the next/font variables, so the canvas prints in the page's faces. */
function readFonts(): Fonts {
  const css = getComputedStyle(document.querySelector('.pd-site') ?? document.documentElement);
  const display = css.getPropertyValue('--font-hubot').trim();
  const mono = css.getPropertyValue('--font-martian').trim();
  return { display: display ? `${display}, ${FALLBACK_FONTS.display}` : FALLBACK_FONTS.display, mono: mono ? `${mono}, ${FALLBACK_FONTS.mono}` : FALLBACK_FONTS.mono };
}

const isTextField = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Any key without a cap of its own presses one picked from its code, so every key does something. */
function capFor(code: string): number {
  const known = CODE_CAP[code];
  if (known !== undefined) return known;
  let h = 7;
  for (let k = 0; k < code.length; k++) h = (h * 31 + code.charCodeAt(k)) | 0;
  return 1 + (Math.abs(h) % 8);
}

/** The Subject for one page's content. Built per direction, so counts are closed over. */
export function createSubject(data: StageData, layouts: Layouts): ComponentType<SubjectProps> {
  return function KeycapSubject({ quality, rig }: SubjectProps) {
    const gl = useThree((s) => s.gl);
    const size = useThree((s) => s.size);
    const scene = useMemo(
      () =>
        createKeycapScene({
          quality,
          data,
          layouts,
          anisotropy: Math.min(8, gl.capabilities.getMaxAnisotropy()),
          fonts: readFonts(),
        }),
      [quality, gl],
    );
    useEffect(() => () => scene.dispose(), [scene]);

    // Repaint the legends once the real faces are in.
    useEffect(() => {
      let alive = true;
      void document.fonts.ready.then(() => alive && scene.repaint(readFonts()));
      return () => {
        alive = false;
      };
    }, [scene]);

    // The visitor's own keyboard presses the matching cap (fine pointers, never while typing in a form).
    useEffect(() => {
      if (!window.matchMedia('(pointer: fine)').matches) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.repeat || rig.reducedMotion || !stage.inView || isTextField(e.target)) return;
        scene.keyDown(capFor(e.code || e.key), rig.time);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [scene, rig]);

    const fine = useMemo(() => window.matchMedia('(pointer: fine)').matches, []);
    const last = useRef(0);
    useFrame((state) => {
      const dt = Math.min(Math.max(rig.time - last.current, 0), 1 / 20);
      last.current = rig.time;
      scene.update({
        rig,
        dt,
        camera: state.camera as PerspectiveCamera,
        pointer: state.pointer,
        fine,
        tall: bucketFor(size.width, size.height) === 'tall',
      });
    });

    return <primitive object={scene.group} />;
  };
}

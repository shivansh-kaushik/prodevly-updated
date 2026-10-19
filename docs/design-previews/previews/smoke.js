import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const meta = {
  id: 'smoke',
  title: 'Harness smoke test',
  stage: { background: '#e9e4ff', fov: 35 },
  sections: [
    { key: 'hero', label: 'Hero', at: 0 },
    { key: 'services', label: 'Services', at: 0.33 },
    { key: 'work', label: 'Work', at: 0.66 },
    { key: 'contact', label: 'Contact', at: 1 },
  ],
};

export const css = `.smoke-h{position:absolute;left:6cqw;top:8cqh;font:800 7cqw/0.9 system-ui;color:#1a1036;margin:0}`;

export function create({ THREE, scene, camera, overlay, helpers }) {
  overlay.innerHTML = '<p class="smoke-h">Smoke</p>';
  const colors = ['#ff5b3a', '#ffc53d', '#2fbf71', '#2f6bff', '#a14bff'];
  const group = new THREE.Group();
  const blocks = colors.map((c, i) => {
    const m = new THREE.Mesh(
      new RoundedBoxGeometry(1.6, 0.7, 1.6, 4, 0.12),
      new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.35, clearcoat: 0.6 }),
    );
    m.position.y = i * 0.78 - 1.6;
    group.add(m);
    return m;
  });
  scene.add(group);
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(4, 6, 5);
  scene.add(key);
  camera.position.set(0, 0.6, 9);

  return {
    update({ progress, time, pointer, isPhone }) {
      blocks.forEach((b, i) => {
        b.rotation.y = progress * Math.PI * (1 + i * 0.35) + time * 0.1;
        b.position.x = Math.sin(progress * Math.PI * 2 + i) * helpers.band(progress, 0.2, 0.5) * 0.8;
      });
      group.rotation.x = pointer.y * 0.15;
      group.rotation.z = -pointer.x * 0.1;
      group.position.x = isPhone ? 0 : 1.8;
      camera.position.z = isPhone ? 12 : 9;
      camera.lookAt(isPhone ? 0 : 1.8, 0, 0);
    },
  };
}

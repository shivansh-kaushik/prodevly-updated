# Preview builder brief (read fully before writing code)

You are building ONE live 3D preview of a design direction for the ProDevly home page.
ProDevly is a web development, SaaS and custom software studio (clients: startups/SaaS founders,
Indian SMBs, international clients, agencies). Read /Users/amangupta/Desktop/FL/ProdevlyWebsite/PRODUCT.md.

The preview is embedded in a planning page (an Artifact) next to three other directions. The user
will choose a direction from these previews, so each must be the best possible honest proof of
its idea: colourful, FULLY 3D sculptural "totems" (solid, lit, bevelled PBR objects — never flat,
never line drawings), Awwwards-level craft, and it must look designed on a PHONE, not just desktop.

## Files and harness (all paths relative to ARTIFACT = this file's directory)

- `previews/common.js` — DO NOT EDIT. Owns renderer, PMREM room environment, scroll-follow spring.
- `previews/smoke.js` — a tiny reference module showing the contract.
- `dev.html?m=<id>` — mounts one module full-size with controls. `&device=phone` for the phone
  frame (390x780 aspect). `&jump=0.4` pins scroll progress for screenshots.
- `shoot.sh <id> [p ...]` — headless Chrome screenshots of desktop + phone at each progress into
  `shots/<id>-desk-<p>.png` / `shots/<id>-phone-<p>.png` (~6s for 12 shots). Open them with the
  Read tool to SEE your work. Errors thrown by your module print in red text under the frame, so
  they show in the screenshot. A local server already serves ARTIFACT at http://127.0.0.1:4173.
  Do not start or stop servers. Do not use the shared in-app browser pane.

## Module contract — write `previews/<id>.js`

```js
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'; // any three/addons path works (three@0.186.1 via importmap)
export const meta = {
  id: '<id>', title: '<direction name>',
  stage: { background: '#hex', fov: 30, exposure: 1 /*, toneMapping: THREE.AgXToneMapping */ },
  sections: [ // use exactly these six keys/positions so directions compare fairly
    { key: 'hero', label: 'Hero', at: 0 }, { key: 'services', label: 'Services', at: 0.2 },
    { key: 'projects', label: 'Projects', at: 0.4 }, { key: 'pricing', label: 'Pricing', at: 0.6 },
    { key: 'team', label: 'Developers', at: 0.8 }, { key: 'contact', label: 'Contact', at: 1 } ],
  fonts: ['Hubot+Sans:wdth,wght@75..125,200..900', ...], // Google Fonts css2 family specs
};
export const css = `/* every selector prefixed .<id>- */`;
export function create(ctx) {
  // ctx: { THREE, scene, camera, renderer, overlay (div over canvas, container-type:size so cqw/cqh work),
  //        viewport, isPhone (getter), reducedMotion, helpers: { band, window01, damp, smoothDamp, keyframes, clamp, lerp } }
  return {
    update({ progress, target, velocity, dt, time, pointer /* {x,y} in -1..1, damped */, isPhone }) {},
    resize({ width, height, isPhone }) {},
    dispose() {},
  };
}
```

`progress` is ALREADY the damped, speed-capped follower of scroll (the fix for the old travel site's
car that outran the scroll). Derive every transform from it in `update`. Do not add a second damping
stage in series on top of `progress` for main poses (secondary springs for wobble/settle are fine).
`update` must be deterministic for a given (progress, time) so `jump` screenshots are faithful.

## Overlay (the DOM layer)

Render the direction's real DOM type/copy into `ctx.overlay` (HTML strings you build once in
`create`; then only toggle opacity/transform per section in `update`). It stands in for the actual
page text, so: one short block per section, readable contrast, set in the direction's typefaces,
composed differently on phone (use `ctx.isPhone` / `resize` to switch a class, and cqw/cqh units).
The overlay is pointer-events:none; it's a visual mock, not interactive.

Copy rules (hard): NO invented numbers, stats, client names, testimonials, ratings, years-in-business,
or awards. Projects, partners, pricing and developers are managed in the admin panel and do not exist
yet — show them as clearly labelled samples ("Sample project", "Plan names and prices are set in the
admin") or as structure without figures. Services may name: Web apps, SaaS products, Custom software,
Mobile apps, UI/UX design, Cloud & DevOps. Hero headline: plain and confident, no superlatives you
can't prove (e.g. "Web apps, SaaS and custom software, built end to end."). Brand name: ProDevly.
Primary action: "Start a project".

## Craft rules (from audits of the user's two previous 3D sites — each was a real failure)

1. Totems are real 3D: bevel every edge, varied roughness per material class, one glossy/transmissive
   hero per frame at most, contact shadow or grounding under objects (a shadow-catcher plane, or a
   soft blurred dark disc texture from a canvas), no floating primitives with default materials.
2. Colour: commit at page scale (fields that own whole regions), with a disciplined palette from the
   direction spec. Colours enter as sRGB hex; NeutralToneMapping is the default (keeps hue). Avoid
   AI-look tells: purple→blue gradients, gradient text, glass cards, neon-on-black, cream+terracotta,
   Inter/Space Grotesk/DM Sans/Outfit/Plus Jakarta/Syne/Fraunces/Playfair.
3. Every chapter changes at least TWO of: screen position (cross thirds), scale (≥1.5x), camera
   angle/framing, material/colour, form (assemble/morph). Signature beats are continuous transforms
   of the SAME objects, not crossfades between separate meshes.
4. Phone is designed, not shrunk: the totem gets centre stage between text blocks (e.g. text top
   third, totem middle, or totem top and text on a solid card below). Never a strip stuck to one
   edge, never shrunk to a ghost (<0.85 opacity) in signature chapters. Check every phone shot.
5. Text never sits on a busy 3D area without a solid backing; check contrast in every shot.
6. Pointer: damped tilt/parallax of the totem (±6°) using `pointer`; nothing whips.
7. Performance: procedural geometry only (no external models/images; canvas-generated textures OK),
   instancing for repeated parts, < ~120 draw calls, no allocation inside `update` (keep scratch
   Vector3/Color/Quaternion at module scope), dispose geometries/materials/textures in `dispose`.
   No postprocessing composer (keep it to the core renderer).
8. No network besides three (importmap) and Google Fonts. No localStorage. No audio.

## Process

1. Read this brief, `previews/smoke.js`, `previews/common.js`, and your direction spec in
   `directions.json` (your `id`). Also read the relevant installed skills if useful:
   ~/.claude/skills/build-threejs-scroll-worlds/SKILL.md, ~/.claude/skills/r3f-materials/SKILL.md,
   ~/.claude/skills/r3f-lighting/SKILL.md (R3F skills apply to vanilla three conceptually).
2. Build `previews/<id>.js`. Then run `shoot.sh <id> 0 0.2 0.4 0.6 0.8 1` and LOOK at all 12 shots.
3. Iterate: fix composition, materials, phone layout, readability, errors. Re-shoot. At least three
   full look-fix rounds; stop when every shot would survive an Awwwards juror's glance.
4. Run `node --check previews/<id>.js` (syntax) before finishing.

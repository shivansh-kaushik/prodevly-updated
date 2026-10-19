# Design system: public site

The admin's visual system is in `.interface-design/system.md`. This file covers the public site. Each design branch (`design/keycap`, `design/totems`, `design/source`) adds its fields, inks, type and totems here. `main` holds only the shared 3D stage engine described below; the **Keycap Colorway** section at the end belongs to `design/keycap`. Rules come from `docs/CONTRACT.md`; the full plan is `docs/plan/engineering.html`.

## The 3D stage engine (shared by every direction)

One fixed, transparent canvas sits behind server-rendered DOM. The page is complete without it.

### Layers (back to front)

| z | Layer | Notes |
|---|---|---|
| 0 | Section fields | An absolutely positioned child of each section, in its field colour. |
| 10 | `.pd-stage` | Fixed, `100lvh` (so the iOS toolbar never resizes it), `contain: strict`, `pointer-events: none`, `aria-hidden`. |
| 20 | Content | Copy sits on solid cards, never on bare 3D. |
| 40 | Navbar | Dialogs go in the top layer. |

`<main>` and the sections must not create a stacking context: no transform, filter, opacity below 1, isolation, contain, will-change or positioned z-index on them.

### Frame order (one clock)

`SmoothScroll` owns the only `gsap.ticker` callback, with lag smoothing off. Each tick it does three things in order:

1. `lenis.raf()` (wheel smoothing only; no Lenis under reduced motion).
2. `setScrollY(lenis.targetScroll)`. This is the TARGET, never the smoothed value.
3. `runFrame()` (`src/lib/clock.ts`).

The stage's driver is registered on that clock, after `compileAsync`. Each frame it runs:

1. The followers.
2. The fade.
3. The rest, only if a station is in view and the tab is visible: pose, then secondary motion, then framing, then `advance()` (useFrame and render), then stats.

React never re-renders at frame rate, and nothing allocates per frame.

### Chapters and stations

A station is a section with `data-chapter="<key>"`. Its centre is measured after mount, after fonts load and on a debounced body resize. `chapterFromY` gives each station one unit with a 0.22 to 0.78 hold. When a section is missing (empty admin data), its station drops out and the camera rails are rebuilt through the stations that remain.

### Followers (`src/three/rig/follower.ts`)

| Bucket | smoothTime | Speed cap |
|---|---|---|
| wide, mid | 0.45 s | 1.6 chapters/s |
| tall | 0.55 s | 1.3 chapters/s |

- The camera follower is 0.15 s slower, in parallel. It never feeds from the subject.
- **Catch-up:** the cap is multiplied by `1 + 2 * max(0, gap - 1)`.
- **Fade-cut:** a gap over 2.5 chapters fades out (150 ms), jumps to half a chapter short, then fades in (200 ms).
- `dt` is clamped to 1/20 s.
- **Reduced motion:** the subject holds the nearest station and cuts between stations (150 ms each way). Secondary motion is off.

### Poses as data (`src/three/poses/types.ts`)

Each direction authors a table per bucket: `tall` (aspect below 0.8), `wide` (1.35 and above), and an optional `mid` that overrides `wide` per station. A pose holds:

- `cam`: the direction only.
- `aim`: projected to the centre of the safe rect, so put it on the subject.
- `vFov`: optional.
- `subject`: `{ pos, rot (degrees), scale }`.
- `radius`: the bounding sphere at this station, at scale 1.
- `assembly`: 0..1 parameters.
- `safe`: viewport fractions.
- `env`: `{ yaw, tint }`.

How a pose is evaluated:

- Camera and aim ride centripetal Catmull-Rom rails that pass exactly through each station.
- Scalars lerp and rotations slerp.
- Subject fields follow the subject follower; camera fields follow the camera follower.

### Framing (`src/three/rig/framing.ts`)

- **Vertical FOV:** derived from a 50° horizontal FOV and clamped to 28–45°, so a phone pulls the camera back instead of widening the lens.
- **Distance:** set so the subject fits the safe rect with a 6% margin, on both axes. A pose may give an `extent` (half-size across and up the screen, from its own camera direction); then framing fits that box, so a wide or tall subject fills its zone on every aspect ratio. Without one it fits the `radius` sphere.
- **Measured zones:** a station block may contain a `[data-stage-zone]` element. `SmoothScroll` measures where it sits in the viewport when that station is at rest (pixels, with the centres, on resize and after fonts) and publishes the scroll position the page is drawn at (`scroll.view`, Lenis's animated value). Each frame the driver moves every zone by how far the page has scrolled from its station, so the frame is where the zone IS: the subject scrolls with its section like the copy around it. The pose's `safe` is the fallback.
- **Between stations (`rig/zone-follow.ts`):** the subject follows whichever zone is on screen: it leaves with one section and arrives inside the next. While two zones are partly visible it sits between them, weighted by how much of each shows (eased, so there is no kink as a zone's edge crosses the screen edge), and is drawn smaller (`Direction.travel`, keycap 0.5), so it passes along the seam instead of sliding under copy. The choice depends only on what is on screen, never on which chapter a follower has crossed, so nothing jumps; with no zone on screen it switches unseen. Measured with a steady wheel scroll (`scratchpad` probe): the subject's on-screen position moves with the page to the pixel (median residual 0), and the largest frame-to-frame deviation while on screen is about 25 px during a hand-over.
- **Centring:** `setViewOffset` moves the projection centre to the centre of the safe rect.
- **Checking:** `?debug=stage` draws the safe rect (dashed) and the fitted bounds around the aim (solid). `scripts/measure-zones.ts` prints the zones at seven screen sizes.

### Secondary motion (after the pose, never fed back)

- **Pointer tilt** (fine pointers only): yaw up to 6°, pitch up to 4°, smoothTime 0.35 s.
- **Environment yaw** from the pointer: up to 0.2 rad.
- **Lean** from the clamped scroll delta (touch): up to 5°.
- **Breathing:** 1.2% of the radius over a 6 s period.

### Quality tiers (`src/lib/gpu-tier.ts`)

The tier is chosen before three.js is requested. The checks are: a WebGL2 probe, Save-Data, `deviceMemory` of 4 GB or less (tier 1), and the self-hosted detect-gpu benchmark. Phones are capped at tier 2.

| Tier | DPR cap | Segments | Env | Shadows | FPS cap |
|---|---|---|---|---|---|
| 0 | none: posters only, three.js never requested | | | | |
| 1 | 1.25 | 0.5 | 64 | blob texture | 60 |
| 2 | 1.5 | 0.75 | 128 | ContactShadows baked once per station | 60 |
| 3 | 2 | 1 | 256 | ContactShadows live | none |

At runtime the tier only steps down:

- Below 45 fps for 3 s: drop one tier.
- At tier 1, below 30 fps for 5 s: the stage fades to the posters for the visit.
- Pauses restart the measurement window.

In dev and opted-in previews, `?tier=0..3` forces a tier.

### Posters, context loss and fallbacks

`StageMount` writes the stage status to `<html data-stage>`. The possible values are `detecting`, `off`, `loading`, `ready`, `lost` and `failed`. Posters (`.pd-poster`) stay visible until `ready`, then crossfade in 400 ms while the canvas fades in.

When the WebGL context is lost:

1. The poster shows.
2. On restore, the stage remounts once with a fresh canvas.
3. A second loss in the same visit means tier 0.

R3F's own `forceContextLoss` on unmount is ignored.

### Layout hook

`pd-split:` (`globals.css`) is the two-column variant. It applies at width 768 and up with aspect 0.8 and up, which matches the stage's mid and wide buckets. A portrait tablet therefore keeps the stacked phone composition that its `tall` poses are framed for.

### Adding a direction (Phase 5, on its design branch)

1. Create `src/three/directions/<id>/` exporting a `Direction` (`src/three/direction.ts`). It contains:
   - `poses`: `{ tall, wide, mid? }`.
   - `Subject`: reads `rig.pose.assembly` in its own useFrame, allocates nothing per frame, and disposes what it creates.
   - `Lightformers`.
   - `shadow`.
   - `fill`.
2. Add `src/three/entries/<id>.tsx` and register it in `ENTRIES` in `src/components/site/stage-mount.tsx`.
3. Mount `<StageMount direction="<id>" />` from the home page. Never mount it from a layout.
4. Never edit `src/three/rig/*` for a design.

### Budgets measured on the fixture (2026-10-13)

| Measure | Result | Budget |
|---|---|---|
| Admin routes | no three, GSAP or Lenis (54 pages) | none |
| Site entry JS (layout and page) | 36.7 KB gzip | |
| Lazy 3D chunk (three, R3F, drei, engine, fixture) | 267.7 KB gzip | 300 KB |
| Fixture at tier 3 | 7 draw calls, 9 programs, 10k triangles | |

The site entry JS includes GSAP and Lenis but not three.

### Checks

- `npm test` runs the follower, fade, pose, framing, perf-guard, tier and clock unit tests.
- `npm run check:stage`, against `npm run dev`, drives `/dev/stage` in Chrome. It checks:
  - the fling speed cap and the End-key single cut;
  - zero frames behind the footer and zero resizes during scroll;
  - context loss and restore;
  - tier 0 makes no three.js request;
  - stations can be omitted;
  - reduced motion.
- `npm run check:stage -- --shots` writes station screenshots at 375, 390, 768 and 1440 to `test-results/stage/`.

`/dev/stage` uses an engine fixture: a neutral stack of bevelled, lit pieces. It is not a design and 404s in production unless `NEXT_PUBLIC_STAGE_DEV=1`.

## Keycap Colorway (`design/keycap`)

A cairn of oversized sculpted keycaps that unstacks into a key cluster, stands up as record sleeves, settles onto keyboard plates, lines up as a row of makers' keys and ends as one giant Enter. Spec: `docs/plan/directions.json` (id `keys`) and the stills in `docs/design-previews/stills/keys-*`.

### Fields, inks, type

| Station | Field | Ink |
|---|---|---|
| hero | cobalt `#2340C8` | chalk |
| services | chalk `#EEF1F0` | graphite `#1B1D22` |
| work | yolk `#F6C12B` | graphite |
| pricing | mint `#8FD8C0` | graphite |
| team | tomato `#E5362C` | chalk, large type only (3.8:1); small text sits on chalk cards |
| contact, footer | graphite | chalk |

Tokens are `@theme static` in `globals.css` (`--color-chalk`, `-chalk-side` and so on; the `-side` colour is the key's skirt). The tomato KEY face is `--color-tomato-key` (`#CC2B22`), a shade deeper than the field, so chalk labels on it pass AA (4.7:1). `npm run check:contrast` checks every pair. Faces (next/font, set on `.pd-site`): Hubot Sans at width 125 and weight 860 for display (`.pd-display`), Mona Sans for text, Martian Mono for keys, legends and kickers (`.pd-mono`, `.pd-kicker`). `pd-eyebrow` belongs to the admin; the public site's is `pd-kicker`.

Every action is a flat pill (`.pd-key`, `components/home/key.tsx`) in a colourway tone, in `em` so it scales with its text, darker on hover; an arrow marks an action that goes somewhere. The nav is a graphite bar whose pills are the sections: the pill of the section on screen gets a chalk ring, and each visited section keeps its dot lit.

### Page structure

`components/home/home.tsx` assembles hero, partners, services, work, pricing, team, contact and footer, plus `StageMount direction="keycap"`. A section with no published records renders nothing, and its nav key and its station go with it. Records come from `loadHomeContent()` (`lib/content/home-loader.ts`, server only): everything published in the admin, through the cached reads in `lib/content/public.ts`. Without `MONGODB_URI` the page renders its static sections; a database that is down at build time builds the page without records (it fills in on revalidation). `/dev/home` renders the same page with SAMPLE records (`?projects=0..8 &plans=0..5 &people=0..9 &partners=0..4`), in development only.

- **Station = the content block, one screen tall.** `data-chapter` sits on the section's content block (`Section station=`), and on the services station's inner grid (the details below it are ordinary content). The totem is at rest when that screen is in view. Every block measures 100svh from 360x800 to 1440x900 (the zone takes what the copy leaves: `minmax(20svh, 1fr)`).
- **Zone.** Each station reserves a zone for the totem (`Zone`, `data-stage-zone`, class `pd-poster`) between its heading and its cards (phone), or beside the copy (desktop). The stage measures it and frames the totem into it. The poster AVIF is absolutely positioned inside it, so it never sizes the zone.
- **Phone first.** Heading top, totem middle, solid card or rail below. Work, pricing and team cards are rails on a phone (`pd-rail`, snap) and a row on desktop. Pricing columns are as wide as the plates they sit under.
- **Contact.** The phone form shows name, email and message; company, project type and timing open under a button. It posts to Web3Forms (if `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY` is set) and to `/api/leads` in parallel, and succeeds when either call does.

### How the page drives the 3D

- `StageData` (`lib/stage-data.ts`, built by `stageDataOf`): projects, plans and one initial per person. `StageMount data=` passes it to the entry, which builds the direction (`createKeycapDirection(data)`), so counts size the pieces. The stage draws at most six sleeves, four plates and seven people's keys; the DOM lists every record.
- `stageInput`, written by `BoundList` and the contact form only from events: `service` (a hovered or focused tile), `project` (the card in focus, or the one in the middle of a rail), `plan`, `person`, `sent` (a successful form). The frame loop reads it; nothing re-renders.
- A hovered service tile holds its cap pressed and lit; a hovered plan lifts its plate; a hovered person lifts their key; the focused project's sleeve is pulled forward; a sent form presses the giant Enter hard and lights it. With reduced motion there is no gesture.

### The totem (`src/three/directions/keycap/`)

| File | Job |
|---|---|
| `cast.ts` | The nine caps (`SPACE`, `SHIFT`, ... `ART`), legends per layout, key-code map |
| `keycap-geometry.ts` | Sculpted cap: tapered loft, rounded top bevel, cylindrical dish, analytic normals, UVs for print, grain and height AO |
| `legends.ts` | Canvas legends (service names, key symbols, a generic browser wireframe for a sleeve, a developer's initial), one atlas per cap, tile swapped by offset |
| `layout-core.ts`, `layout-fixed.ts`, `layout-data.ts`, `layouts.ts`, `plates.ts` | Where each cap goes in each chapter, as data: fixed tables for hero, services and contact; sleeves, plates and the people's row built from the counts, the same code for phone and desktop. `plates.ts` has no three import, so the pricing cards size columns from it |
| `poses.ts` | Pose tables: camera angle (from the preview), 30 deg lens, `extent` and `aim` measured from the layout as seen from that angle, fallback safe rects, `assembly` = one weight per layout |
| `scene.ts`, `parts.ts`, `motion.ts` | Builds the meshes once; `motion.ts` moves them every frame |
| `materials.ts` | Canvas-generated textures; PBT cap material; the resin cap |
| `subject.tsx`, `lightformers.tsx`, `index.ts` | R3F wrapper (fonts, real keyboard), studio light, the Direction |

- **Rearranged by hand.** Between two stations the engine lerps the layout weights; the two non-zero ones name the layouts the caps move between. Caps move one at a time, top of the stack first, on one continuous path: lifted, carried across just above the caps they pass and set down, starting across while still rising, so no cap stops at a corner. No spin or tumble; a cap turns only while it is carried. A cap one layout does not use is put away where it stood (it shrinks into its place) or set out where it will stand (grows); plates grow in place under the caps and shrink after them. The legend swaps mid-carry. The same nine meshes throughout; nothing crossfades.
- **Framing.** For each station the layout's corners are projected onto the screen axes of that station's camera direction: the middle of that box is the `aim`, its half-sizes are the `extent`. The engine fits the box into the live-measured zone, so the totem fills its zone on every screen and every record count (one sleeve frames closer than six), and never reaches the copy or the cards. `TRIM_*` nudges a station (the phone crate a little larger). The shelf's long lip is left out of the box, so it may run off the edge.
- **Resin cap.** A canvas is transparent over the page's colour field, so a transmission pass would sample nothing. The fake: a clear shell with a high clearcoat, a mint core that fades toward the top (the gradient as `alphaMap`), and a suspended monogram. One glossy object per frame.
- **Grounding.** The direction sets `shadow: null` (the engine draws no shadow) and grounds itself: a contact blob under each cap and plate on every tier, plus the key light's shadow map on tier 3 only (`shadowMap: true`). With PCF shadows (`shadows="percentage"`; three r186 removed the soft variant) tier 3 compiles 12 shader programs and tiers 1 and 2 compile 10 to 11, all inside the 12-program budget. Shadows are black at partial opacity, never tinted by the field, so a shadow crossing a section edge in flight darkens whichever field it falls on.
- **In flight.** Arcs are 40% lower on a phone. Copy on a bare field (headings, ledes) carries `.pd-halo`, a text shadow in the field's own colour (`--field`, set by `Section`): invisible at rest, it keeps a heading legible while a cap passes behind it.
- **Interaction.** Pointer tilt (engine); hero underglow follows the caps nearest the pointer, or cycles through the stack on touch; services type in a rhythm unless a tile is hovered; the visitor's real keyboard presses the matching cap (fine pointers, never while typing in a form field).
- **Parked caps.** A cap a layout does not use waits off frame and is not drawn when it is parked in both layouts of a transition.

### Phase 6 polish (2026-10-14)

- Measured zones and extent framing (engine, above) replaced the preview-calibrated radius: the totem now fits its zone at 360, 375, 390, 768 portrait, 1024x768, 1440 and 1920.
- Brighter studio (key light 2.6, hemisphere 0.8, cap environment 0.45) so chalk and yolk read like the preview stills.
- The phone team row turns 66 deg end-on like the preview and is framed by its real extent, so five or seven people all stay in frame.
- A plate no longer peeks in from the edge on a neighbouring station (a plate needs a 4% weight to show).
- Station blocks are exactly one screen tall, so the heading is never under the nav at rest.
- Hero on the production build: LCP 852 ms on a phone with 4x CPU and slow 4G (the poster), 68 ms on desktop; CLS 0 on both. Budget: 2.5 s and 0.05.

### Portfolio pages (docs/plan/portfolio.md)

- **Order:** hero, partners, work, services, how we work (`process.tsx`, graphite), who we work with (`audiences.tsx`, chalk), pricing, team, questions (`faq.tsx`, hidden until answered), contact (with "What happens next"), footer (with Privacy).
- **Case study, `/work/[slug]`** (`case-study.tsx`, `lib/content/home-loader.ts` `loadCaseStudy`): yolk header (title, summary, client, completed date, service and stack chips, live link), cover, then "The brief", "What we built" and "The result" only where the record has text, gallery, next project (wrapping), and a "Start a project" band. No 3D. Prerendered for published slugs, refreshed hourly; an unknown slug is a 404. `/dev/case-study` (and `?empty=1`) shows it with a sample record in development.
- **Privacy** (`/privacy`, copy in `src/content/privacy.ts`): a DRAFT that describes only what the code does (fields stored, hashed IP, Web3Forms, no cookies or trackers on the public site); the team confirms it.
- **404** (`app/not-found.tsx`): the cobalt field, one pill back to the start. Fonts come from `lib/site-fonts.ts`, shared with the public layout.
- **Nav and footer** take `base="/"` on pages other than the home page, so section links lead back to it.
- `.pd-key` is `position: relative`: screen-reader text inside a pill (`.sr-only`, absolute) must stay inside it, or inside a scrolling rail it escapes the rail and widens a phone's layout viewport.

### Posters (`npm run posters`)

Renders the live stage in Chrome against `npm run dev` (`/dev/home`, sample records): one transparent AVIF per station and bucket, cropped to the safe rect, into `public/posters/keycap/`, plus `components/home/posters.generated.ts` (sizes). They show the reference composition, not the page's real counts; they are decoration (`aria-hidden`) and only show on tier 0, before the first frame, and after a context loss. Re-run and commit after any change to the totem or its poses.

### Checks added for this design

- `npm run check:stacking`: no `<main>` or `<section>` creates a stacking context (`scripts/lib/stacking.mjs`, on the syntax tree).
- `npm run check:contrast`: every field and ink pair passes its WCAG minimum (`scripts/lib/contrast.mjs`).
- `npm run check:home` (needs `npm run dev`): stations follow the records, empty sections leave no trace, hovering a tile and scrolling the rail drive the 3D, the form sends and fails, tier 0 is a full page with no three.js request.
- `npx tsx scripts/shoot-stations.ts --path /dev/home --sizes 390x844,768x1024,1440x900` screenshots every station for review against the preview stills.

### Budgets measured (2026-10-13, production build)

| Measure | Result | Budget |
|---|---|---|
| Lazy 3D chunk (three, R3F, drei, engine, keycap) | 266 KB gzip | 300 KB |
| First-load JS of `/`, all scripts | 216 KB gzip, of which about 48 KB is ours (GSAP and Lenis 32 KB, page 12 KB) and the rest is React and Next | 180 KB (over if the framework counts; revisit in Phase 7) |
| Draw calls | 14 (tiers 1 and 2), 23 (tier 3) | 60 phone, 150 desktop |
| Shader programs | 10 to 11 (tiers 1 and 2), 12 (tier 3) | 12 |
| Posters | 12 AVIF files, 264 KB in all, 13 to 30 KB each | |
| Legend atlases | no side over 1024 px | 1024 |

### Known limits and open items

- The stage draws at most six sleeves, four plates and seven people's keys. More records appear in the DOM only.
- Service descriptions, "what is included" lists, stack chips and the process strip in `src/content/home.ts` are DRAFTS for the team to confirm. Stack chips list only technologies this project is built with.
- No Privacy page exists yet, so the footer has no Privacy link.
- Not built: ScrollTrigger reveals (nothing reveals), and `check-rendered-copy`.
- Still open after Phase 6: a trace on a real phone (60 fps on tier 2), an axe pass, and the resin cap's look (it reads as tinted glass, a little flatter than the preview's transmission).

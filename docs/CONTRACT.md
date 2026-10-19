# Contract

These rules override every other document in this repo, including `docs/plan/*`. Where the plan and this file disagree, this file wins. Each rule exists because a previous project (the travel site, the Jindal Steel branches) got it wrong.

## 1. Public copy has no invented claims

- No counts, ratings, years in business, awards, client names, testimonials or "trusted by" lines on the public site, ever.
- A number may appear only when a database record backs it (a price someone typed in) or it is computed from records at render time.
- Projects, partners, pricing plans and developer profiles come from the admin panel. A home section with no published records renders nothing, and its nav link and 3D station go with it.
- Sample or placeholder content exists only in design previews and tests, never in shipped pages.
- `npm run check:copy` scans `src/content/**` and the strings in `src/three/**`. A line can opt out with `// copy-ok: reason`, and every exemption is listed.

## 2. Motion

- Scroll writes a **target** and nothing else (`setScrollY` in `src/lib/scroll-store.ts`). No code writes a transform from a scroll event.
- Everything that moves chases that target through one `smoothDamp` follower with a speed cap. Never damp in series.
- One clock: a single `gsap.ticker` callback drives Lenis, the followers and the R3F frame. Read Lenis's **target** scroll, not its smoothed value.
- Chapters are anchored to **measured DOM section centres**, one unit per section regardless of height (`chapterFromY`). Re-measure on resize, on font load and after mount, never in the frame loop.
- Poses are data, authored per aspect bucket (`tall`, `mid`, `wide`) and fitted to a named safe rectangle. Never raw per-frame multipliers.
- Allocate nothing inside a frame callback. Clamp `dt` to 1/20 s.
- Signature beats are continuous transforms of the same objects. Never crossfade one mesh into another.
- Page colour fields change at section edges, never by blending text and background together. Check AA contrast on every field and ink pair.
- `prefers-reduced-motion`: keep the totems, hold the poses, cut between stations, switch off idle motion, grain and pointer tilt.

## 3. Phone first

- Design and review the phone composition before desktop (375, 390 and 360 wide). The totem is centred between copy blocks, never a strip down one edge.
- In signature stations a totem stays at 0.85 opacity or more and fills at least 70% of the width.
- Copy never sits directly on busy 3D. It sits on a solid card at full opacity.
- Quality tiers change DPR, instance counts and effects. They never change whether the experience exists.

## 4. 3D

- Totems are real lit meshes: bevelled edges, physical materials with varied roughness, grounded with contact shadows. Procedural geometry only; no GLB unless approved.
- Colours enter as sRGB hex. `NeutralToneMapping`. Studio light from Lightformers, never a fetched HDRI.
- One WebGL context for the whole site. Handle context loss. Pause rendering when no station is in view or the tab is hidden.
- The page must be complete without the canvas: server-rendered headline and content, an AVIF poster, and a no-WebGL path.
- All copy lives in the DOM. Never render headings or text in WebGL.
- Admin routes ship zero bytes of three, R3F, GSAP or Lenis (`npm run audit:boundaries`).

## 5. Stack rules

- Versions are pinned exactly (see `package.json`). R3F 9.8.1 needs React below 19.4. postprocessing 6.39.5 needs three below 0.187.
- Next 16: read `node_modules/next/dist/docs/` before using an API. `proxy.ts` replaces middleware. `params`, `cookies` and `headers` are async. React Compiler stays off.
- Tailwind 4.2: tokens in `@theme` in `globals.css`, no `tailwind.config`. Prefix house utilities and classes with `pd-` so they never collide with a core utility name.
- The dev server is reached at `localhost`, not `127.0.0.1`. The port (3050) is defined once, in `package.json`.
- Mongoose 9 needs Node 20.19 or later. The project uses Node 22. Cache the connection on `globalThis` and register models as `models.X ?? model('X', schema)`.
- Admin mutations go through route handlers, not Server Actions, so auth, same-origin checks, rate limits and audit run through one path.

## 6. Admin and security

- Authorisation is by capability, never by role name, and is checked on the server in every page, route handler and service. The proxy is a redirect convenience, not a boundary.
- Sessions are JWTs with a `tokenVersion` claim. Changing a password, role or status increments it and ends every session.
- Superadmin rules: only superadmins manage admins; nobody removes or demotes themself; the last active superadmin cannot be removed or demoted; "delete" means deactivate.
- Every mutation writes one audit entry through the single `audit()` helper, inside the same transaction as the change.
- Never log or return password hashes, payment notes or IP addresses. IPs are stored only as salted hashes.
- Secrets live in `.env.local` and the host's settings. They are never committed and never pasted into chat. The seed reads emails and passwords from environment variables, never from code.

## 7. Money

- Amounts are integers in the currency's minor unit. Never floats.
- INR is the base currency. Each entry stores its currency, the FX rate for its date and the INR amount, and the **server** computes the INR amount.
- Every payment, payout and expense links to a client and a project, and optionally a task. The server derives the links from the task or project and rejects a mismatch.
- Money entries are voided with a reason, never deleted. There is no payment gateway.

## 8. Process

- Work in vertical slices. Each slice passes `npm run verify`, plus screenshot review at 375, 768 and 1440 for anything visual, and is committed on a branch.
- Update `DESIGN.md` in the same commit as the code it describes. Delete superseded code in the same commit as its replacement.
- Keep every visual-system module under about 300 lines.
- Run the contradiction check before handing specs to anyone: if two documents disagree, fix the document.

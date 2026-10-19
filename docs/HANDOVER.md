# Handover: ProDevly website and admin

Read this first, then `AGENTS.md`, `docs/CONTRACT.md` (overrides everything), `PRODUCT.md`, `docs/ADMIN-BUILD.md`, `.interface-design/system.md`, and `DESIGN.md` (the public site and the 3D stage engine).

## 1. What this is
ProDevly is a web development, SaaS and custom software studio. This repo is (a) the public company site, a colourful, fully 3D, Awwwards-level home page built around solid lit 3D "totems", and (b) a private admin panel to run the business (clients, projects, tasks, time, multi-currency ledger, payouts, expenses, team, enquiries, website content, audit).
Stack (exact pins in package.json): Next 16.4 App Router, React 19.3, TypeScript strict, Tailwind 4.2, MongoDB with Mongoose 9, Web3Forms for the contact form, three.js via React Three Fiber on the public home page, Vitest.

## 2. The original brief (the user's own words, condensed)
- Org name ProDevly. Admin manages clients, projects, tasks, client payments, third parties and their payouts (linked to client, project, task), the company's own expenses per client project, team and roles, and admin work and pay. A dashboard per section.
- Two roles: `superadmin` (3: Aman Gupta, Lakshya Sharma, Shivansh Kaushik; a seed creates them from env vars) and `admin`. Superadmins add and delete (deactivate) admins.
- Public sections: navbar, hero, partners, projects, services, pricing, developers, contact form, footer. Projects, partners, pricing and developers are admin-managed; empty sections hide.
- HARD RULES: no AI-generated statistics or invented claims on the public site; no "AI-default" theme; 3D totems are real lit meshes, not drawings. Clients served: startups and SaaS founders, Indian SMBs, international, agencies. Money is a multi-currency ledger, INR totals, no payment gateway.
- Lessons from the user's earlier 3D sites (also in the memory folder): scroll sets a TARGET only and the 3D follows with smoothDamp and a speed cap (never sync to scroll); design the PHONE composition first with the totem centred; no monotone side strip; no fake stats.

## 3. Plan and status of phases
| Phase | What | Status |
|---|---|---|
| 1 | Setup: Next/Tailwind/TS, scroll-follow maths (`src/lib/motion/damp.ts`), guard scripts, plan docs, design previews | DONE |
| 2 | Models, auth, roles, seed, rate limits, audit, tests; adversarial-reviewed | DONE |
| 3 | Admin panel: Ledger design system, UI kit, 14 modules, dashboards, exports, conversion, smoke test; adversarial-reviewed | DONE except the leftovers in section 6 |
| 4 | 3D stage engine (R3F, one canvas, poses as data per aspect bucket, follow-not-sync scroll, quality tiers, no-WebGL path). See `DESIGN.md`; verified on `/dev/stage` with `npm run check:stage` | DONE |
| 5 | Port each home design to R3F on its own branch off `main`: `design/keycap` (Keycap Colorway), `design/totems` (Glazed Component Totems), `design/source` (Live Source). Studio Standard is NOT one of the three | `design/keycap` DONE (committed on its branch, see `DESIGN.md` "Keycap Colorway"); `design/totems` and `design/source` TODO |
| 6 | Hero and phone polish per design (Opus, High) | `design/keycap` DONE (measured zones and extent framing in the engine, lighting, transitions, LCP and CLS measured; see `DESIGN.md` "Phase 6 polish"); other designs follow their ports |
| 7 | Final review: performance, accessibility, public site content wiring (`src/lib/content/public.ts` already provides cached published reads) | TODO |
Phase 4 leftovers, deliberately deferred to the phase that first needs them:
- ScrollTrigger: not wired yet because nothing reveals yet. Add `lenis.on('scroll', ScrollTrigger.update)` in `smooth-scroll.tsx` with the first DOM reveal.
- Projected DOM labels (`src/three/labels.ts`): not built, because no station needs one yet.
- Poster pipeline (`scripts/posters.ts`, Playwright and AVIF): not built, because a poster needs a real design. The slot (`.pd-poster`) and the `data-stage` CSS are in place.
- `check-stacking` and `check-contrast` scripts: not built, because they apply to real sections (Phase 5).

Phase 5 (keycap) built: the full home page DOM on `design/keycap` (nav, hero, partners, services, work, pricing, team, contact form, footer), the keycap totem, posters, `check:stacking`, `check:contrast`, `check:home`. Still open from the Phase 4 list: ScrollTrigger reveals and projected labels (nothing needs them yet). The home page reads the published records (`src/lib/content/home-loader.ts`); `/dev/home` shows sample records. Service copy in `src/content/home.ts` is a DRAFT for the team to confirm. Generic pieces added on this branch that `design/totems` and `design/source` can reuse once rebased onto it: `StageData`/`stageInput` (`src/lib/stage-data.ts`), `Direction.shadow: null` and `shadowMap`, `scripts/posters.ts`, `scripts/shoot-stations.ts`, the two check scripts.
The public contact form is wired on `design/keycap` (the API `/api/leads` and `/api/form-token` exist; see `docs/plan/admin-plan.txt` section 7).
Company portfolio plan (sections, order, case study page, build order): `docs/plan/portfolio.md` on branch `plan/portfolio`, with mockups in the design canvas linked there.
Design previews of all four directions (WebGL, per-design JS) live in `docs/design-previews/` (README there). They are the visual spec the R3F ports must match. Plans: `docs/plan/engineering.html` (frontend), `docs/plan/directions.json`, `docs/plan/admin.html` and `admin-plan.txt` (admin).

## 4. Branch and workflow rules
`main` holds everything shared (admin, content APIs, the 3D stage engine). Each design lives on `design/keycap`, `design/totems`, `design/source` off `main`, adding only its home page. Work in vertical slices; `npm run verify` must pass before every commit; screenshot review at 375, 768 and 1440 for anything visual. The user wants phase-wise work: at the end of each phase STOP, summarise, and say which model and effort the next phase needs, then wait. They care about token cost. Git trailer for commits: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.

## 5. Running it
```
nvm use            # Node 22 (.nvmrc)
npm install
npm run dev:db     # local MongoDB replica set on :27018 (prints MONGODB_URI)
# put in .env.local: MONGODB_URI, AUTH_SECRET, IP_HASH_SALT, FORM_TOKEN_SECRET, CRON_SECRET, SEED_* (see .env.example)
npm run db:indexes && npm run seed && npm run dev      # http://localhost:3050 (use localhost, not 127.0.0.1)
npm run verify     # lint, check:copy, audit:boundaries, audit:filters, typecheck, tests, build
npm run smoke      # real-HTTP test against a running dev server
npm run check:stage  # the 3D stage engine in Chrome against a running dev server (-- --shots for screenshots)
```
Ports: 3050 is this project's dev port. 3000-3003, 3007, 3010, 3011, 3020, 5173 belong to the user's other projects: never use them and never run broad `pkill`; stop your own servers by PID.
Still needed from the user before a real seed: the 3 superadmin emails and initial passwords (env only, never committed), domain, hosting and database choice, logo (none supplied; do not invent one).

## 6. Known leftovers (from the last adversarial review; none critical)
Fixed in the last commit: viewer-aware record activity feeds (`getRecordActivity`), client rename search key, payment note no longer written to the audit log, nested form in Settings, work-order amount cap, team payout FX date. Still open (all low or medium, details were produced by the review):
- `signOutEverywhere`/`stepUp`/`changeOwnPassword` mint the new cookie from the DB token version, not the authenticated one (tiny race window).
- The FX `manualRate` has no sanity bound (a typed rate is trusted by design).
- Pricing editor silently re-prices in INR if the plan's currency was later disabled; keyboard reordering in content lists drops focus; tasks/work-log lists past the last page show a false empty state; assignee editors PUT a stale list; payment-void wording for refunds; money warnings only in a toast; spam heuristic holds ordinary SEO requests; media delete can race an attach; project move can race a concurrent payables write.
- Nobody has looked at every page in a real browser at 375/768/1440 (a sample was checked). Do a visual pass.
- Production needs `npm run db:indexes` (autoIndex is off), a cron for `/api/cron/fx` with `Authorization: Bearer CRON_SECRET`, and ECB does not publish AED/SAR/QAR/KWD (enter those rates by hand).

## 7. Conventions that cost time (details in AGENTS.md and docs/ADMIN-BUILD.md)
adminRoute for every admin API; capabilities never role names; step-up lives in the cookie; ids through `parseObjectId`; Mongo operators wrapped in `mongoose.trusted`; audited writes in `withTransaction` with audit on the same session; money as integer minor units built with `resolveFx`/`buildMoney`; Next 16 specifics (`proxy.ts`, async params, `error.tsx` gets `{ error, retry }`); Tailwind preflight zeroes dialog margin; React lint forbids setState in effects. Admin code must never import three, GSAP or Lenis (`audit:boundaries`).

## 8. Where things are
`src/services` (business logic per module), `src/services/dashboards`, `src/app/api/admin` (routes), `src/app/admin/(workspace)` (pages), `src/components/{ui,admin}` (kit), `src/models`, `src/lib`, `src/config`, `scripts/` (seed, smoke, fx-fetch, audits), `docs/`.

## 9. Models and effort
Phase 4 and 6: Opus, High. Phase 5: Sonnet or Opus, Medium to High. Phase 7: any, Medium. Ultracode (parallel agent workflows) worked well for the admin build and is optional for the 3D work.

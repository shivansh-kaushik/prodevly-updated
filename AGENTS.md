# ProDevly website

Company site and admin panel for ProDevly, a web development, SaaS and custom software studio. Product truth is in `PRODUCT.md`. The rules that override everything else are in `docs/CONTRACT.md`. Read both first.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Stack

Next.js 16.4 (App Router, Turbopack), React 19.3, TypeScript strict, Tailwind 4.2, MongoDB with Mongoose 9, Web3Forms for the contact form. 3D on the public home page uses three.js through React Three Fiber (added with the stage engine). Exact pins are in `package.json`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:3050 (use `localhost`, not `127.0.0.1`) |
| `npm run dev:db` | Local MongoDB **replica set** on :27018 (transactions need one), data in `.mongo-data/`. Prints the `MONGODB_URI` for `.env.local` |
| `npm run db:indexes` | Build every model's indexes (`-- --dry-run` to preview). Production has `autoIndex` off: run this before traffic |
| `npm run seed` | Create the 3 superadmins, settings and the internal client from `SEED_*` env vars. Idempotent |
| `npm run smoke` | Black-box HTTP test of the admin API against a running `npm run dev` + `dev:db` |
| `npm run check:stage` | Drives `/dev/stage` in Chrome against a running `npm run dev`: speed cap, fade-cut, pause, context loss, tier 0, reduced motion. `-- --shots` saves station screenshots to `test-results/stage/` |
| `npm run check:home` | (`design/keycap`) Drives `/dev/home` (the real home page with sample records) in Chrome against a running `npm run dev`: stations follow the records, empty sections leave no trace, tile hover and rail scroll drive the 3D, the form, tier 0 |
| `npm run posters` | (`design/keycap`) Renders the station posters (transparent AVIF) from the live stage into `public/posters/keycap/`. Needs `npm run dev` |
| `npm run check:stacking` | Fails when a public `<main>` or `<section>` would create a stacking context (it would trap the fixed canvas) |
| `npm run check:contrast` | Fails when a field and ink pair on the public page drops below its WCAG minimum |
| `npm run reset:rate-limits` | Clear rate-limit windows (dev only) |
| `npm run admin:reset-password -- --email x` | Break-glass reset when no superadmin can sign in (`RESET_PASSWORD` from env) |
| `npm run verify` | lint, `check:copy`, `check:stacking`, `check:contrast`, `audit:boundaries`, `audit:filters`, typecheck, all tests, production build. Must pass before every commit |
| `npm test` | Vitest: unit tests plus `*.int.test.ts` integration tests against an in-memory MongoDB replica set (started automatically) |
| `npm run check:copy` | Fails on invented marketing claims in public copy |
| `npm run audit:boundaries` | Fails on forbidden imports (client to server, admin to 3D, 3D to server) |
| `npm run audit:filters` | Fails on Mongoose filter operators not wrapped in `mongoose.trusted()` |

First run of the stack: `npm run dev:db`, copy the URI it prints into `.env.local` together with `AUTH_SECRET`, `IP_HASH_SALT` and the six `SEED_*` values (see `.env.example`), then `npm run db:indexes`, `npm run seed`, `npm run dev`.

## Where things are

- `docs/CONTRACT.md` is the rulebook. Read it.
- `docs/ADMIN-BUILD.md` is how an admin module is built (services, routes, pages, dashboards, tests); the Admins module is the reference. `.interface-design/system.md` is the admin's visual system (the Ledger).
- `docs/plan/admin.html` has the admin plan: roles, modules, data model, money rules, dashboards, routes, folder structure, seed. `docs/plan/engineering.html` has the frontend plan: stack, sections, 3D stage, motion, mobile, performance budget, milestones. `docs/plan/directions.json` has the three home-page design directions.
- `docs/design-previews/` has live WebGL previews of each design direction (see its README). These are the visual spec the React Three Fiber ports must match.
- `docs/research/*.json` has the research behind the plan.
- `src/lib/motion/damp.ts` is the scroll-follow maths (`smoothDamp`). `src/lib/scroll/chapters.ts` maps scroll to chapters. `src/lib/scroll-store.ts` holds scroll state.
- `src/config/` capabilities (the permission model), statuses, currencies, rate limits. `src/models/` Mongoose schemas (import from `@/models`, never a model file). `src/services/` business logic, one file per module: `admin`, `auth`, `client`, `project`, `task`, `work-log`, `team`, `team-role`, `pay-profile`, `team-payout`, `lead` and `lead-conversion`, `content` and `site-info`, `media`, `client-payment`, `third-party`, `work-order`, `third-party-payout`, `expense`, `settings`, `fx`, `audit` and `audit-log`, `activity`, `lookup`, `export`, plus `seed`, `refs` and `dashboards/` (see `docs/ADMIN-BUILD.md` for what each exports). `src/lib/api/` the route wrapper (`adminRoute`), errors, request helpers. `src/lib/auth/` tokens, passwords, guards. `src/test/` test database and factories.
- `src/components/home/` (the home page's sections, on the design branch), `src/lib/home-content.ts` (records and stage data), `src/lib/stage-data.ts` (what the page tells the stage) and `src/three/directions/keycap/` (the Keycap Colorway totem) belong to `design/keycap`; `/dev/home` renders the page with sample records.
- `DESIGN.md` is the public site's design system and the 3D stage engine: layers, the frame order, followers, the pose format, framing, tiers, fallbacks, and how a direction plugs in.
- `src/content/` holds static site facts. `src/three/` is the 3D stage: `stage.tsx` (the canvas), `rig/` (followers, fade, pose evaluation, framing, perf guard, driver; never edited for a design), `look/`, `directions/<id>/` (one per design; `fixture` is the engine test subject), `entries/`. `src/components/site/` holds `smooth-scroll.tsx` (the one clock), `stage-mount.tsx` (tier, lazy load, fallbacks) and the public sections. `src/lib/clock.ts`, `stage-store.ts` and `gpu-tier.ts` are the three-free halves. `src/components/ui/` and `src/components/admin/` the admin UI kit and shell.

## Conventions that have already bitten (read before writing a service or route)

- **Routes**: write admin APIs with `adminRoute` (`src/lib/api/admin-route.ts`). It does same-origin, DB-backed auth, capability, step-up, rate limit, body validation and error mapping. Handlers that mint a replacement cookie must carry `session.authTime` over; never restart the 12 h hard limit.
- **Step-up** (re-enter password, 10 min) lives in the cookie (`su` claim), never on the account, so a second copy of a session does not inherit it. `reactivate` always needs it.
- **Ids**: run every id from a URL or body through `parseObjectId` (returns lowercase). Compare identities only after that, or `5F3A…` slips past a self-action check.
- **Mongo filters**: `sanitizeFilter` is global. An operator inside a filter must be `mongoose.trusted({...})` (`npm run audit:filters` enforces it, on the real syntax tree). Update documents and pipelines are exempt.
- **Writes that matter** (anything audited, anything touching more than one document) go through `withTransaction` with the audit entry on the SAME session. Do slow work (bcrypt) before the transaction, sign tokens after it.
- **Superadmin safety**: the actor is re-checked with a *write* on their own document inside the transaction (`assertActorStillSuperadmin`), and removing or demoting a superadmin takes the `superadmin-guard` write lock. Do not weaken either.
- **Money**: integer minor units; build the `Money` subdocument with `buildMoney` (`src/lib/money/fx.ts`), parse typed amounts with `parseMinor`. The schema rejects an entry whose INR value does not match amount x rate.
- **Dates**: `dateOnly()` fields are exactly UTC midnight (validated).
- **Rate limits** are keyed on a salted hash, never the raw email or IP. A successful sign-in refunds its per-email hit.
- **Scripts** that take a password read it raw (`scripts/lib/env.ts`), because `@next/env` expands `$name`. Anything pointing at a non-local database needs `--confirm-production`.

## Working agreements

- Branches: `main` holds everything shared (admin, content APIs, the 3D stage engine). Each home-page design lives on its own branch off `main`: `design/keycap`, `design/totems`, `design/source`.
- Public copy has no invented numbers. Never fabricate clients, testimonials, ratings or counts.
- Skills worth using: `impeccable` (design direction, critique, polish), `interface-design` (admin UI), the `r3f-*` and `gsap-*` skills, `web-quality-audit` and friends for performance and accessibility.

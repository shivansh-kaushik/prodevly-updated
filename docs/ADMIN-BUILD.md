# Building an admin module

How every module of the admin panel is built. The **Admins** module is the reference: read its files before writing yours. The product spec is `docs/plan/admin.html` (data model, money rules, dashboards, routes); the rules that override it are `docs/CONTRACT.md`. Visual language: `.interface-design/system.md`.

## The shape of a module

```
src/services/<name>.service.ts          business rules, transactions, audit, DTOs
src/services/dashboards/<name>.ts       the section's dashboard (one function, typed result)
src/lib/validation/<name>.ts            zod schemas, shared by the form and the route
src/app/api/admin/<name>/...route.ts    thin route handlers (adminRoute)
src/app/admin/(workspace)/<name>/       pages: page.tsx (dashboard + list), new/, [id]/ , _components/
src/test/<name>-factories.ts            fixtures for this module (extend domain-factories.ts)
tests: <name>.service.int.test.ts, dashboards/<name>.int.test.ts, a route test where the route has its own rules
```

Do NOT edit shared files outside your module unless your brief says so (`config/*`, `models/index.ts`, `lib/api/*`, `components/ui/*`, `components/admin/*`, `package.json`, `globals.css`). If you need a change there, say so in your report instead.

## Services

- A service function takes the **viewer** (`SessionUser`) first and checks the capability itself (`assertCapability(viewer, 'client:edit')`). Pages and routes check too; the service is the last line.
- Anything that writes more than one document, and every audited change, runs in `withTransaction` with `audit(..., session)` on the SAME session. Do slow work (bcrypt) before the transaction, mint tokens after.
- Return **DTOs** (plain objects, ids as strings, dates as ISO strings, no hashes or notes the viewer may not see). Never return a Mongoose document to a page or route.
- Ids from a URL or body go through `parseObjectId` (lowercase). Compare identities only after that.
- Mongo filters: `sanitizeFilter` is on globally. An operator inside a filter must be `mongoose.trusted({...})`; `npm run audit:filters` enforces it (it follows assignments, spreads and conditionals). Search text goes through `escapeRegex` and is matched literally.
- Links are derived on the server: a task names its project, which names its client. A request whose ids disagree answers `linkMismatch()`. Use the error constructors in `src/lib/api/errors.ts` (`linkMismatch`, `currencyMismatch`, `fxRateMissing`, `paymentExceedsDue`, `entryLocked`, `hasLinkedRecords`, `conflict`, `validationFailed`).
- References come from `nextRef` / `nextFiscalRef` / `nextTaskRef` (`src/services/refs.ts`), inside the transaction.
- Money: integer minor units. Build the `Money` subdocument with `buildMoney` (`src/lib/money/fx.ts`); never trust an INR value from the client. Dates that are calendar dates (received on, due on) are UTC midnight (`parseDateOnly`); the schema rejects anything else.
- Status moves keep a `statusHistory` entry `{ from, to, at, by, note }`; transitions come from `config/statuses.ts`.
- Archive instead of delete; money is voided with a reason, never deleted.

## Routes

```ts
export const POST = adminRoute<Body, Params>(
  { capability: 'client:edit', schema: createClientSchema /*, stepUp: true */ },
  async ({ admin, body, params, meta, session }) => created({ client: await createClient(admin, body, meta) }),
);
```

`adminRoute` does same-origin, DB-backed auth, capability, step-up, a 120/min write limit, JSON parsing and error mapping. Handlers stay thin: parse, call a service, shape the envelope with `ok()` / `created()`. Every mutation goes through a route handler (no Server Actions). Every route needs a test through `call()` from `src/test/factories.ts` for its own rules (auth, capability matrix, validation).

## Pages

Server Components read through services using URL params; mutations call routes from client components.

```tsx
export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/clients', { capability: 'client:view' }); // EVERY page, layouts do not re-run
  const sp = await searchParams;
  const list = parseListParams(sp, { sortable: ['name', 'updatedAt'], defaultSort: 'updatedAt' });
  const period = await getPeriod(sp);   // FY by default; presets and custom range
  ...
}
```

- Layout of a section page: `PageHeader`, `StatBand` (tiles), 2 to 4 `ChartCard`s, `DataToolbar` (search + filters + `PeriodPicker` as children), the table in `TableFrame`/`Table`, `Pagination`. Empty states say what is missing and offer the next step.
- Tiles for money are **left out** for viewers without the money capability (never shown as zero).
- Detail pages use `TabLinks` (`?tab=`), `Panel`, `DescriptionList`, `AuditFeed` (activity), `StatusHistory`.
- Forms: `useForm` + `Field`/`Input`/`Select`/`Textarea`/`MoneyInput`/`EntityPicker`; submit with `useAdminApi().call()`, which handles step-up, expired sessions and a pending password change. Show server `fields` errors in place. After success `router.refresh()` or navigate; confirm with `useToast()`.
- Destructive or consequential actions use `ConfirmDialog` (with `reason` when the audit log should explain it).
- Route files: `loading.tsx` / `error.tsx` where the segment fetches. `error.tsx` receives `{ error, retry }` in this Next version (not `reset`).
- Client components cannot import services, models, db or auth (`npm run audit:boundaries`). Pass plain DTOs down. Never pass a `Set` or a Mongoose document across the boundary.
- Admin code must not import three, GSAP or Lenis.

## Dashboards

One service function `get<Section>Dashboard(viewer, range)` returning typed JSON, built from one aggregation (`$facet`) where possible. Rules are in plan section 4 and 5: dashboards sum `amount.inrMinor` only, voided entries and rejected expenses are excluded, native amounts appear only as a secondary line, the default period is the current financial year, ratios render only when the denominator is above zero. Aggregation pipelines are not sanitised: build `$match` stages from parsed primitives only. Test the figures with fixtures, including voided entries, foreign currency and an empty database.

## Modules and what they export for others

One line per module: its service, its dashboard function, its main routes (API under `/api/admin`, pages under `/admin`) and what other modules reuse. Services check the viewer's capability themselves; reuse them, do not copy their rules. Read a service's header comment before calling it from another module.

- **Admins** (the reference): `admin.service.ts`, `getAdminsDashboard`; `/api/admin/admins/**`, `/api/admin/auth/**`, pages `admins`, `account`. `assertAnotherSuperadminRemains` is the superadmin guard.
- **Settings and FX**: `settings.service.ts`, `fx.service.ts`, `fx-feed.ts` (ECB, run by `/api/cron/fx`), `getFxDashboard`; `/api/admin/settings`, `/api/admin/fx-rates/**`, pages `settings`, `settings/lists`, `settings/fx`. Reuse `getSettings()` / `loadSettings(session)` for enabled currencies and option lists, `resolveFx(input, session)` for every Money subdocument, `fxPayloadFields` (`lib/validation/fx.ts`) in body schemas and `FxField` (`components/admin/fx-field.tsx`) in forms.
- **Clients**: `client.service.ts`, `getClientsDashboard` and `getClientMoney`; `/api/admin/clients/**`, pages `clients`. Reuse `createClientInTx(viewer, input, session)` to create a client inside a caller's transaction.
- **Projects**: `project.service.ts` (documents and milestones), `getProjectsDashboard`, `getProjectMoney`, `getProjectTasks`, `getProjectTeam`, `getProjectActivity`; `/api/admin/projects/**` (milestones, status), pages `projects`. Reuse `createProjectInTx`; the Money tab's shortcuts into other modules are `projectMoneyLinks` / `MoneyLinks` (`projects/_components/money-links.tsx`).
- **Tasks and work logs**: `task.service.ts`, `work-log.service.ts`, `getTasksDashboard`; `/api/admin/tasks/**`, `/api/admin/work-logs/**`, pages `tasks`, `work-logs`, `my`. Reuse `projectBriefs`, `getProjectLabel`, `listMyTasks`; `workLogDayLockKey` / `lockWorkLogDay` are the per-day counter that makes a new time entry conflict with a payout being marked paid (the team payout service touches the same key).
- **Team**: `team.service.ts`, `team-role.service.ts`, `pay-profile.service.ts`, `getTeamDashboard` and `getPersonDashboard`; `/api/admin/team/**`, pages `team`, `team/[adminId]` (opens for the person themself or an `audit:viewAll` holder; Pay tab for them or `team:payView`), `team/roles`. Reuse `PersonDashboardView` (`components/admin/person-dashboard.tsx`), `PayProfilePanel` (`team/_components`), `getTeamMember`, `payTermsOn`.
- **Team payouts**: `team-payout.service.ts` and `team-payout-suggestion.service.ts`, totals from `getPayoutTotals`; `/api/admin/team-payouts/**`, pages `team/payouts/**`. The only writer of `WorkLog.lockedByPayoutId`. Reuse `listPersonPayouts` and `PayoutsTable`.
- **Enquiries**: `lead.service.ts`, `lead-conversion.service.ts`, `getEnquiriesDashboard`; `/api/admin/enquiries/**`, public intake `/api/leads` and `/api/form-token`, pages `enquiries`. `convertLead` creates the client and project and calls `applyLeadConversion(viewer, id, links, session)` in one transaction.
- **Content and media**: `content.service.ts` with one file per kind in `services/content/`, `site-info.service.ts`, `media.service.ts`, `getContentDashboard`; `/api/admin/content/**`, `/api/admin/media/**`, pages `content`. Reuse `uploadMedia(file, { for })` (`components/admin/media-upload.ts`) from the browser, `describeMedia(viewer, ids)` on the server and `MediaPicker`. Receipts and attachments are private media.
- **Audit log**: `audit.service.ts` is the single writer (`audit()`), `audit-log.service.ts` the reader, `activity.service.ts` (`getActivity`) the per-record feed; `getAuditDashboard`; read-only, page `audit`. Reuse `AuditFeed`; `describeAction` (`lib/admin/audit-text.ts`) words every action, so a new action name needs a line there if the plain `entity.verb` reading is not natural.
- **Client payments**: `client-payment.service.ts` (writes), `client-payment.read.ts` (reads), `getPaymentsDashboard`; `/api/admin/payments/**` (including `context`), pages `payments`. Reuse `getPaymentContext(viewer, projectId)` to preselect a project in a form.
- **Third parties and payouts**: `third-party.service.ts`, `work-order.service.ts`, `third-party-payout.service.ts`, `getThirdPartiesDashboard`; `/api/admin/third-parties/**`, `/api/admin/work-orders/**`, `/api/admin/third-party-payouts/**`, pages `third-parties`, `third-parties/work-orders`, `third-parties/payouts`. Reuse `loadOpenProject` (a project new money may link to), `getProjectOption`, `getThirdPartyOption`.
- **Expenses**: `expense.service.ts`, `getExpensesDashboard`; `/api/admin/expenses/**`, pages `expenses`. Reuse `expenseAbilities` and `getExpenseFilterLabels`.
- **Overview and the ledger**: `getOverviewDashboard` (page `/admin`, shows each tile by capability); `services/dashboards/ledger.ts` holds `ledgerUnionPipeline`, `runLedger`, `getCompanyTotals` and `getProjectMargins`, which do NO authorisation, so gate every money figure by the viewer's own capability before calling them.
- **Exports**: `export.service.ts` with one file per section in `services/exports/`; `GET /api/admin/exports/[section]` (`export:data` and a recent step-up; the section's own view capability is checked by the service). Every export writes an `export.<section>` audit entry.
- **Pickers**: `lookup.service.ts` answers `/api/admin/lookup/<kind>` for `clients`, `projects`, `tasks`, `admins` and `third-parties`; `EntityPicker` (`components/admin/entity-picker.tsx`) cascades with `clientId` / `projectId`.

Links between modules go through the address, not shared state: a page that opens another module's form passes the record in the query string (`/admin/payments/new?projectId=`, `/admin/expenses/new?projectId=`, `/admin/tasks/new?projectId=`, `/admin/third-parties/work-orders/new?project=`, `/admin/team/payouts/new?adminId=`), and a list is narrowed the same way (`/admin/payments?client=` or `?project=`, `/admin/third-parties/payouts?project=`). Check the target page's own parameter names before linking, and only show a link to a viewer who holds the capability the target page asks for, so it never leads to a 404.

## Design rules (short)

Ledger look: paper, ink, hairline rules, one red accent used only for danger and attention. Primary buttons are ink. Figures use `.pd-figure` (tabular, lining); totals use the double rule (`TotalRow`, `.pd-total`). Depth is borders only. Touch targets 44px on touch (`pointer-coarse:`). Every table scrolls inside its frame on a phone; design the 375px view first. States are not optional: loading, empty, error, disabled, focus. Colour never carries meaning alone (badges have text).

## Verifying your work (while other modules are being built in parallel)

Other people are editing other modules at the same time, so the whole project may not compile at every moment.

- `npx tsc --noEmit -p . 2>&1 | grep -E "<your paths>"` (ignore errors in files you do not own)
- `npx vitest run src/services/<yours> src/app/api/admin/<yours>` (an in-memory MongoDB starts by itself)
- `npx eslint <your paths>` and `node scripts/audit-filters.mjs` and `node scripts/audit-boundaries.mjs`
- Do NOT run `npm run build`, `npm run verify`, `npm run dev`, or touch git. The coordinator does that between waves.

## Gotchas that already bit

- Tailwind's preflight zeroes margins: `.pd-dialog` restores `margin: auto`. A new top-layer element needs the same care.
- `useId`-based `Field` ids need `'use client'`; the `Field` component already is one.
- recharts renders only on the client (the chart components wait for mount) and animation is off.
- Admin sessions are re-read from the database on every request; never cache the viewer.
- A `<dialog>` closes on Escape; the `EntityPicker` stops Escape when its list is open so it does not close the dialog around it.

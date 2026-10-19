# Admin design system: the Ledger

**Who:** a small studio's founders and team in India, at a desk or on a phone, doing books and delivery in the same sitting: approving a payout, logging time, checking who owes what. They know account books. **Feel:** calm, exact, a little old-fashioned in the right way: printed paper, not glass. Dense enough to work in, never cramped.

**Domain:** ledger, khata, rubric (the red margin line), voucher, FY27 (April to March), lakh and crore grouping, double-rule totals, passbook green, stamp ink, cheque, milestone, sprint board.

**Color world:** ivory ledger paper, fountain-pen ink navy, the red margin rule, passbook green for money in, stamp violet, brass amber for "look at this".

**Signature:** the accountant's rule. Totals close with a single rule above and a double rule below (`.pd-total`, the lead figure of every stat band). The red margin line (`.pd-margin-flag`) appears only on something that needs attention and on the current nav item. The financial year is stamped in the sidebar like an office stamp.

**Rejected defaults:** dark sidebar with a blue accent -> paper sidebar on the same ground, divided by a hairline; four floating KPI cards with icons -> one ruled totals band whose first figure leads; rounded shadowed cards -> hairline panels, borders-only depth.

## Tokens (`src/app/admin/admin.css`, prefix `pd-`)
- Surfaces: `paper #faf7f0` (page), `leaf #fdfbf6` (panels), `sheet #fffefb` (floating), `well #f2eee3` (inputs, inset; one step darker because they receive content).
- Ink: `ink #1c2332`, `ink-2 #444d60`, `ink-3 #5d6679` (4.8:1 on paper), `ink-4` decorative only.
- Rules: `rule` 12%, `rule-soft` 7%, `rule-strong` 26% of ink.
- Accent: `rubric #b3301d`. Meaning: `credit #1d6b49`, `amber #8a5a08`, `blue #2d4b8e`, `violet #6a4a98` (each with a `-wash`).
- Type: UI **IBM Plex Sans** 14px; titles and figures **Source Serif 4** (tabular, lining); refs and code **IBM Plex Mono**. Scale: 11 eyebrow, 12 caption, 14 body, 15 panel title, 20 dialog, 26-32 figures, 28 page title. Weight and colour carry hierarchy, not size alone.
- Radius 4 (controls) / 6 (panels) / 10 (dialogs). Depth: hairline rings; one float shadow for popovers and dialogs. Spacing base 4px; control height 36px (44px on touch). Motion: 150-220ms, ease-out `cubic-bezier(0.23,1,0.32,1)`, press scale .97, transform and opacity only, reduced-motion respected.

## Patterns
- Primary button = ink fill; danger = outlined rubric that fills on hover; secondary = leaf with strong rule.
- Stat band: one bordered strip, tiles divided by hairlines, label eyebrow over a 26px serif figure, optional quiet sub-line; first tile 32px with the double rule.
- Tables: ruled header on paper, hairline rows, figures right-aligned and tabular, totals row with the double rule, frame scrolls horizontally on phones.
- Badges: tinted wash + text (never colour alone); one status-to-tone map in `lib/admin/status-tone.ts`.
- Forms: label above, hint below, error as text with `role="alert"`; inputs inset on `well`, focus ring blue.
- Dialogs: native `<dialog>`, centred, `pd-pop` entry; drawer variant slides from the right.

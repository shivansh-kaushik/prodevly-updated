# Company portfolio: sections and how they look

Plan for turning the home page into a full company portfolio for ProDevly. It keeps the Keycap Colorway look (`DESIGN.md`) and every rule in `docs/CONTRACT.md`. The visual mockups (home and case study, desktop and phone, plus a section map) are in the design canvas https://claude.ai/artifact/QRvqaxWm3uWaSzajQYMdAD (private to its owner until shared); this file is the written spec.

## What a visitor must get from the site

A founder, a business owner or an agency lands on the page and, within a minute, should know:

1. **What ProDevly builds:** web apps, SaaS products, custom software, mobile apps, UI/UX design, cloud and DevOps.
2. **That the work is real:** published projects with what was asked, what was built and what happened.
3. **How working together goes:** the steps, who does the work, what it costs or how it is priced.
4. **How to start:** one action, "Start a project", repeated down the page.

Proof comes only from records the team publishes. There are no testimonials, ratings, client counts, years in business or awards anywhere, and no section exists for them (CONTRACT section 1).

## Page map

| # | Section | Job | Content source | When empty | 3D station |
|---|---|---|---|---|---|
| 1 | Navbar | Get anywhere, start a project | Rendered sections | Links only for sections that render | none |
| 2 | Hero | Say what we do in one sentence | `src/content/home.ts` | always shown | yes: the cairn |
| 3 | Partners | Show who we work with, by name | Admin: partners (permission confirmed) | hidden | none |
| 4 | Selected work | Prove it with real projects | Admin: showcase | hidden | yes: record sleeves |
| 5 | Services | What we build, in detail | Static (team confirms) | always shown | yes: key cluster |
| 6 | How we work | Remove the fear of the unknown | Static (team confirms) | always shown | none |
| 7 | Who we work with | Let each visitor find themself | Static, from PRODUCT.md audiences | always shown | none |
| 8 | Pricing | Set expectations about cost | Admin: pricing plans | hidden | yes: plates |
| 9 | Team | Show who does the work | Admin: developer profiles (consent confirmed) | hidden | yes: people's keys |
| 10 | FAQ | Answer the questions people email about | Static (team writes the answers) | hidden until written | none |
| 11 | Contact | Start the conversation | Form, `/api/leads` + Web3Forms | always shown | yes: giant Enter |
| 12 | Footer | Details, links, legal | Admin: site info | only filled fields | none |

Separate pages:

- **`/work/[slug]`, the case study.** The data already exists (`body.brief`, `body.built`, `body.result`, gallery, stack, services, live link, completed date). A portfolio without case studies is a list of thumbnails; this page is where trust is built.
- **`/privacy`**, required by the contact form.
- **404**, in the colourway, with "Back to the start".

### Order, and why it changes

The current page order is hero, partners, services, work, pricing, team, contact. For a portfolio, **work moves above services**: visitors believe what they see before what they read. The 3D engine needs no change for a new order (poses are keyed by station; the keycap rearrangement simply runs cairn to sleeves to cluster). "How we work", "Who we work with" and FAQ are plain bands with no station: the totem leaves with the section above and arrives with the next station, as it already does for the services details.

## Each section

All copy below that is not in `src/content/` today is a DRAFT for the team to confirm. Where a fact is missing, the mockups show a visible placeholder such as `[TEAM TO CONFIRM]`, never an invented one.

### 1. Navbar

- **Desktop:** graphite bar. Wordmark left; section pills (each in its field colour) and the tomato "Start a project" pill right. The pill of the section on screen gets a chalk ring; a visited section keeps its dot lit.
- **Phone:** wordmark, a row of small colour dots (the section pills shrunk), a "Menu" pill opening a full-screen native dialog with large pills.

### 2. Hero

- Kicker: "For founders, businesses and agencies".
- H1: "Web apps, SaaS and custom software, built end to end."
- One line: who we work with, in India and abroad.
- Primary: "Start a project". Secondary: "See our work" (or "What we build" when no project is published).
- **Desktop:** copy left, the keycap cairn right. **Phone:** headline top third, cairn middle, full-width action at the bottom.

### 3. Partners

- One graphite band, logos in chalk through a CSS mask, names as accessible text, links when set.
- Heading "Partners" only. Never "Trusted by".

### 4. Selected work

- Heading, one line, then up to six project cards; a "See all work" link when there are more.
- **Card:** cover image (16:9), title, client display name (when the client allowed it), service chips, the one-paragraph summary, "Read the case study".
- **Desktop:** the record-sleeve totem above, cards in a row below; the hovered card pulls its sleeve forward. **Phone:** sleeves middle, cards as a snap rail.

### 5. Services

- Six tiles (Web apps, SaaS products, Custom software, Mobile apps, UI/UX design, Cloud & DevOps); hovering one presses its key.
- Below: one card per service with a sentence, what is included, and stack chips (only technologies the team confirms).

### 6. How we work

- Four steps on graphite cards: **Scope, Design, Build, Support**.
- Each step: what happens, and what you receive (for example Scope: a written scope and estimate; Design: clickable screens; Build: working releases you can try; Support: fixes and improvements). Durations only if the team states them: `[TEAM TO CONFIRM]`.

### 7. Who we work with

- Four columns, one per audience from PRODUCT.md: **Startups and SaaS founders**, **Growing businesses**, **International clients**, **Agencies (white-label)**.
- Each: the problem they come with, and what ProDevly does for them, in two lines. No logos, no counts.

### 8. Pricing

- One card per published plan: name, who it suits, what it includes, the price line (`From ₹X`, `₹X a month`, or "Quoted after a scoping call"), "Choose this plan" (pre-fills the form).
- Desktop columns are as wide as the plates they stand under; the highlighted plan is graphite.

### 9. Team

- One card per published developer: photo or initial, name, role, two-line bio, up to four skills, GitHub and LinkedIn.
- Small text on chalk cards, never directly on the tomato field.

### 10. FAQ

- Five or six questions people actually ask: how long a typical project takes, who owns the code, NDAs, how we communicate, support after launch, currencies and payment.
- Native `<details>` elements (keyboard and screen-reader friendly). Answers come from the team; the section is hidden until they exist.

### 11. Contact

- Heading "Tell us what you're building." and "We read every enquiry and reply by email."
- Form: name, email, message; company, project type, timing and plan behind "Add details" on a phone.
- **What happens next**, three short steps: we read it, we reply by email, we set up a scoping call.
- The giant Enter key presses when the form is sent.

### 12. Footer

- Wordmark and one line, section links, services, email and social links that exist, Privacy, the copyright year.

## The case study page (`/work/[slug]`)

1. Back link to Work, title, client display name, service and stack chips, completed date if entered, "Visit the live site" if set.
2. Cover image, full width of the content column.
3. **The brief**, **What we built**, **The result**: three short sections from the record, each only if filled. A number appears only if the team typed it, as a client-approved fact.
4. Gallery: a two-column grid on desktop, one column on a phone, each image with alt text.
5. Next project, then "Start a project".

No 3D on this page: it loads fast, reads like an article and is easy to share.

## Look and feel (from the Keycap Colorway)

- **Fields:** each section owns one colour edge to edge: hero cobalt, partners graphite, work yolk, services chalk, how we work graphite, who we work with chalk, pricing mint, team tomato, FAQ chalk, contact graphite.
- **Type:** Hubot Sans wide and heavy for headings, Mona Sans for text, Martian Mono for kickers and chips.
- **Actions:** flat pills in a colourway tone with an arrow.
- **Cards:** solid chalk or white with a darker bottom edge (the keycap skirt); dark cards on graphite.
- **Phone first:** heading, then the totem, then cards in a snap rail; every action at least 44 px tall.

## Build order

All five steps are built on `design/keycap` (2026-10-16):

1. Case study page (`/work/[slug]`) and the "Read the case study" link on every work card. `/dev/case-study` shows it with a sample record.
2. Reorder: work above services (nav and stations follow).
3. "How we work" as its own section with what each step hands over, and "Who we work with" (static copy, team confirms).
4. FAQ: built, and hidden until the team writes answers in `src/content/home.ts` (`FAQ.items[].answer`).
5. Contact "What happens next", the Privacy page (a DRAFT describing only what the code does, for the team to confirm), and the colourway 404.

Each step: `npm run verify`, screenshots at 375, 768 and 1440, committed on its branch.

## What the team needs to provide

- Confirmation of every DRAFT line (services, steps, audiences).
- FAQ answers.
- At least one published project with cover, brief, what was built and result, to see the case study page with real content.
- Logo, Privacy text.

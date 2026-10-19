# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Pinned by the user: Next.js 16 (App Router, TypeScript), Tailwind CSS 4.2, MongoDB (mongoose), Web3Forms for public forms. 3D on the public site via three.js (React Three Fiber). No payment gateway.

## Users

Two surfaces, two audiences.

**Public site visitors** (prospective clients deciding whether to hire ProDevly):
- Startup and SaaS founders who need an MVP or product build and fast iteration.
- Indian SMBs and businesses who need websites, CRMs and custom business software.
- International clients (US, EU, Middle East) outsourcing development.
- Agencies looking for a white-label build partner.

**Admin panel users** (the ProDevly team):
- 3 superadmins: Aman Gupta, Lakshya Sharma, Shivansh Kaushik. They can add and delete admins and see everything.
- Admins: team members whose work and payments are tracked.

## Product Purpose

1. A public company profile for ProDevly, a web development, SaaS and custom software studio. Success: a visitor understands what ProDevly builds, sees real work, and sends an enquiry through the contact form.
2. An internal admin panel to run the business: clients, their projects and tasks, project status, client payments, third parties (vendors and freelancers) and their payouts per client/project/task, the company's own expenses per client project, the team and their roles, and admin work and pay. Each section has its own dashboard of overall figures.

## Positioning

Open decision. The user has not stated a differentiator beyond the breadth of work (web, SaaS, custom software) and the range of clients served. Do not invent one.

## Operating Context

- Enquiries arrive through the website contact form (Web3Forms) and are followed up by the team.
- Money is tracked as a ledger, not processed: client receipts, third-party payouts, admin payments and expenses each record amount, currency, conversion rate to INR, date, mode and status, linked to client, project and task where relevant. Dashboards total in INR.
- Superadmins manage admin accounts; admins log work against tasks.

## Capabilities and Constraints

- Public home page sections: navbar, hero, partners, projects, services, pricing, developers, contact form, footer.
- Projects, partners, developers and pricing are managed in the admin panel. Each home section renders only what has been added and stays hidden while empty. Any number shown publicly is computed from real records.
- Roles: `superadmin` and `admin`. Seed creates the 3 superadmins.
- Multi-currency ledger with stored conversion rate per entry.

## Brand Commitments

- Name: ProDevly.
- Colourful, fully 3D home page built around solid, lit 3D "totems"; not flat or illustrated.
- Awwwards-level craft is the bar.
- No fabricated statistics anywhere on the public site.
- No AI-default themes.

## Evidence on Hand

None yet. No case studies, client logos, testimonials, team photos, prices or metrics have been supplied. Until they are entered in the admin panel, the site must not show any, and nothing may be fabricated in their place.

## Product Principles

1. Show, don't claim: the site proves craft through the experience itself and real records, never through invented numbers.
2. One source of truth: public content comes from the same database the team runs the business on.
3. Every rupee traceable: each money entry links to who, which client, which project and which task.
4. Motion serves reading: 3D never makes text hard to read or scrolling hard to follow, on any screen size.

## Accessibility & Inclusion

WCAG 2.2 AA for text contrast, focus and keyboard use. Respect `prefers-reduced-motion` with a calm, non-animated 3D state. A non-WebGL fallback must still present every section.

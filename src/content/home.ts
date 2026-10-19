/**
 * Static copy for the home page. Every line is a statement about what ProDevly
 * offers, so the team confirms these drafts (docs/plan/engineering.html section 2).
 * No counts, ratings, client names, years or awards (docs/CONTRACT.md section 1);
 * `npm run check:copy` scans this folder.
 */
export const HERO = {
  eyebrow: 'For founders, businesses and agencies',
  title: 'Web apps, SaaS and custom software, built end to end.',
  lede: 'We work with founders, growing businesses and agencies, in India and abroad.',
  cta: 'Start a project',
  secondaryWork: 'See our work',
  secondaryServices: 'What we build',
} as const;

export interface ServiceCopy {
  /** Matches SITE.services. */
  name: string;
  blurb: string;
  included: readonly string[];
  stack: readonly string[];
}

export const SERVICES_SECTION = {
  eyebrow: 'Services',
  title: 'What we build',
  lede: 'Each key is one kind of work we take on, from the first screen to the servers it runs on.',
  detailsTitle: 'What each one includes',
} as const;

/**
 * The six services, in the order of the cluster on the keyboard. DRAFT: the team confirms
 * every line. Stack chips list only technologies this project itself is built with; the
 * team adds the rest when it confirms what it offers.
 */
export const SERVICES: readonly ServiceCopy[] = [
  {
    name: 'Web apps',
    blurb: 'Fast, accessible web applications and company sites, built to be easy to change.',
    included: ['Company and product sites', 'Dashboards and customer portals', 'Admin panels', 'Forms and integrations'],
    stack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS'],
  },
  {
    name: 'SaaS products',
    blurb: 'Multi-user products with accounts and roles, and the admin tools to run them.',
    included: ['Sign-in and roles', 'Team and workspace features', 'Admin tooling', 'APIs and integrations'],
    stack: ['Next.js', 'TypeScript', 'MongoDB'],
  },
  {
    name: 'Custom software',
    blurb: 'Software shaped around how your business already works.',
    included: ['Internal tools', 'Workflow automation', 'Integrations with the tools you use', 'Reporting'],
    stack: ['TypeScript', 'Node.js', 'MongoDB'],
  },
  {
    name: 'Mobile apps',
    blurb: 'Phone apps that share their backend and their design with your web product.',
    included: ['Cross-platform apps', 'Backend and APIs', 'Push notifications'],
    stack: [],
  },
  {
    name: 'UI/UX design',
    blurb: 'Interfaces designed with the people who will use them, handed over ready to build.',
    included: ['Flows and wireframes', 'Visual design', 'Design systems', 'Clickable prototypes'],
    stack: [],
  },
  {
    name: 'Cloud & DevOps',
    blurb: 'Hosting, deployment and monitoring set up so releases are routine.',
    included: ['Hosting and deployment', 'CI/CD pipelines', 'Monitoring and backups', 'Performance and security reviews'],
    stack: [],
  },
] as const;

/** DRAFT: the team confirms the steps and what each one hands over. No durations until the team states them. */
export const PROCESS = {
  eyebrow: 'How we work',
  title: 'Four steps, no surprises',
  receive: 'You receive',
  steps: [
    { name: 'Scope', text: 'We agree what is being built and what it has to do.', receive: 'a written scope and estimate.' },
    { name: 'Design', text: 'Screens and flows you can react to before any code is written.', receive: 'clickable screens.' },
    { name: 'Build', text: 'Working software, delivered in steps you can see and try.', receive: 'releases you can use.' },
    { name: 'Support', text: 'Launch, then fixes and improvements as you grow.', receive: 'a live product, looked after.' },
  ],
} as const;

/** DRAFT, from the audiences in PRODUCT.md: the team confirms. No logos and no counts. */
export const AUDIENCES = {
  eyebrow: 'Who we work with',
  title: 'Find yourself here',
  comeWith: 'You come with',
  weDo: 'We do',
  items: [
    { name: 'Startups and SaaS founders', need: 'an idea or a first version to ship.', does: 'build the MVP, then iterate with you.', field: 'cobalt' },
    { name: 'Growing businesses', need: 'spreadsheets and tools that no longer keep up.', does: 'websites, CRMs and custom business software.', field: 'yolk' },
    { name: 'International clients', need: 'a reliable team in another time zone.', does: 'full builds with clear, written updates.', field: 'mint' },
    { name: 'Agencies', need: 'more projects than developers.', does: 'white-label builds under your name.', field: 'tomato' },
  ],
} as const;

/**
 * Questions people ask before starting. A question shows only once the team has written
 * its answer here (`answer` not null), and the section shows only when at least one has:
 * an answer is a promise, so it is never drafted for them.
 */
export const FAQ: { eyebrow: string; title: string; items: ReadonlyArray<{ q: string; answer: string | null }> } = {
  eyebrow: 'Questions',
  title: 'What people ask before starting',
  items: [
    { q: 'How long does a typical project take?', answer: null },
    { q: 'Who owns the code and the designs?', answer: null },
    { q: 'Will you sign an NDA?', answer: null },
    { q: 'How do we communicate during the project?', answer: null },
    { q: 'What happens after launch?', answer: null },
    { q: 'Which currencies can we pay in?', answer: null },
  ],
};

export const CASE_STUDY = {
  back: 'All work',
  client: 'Client',
  completed: 'Completed',
  visit: 'Visit the live site',
  brief: 'The brief',
  built: 'What we built',
  result: 'The result',
  gallery: 'Gallery',
  next: 'Next project',
  ctaTitle: 'Want something like this?',
  cta: 'Start a project',
  read: 'Read the case study',
} as const;

export const WORK_SECTION = {
  eyebrow: 'Work',
  title: 'Projects',
  lede: 'Each sleeve on the shelf is a project we built. Read how it started, what we built and what changed.',
} as const;

export const PRICING_SECTION = {
  eyebrow: 'Pricing',
  title: 'Pick a size of build',
  lede: 'Small, medium or large: three ways to engage, each priced for what it includes.',
  quoted: 'Quoted after a scoping call',
  choose: 'Choose this plan',
} as const;

export const TEAM_SECTION = {
  eyebrow: 'Developers',
  title: 'The people at the keys',
  lede: 'Every key is one developer. Press it to meet them.',
} as const;

export const PARTNERS_SECTION = { title: 'Partners' } as const;

export const CONTACT = {
  eyebrow: 'Contact',
  title: "Tell us what you're building.",
  lede: 'We read every enquiry and reply by email.',
  fields: {
    name: 'Your name',
    email: 'Email',
    company: 'Company (optional)',
    type: 'What do you need?',
    plan: 'Plan (optional)',
    timing: 'When do you want to start?',
    message: 'Tell us about the project',
  },
  typeOther: 'Something else',
  more: 'Add company, project type and timing',
  fewer: 'Hide those details',
  timing: ['This month', 'This quarter', 'Just exploring'],
  send: 'Send enquiry',
  sending: 'Sending',
  sent: 'Sent. We will reply by email.',
  failed: 'That did not send. Try again, or write to us at',
  retry: 'Try again',
  nextTitle: 'What happens next',
  next: ['We read your message.', 'We reply by email with questions or a time to talk.', 'On a short call we agree what to build, then send a written scope.'],
} as const;

export const NAV_LABELS = {
  services: 'Services',
  work: 'Work',
  pricing: 'Pricing',
  team: 'Team',
  contact: 'Contact',
} as const;

export const FOOTER = {
  line: 'ProDevly designs and builds web apps, SaaS products and custom software.',
  privacy: 'Privacy',
  skip: 'Skip to content',
} as const;

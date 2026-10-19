/**
 * `npm run check:home` - drives /dev/home (the real home page with SAMPLE records) in a
 * real Chrome against a running `npm run dev`, and checks what the page promises:
 * stations follow the records, a section with none leaves no trace, the service tiles,
 * the project rail and the contact form drive the 3D, and tier 0 is a complete page
 * without three.js. Like `check:stage` and `smoke`, it needs the dev server, so it is
 * not part of `npm run verify`.
 */
import { chromium, type Browser, type Page } from '@playwright/test';

const BASE = process.env.STAGE_URL ?? 'http://localhost:3050';
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

interface Hook {
  stage: { status: string; tier: number | null; stats: { calls: number; programs: number; subject: number; frames: number } };
  scroll: { keys: string[] };
  input: { service: number; project: number; plan: number; person: number; sent: number };
}
const snap = async (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __stage: Hook }).__stage;
    return { status: h.stage.status, keys: [...h.scroll.keys], calls: h.stage.stats.calls, programs: h.stage.stats.programs, frames: h.stage.stats.frames, input: { ...h.input } };
  });

async function open(browser: Browser, query: string, viewport = { width: 1440, height: 900 }, reduced = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width < 800 ? 2 : 1,
    hasTouch: viewport.width < 800,
    isMobile: viewport.width < 800,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.location().url) && errors.push(m.text()));
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${BASE}/dev/home${query}`, { waitUntil: 'networkidle' });
  return { page, context, errors, requests };
}

const ready = (page: Page, status = 'ready') =>
  page.waitForFunction((s) => (window as unknown as { __stage?: Hook }).__stage?.stage.status === s, status, { timeout: 30_000 });

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'] });

  // 1. Default sample content: six stations, light on the GPU.
  {
    const { page, context, errors } = await open(browser, '?tier=3');
    await ready(page);
    const s = await snap(page);
    check('six stations from the records', s.keys.join() === 'hero,work,services,pricing,team,contact', s.keys.join());
    check('draw calls within the budget (150)', s.calls > 0 && s.calls <= 150, `${s.calls}`);
    check('shader programs on tier 3 within budget (12)', s.programs <= 12, `${s.programs}`);
    check('one h1, in the server HTML', (await page.locator('h1').count()) === 1);
    check('nav lists the five sections', (await page.locator('header nav a[href^="#"]:not([href="#contact"]), header nav a[href="#contact"]:has-text("Contact")').count()) >= 5);

    // A service tile lifts its cap; leaving lets go.
    await page.locator('#services a[href^="#service-"]').nth(2).hover();
    check('hovering a service tile binds its piece', (await snap(page)).input.service === 2);
    await page.mouse.move(5, 450);
    check('leaving the tile lets go', (await snap(page)).input.service === -1);

    // A real key press does something and breaks nothing (focus is on the page, not a field).
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-chapter="hero"]')?.scrollIntoView());
    const before = (await snap(page)).frames;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    check('keyboard press keeps the stage drawing', (await snap(page)).frames > before);
    check('no page errors (default)', errors.length === 0, errors.join(' | ').slice(0, 300));

    // Portfolio order and the case study links (docs/plan/portfolio.md).
    const order = await page.evaluate(() => [...document.querySelectorAll('main > section')].map((el) => el.id).join(','));
    check('work comes before services', order.indexOf('work') >= 0 && order.indexOf('work') < order.indexOf('services'), order);
    check('how we work and who we work with are on the page', (await page.locator('#process, #audiences').count()) === 2);
    check('questions stay hidden until the team writes answers', (await page.locator('#faq').count()) === 0);
    const cardLinks = await page.locator('#work article a[href^="/work/"]').count();
    check('every project card links to its case study', cardLinks === (await page.locator('#work article').count()) && cardLinks > 0, `${cardLinks}`);
    await context.close();
  }

  // Case study, privacy and 404 pages.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors: string[] = [];
    // React's dev-only performance track throws this for a page that calls notFound(); production has no such error.
    page.on('pageerror', (e) => !/negative time stamp/.test(e.message) && errors.push(e.message));
    let r = await page.goto(`${BASE}/dev/case-study`, { waitUntil: 'networkidle' });
    check('case study renders', r?.status() === 200 && (await page.locator('h1').count()) === 1);
    check('case study shows its three parts and the next project', (await page.locator('article h2').count()) === 3 && (await page.locator('a[href="/work/sample-project-b"]').count()) === 1);
    await page.goto(`${BASE}/dev/case-study?empty=1`, { waitUntil: 'networkidle' });
    check('a part left empty in the admin is not shown', (await page.locator('article h2').count()) === 1 && (await page.locator('a[href^="/work/"]').count()) === 0);
    r = await page.goto(`${BASE}/work/no-such-project`, { waitUntil: 'networkidle' });
    check('an unknown project is a 404', r?.status() === 404);
    r = await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
    check('privacy page renders', r?.status() === 200 && (await page.locator('h1').innerText()) === 'Privacy');
    r = await page.goto(`${BASE}/no-such-page`, { waitUntil: 'networkidle' });
    check('unknown pages get the colourway 404 with a way back', r?.status() === 404 && (await page.locator('a[href="/"]').count()) === 1);
    check('no page errors (pages)', errors.length === 0, errors.join(' | ').slice(0, 300));
    await context.close();
  }

  // 2. No records: three stations, and the data sections leave no trace.
  {
    const { page, context, errors } = await open(browser, '?tier=2&projects=0&plans=0&people=0');
    await ready(page);
    const s = await snap(page);
    check('no records: hero, services and contact only', s.keys.join() === 'hero,services,contact', s.keys.join());
    check('shader programs on tier 2 within budget (12)', s.programs <= 12, `${s.programs}`);
    check('no records: no work, pricing or team section', (await page.locator('#work, #pricing, #team').count()) === 0);
    check('no records: the nav has no key for them', (await page.locator('header nav a[href="#work"], header nav a[href="#pricing"], header nav a[href="#team"]').count()) === 0);
    check('no page errors (empty)', errors.length === 0, errors.join(' | ').slice(0, 300));
    await context.close();
  }

  // 3. The most records the stage draws.
  {
    const { page, context, errors } = await open(browser, '?tier=2&projects=8&plans=5&people=9&partners=3');
    await ready(page);
    check('most records: six stations and no errors', (await snap(page)).keys.length === 6 && errors.length === 0, errors.join(' | ').slice(0, 300));
    check('most records: every project card is in the DOM (the stage draws six)', (await page.locator('#work article').count()) === 8);
    await context.close();
  }

  // 4. Phone: the project rail features the card in the middle, and the form drives the send gesture.
  {
    const { page, context, errors } = await open(browser, '?tier=2', { width: 390, height: 844 });
    await ready(page);
    await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('#work ul.pd-rail');
      if (rail) rail.scrollTo({ left: (rail.children[2] as HTMLElement).offsetLeft - 20 });
    });
    await page.waitForTimeout(500);
    check('rail scroll features the card in the middle', (await snap(page)).input.project === 2, `${(await snap(page)).input.project}`);

    await page.route('**/api/form-token', (r) => r.fulfill({ json: { ok: true, data: { token: 'test-token', expiresInSeconds: 1800 } } }));
    let posted = '';
    await page.route('**/api/leads', (r) => {
      posted = r.request().postData() ?? '';
      return r.fulfill({ status: 201, json: { ok: true, data: { received: true } } });
    });
    await page.locator('#contact input[name="name"]').fill('Test Person');
    await page.locator('#contact input[name="email"]').fill('test@example.com');
    await page.locator('#contact textarea[name="message"]').fill('We would like a web app for our team.');
    await page.locator('#contact button[type="submit"]').click();
    await page.waitForSelector('#contact [role="status"]:has-text("Sent")', { timeout: 8000 });
    check('form sends to /api/leads with the form token and a clean body', /"formToken":"[^"]+"/.test(posted) && /Test Person/.test(posted) && /web app/.test(posted));
    check('a sent form plays the send gesture once', (await snap(page)).input.sent === 1);

    await page.route('**/api/leads', (r) => r.fulfill({ status: 500, json: { ok: false, error: { code: 'x', message: 'x' } } }));
    await page.locator('#contact input[name="name"]').fill('Test Person');
    await page.locator('#contact input[name="email"]').fill('test@example.com');
    await page.locator('#contact textarea[name="message"]').fill('Second message that fails to send.');
    await page.locator('#contact button[type="submit"]').click();
    await page.waitForSelector('#contact [role="status"]:has-text("did not send")', { timeout: 8000 });
    check('a failed send shows the error with a retry and the mailto', (await page.locator('#contact [role="status"] button:has-text("Try again")').count()) === 1 && (await page.locator('#contact [role="status"] a[href^="mailto:"]').count()) === 1);
    check('errors on phone are only the deliberate 500', errors.every((e) => /500|Failed to load resource/.test(e)), errors.join(' | ').slice(0, 300));
    await context.close();
  }

  // 4b. The menu dialog opens and every link closes it.
  {
    const { page, context } = await open(browser, '?tier=0', { width: 390, height: 844 });
    await page.locator('header button:has-text("Menu")').click();
    check('phone menu is a modal dialog with the sections', (await page.locator('dialog[open] a[href="#services"]').count()) === 1);
    await page.locator('dialog[open] a[href="#services"]').click();
    check('choosing a link closes the menu', (await page.locator('dialog[open]').count()) === 0);
    await context.close();
  }

  // 5. Tier 0: the whole page, no three.js.
  {
    const { page, context, requests } = await open(browser, '?tier=0', { width: 390, height: 844 });
    await ready(page, 'off');
    await page.waitForTimeout(400);
    const three = requests.filter((u) => /three|react-three|fiber|drei/i.test(u));
    check('tier 0: no canvas and no three.js request', (await page.locator('canvas').count()) === 0 && three.length === 0, three.slice(0, 2).join(' '));
    check('tier 0: every section is on the page', (await page.locator('#top, #services, #work, #pricing, #team, #contact').count()) === 6);
    check('tier 0: every station has a poster', (await page.locator('.pd-poster img').count()) >= 6, `${await page.locator('.pd-poster img').count()}`);
    await context.close();
  }

  // 6. Reduced motion: still renders, holds exact stations.
  {
    const { page, context, errors } = await open(browser, '?tier=2', { width: 390, height: 844 }, true);
    await ready(page);
    await page.evaluate(() => document.querySelector('#pricing')?.scrollIntoView());
    await page.waitForTimeout(800);
    const subject = await page.evaluate(() => (window as unknown as { __stage: Hook }).__stage.stage.stats.subject);
    check('reduced motion holds an exact station', Number.isInteger(subject), `${subject}`);
    check('no page errors (reduced motion)', errors.length === 0, errors.join(' | ').slice(0, 300));
    await context.close();
  }

  await browser.close();
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\ncheck:home ok');
}


main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * `npm run check:stage` - drives /dev/stage in a real Chrome against a running
 * `npm run dev` and checks the stage engine's promises (docs/plan/engineering.html
 * section 8, M2 gate). Like `npm run smoke`, it needs the dev server, so it is not
 * part of `npm run verify`.
 *
 *   npm run check:stage                 behaviour checks
 *   npm run check:stage -- --shots      also screenshots every station at 375, 390,
 *                                       768 and 1440 (and reduced motion) into
 *                                       test-results/stage/
 *
 * Uses the installed Google Chrome (channel 'chrome') with GPU flags, so WebGL is real.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';

const BASE = process.env.STAGE_URL ?? 'http://localhost:3050';
const URL_ = `${BASE}/dev/stage`;
const OUT = 'test-results/stage';
const shots = process.argv.includes('--shots');

interface Snapshot {
  status: string;
  tier: number | null;
  inView: boolean;
  stats: {
    subject: number;
    camera: number;
    target: number;
    speed: number;
    cap: number;
    cuts: number;
    frames: number;
    resizes: number;
    calls: number;
    programs: number;
    opacity: number;
  };
  keys: string[];
}

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function snap(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const w = window as unknown as { __stage: { stage: Snapshot & { stats: Snapshot['stats'] }; scroll: { keys: string[] } } };
    const { stage, scroll } = w.__stage;
    return { status: stage.status, tier: stage.tier, inView: stage.inView, stats: { ...stage.stats }, keys: [...scroll.keys] };
  });
}

async function open(browser: Browser, query: string, viewport: { width: number; height: number }, reduced = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width < 800 ? 2 : 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    hasTouch: viewport.width < 800,
    isMobile: viewport.width < 800,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The favicon 404s until a logo is supplied (none has been; none is invented).
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.location().url) && errors.push(m.text()));
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${URL_}${query}`, { waitUntil: 'networkidle' });
  return { page, context, errors, requests };
}

async function waitReady(page: Page, status = 'ready') {
  await page.waitForFunction((s) => (window as unknown as { __stage?: { stage: { status: string } } }).__stage?.stage.status === s, status, {
    timeout: 20_000,
  });
}

/** Scroll so a station's centre meets the viewport centre, then let the follower settle. */
async function toStation(page: Page, key: string) {
  await page.evaluate((k) => {
    const el = document.querySelector(`[data-chapter="${k}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo(0, r.top + window.scrollY + r.height / 2 - window.innerHeight / 2);
  }, key);
  // Wait for the TARGET to reach the station first, then for both followers to settle on it.
  await page.waitForFunction(
    (k) => {
      const w = window as unknown as { __stage: { stage: { stats: Snapshot['stats'] }; scroll: { keys: string[] } } };
      const s = w.__stage.stage.stats;
      const at = w.__stage.scroll.keys.indexOf(k);
      return (
        Math.abs(s.target - at) < 0.001 &&
        Math.abs(s.subject - at) < 0.002 &&
        Math.abs(s.camera - at) < 0.002 &&
        s.opacity > 0.99
      );
    },
    key,
    { timeout: 10_000 },
  );
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'],
  });
  mkdirSync(OUT, { recursive: true });

  // 1. Tier 3 desktop: it renders, it is a real canvas, budgets on the fixture.
  {
    const { page, context, errors } = await open(browser, '?tier=3', { width: 1440, height: 900 });
    await waitReady(page);
    const s = await snap(page);
    check('desktop reaches ready at tier 3', s.status === 'ready' && s.tier === 3);
    check('six stations measured', s.keys.join() === 'hero,services,work,pricing,team,contact', s.keys.join());
    check('draw calls within the desktop budget (150)', s.stats.calls > 0 && s.stats.calls <= 150, `${s.stats.calls}`);
    check('shader programs within budget (12)', s.stats.programs <= 12, `${s.stats.programs}`);

    // A 4,000 px wheel fling: in every frame the rendered speed stays under that
    // frame's cap (the base cap, raised only by the catch-up rule). Sampled in-page
    // on every animation frame so no frame is missed.
    // A string, not a function: tsx would wrap a named closure in a helper the page lacks.
    // Outside catch-up (base cap, and 0.6 s after the last catch-up frame so the
    // spring's carried momentum has decayed) the speed must stay under 1.6 ch/s.
    await page.evaluate(`(() => {
      const BASE = 1.6;
      window.__fling = { worst: 0, peak: 0, catchUp: false };
      let lastCatchUp = -Infinity;
      const loop = (now) => {
        const { speed, cap } = window.__stage.stage.stats;
        if (cap > BASE + 1e-9) { lastCatchUp = now; window.__fling.catchUp = true; }
        else if (cap > 0 && now - lastCatchUp > 600) window.__fling.worst = Math.max(window.__fling.worst, Math.abs(speed) - BASE);
        window.__fling.peak = Math.max(window.__fling.peak, Math.abs(speed));
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    })()`);
    await page.mouse.move(700, 450);
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(2500);
    const fling = await page.evaluate(
      () => (window as unknown as { __fling: { worst: number; peak: number; catchUp: boolean } }).__fling,
    );
    check(
      'fling: speed under 1.6 ch/s outside catch-up',
      fling.worst <= 1e-6,
      `peak ${fling.peak.toFixed(2)} ch/s, catch-up ${fling.catchUp}, worst excess ${fling.worst.toFixed(4)}`,
    );

    // End key from the top: exactly one fade-cut.
    await page.evaluate(() => window.scrollTo(0, 0));
    await toStation(page, 'hero');
    const before = (await snap(page)).stats.cuts;
    await page.keyboard.press('End');
    await page.waitForTimeout(1500);
    const after = await snap(page);
    check('End key from the hero makes exactly one fade-cut', after.stats.cuts - before === 1, `${after.stats.cuts - before}`);

    // Footer fills the viewport: no station in view, no GPU frames.
    const f0 = after.stats.frames;
    await page.waitForTimeout(600);
    const f1 = await snap(page);
    check('footer in view: stage paused (zero frames)', !f1.inView && f1.stats.frames === f0, `inView ${f1.inView}, frames +${f1.stats.frames - f0}`);

    // Scrolling never resizes the canvas.
    const r0 = f1.stats.resizes;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    check('no canvas resize during scroll', (await snap(page)).stats.resizes === r0);

    // Context loss: poster state, then a fresh stage after restore.
    await page.evaluate(() => (window as unknown as { __stage: { stage: { hooks: { loseContext(): void } } } }).__stage.stage.hooks.loseContext());
    await waitReady(page, 'lost');
    check('context loss shows the poster state', true);
    await page.evaluate(() => (window as unknown as { __stage: { stage: { hooks: { restoreContext(): void } } } }).__stage.stage.hooks.restoreContext());
    await waitReady(page);
    check('restored context remounts the stage', (await snap(page)).status === 'ready');
    check('no page errors (desktop)', errors.length === 0, errors.join(' | ').slice(0, 300));
    await context.close();
  }

  // 2. Tier 0: the full page, posters, and three.js is never requested.
  {
    const { page, context, requests } = await open(browser, '?tier=0', { width: 390, height: 844 });
    await waitReady(page, 'off');
    await page.waitForTimeout(500);
    const canvases = await page.locator('canvas').count();
    const threeChunk = requests.filter((u) => /three|react-three|fiber|drei/i.test(u));
    check('tier 0: no canvas', canvases === 0);
    check('tier 0: no three.js request', threeChunk.length === 0, threeChunk.slice(0, 3).join(' '));
    check('tier 0: posters visible', (await page.locator('.pd-poster').first().evaluate((e) => getComputedStyle(e).opacity)) !== '0');
    await context.close();
  }

  // 3. Missing stations: rails rebuild, nothing breaks.
  {
    const { page, context, errors } = await open(browser, '?tier=2&omit=work,pricing', { width: 390, height: 844 });
    await waitReady(page);
    const s = await snap(page);
    check('omitted stations drop out of the rails', s.keys.join() === 'hero,services,team,contact', s.keys.join());
    await toStation(page, 'team');
    check('no page errors (omit)', errors.length === 0, errors.join(' | ').slice(0, 300));
    await context.close();
  }

  // 4. Reduced motion: stations cut, the totem still renders.
  {
    const { page, context } = await open(browser, '?tier=2', { width: 390, height: 844 }, true);
    await waitReady(page);
    await toStation(page, 'work');
    const s = await snap(page);
    check('reduced motion holds an exact station', Number.isInteger(s.stats.subject), `${s.stats.subject}`);
    await context.close();
  }

  if (shots) {
    const sizes = [
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ];
    for (const viewport of sizes) {
      const { page, context } = await open(browser, '?tier=3&debug=stage', viewport);
      await waitReady(page);
      for (const key of ['hero', 'services', 'work', 'pricing', 'team', 'contact']) {
        await toStation(page, key);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${viewport.width}-${key}.png` });
      }
      await context.close();
    }
    const { page, context } = await open(browser, '?tier=2', { width: 390, height: 844 }, true);
    await waitReady(page);
    await toStation(page, 'services');
    await page.screenshot({ path: `${OUT}/390-services-reduced.png` });
    await context.close();
    console.log(`screenshots in ${OUT}/`);
  }

  await browser.close();
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\ncheck:stage ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

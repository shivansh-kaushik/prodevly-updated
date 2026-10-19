/**
 * `npx tsx scripts/shoot-stations.ts --path /dev/keycap [--out test-results/keycap] [--sizes 390x844,1440x900]
 *  [--tier 3] [--stations hero,services] [--query "&x=1"]`
 *
 * `--mid` also shoots the midpoint of every transition; `--reduced` uses reduced motion.
 *
 * Screenshots every station of a page with the stage engine, at each viewport, in a
 * real Chrome against a running `npm run dev`. The shots are for review next to the
 * approved preview stills (docs/design-previews/stills). Console errors and page
 * errors are printed.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const BASE = process.env.STAGE_URL ?? 'http://localhost:3050';
const PATH = arg('path', '/dev/keycap');
const OUT = arg('out', 'test-results/shots');
const TIER = arg('tier', '3');
const QUERY = arg('query', '');
const SIZES = arg('sizes', '390x844,1440x900').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number);
  return { width: w!, height: h! };
});
const REDUCED = process.argv.includes('--reduced');
const DEBUG = process.argv.includes('--debug');
/** Also shoot the midpoint of every transition (the totem in flight between two stations). */
const MID = process.argv.includes('--mid');

async function toStation(page: Page, key: string) {
  await page.evaluate((k) => {
    const el = document.querySelector(`[data-chapter="${k}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo(0, r.top + window.scrollY + r.height / 2 - window.innerHeight / 2);
  }, key);
  await page.waitForFunction(
    (k) => {
      const w = window as unknown as { __stage: { stage: { stats: Record<string, number> }; scroll: { keys: string[] } } };
      const s = w.__stage.stage.stats;
      const at = w.__stage.scroll.keys.indexOf(k);
      return at >= 0 && Math.abs(s.target! - at) < 0.001 && Math.abs(s.subject! - at) < 0.003 && Math.abs(s.camera! - at) < 0.003 && s.opacity! > 0.99;
    },
    key,
    { timeout: 15_000 },
  );
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'] });
  mkdirSync(OUT, { recursive: true });
  for (const viewport of SIZES) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: viewport.width < 800 ? 2 : 1,
      hasTouch: viewport.width < 800,
      isMobile: viewport.width < 800,
      reducedMotion: REDUCED ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.location().url) && errors.push(m.text()));
    await page.goto(`${BASE}${PATH}?tier=${TIER}${DEBUG ? '&debug=stage' : ''}${QUERY}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window as unknown as { __stage?: { stage: { status: string } } }).__stage?.stage.status === 'ready', undefined, { timeout: 30_000 });
    const keys: string[] = await page.evaluate(() => (window as unknown as { __stage: { scroll: { keys: string[] } } }).__stage.scroll.keys);
    const only = arg('stations', '').split(',').filter(Boolean);
    for (const key of keys.filter((k) => only.length === 0 || only.includes(k))) {
      await toStation(page, key);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${viewport.width}-${key}${REDUCED ? '-reduced' : ''}.png` });
    }
    if (MID) {
      for (let i = 0; i + 1 < keys.length; i++) {
        // Halfway between two station centres the target is exactly i + 0.5.
        await page.evaluate((at) => {
          const c = (window as unknown as { __stage: { scroll: { centres: number[] } } }).__stage.scroll.centres;
          window.scrollTo(0, (c[at]! + c[at + 1]!) / 2);
        }, i);
        await page.waitForFunction(
          (at) => {
            const s = (window as unknown as { __stage: { stage: { stats: Record<string, number> } } }).__stage.stage.stats;
            return Math.abs(s.target! - at - 0.5) < 0.01 && Math.abs(s.subject! - s.target!) < 0.003 && Math.abs(s.camera! - s.target!) < 0.003;
          },
          i,
          { timeout: 15_000 },
        );
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${viewport.width}-${keys[i]}-${keys[i + 1]}-mid.png` });
      }
    }
    if (errors.length) console.log(`errors @${viewport.width}:`, errors.slice(0, 6).join(' | ').slice(0, 800));
    await context.close();
  }
  await browser.close();
  console.log(`shots in ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * `npx tsx scripts/measure-zones.ts [--path /dev/home]` - prints where each station's
 * stage zone sits in the viewport when the station is at rest (its content block
 * centred), as viewport fractions, for several viewport sizes. The pose tables'
 * safe rects are read off this, so the totem stands exactly in its zone (and the
 * poster, cropped to the safe rect, lines up with it).
 */
import { chromium } from '@playwright/test';

const BASE = process.env.STAGE_URL ?? 'http://localhost:3050';
const PATH = process.argv.includes('--path') ? process.argv[process.argv.indexOf('--path') + 1]! : '/dev/home';
const SIZES = [
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const viewport of SIZES) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 800, isMobile: viewport.width < 800 });
    const page = await context.newPage();
    await page.goto(`${BASE}${PATH}?tier=0`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const rows = await page.evaluate(async () => {
      const out: Record<string, number[]> = {};
      const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]'));
      for (const block of blocks) {
        const r = block.getBoundingClientRect();
        window.scrollTo(0, r.top + window.scrollY + r.height / 2 - window.innerHeight / 2);
        await new Promise((res) => setTimeout(res, 80));
        const z = block.querySelector('.pd-zone')!.getBoundingClientRect();
        const w = window.innerWidth;
        const h = window.innerHeight;
        out[block.dataset.chapter!] = [z.left / w, z.top / h, z.width / w, z.height / h].map((v) => Math.round(v * 100) / 100);
      }
      return out;
    });
    console.log(`\n${viewport.width}x${viewport.height}`);
    for (const [k, v] of Object.entries(rows)) console.log(`  ${k.padEnd(9)} r(${v.join(', ')})`);
    await context.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

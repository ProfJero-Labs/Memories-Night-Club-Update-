// Screenshots pages at the target widths: node dev/shoot.mjs "index.html,nights.html" [widths]
import { chromium } from '../worker/node_modules/playwright/index.mjs';
const pages = (process.argv[2] || 'index.html').split(',');
const widths = (process.argv[3] || '390,1280').split(',').map(Number);
const out = process.env.OUT || '/tmp/claude-0/shots';
const full = process.env.FULL !== '0';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy, args: ['--ignore-certificate-errors'] });
const { mkdirSync } = await import('node:fs'); mkdirSync(out, { recursive: true });
for (const p of pages) for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 700 ? 844 : 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.goto(`http://localhost:${process.env.PORT || 8787}/${p}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const name = `${out}/${p.replace(/[^a-z0-9]+/gi, '_')}-${w}.png`;
  await page.screenshot({ path: name, fullPage: full });
  console.log(name, overflow > 0 ? `OVERFLOW ${overflow}px` : '', errs.length ? 'ERRORS: ' + errs.join(' | ') : '');
  await ctx.close();
}
await browser.close();

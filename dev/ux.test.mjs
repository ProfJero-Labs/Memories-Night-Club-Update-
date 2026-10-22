// Comfort guardrails: every staff and guest screen, measured in a real phone-sized browser, so a
// crowded screen, a cramped box, a tiny button or a missing way back can't come back unnoticed.
//   node --test dev/ux.test.mjs
// Rules (from the owner's UX audit):
//   • Typing: every box's text is at least 16px; writing boxes are at least 120px tall.
//   • Numbers get a number keyboard: money and count boxes say inputmode numeric/decimal; phone boxes tel.
//   • Tapping: buttons and links that do something are at least 40px tall.
//   • Reading: no text smaller than 12px.
//   • Going back: every screen that isn't a main tab has the ← Back bar; the phone's back button
//     closes a panel without leaving the screen.
//   • No sideways scrolling, no script errors.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
process.env.PORT ||= '8798';
await import('./server.mjs');
const { chromium } = await import('../worker/node_modules/playwright/index.mjs');
const base = `http://localhost:${process.env.PORT}`;
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' }); });
after(async () => { await browser.close(); setTimeout(() => process.exit(0), 50); });
const opened = [];
afterEach(async () => { for (const c of opened.splice(0)) await c.close().catch(() => {}); });

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  opened.push(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  return page;
}
async function signIn(page, ph, pin) {
  await page.goto(`${base}/login.html`); await page.fill('#phone', ph); await page.fill('#pin', pin); await page.click('#go');
  await page.locator('#acctBtn').waitFor({ timeout: 15000 });
}

// What's wrong with the screen showing now (an empty list means it's comfortable).
const problems = page => page.evaluate(() => {
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]'); };
  const name = el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}“${(el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 24)}”`;
  // The phone is 390px wide. (On a phone a too-wide page zooms out, so compare with 390, not innerWidth.)
  if (document.documentElement.scrollWidth > 391 || innerWidth > 391) out.push(`too wide for the phone: ${Math.max(document.documentElement.scrollWidth, innerWidth)}px (the bottom bar slips off the screen)`);
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, textarea')) {
    if (!vis(el)) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`small typing text in ${name(el)}`);
    if (el.tagName === 'TEXTAREA' && el.getBoundingClientRect().height < 119) out.push(`cramped writing box ${name(el)} (${Math.round(el.getBoundingClientRect().height)}px)`);
    const label = `${el.id} ${el.name} ${el.placeholder} ${el.closest('.sfield, .field')?.querySelector('label')?.textContent || ''}`;
    if (el.closest('.money-in') && !/decimal|numeric/.test(el.inputMode)) out.push(`money box without a number keyboard ${name(el)}`);
    if (el.tagName === 'INPUT' && /\b0\d{2} ?\d{3} ?\d{4}\b|phone|momo number/i.test(label) && !/tel/.test(`${el.type} ${el.inputMode}`) && !/@|email|transaction|search|name/i.test(label)) out.push(`phone box without the phone keyboard ${name(el)}`);
  }
  for (const el of document.querySelectorAll('button, a[href], summary, [role=button]')) {
    if (!vis(el) || el.closest('.staff-credit, p, li, .lines-list .ln small')) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 40) out.push(`small button ${name(el)} (${Math.round(r.height)}px)`);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let tiny = 0, example = '';
  while (walker.nextNode()) {
    const n = walker.currentNode, p = n.parentElement;
    if (!n.textContent.trim() || !p || !vis(p)) continue;
    if (parseFloat(getComputedStyle(p).fontSize) < 12) { tiny++; example ||= n.textContent.trim().slice(0, 30); }
  }
  if (tiny) out.push(`${tiny} bits of text under 12px (e.g. “${example}”)`);
  return out;
});

// Every problem on every screen is collected, then reported together at the end of the test.
async function check(page, what, { back = false } = {}) {
  await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const found = await problems(page);
  if (back) { const has = await page.locator('.back-btn').count(); if (!has) found.push('no ← Back on a screen that isn’t a main tab'); }
  if (page.errors.length) found.push(`script errors: ${page.errors.splice(0).join(' | ')}`);
  (page.found ||= []).push(...found.map(f => `${what}: ${f}`));
}
const verdict = page => assert.deepEqual(page.found || [], [], `\n  ${(page.found || []).join('\n  ')}`);

// Main tabs (no back needed) and the screens under them (← Back needed), per role.
const ROLES = [
  { who: 'waiter', ph: '0200000007', pin: '2580', page: 'waiter.html', tabs: ['tabs', 'tables', 'report'], subs: ['quick'] },
  { who: 'bar', ph: '0200000004', pin: '2580', page: 'bar.html', tabs: [], subs: [] },
  { who: 'cashier', ph: '0200000009', pin: '2580', page: 'cashier.html', tabs: ['bills', 'cash'], subs: [] },
  { who: 'manager', ph: '0200000002', pin: '258025', page: 'night.html', tabs: ['tonight', 'tables', 'customers'], subs: ['payments', 'cash', 'purchases', 'stock', 'money', 'approvals', 'sales', 'prices', 'commissions', 'reports'] },
  { who: 'director', ph: '0200000012', pin: '258025', page: 'night.html', tabs: ['tonight', 'money', 'approve'], subs: ['salaries', 'budget', 'reviews', 'feedback', 'perf', 'staff', 'tables', 'sales', 'reports'] },
  { who: 'human manager', ph: '0200000013', pin: '258025', page: 'hr.html', tabs: ['floor', 'staff', 'pay', 'customers'], subs: ['payments', 'feedback', 'perf', 'close'] },
  { who: 'finance', ph: '0200000010', pin: '258025', page: 'finance.html', tabs: ['today', 'pay', 'money', 'stock', 'reports'], subs: ['salaries', 'purchases', 'commissions', 'tips', 'budget', 'payments', 'prices', 'check'] },
  { who: 'dj', ph: '0200000016', pin: '2580', page: 'me.html', tabs: ['notices', 'messages', 'pay', 'me'], subs: [] },
];
for (const r of ROLES) {
  test(`comfortable screens: ${r.who}`, async () => {
    const page = await phone(); await signIn(page, r.ph, r.pin);
    await page.goto(`${base}/${r.page}`); await check(page, `${r.who} home`);
    // Main tabs, reached by tapping the bottom bar like a person would.
    for (const t of r.tabs) { const b = page.locator(`.bnav [data-k="${t}"]`); if (await b.count()) { await b.click(); await check(page, `${r.who} ${t}`); } }
    for (const k of await page.$$eval('.bnav [data-k]', bs => bs.map(b => b.dataset.k).filter(k => k !== 'more'))) { if (!r.tabs.includes(k)) { await page.click(`.bnav [data-k="${k}"]`); await check(page, `${r.who} ${k}`); } }
    for (const s of r.subs) { await page.goto(`${base}/${r.page}#${s}`); await check(page, `${r.who} ${s}`, { back: s !== 'quick' }); }
    verdict(page);
  });
}

test('comfortable screens: guests (QR menu, review) and sign-in', async () => {
  const page = await phone();
  await page.goto(`${base}/login.html`); await check(page, 'sign in');
  assert.equal(await page.getAttribute('#phone', 'type'), 'tel'); assert.equal(await page.getAttribute('#pin', 'inputmode'), 'numeric');
  await page.goto(`${base}/counter.html?s=0123456789abcdef0123456789abcdef`); await page.waitForSelector('#find'); await check(page, 'QR menu');
  await page.goto(`${base}/review.html`); await check(page, 'review');
  verdict(page);
});

test('going back: the phone’s back button closes a panel and stays on the screen; ← returns to where you came from', async () => {
  const page = await phone(); await signIn(page, '0200000002', '258025');
  await page.goto(`${base}/night.html#tonight`); await page.waitForSelector('.bnav [data-k="more"]');
  await page.click('.bnav [data-k="more"]'); await page.locator('.sheet').waitFor();
  await page.goBack(); await page.locator('.sheet').waitFor({ state: 'detached' });
  assert.match(page.url(), /night\.html#tonight$/, 'still on Tonight after closing the panel with Back');
  // More → Stock → ← Back lands on Tonight again; the ✕ closes a panel too.
  await page.click('.bnav [data-k="more"]'); await page.click('[data-more="stock"]'); await page.waitForURL(/#stock$/);
  await page.click('.back-btn'); await page.waitForURL(/#tonight$/);
  await page.click('.bnav [data-k="more"]'); await page.click('.sheet-x'); await page.locator('.sheet').waitFor({ state: 'detached' });
  await page.goBack(); await page.waitForTimeout(300);
  assert.doesNotMatch(page.url(), /#stock$/, 'Back after closing a panel doesn’t reopen the screen before');
  assert.deepEqual(page.errors, []);
});

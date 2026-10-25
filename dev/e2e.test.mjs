// End-to-end journeys in a real browser (Chromium via Playwright) against the real Worker code,
// served by dev/server.mjs with in-memory Firestore and a fake Paystack.
//   node --test dev/e2e.test.mjs
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
process.env.PORT ||= '8799';
const { store } = await import('./server.mjs');
const { chromium } = await import('../worker/node_modules/playwright/index.mjs');
const base = `http://localhost:${process.env.PORT}`;
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' }); });
after(async () => { await browser.close(); setTimeout(() => process.exit(0), 50); });
// Each test closes the pages it opened, so staff screens left open (they check the server every few
// seconds) don't pile up and slow the server down for the tests after them.
const opened = [];
afterEach(async () => { for (const ctx of opened.splice(0)) await ctx.close().catch(() => {}); });

async function phone(width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
  opened.push(ctx);
  // Fonts come from Google in production; offline they fall back, which is fine for behaviour tests.
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('console', m => /Content Security Policy/i.test(m.text()) && page.errors.push(m.text()));
  return page;
}
const docs = col => store.list(col).map(d => ({ id: d.id, ...d.fields }));
// Wait for a server-side effect instead of a fixed sleep (fails with a clear message after 10s).
async function until(check, what) { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`timed out waiting for ${what}`); }
// Tickets page (type + how many) → one-page checkout (details, optional line, pay).
async function buyTicket(page, { name, line, event = 'dev-afro', type }) {
  if (!/tickets\.html/.test(page.url())) await page.goto(`${base}/tickets.html?event=${event}`, { waitUntil: 'networkidle' });
  await page.click(type ? `[data-type="${type}"]` : '.type:not([disabled])');
  await page.click('#barGo');
  await page.waitForURL(/checkout\.html/); await page.waitForSelector('#co');
  if (line) {
    await page.click('#lineBox summary');
    if (line.own) await page.fill('#ownLine', line.own); else await page.getByRole('radio', { name: line }).click();
  }
  await page.fill('#name', name); await page.fill('#phone', '024 555 1234');
  await page.click('#pay');
  await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
  await page.waitForURL(/ticket\.html/, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('#postImg')?.src?.startsWith('blob:'), null, { timeout: 15000 });
  return new URL(page.url()).searchParams.get('token');
}

// Staff sign in with phone + PIN (dev seed: 2580, or 258025 for managers, directors, finance, admin).
const STAFF = { 'barmgr@dev': ['0200000018', '258025'], 'media@dev': ['0200000017', '2580'], 'admin@dev': ['0200000001', '258025'], 'manager@dev': ['0200000002', '258025'], 'door@dev': ['0200000003', '2580'], 'bar@dev': ['0200000004', '2580'], 'orga@dev': ['0245552020', '2580'], 'orgb@dev': ['0200000006', '2580'], 'waiter@dev': ['0200000007', '2580'], 'waiter2@dev': ['0200000008', '2580'], 'cashier@dev': ['0200000009', '2580'], 'finance@dev': ['0200000010', '258025'], 'security@dev': ['0200000011', '2580'], 'director@dev': ['0200000012', '258025'], 'hr@dev': ['0200000013', '258025'], 'director2@dev': ['0200000014', '258025'], 'events@dev': ['0200000015', '2580'], 'dj@dev': ['0200000016', '2580'] };
async function signInAs(page, email) {
  if (!/login\.html/.test(page.url())) await page.goto(`${base}/login.html`);
  await page.waitForSelector('#pinForm');
  const s = STAFF[email];
  if (s) { await page.fill('#phone', s[0]); await page.fill('#pin', s[1]); await page.click('#go'); return; }
  await page.click('#toEmail'); await page.fill('#email', email); await page.fill('#pw', 'memories-dev'); await page.click('#goEmail');
}

// Control-room tabs open by address; wait until that tab is the one showing and has loaded.
async function openTab(page, tab) {
  await page.evaluate(t => { location.hash = t; }, tab);
  await page.waitForFunction(t => {
    const single = { overview: 'tonight', nights: 'nights' }[t];
    const on = single ? document.querySelector(`[data-group="${single}"]`)?.getAttribute('aria-selected') === 'true' : document.querySelector(`.subtabs [data-tab="${t}"]`)?.getAttribute('aria-pressed') === 'true';
    return on && location.hash === `#${t}` && !document.querySelector('#panel .loading');
  }, tab);
}

test('homepage "Get tickets" opens a real night and a guest can pay, get a ticket and a share image', async () => {
  const page = await phone();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#next').getByRole('link', { name: /get tickets/i }).click();
  await page.waitForURL(/tickets\.html\?event=/);
  assert.match(await page.textContent('h1'), /choose your ticket/i);
  const token = await buyTicket(page, { name: 'Kwame Asante', line: 'SAMPLE LINE THREE.' });
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(await page.textContent('[data-line]'), 'SAMPLE LINE THREE.');
  assert.equal(await page.textContent('[data-name]'), 'Kwame');
  assert.ok(await page.locator('.t-qr svg').count(), 'QR rendered');
  const style = await page.getAttribute('.ticket', 'data-style');
  assert.ok(['classic', 'poster', 'neon', 'split', 'stamp', 'marquee', 'vinyl', 'sunburst', 'holo', 'coast'].includes(style), `ticket has its night's design (${style})`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.t-qr')).backgroundColor), 'rgb(255, 255, 255)', 'QR on white in every design');
  const t = store.get('tickets', token).fields;
  assert.equal(t.identityLine, 'SAMPLE LINE THREE.');
  assert.deepEqual(page.errors, []);
});

test('three tickets bought together: three tickets, each “n OF 3”; the buyer’s ticket lists and sends the others; a friend’s shows only its own', async () => {
  const page = await phone();
  await page.goto(`${base}/tickets.html?event=dev-afro`, { waitUntil: 'networkidle' });
  await page.click('.type:not([disabled])'); await page.click('#plus'); await page.click('#plus');
  await page.click('#barGo'); await page.waitForURL(/checkout\.html/); await page.waitForSelector('#co');
  await page.fill('#name', 'Group Buyer'); await page.fill('#phone', '024 555 7777'); await page.click('#pay');
  await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
  await page.waitForURL(/payment-return/); await page.getByText(/All 3 of you/).waitFor({ timeout: 20000 });
  assert.match(store.sms.at(-1).message, /3 tickets, one QR each/);
  await page.locator('.info-rows a').first().click(); await page.waitForURL(/ticket\.html/); await page.waitForSelector('.ticket');
  assert.match(await page.textContent('.ticket'), /1 OF 3/);
  assert.match(await page.textContent('.ticket'), /Ticket 1 of 3/);
  assert.match(await page.textContent('.ticket'), /EvolveIT/, 'the ticket credits EvolveIT');
  assert.equal(await page.locator('.group-row').count(), 2);
  const friendHref = await page.locator('.group-row a').last().getAttribute('href');
  const friend = await phone();
  await friend.goto(`${base}/ticket.html${friendHref}`, { waitUntil: 'networkidle' }); await friend.waitForSelector('.ticket');
  assert.match(await friend.textContent('.ticket'), /3 OF 3/);
  assert.equal(await friend.locator('.group-row').count(), 0, 'a friend’s ticket doesn’t list the group');
  assert.deepEqual([...page.errors, ...friend.errors], []);
});

test('two apps: guest pages install “Memories”; staff pages install “Memories Staff”, which opens at sign-in and goes straight to the dashboard; EvolveIT credited', async () => {
  const page = await phone();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'), 'manifest.webmanifest');
  assert.match(await page.textContent('footer'), /EvolveIT/);
  const [pub, staff] = await page.evaluate(() => Promise.all(['manifest.webmanifest', 'staff.webmanifest'].map(u => fetch(u).then(r => r.json()))));
  assert.notEqual(pub.id, staff.id, 'two separate apps');
  assert.match(staff.start_url, /^login\.html/);
  await page.goto(`${base}/login.html`); assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'), 'staff.webmanifest');
  await signInAs(page, 'manager@dev');
  await page.waitForURL(/night\.html/);
  assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'), 'staff.webmanifest');
  await page.locator('.staff-credit').getByText(/EvolveIT/).waitFor();
  // Opening the installed staff app (its start page) while signed in: straight to the dashboard.
  await page.goto(`${base}/${staff.start_url}`); await page.waitForURL(/night\.html/);
  assert.deepEqual(page.errors, []);
});

test('a declined payment never shows as paid: the guest sees "not paid" and a way back', async () => {
  const page = await phone();
  const before = docs('tickets').length;
  await page.goto(`${base}/tickets.html?event=dev-afro`, { waitUntil: 'networkidle' });
  await page.click('.type:not([disabled])'); await page.click('#barGo');
  await page.waitForURL(/checkout\.html/); await page.fill('#phone', '024 555 0101');
  await page.click('#pay');
  await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Decline' }).click();
  await page.waitForURL(/payment-return/);
  await page.getByText(/payment didn’t go through/i).waitFor({ timeout: 20000 });
  assert.doesNotMatch(await page.textContent('body'), /you’re in/i, 'nothing says you are in');
  assert.equal(await page.textContent('.stamp'), 'Not paid');
  assert.match(await page.getAttribute('a:has-text("Try again")', 'href'), /tickets\.html\?event=dev-afro/);
  assert.equal(docs('tickets').length, before, 'no ticket issued');
  assert.deepEqual(page.errors, []);
});

test('checkout is one page: details first, the line is optional and folded away; write your own or skip it', async () => {
  const page = await phone();
  await page.goto(`${base}/checkout.html?event=dev-afro&type=dev-afro-reg&qty=1`, { waitUntil: 'networkidle' });
  assert.match(await page.textContent('#co h1'), /your details/i);
  assert.equal(await page.isVisible('#name'), true, 'name comes first');
  assert.equal(await page.getAttribute('#lineBox', 'open'), null, 'the line is folded away');
  assert.equal(await page.locator('#toWho, #s1, #s2, #s3, .steps').count(), 0, 'no steps left');
  const own = await buyTicket(page, { name: 'Esi Mensah', line: { own: 'birthday girl in the building' } });
  assert.equal(store.get('tickets', own).fields.identityLine, 'birthday girl in the building');
  assert.match(await page.textContent('[data-line]'), /birthday girl in the building/i);
  const none = await buyTicket(page, { name: 'Kobby Mensah' });
  assert.equal(store.get('tickets', none).fields.identityLine, '', 'no line picked, none stored');
  assert.match(await page.textContent('[data-line]'), /afrobeats friday/i, 'the ticket leads with the night instead');
  assert.deepEqual(page.errors, []);
});

test('footer and visit page show the WhatsApp number and clickable Instagram, Facebook and TikTok; no ID line', async () => {
  const page = await phone();
  for (const path of ['index.html', 'visit.html']) {
    await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' });
    const hrefs = await page.$$eval('a', as => as.map(a => a.href));
    for (const url of ['https://wa.me/233249050086', 'https://www.instagram.com/memoriesnightclub.gh/', 'https://www.facebook.com/memoriesnightclub.gh', 'https://www.tiktok.com/@memoriesnightclub.gh'])
      assert.ok(hrefs.includes(url), `${path} links ${url}`);
    assert.doesNotMatch(await page.textContent('body'), /ID at the door|18\+ · ID/);
  }
  assert.ok((await page.$$eval('a', as => as.map(a => a.getAttribute('href')))).includes('nights.html#calendar'), 'calendar link in the footer');
  assert.deepEqual(page.errors, []);
});

test('remembered buyer details can be cleared from the phone', async () => {
  const page = await phone();
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => localStorage.setItem('mem-buyer', JSON.stringify({ name: 'Kwame Asante', phone: '0245551234', email: 'k@example.com' })));
  await page.goto(`${base}/checkout.html?event=dev-afro&type=dev-afro-reg&qty=1`, { waitUntil: 'networkidle' });
  assert.equal(await page.inputValue('#name'), 'Kwame Asante');
  await page.getByRole('button', { name: /not you\? clear saved details/i }).click();
  assert.equal(await page.inputValue('#name'), ''); assert.equal(await page.inputValue('#phone'), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('mem-buyer')), null);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.inputValue('#name'), '', 'stays cleared');
  assert.equal(await page.getByRole('button', { name: /clear saved details/i }).count(), 0);
  assert.deepEqual(page.errors, []);
});

test('event page: title, description, canonical, Open Graph and schema.org Event from the night’s data; no private data', async () => {
  const page = await phone();
  await page.goto(`${base}/event.html?id=dev-afro`, { waitUntil: 'networkidle' });
  const meta = sel => page.getAttribute(sel, 'content');
  assert.match(await page.title(), /^Afrobeats Friday · Memories$/);
  assert.equal(await meta('meta[property="og:title"]'), 'Afrobeats Friday · Memories');
  assert.match(await meta('meta[name="description"]'), /Doors 10PM/i);
  assert.equal(await page.getAttribute('link[rel="canonical"]', 'href'), `${base}/event.html?id=dev-afro`);
  const ld = JSON.parse(await page.textContent('script[type="application/ld+json"]'));
  assert.equal(ld['@type'], 'Event'); assert.equal(ld.name, 'Afrobeats Friday');
  assert.ok(ld.offers.length > 0 && ld.offers.every(o => o.priceCurrency === 'GHS' && /^\d+\.\d{2}$/.test(o.price)));
  const head = await page.evaluate(() => document.head.innerHTML);
  for (const t of docs('tickets')) assert.ok(!head.includes(t.id), 'no ticket token in metadata');
  assert.deepEqual(page.errors, []);
  // The static tags link previews use are in the HTML itself (they don't run scripts).
  const raw = await (await page.request.get(`${base}/event.html`)).text();
  assert.match(raw, /<meta property="og:image" content="https:\/\/memoriesnightclub\.com\/assets\/og\.png">/);
});

test('accessibility: axe finds no WCAG 2 A/AA or best-practice violations on the public pages (phone size)', async () => {
  const { readFileSync } = await import('node:fs');
  const axe = readFileSync(new URL('../worker/node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
  const found = [];
  for (const u of ['index.html', 'nights.html', 'event.html?id=dev-afro', 'tickets.html?event=dev-afro', 'checkout.html?event=dev-afro&type=dev-afro-reg&qty=1', 'tables.html?event=dev-afro', 'private.html', 'installment.html', 'find.html', 'member.html', 'counter.html?s=0123456789abcdef0123456789abcdef&t=4', 'visit.html', 'login.html']) {
    const page = await phone();
    await page.goto(`${base}/${u}`, { waitUntil: 'networkidle' });
    await page.evaluate(axe);
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations.map(x => `${x.id} (${x.nodes.map(n => n.target.join(' ')).join(', ')})`));
    for (const x of v) found.push(`${u}: ${x}`);
    await page.close();
  }
  assert.deepEqual(found, []);
});

test('two guests picking the same line get two different share images', async () => {
  const hashes = [];
  for (const name of ['Ama Owusu', 'Kofi Mensah']) {
    const page = await phone();
    await buyTicket(page, { name, line: 'SAMPLE LINE TWO.' });
    const bytes = await page.evaluate(async () => { const b = await (await fetch(document.querySelector('#postImg').src)).arrayBuffer(); return Array.from(new Uint8Array(b)); });
    hashes.push(createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
    assert.ok(bytes.length > 20000, 'a real PNG was drawn');
  }
  assert.notEqual(hashes[0], hashes[1]);
});

test('pay in bits: partial payment gets no ticket and no draw spot; the final payment issues one ticket', async () => {
  const page = await phone();
  const spotsBefore = store.get('raffles', 'evt_dev-afro').fields.spotsTaken;
  await page.goto(`${base}/checkout.html?event=dev-afro&type=dev-afro-reg&qty=1`, { waitUntil: 'networkidle' });
  await page.click('#lineBox summary'); await page.getByRole('radio', { name: 'SAMPLE LINE FOUR.' }).click();
  await page.fill('#name', 'Yaw Boateng'); await page.fill('#phone', '0241112222');
  assert.equal(await page.isVisible('#ack'), false, 'no tick box for paying in full');
  await page.click('#bitsMode'); await page.fill('#dep', '30');
  assert.match(await page.textContent('#bitsNote'), /forfeited once the night starts/, 'the deadline shows above Pay');
  assert.equal(await page.isChecked('#ack'), false, 'unticked by default');
  await page.click('#pay'); await page.getByText(/tick the box/i).waitFor();
  assert.ok(!/paystack/.test(page.url()), 'no payment without the tick');
  await page.check('#ack'); await page.click('#pay');
  await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
  await page.getByText(/to go/i).waitFor({ timeout: 20000 });
  const plan = docs('installment_plans').find(p => p.buyerName === 'Yaw Boateng');
  const receipt = await page.textContent('#receipt');
  for (const want of [plan.id, 'This payment', 'GHS 30', 'Left to pay', 'GHS 70', /Pay the rest before/, /forfeited/, /Anyone can pay/, /024\*\*\*2222/, /Lost this\?/])
    assert.match(receipt, want instanceof RegExp ? want : new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `receipt shows ${want}`);
  assert.ok(!receipt.includes('0241112222'), 'never the full phone');
  assert.ok(!/undefined|NaN/.test(receipt));
  assert.equal(plan.status, 'active'); assert.equal(plan.paidPesewas, 3000);
  assert.equal(docs('tickets').filter(t => t.planId === plan.id).length, 0, 'no ticket yet');
  assert.equal(store.get('raffles', 'evt_dev-afro').fields.spotsTaken, spotsBefore, 'no draw spot yet');
  assert.ok(store.sms.some(s => s.to === '0241112222' && s.message.includes(plan.id) && /Left: GHS 70/.test(s.message) && /forfeited/.test(s.message)), 'balance text with order code and deadline');
  await page.getByRole('link', { name: /pay more now/i }).click();
  await page.getByRole('button', { name: /all of it/i }).click(); await page.click('form[data-plan] button[type=submit]');
  await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
  await page.waitForURL(/ticket\.html/, { timeout: 20000 });
  assert.equal(store.get('installment_plans', plan.id).fields.status, 'completed');
  assert.equal(docs('tickets').filter(t => t.planId === plan.id).length, 1);
  assert.equal(await page.textContent('[data-line]'), 'SAMPLE LINE FOUR.', 'the line picked at the start is printed at the end');
});

test('pay-the-rest lookup of a paid order shows no ticket link; "text me the link" is neutral and texts only the right phone', async () => {
  const plan = docs('installment_plans').find(p => p.buyerName === 'Yaw Boateng' && p.status === 'completed');
  assert.match(plan.id, /^[A-Z0-9]{1,10}-\d{3}$/, 'readable order code from the night, e.g. AMAPIANOSA-001');
  const page = await phone();
  await page.goto(`${base}/installment.html?code=${plan.id.toLowerCase()}`, { waitUntil: 'networkidle' });
  await page.getByText(/enter the phone number you paid with/i).waitFor();
  assert.equal(await page.locator('#root .plan').count(), 0, 'the code alone opens nothing');
  await page.fill('#phone', '024 111 2222'); await page.click('#find button[type=submit]');
  await page.getByText(/paid in full/i).waitFor();
  const html = await page.content();
  assert.ok(!/ticket\.html\?token=/.test(html), 'no ticket link on the page');
  for (const t of plan.ticketIds) assert.ok(!html.includes(t), 'no ticket token in the page');
  const before = store.sms.length;
  await page.fill('form[data-resend] input', '0209999999'); await page.click('form[data-resend] button[type=submit]');
  await page.waitForFunction(() => { const f = document.querySelector('form[data-resend]'); return !f.querySelector('button[type=submit]').disabled && !f.querySelector('.notice:not(.ok)').hidden; });
  const wrongMsg = await page.locator('form[data-resend] .notice:not(.ok)').textContent();
  await page.evaluate(() => { document.querySelector('form[data-resend] .notice:not(.ok)').hidden = true; });
  await page.fill('form[data-resend] input', '024 111 2222'); await page.click('form[data-resend] button[type=submit]');
  await page.waitForFunction(() => { const f = document.querySelector('form[data-resend]'); return !f.querySelector('button[type=submit]').disabled && !f.querySelector('.notice:not(.ok)').hidden; });
  const rightMsg = await page.locator('form[data-resend] .notice:not(.ok)').textContent();
  assert.equal(wrongMsg, rightMsg, 'same message either way');
  assert.equal(store.sms.length, before + 1, 'one text, for the matching phone');
  assert.equal(store.sms.at(-1).to, '0241112222');
  assert.deepEqual(page.errors, []);
});

test('tables: night → table → bottles → pay; the booking shows up for staff', async () => {
  const page = await phone();
  await page.goto(`${base}/tables.html?event=dev-piano`, { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: /birthday table/i }).click(); await page.click('[data-next]');
  await page.click('[data-inc="dev-b2"]'); await page.click('[data-next]');
  await page.fill('#name', 'Efua Mensah'); await page.fill('#phone', '0551234567'); await page.click('#pay');
  await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
  await page.getByText(/your table is set/i).waitFor({ timeout: 20000 });
  const o = docs('orders').find(x => x.kind === 'table' && x.buyerName === 'Efua Mensah');
  assert.equal(o.amountPesewas, 450000 + 180000);
});

test('Book an event: Corporate opens the short form with Corporate chosen; admin accepts; the calendar shows the date held', async () => {
  const page = await phone();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Corporate' }).click();
  await page.getByRole('heading', { name: /when\?/i }).waitFor();
  const date = await page.locator('[data-date]:not([disabled])').nth(2).getAttribute('data-date');
  await page.locator(`[data-date="${date}"]`).click(); await page.fill('#guests', '30'); await page.click('#next');
  await page.fill('#name', 'Akosua Darko'); await page.fill('#phone', '0209998888'); await page.click('#send');
  await page.getByText(/got it/i).waitFor();
  const req = docs('private_event_requests').find(r => r.name === 'Akosua Darko');
  assert.equal(req.eventType, 'Corporate'); assert.equal(req.status, 'NEW');

  const admin = await phone(1280);
  await signInAs(admin, 'admin@dev');
  await admin.waitForURL(/admin\.html/); await openTab(admin, 'requests');
  await admin.locator(`[data-open="${req.id}"]`).click();
  admin.once('dialog', d => d.accept());
  await admin.locator(`[data-set="ACCEPTED"][data-id="${req.id}"]`).click();
  await until(() => store.get('private_event_requests', req.id).fields.status === 'ACCEPTED', 'the request to be accepted');
  await page.goto(`${base}/nights.html`, { waitUntil: 'networkidle' });
  const row = page.locator('.cal li').filter({ has: page.locator('.held') });
  assert.ok(await row.count() >= 1, 'a held date is on the calendar');
});

test('admin changes a flyer and a price; the public page shows it with no deploy', async () => {
  const admin = await phone(1280);
  await signInAs(admin, 'admin@dev');
  await admin.waitForURL(/admin\.html/); await admin.goto(`${base}/admin.html#nights/dev-piano`); await admin.waitForLoadState('networkidle');
  await admin.setInputFiles('#artFile', new URL('./fixtures/dnd-party-poster.jpeg', import.meta.url).pathname);
  await admin.getByText(/uploaded/i).waitFor();
  await admin.click('#save'); await admin.getByText(/live on the public site/i).waitFor();
  await admin.click('[data-sec-go="tickets"]');
  const row = admin.locator('tr[data-row="dev-piano-reg"]');
  await row.locator('[data-k=price]').fill('125'); await row.locator('[data-save]').click();
  await until(() => store.get('ticket_types', 'dev-piano-reg').fields.pricePesewas === 12500, 'the new price to be saved');
  await until(() => /\/dev\/uploads\//.test(store.get('events', 'dev-piano').fields.artwork || ''), 'the flyer to be saved');
  const guest = await phone();
  await guest.goto(`${base}/event.html?id=dev-piano`, { waitUntil: 'networkidle' });
  assert.match(await guest.locator('.event-art img').getAttribute('src'), /\/dev\/uploads\//);
  await guest.goto(`${base}/tickets.html?event=dev-piano`, { waitUntil: 'networkidle' });
  assert.match(await guest.textContent('[data-type="dev-piano-reg"]'), /GHS 125/);
});

test('control room: an unsaved flyer is not lost when a ticket row is saved; a private night says it is not public', async () => {
  const admin = await phone(1280);
  await signInAs(admin, 'admin@dev');
  await admin.waitForURL(/admin\.html/); await admin.goto(`${base}/admin.html#nights/dev-afro`); await admin.waitForLoadState('networkidle');
  await admin.setInputFiles('#artFile', new URL('./fixtures/dnd-party-poster.jpeg', import.meta.url).pathname);
  await admin.getByText(/uploaded/i).waitFor();
  assert.match(await admin.textContent('#saveState'), /unsaved/i, 'flyer upload marks the night unsaved');
  assert.equal((await admin.locator('#evOrg option:checked').textContent()).trim(), 'orga@dev', 'organiser shown by email, not UID');
  assert.ok(!(await admin.locator('#panel').innerText()).includes('uid-org-a'), 'no UID on screen');
  await admin.click('[data-sec-go="tickets"]');
  assert.equal(await admin.isVisible('#evForm'), false, 'one part of the night at a time');
  const row = admin.locator('tr[data-row="dev-afro-reg"]');
  await row.locator('[data-k=price]').fill('99');
  assert.match(await row.getAttribute('class'), /dirty/, 'changed row is highlighted');
  const dialog = new Promise(res => admin.once('dialog', d => { res(d.message()); d.accept(); }));
  await row.locator('[data-save]').click();
  assert.match(await dialog, /aren’t saved yet/);
  await until(() => store.get('ticket_types', 'dev-afro-reg').fields.pricePesewas === 9900 && /\/dev\/uploads\//.test(store.get('events', 'dev-afro').fields.artwork || ''), 'the price and the flyer to be saved');
  await admin.locator('tr[data-row="dev-afro-reg"]:not(.dirty)').waitFor();
  const guest = await phone();
  await guest.goto(`${base}/event.html?id=dev-afro`, { waitUntil: 'networkidle' });
  assert.match(await guest.locator('.event-art img').getAttribute('src'), /\/dev\/uploads\//, 'flyer kept and published');
  await guest.goto(`${base}/tickets.html?event=dev-afro`, { waitUntil: 'networkidle' });
  assert.match(await guest.textContent('[data-type="dev-afro-reg"]'), /GHS 99/);

  assert.equal(await admin.getAttribute('[data-sec-go="tickets"]', 'aria-pressed'), 'true', 'still on Tickets after the reload');
  await admin.click('[data-sec-go="details"]');
  await admin.uncheck('#evPublic'); await admin.click('#save');
  await admin.getByText(/NOT on the public site/).waitFor();
  await until(() => store.get('events', 'dev-afro').fields.visibility === 'private', 'the night to be saved private');
  await admin.check('#evPublic'); await admin.click('#save');
  await admin.getByText(/live on the public site/i).waitFor();
  await until(() => store.get('events', 'dev-afro').fields.visibility === 'public', 'the night to be public again');
});

test('control room: refunds owed are listed and can be marked refunded with a note', async () => {
  store.seed('pending_checkouts', 'e2e-refund', { kind: 'ticket', eventName: 'Afrobeats Friday', buyerName: 'Refund Me', buyerPhone: '0247778888', amountPesewas: 15000, status: 'failed', error: 'sold_out_after_payment', refundStatus: 'manual_required', createdAt: new Date().toISOString() });
  // Refunds are the ticket side: the system admin's, not the director's.
  const dir = await phone(390); await signInAs(dir, 'director@dev'); await dir.waitForURL(/night\.html/);
  await dir.locator('#acctBtn').waitFor(); // signed in and the director's screen is up before moving on
  await dir.goto(`${base}/admin.html`); await dir.waitForFunction(() => location.hash === '#members'); // members only
  assert.equal(await dir.locator('text=Refunds').count(), 0);
  const admin = await phone(1280);
  await signInAs(admin, 'admin@dev'); await admin.waitForURL(/admin\.html/); await openTab(admin, 'refunds');
  const row = admin.locator('tr', { hasText: 'Refund Me' });
  await row.waitFor();
  assert.match(await row.textContent(), /GHS 150/);
  await row.locator('button', { hasText: /mark refunded/i }).click();
  await admin.getByText(/add a note first/i).waitFor();
  assert.equal(store.get('pending_checkouts', 'e2e-refund').fields.refundStatus, 'manual_required', 'nothing marked without a note');
  await row.locator('input').fill('Paystack refund RF-123');
  admin.once('dialog', d => d.accept());
  await row.locator('button', { hasText: /mark refunded/i }).click();
  await admin.getByText(/marked refunded/i).waitFor();
  assert.equal(store.get('pending_checkouts', 'e2e-refund').fields.refundStatus, 'refunded');
  assert.equal(await admin.locator('tr', { hasText: 'Refund Me' }).count(), 0);
  assert.deepEqual(admin.errors, []);
});

test('control room on a phone: every tab fits the screen; tables become labelled cards', async () => {
  const page = await phone(390);
  await signInAs(page, 'admin@dev');
  await page.waitForURL(/admin\.html/);
  for (const tab of ['overview', 'nights', 'bookings', 'requests', 'bits', 'refunds', 'bar', 'settings', 'staff']) {
    await openTab(page, tab);
    await page.waitForFunction(() => !document.querySelector('#panel .loading'));
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `${tab} is ${w}px wide on a 390px phone`);
  }
  assert.ok(await page.locator('[data-group]').count() <= 5, 'five places at most in the top bar');
  for (const b of await page.locator('[data-group]').all()) { const r = await b.boundingBox(); assert.ok(r.x >= 0 && r.x + r.width <= 390 && r.height >= 44, 'every top button is on screen and thumb-sized'); }
  await page.click('[data-group=money]');
  await page.locator('.subtabs [data-tab=refunds]').click(); await page.waitForFunction(() => !document.querySelector('#panel .loading'));
  assert.match(page.url(), /#refunds$/);
  await openTab(page, 'bits');
  if (await page.locator('table.tbl tbody td').count()) assert.ok(await page.locator('table.tbl tbody td[data-label="Owing"]').count(), 'cells carry their column label');
  assert.deepEqual(page.errors, []);
});

test('images uploaded in the control room appear on the public site: hero image on the homepage and the night’s page; site hero as fallback', async () => {
  const guest = await phone(1280);
  await guest.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  const heroId = new URL(await guest.locator('#heroArt').getAttribute('href'), base).searchParams.get('id');
  const admin = await phone(1280);
  await signInAs(admin, 'admin@dev');
  await admin.waitForURL(/admin\.html/); await admin.goto(`${base}/admin.html#nights/${heroId}`); await admin.waitForLoadState('networkidle');
  await admin.setInputFiles('#heroFile', new URL('./fixtures/dnd-party-poster.jpeg', import.meta.url).pathname);
  await admin.getByText(/uploaded/i).waitFor();
  await admin.click('#save');
  await until(() => /\/dev\/uploads\//.test(store.get('events', heroId).fields.heroImage || ''), 'the hero image to be saved');
  await guest.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  assert.equal(await guest.isVisible('#heroBg'), true, 'homepage shows the night’s hero image');
  assert.match(await guest.evaluate(() => document.querySelector('#heroBg').style.backgroundImage), /\/dev\/uploads\//);
  await guest.goto(`${base}/event.html?id=${heroId}`, { waitUntil: 'networkidle' });
  assert.match(await guest.getAttribute('.event-banner img', 'src'), /\/dev\/uploads\//, 'the night’s page shows it as a banner');
  assert.deepEqual(guest.errors, []);
});

test('a video uploaded for a night plays behind the homepage hero and on its page; reduced motion gets the still image', async () => {
  const guest = await phone(1280);
  await guest.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  const heroId = new URL(await guest.locator('#heroArt').getAttribute('href'), base).searchParams.get('id');
  const admin = await phone(1280);
  await signInAs(admin, 'admin@dev');
  await admin.waitForURL(/admin\.html/); await admin.goto(`${base}/admin.html#nights/${heroId}`); await admin.waitForLoadState('networkidle');
  await admin.setInputFiles('#evVidF', new URL('./fixtures/clip.webm', import.meta.url).pathname);
  await admin.getByText(/video uploaded/i).waitFor();
  assert.equal(await admin.locator('#evVidT video').count(), 1, 'preview in the editor');
  await admin.click('#save');
  await until(() => /\/dev\/uploads\//.test(store.get('events', heroId).fields.heroVideo || ''), 'the video to be saved');
  await guest.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  assert.match(await guest.getAttribute('#heroBg video', 'src'), /\/dev\/uploads\//, 'homepage plays the night’s video');
  assert.equal(await guest.getAttribute('#heroBg video', 'muted') !== null || await guest.evaluate(() => document.querySelector('#heroBg video').muted), true);
  await guest.goto(`${base}/event.html?id=${heroId}`, { waitUntil: 'networkidle' });
  assert.match(await guest.getAttribute('.event-banner video', 'src'), /\/dev\/uploads\//, 'the night’s page plays it');
  const calm = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const still = await calm.newPage();
  await still.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  assert.equal(await still.locator('#heroBg video').count(), 0, 'no video when the visitor asks for reduced motion');
  await calm.close();
  // Remove it again: the homepage falls back to the still image.
  await admin.click('[data-sec-go="look"]'); await admin.click('#evVidX'); await admin.click('#save');
  await until(() => !store.get('events', heroId).fields.heroVideo, 'the video to be removed');
  assert.deepEqual(guest.errors, []);
});

test('door: no any-night mode; valid → ENTRY CONFIRMED, again → ALREADY CHECKED IN, junk refused; headcount from server; search admits', async () => {
  const valid = docs('tickets').filter(t => t.status === 'valid' && t.eventId === 'dev-afro');
  const token = valid[0].id;
  const door = await phone();
  await signInAs(door, 'door@dev');
  await door.waitForURL(/checkin\.html/); await door.waitForLoadState('networkidle');
  assert.equal(await door.locator('#ev option', { hasText: /any night/i }).count(), 0, 'no Any night option');
  if (!(await door.inputValue('#ev'))) {
    await door.fill('#code', token); await door.click('#manual button');
    await door.locator('#out').getByText(/choose the night/i).waitFor();
    assert.equal(store.get('tickets', token).fields.status, 'valid', 'nothing admitted without a night');
  }
  await door.selectOption('#ev', 'dev-afro');
  await door.waitForFunction(() => /\d/.test(document.querySelector('#inCount').textContent));
  const before = Number(await door.textContent('#inCount'));
  await door.fill('#code', `${base}/verify.html?token=${token}`); await door.click('#manual button');
  await door.getByText(/entry confirmed/i).waitFor();
  await door.waitForFunction(n => Number(document.querySelector('#inCount').textContent) > n, before);
  await door.fill('#code', token); await door.click('#manual button');
  await door.getByText(/already checked in/i).waitFor();
  await door.fill('#code', 'deadbeef'); await door.click('#manual button');
  await door.getByText(/not a ticket code/i).waitFor();
  await door.fill('#code', 'f'.repeat(64)); await door.click('#manual button');
  await door.getByText(/ticket not valid/i).waitFor();
  assert.equal(docs('checkins').filter(c => c.ticketId === token).length, 1);

  // Search by first name → Admit, with no token anywhere on the page.
  const other = docs('tickets').find(t => t.status === 'valid' && t.eventId === 'dev-afro' && t.id !== token);
  await door.fill('#search', other.customerName.split(' ')[0]);
  const btn = door.locator(`#hits [data-code="${other.displayCode}"]`);
  await btn.waitFor(); await btn.click();
  await door.getByText(/entry confirmed/i).waitFor();
  assert.equal(store.get('tickets', other.id).fields.status, 'used');
  assert.ok(!(await door.content()).includes(other.id), 'search never puts a token on the page');
  assert.deepEqual(door.errors, []);
});

test('door: a table is found by name and seated once; an admit tapped by mistake can be undone', async () => {
  store.seed('orders', 'e2etable01', { kind: 'table', status: 'confirmed', eventId: 'dev-afro', eventName: 'Afrobeats Friday', packageName: 'Floor Table', buyerName: 'Nana Tablebooker', buyerPhone: '0247770001', createdAt: new Date().toISOString() });
  const t = 'f'.repeat(56) + 'e2e0undo';
  store.seed('tickets', t, { customerName: 'Undo Person', phoneLast4: '0002', eventId: 'dev-afro', eventName: 'Afrobeats Friday', type: 'Regular', admitCount: 1, displayCode: 'MEM-FFFFFF', status: 'valid' });
  const door = await phone();
  await signInAs(door, 'door@dev');
  await door.waitForURL(/checkin\.html/); await door.waitForLoadState('networkidle'); await door.selectOption('#ev', 'dev-afro');
  await door.fill('#search', 'tablebooker');
  await door.locator('#hits [data-table="TBL-E2ETAB"]').click();
  await door.locator('#out').getByText(/table seated/i).waitFor();
  assert.ok(store.get('orders', 'e2etable01').fields.arrivedAt);
  await door.locator('#hits').getByText('Seated').waitFor();

  await door.fill('#search', 'undo person');
  await door.locator('#hits [data-code="MEM-FFFFFF"]').click();
  await door.locator('#out').getByText(/entry confirmed/i).waitFor();
  await door.click('#undo');
  await door.locator('#out').getByText(/admission undone/i).waitFor();
  assert.equal(store.get('tickets', t).fields.status, 'valid', 'the ticket works again');
  assert.deepEqual(door.errors, []);
});

test('the ticket’s QR opens full screen on white for the door', async () => {
  const token = docs('tickets').find(x => x.status === 'valid' && !x.comp)?.id;
  const page = await phone(360);
  await page.goto(`${base}/ticket.html?token=${token}`, { waitUntil: 'networkidle' });
  await page.click('.t-qr');
  const box = await page.locator('.qr-full[open] .qr-big').boundingBox();
  assert.ok(box.width >= 300, `QR is ${Math.round(box.width)}px wide on a 360px phone`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.qr-full')).backgroundColor), 'rgb(255, 255, 255)');
  await page.click('.qr-full'); assert.equal(await page.locator('.qr-full[open]').count(), 0, 'tap closes it');
});

test('membership: a manager adds someone and gets a one-time code (nothing texted); it sets up their app; at the gate only the code in their app works (no QR); attendance; offline; delete', async () => {
  const { passSig } = await import('../worker/src/members.js');
  const smsBefore = store.sms.length;
  const admin = await phone(390);
  await signInAs(admin, 'admin@dev');
  await admin.waitForURL(/admin\.html/); await openTab(admin, 'members');
  await admin.getByText(/Staff accounts without a membership/).waitFor();
  await admin.click('#mAdd'); await admin.fill('#fName', 'Kojo Gatekeeper'); await admin.fill('#fPhone', '0245551010'); await admin.selectOption('#fType', 'member'); await admin.fill('#fDept', 'VIP');
  await admin.click('#mForm button[type=submit]');
  await admin.locator('.qrm .act-code').waitFor();
  const code = (await admin.locator('.qrm .act-code').textContent()).trim();
  assert.match(code, /^[0-9A-Z]{10}$/);
  assert.equal(store.sms.length, smsBefore, 'nothing texted');
  await admin.click('#aDone');

  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const mem = await ctx.newPage(); mem.errors = []; mem.on('pageerror', e => mem.errors.push(e.message));
  await mem.goto(`${base}/member.html?activate=${code}`, { waitUntil: 'networkidle' });
  assert.ok(await mem.locator('link[rel=manifest]').count(), 'installable: has a manifest');
  await mem.waitForSelector('#wait');
  assert.match(await mem.textContent('.who'), /Kojo Gatekeeper/);
  assert.ok(!mem.url().includes('activate='), 'the used code is taken out of the address bar');
  const pass = await mem.evaluate(() => JSON.parse(localStorage.getItem('mem-pass')));
  assert.ok(await mem.evaluate(async () => !!(await navigator.serviceWorker.ready).active), 'service worker running');
  await ctx.setOffline(true); await mem.reload();
  await mem.waitForSelector('.pass .who', { timeout: 10000 });
  await ctx.setOffline(false); await mem.reload(); await mem.waitForSelector('#wait');

  const door = await phone(390);
  await signInAs(door, 'door@dev');
  await door.waitForURL(/checkin\.html/); await door.waitForLoadState('networkidle');
  // No QR for members: an old pass QR scanned by habit points the door to the number route.
  assert.equal(await mem.locator('#qr').count(), 0, 'the pass shows no QR');
  const step = Math.floor((Date.now() + (pass.skewMs || 0)) / 30000);
  await door.fill('#code', `MP1.${pass.passId}.${step}.${await passSig(pass.secret, pass.passId, step)}`); await door.click('#manual button');
  await door.locator('#out').getByText(/use their number/i).waitFor();
  assert.equal(await door.evaluate(() => document.querySelector('#memberGate').open), true);
  await door.fill('#mNum', '0245551010'); await door.click('#mPhone button');
  await door.locator('#out').getByText(/code on their app/i).waitFor();
  // The code appears on the member's pass (polled while it's open), never by SMS.
  await mem.locator('.gate-code b').waitFor({ timeout: 10000 });
  const gate = (await mem.textContent('.gate-code b')).replace(/\D/g, '');
  await door.fill('#mCodeIn', gate); await door.click('#mCode button[type=submit]');
  await door.locator('#out').getByText(/member verified/i).waitFor();
  assert.equal(docs('member_entries').filter(e => e.name === 'Kojo Gatekeeper').length, 1);
  assert.equal(store.sms.length, smsBefore, 'still nothing texted');

  await openTab(admin, 'attendance');
  await admin.getByText('Kojo Gatekeeper').first().waitFor();
  assert.ok((await admin.textContent('#aBody')).includes('door@dev'), 'who checked them in');
  // Delete: gone from the list, the door is told they're not a member; history stays.
  await openTab(admin, 'members');
  admin.once('dialog', d => d.accept());
  await admin.locator('tr', { hasText: 'Kojo Gatekeeper' }).locator('[data-mdel]').click();
  await admin.getByText('Deleted Kojo Gatekeeper.').waitFor();
  await door.fill('#mNum', '0245551010'); await door.click('#mPhone button');
  await door.locator('#out').getByText(/not a member/i).waitFor();
  assert.equal(docs('member_entries').filter(e => e.name === 'Kojo Gatekeeper').length, 1, 'history kept');
  assert.deepEqual([...admin.errors, ...door.errors, ...mem.errors], []);
  await ctx.close();
});

test('staff are members: the organiser sees their gate code on their own dashboard and opens their pass from it', async () => {
  const smsBefore = store.sms.length;
  const org = await phone(390);
  await signInAs(org, 'orga@dev');
  await org.waitForURL(/organiser\.html/); await org.waitForLoadState('networkidle');
  const door = await phone(390);
  await signInAs(door, 'door@dev');
  await door.waitForURL(/checkin\.html/); await door.waitForLoadState('networkidle');
  await door.click('#memberGate summary'); await door.fill('#mNum', '024 555 2020'); await door.click('#mPhone button');
  await door.locator('#out').getByText(/staff dashboard/i).waitFor();
  await org.locator('#gateBanner b').waitFor({ timeout: 12000 });
  const gate = (await org.textContent('#gateBanner b')).replace(/\D/g, '');
  await door.fill('#mCodeIn', gate); await door.click('#mCode button[type=submit]');
  await door.locator('#out').getByText(/staff verified/i).waitFor();
  assert.equal(store.sms.length, smsBefore, 'no SMS');
  await org.click('#acctBtn'); await org.click('#myPass'); await org.waitForURL(/member\.html/); await org.waitForSelector('#wait');
  assert.match(await org.textContent('.who'), /Ama Organiser/);
  assert.deepEqual([...org.errors, ...door.errors], []);
});

test('scan to order: the bar QR opens the menu; pay; the pickup code shows only once paid; the bar hands over; the guest sees it', async () => {
  const g = await phone(360);
  await g.goto(`${base}/b/0123456789abcdef0123456789abcdef`, { waitUntil: 'networkidle' }); // an old printed QR: redirects
  assert.match(g.url(), /counter\.html\?s=0123/);
  assert.match(await g.textContent('#label'), /main bar/i);
  assert.equal(await g.locator('[data-p="dev-m-flute"]').count(), 0, 'sold-out drink can’t be added');
  await g.click('[data-p="dev-m-beer"]'); await g.click('[data-p="dev-m-beer"]'); await g.click('[data-p="dev-m-water"]');
  assert.match(await g.textContent('#dockBtn'), /View order.*3 drinks · GHS 60/);
  // Step 2: the order panel. Pay without a number: the field says so, the panel stays open.
  await g.click('#dockBtn'); await g.waitForSelector('#order:not([hidden])');
  assert.match(await g.textContent('#pay'), /Pay GHS 63/, 'GHS 60 of drinks + the 5% service fee');
  await g.fill('#ph', ''); await g.click('#pay'); await g.locator('#order .field.bad').getByText(/MoMo number/).first().waitFor();
  // The phone's back button closes the panel; the basket is kept.
  await g.goBack(); await g.waitForSelector('#order', { state: 'hidden' });
  assert.match(await g.textContent('#dockBtn'), /3 drinks · GHS 60/);
  await g.click('#dockBtn'); await g.fill('#ph', '024 123 9876'); await g.click('#pay');
  await g.waitForURL(/dev\/paystack/);
  assert.equal(docs('counter_orders').find(o => o.phone === '0241239876').pickupCode, undefined, 'no pickup code before payment');
  await g.getByRole('button', { name: 'Pay' }).click();
  await g.waitForURL(/counter\.html/); await g.waitForSelector('.pickup', { timeout: 15000 });
  const code = (await g.textContent('.pickup')).trim();
  // Waiting for the drinks never locks the menu: order more, and the pickup code is one tap back.
  await g.getByRole('link', { name: 'Order more while you wait' }).click();
  await g.waitForSelector('#find');
  await g.getByRole('link', { name: /your order at the bar/i }).click();
  await g.waitForSelector('.pickup'); assert.equal((await g.textContent('.pickup')).trim(), code);
  // The guest's text carries the pickup code (the Manager's payment alert may come after it).
  assert.match(store.sms.filter(x => x.to === '0241239876').at(-1).message, new RegExp(code));
  assert.ok(store.sms.some(x => /MoMo\/card confirmed/.test(x.message)), 'the Manager is texted that it went through');
  const bar = await phone(390);
  await signInAs(bar, 'bar@dev');
  await bar.waitForURL(/bar\.html/); await bar.waitForSelector('.ord');
  // Bar staff make table QR cards themselves: "1-3" is three cards, each opening that table's menu.
  await bar.click('#barSet'); await bar.click('#qr'); await bar.fill('#qrmT', '1-3');
  await bar.waitForFunction(() => document.querySelectorAll('.qrm .qr-card svg').length === 3);
  assert.match(await bar.textContent('#qrmLink'), /counter\.html\?s=[0-9a-f]{32}&t=1$/);
  await bar.click('#qrmClose');
  await bar.fill('#find', code); await bar.locator('.ord.hit [data-go]').click();
  await bar.getByText('Handed over.').waitFor();
  await g.getByText(/collected/i).waitFor({ timeout: 15000 });
  assert.equal(docs('counter_orders').find(o => o.pickupCode === code).status, 'delivered');
  // After paying the guest goes on ordering; rating is a small optional link that leads back.
  await g.getByRole('link', { name: 'Rate us' }).click(); await g.waitForURL(/review\.html/);
  await g.getByRole('link', { name: /back to ordering/i }).click();
  await g.waitForSelector('#find');
  assert.deepEqual([...g.errors, ...bar.errors], []);
});

test('organiser A sees only their night and cannot open the control room; a no-role account is refused', async () => {
  const org = await phone(1280);
  await signInAs(org, 'orga@dev');
  await org.waitForURL(/organiser\.html/); await org.waitForLoadState('networkidle');
  const text = await org.textContent('main');
  assert.match(text, /Afrobeats/); assert.doesNotMatch(text, /Amapiano/);
  await org.goto(`${base}/admin.html`); await org.waitForURL(/organiser\.html/);
  const guest = await phone(1280);
  await signInAs(guest, 'guest@dev');
  await guest.getByText(/doesn’t have staff access/i).waitFor();
});

test('XSS payloads in admin-entered and guest-entered text render as text on public and staff pages', async () => {
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
  const ev = store.get('events', 'dev-dnd').fields;
  store.seed('events', 'dev-dnd', { ...ev, name: `DND ${payload}`, description: payload, ticketLines: [`LINE ${payload}`.slice(0, 48)] });
  store.seed('private_event_requests', 'xss', { eventType: 'Other', date: '2099-01-02', guests: 5, name: payload, phone: '0240000000', message: payload, status: 'NEW', createdAt: new Date().toISOString() });
  store.seed('tickets', 'xss0000000000000000000000000001', { customerName: `${payload} X`, eventId: 'dev-dnd', eventName: `DND ${payload}`, identityLine: payload, type: payload, status: 'valid', displayCode: 'MEM-XSS000' });
  const t = { id: 'xss0000000000000000000000000001' };
  const page = await phone(1280);
  for (const p of ['/', '/nights.html', '/event.html?id=dev-dnd', '/checkout.html?event=dev-dnd&type=dev-dnd-reg&qty=1', `/ticket.html?token=${t.id}`, `/verify.html?token=${t.id}`]) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => window.__xss), undefined, `payload executed on ${p}`);
  }
  await signInAs(page, 'admin@dev');
  await page.waitForURL(/admin\.html/); await page.waitForLoadState('networkidle');
  for (const h of ['requests', 'nights/dev-dnd', 'bookings']) { await page.goto(`${base}/admin.html#${h}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); if (h === 'requests') await page.locator('[data-open="xss"]').click(); assert.equal(await page.evaluate(() => window.__xss), undefined, `payload executed on admin ${h}`); }
});

test('promos: the control room starts an automatic promo and a code promo; guests see the promo price; the code (typed or from its link) lowers it; the order and the promo record it', async () => {
  const admin = await phone(390);
  await signInAs(admin, 'admin@dev');
  await admin.waitForURL(/admin\.html/); await openTab(admin, 'nights');
  await admin.evaluate(() => { location.hash = 'nights/dev-dnd'; });
  await admin.click('[data-sec-go="promos"]'); await admin.locator('#prAdd').click();
  await admin.fill('#prName', 'Early bird'); await admin.selectOption('#prKind', 'percent'); await admin.fill('#prPct', '20'); await admin.fill('#prLimit', '50');
  await admin.click('#prF button[type=submit]'); await admin.getByText('Started “Early bird”.').waitFor();
  await admin.locator('#prAdd').click();
  await admin.fill('#prName', 'Kojo’s fans'); await admin.selectOption('#prKind', 'amount'); await admin.fill('#prAmt', '30'); await admin.fill('#prCode', 'kojo30');
  await admin.click('#prF button[type=submit]'); await admin.getByText(/Started “Kojo’s fans”/).waitFor();
  assert.equal(await admin.locator('#promoBox tbody tr').count(), 2);

  const g = await phone(360);
  await g.goto(`${base}/event.html?id=dev-dnd`, { waitUntil: 'networkidle' });
  assert.match(await g.textContent('.event-info'), /Early bird/); assert.match(await g.textContent('.event-info'), /from GHS 80/);
  assert.ok(!(await g.content()).includes('KOJO30'), 'a promo code never appears on a public page');
  await g.goto(`${base}/tickets.html?event=dev-dnd`, { waitUntil: 'networkidle' });
  assert.match(await g.textContent('.promo-banner'), /20% off/);
  await g.click('[data-type="dev-dnd-reg"]');
  assert.match(await g.textContent('#barSum'), /GHS 80/);
  await g.click('#barGo'); await g.waitForURL(/checkout\.html/); await g.waitForSelector('#co');
  await g.locator('#sum').getByText('After the discount').waitFor();
  assert.match(await g.textContent('#sum'), /GHS 80/);
  await g.click('#codeBox summary'); await g.fill('#code', 'WRONG'); await g.click('#applyCode');
  await g.locator('#fCode .err').getByText(/isn’t valid/).waitFor();
  await g.fill('#code', 'kojo30'); await g.click('#applyCode');
  await g.locator('#sum').getByText('Kojo’s fans').waitFor();
  assert.match(await g.textContent('#sum'), /GHS 70/);
  assert.match(await g.textContent('#pay'), /Pay GHS 73\.5/);
  await g.fill('#phone', '024 555 3030'); await g.click('#pay');
  await g.waitForURL(/dev\/paystack/); await g.getByRole('button', { name: 'Pay' }).click();
  await g.waitForURL(/ticket\.html/, { timeout: 20000 });
  const order = docs('orders').find(o => o.buyerPhone === '0245553030');
  assert.equal(order.amountPesewas, 7000); assert.equal(order.promo.code, 'KOJO30'); assert.equal(order.promo.discountPesewas, 3000);
  // The ticket and the text say it was discounted, and by how much.
  await g.locator('.t-deal').getByText(/Paid GHS 70/).waitFor();
  assert.match(await g.textContent('.deal-note'), /You paid GHS 70 instead of GHS 100/);
  assert.match(store.sms.filter(x => x.to === '0245553030').at(-1).message, /you paid GHS 70, not GHS 100/);
  assert.equal(docs('promos').find(p => p.code === 'KOJO30').usedCount, 1);

  // An influencer's link carries the code all the way to checkout.
  const f = await phone(360);
  await f.goto(`${base}/tickets.html?event=dev-dnd&promo=kojo30`, { waitUntil: 'networkidle' });
  await f.getByText(/Promo code KOJO30 is applied at checkout/).waitFor();
  await f.click('[data-type="dev-dnd-reg"]'); await f.click('#barGo'); await f.waitForURL(/promo=KOJO30/);
  await f.locator('#sum').getByText('Kojo’s fans').waitFor();

  // The ticket picker with a promo is accessible and fits a small phone.
  const { readFileSync } = await import('node:fs');
  const small = await phone(320);
  await small.goto(`${base}/tickets.html?event=dev-dnd`, { waitUntil: 'networkidle' });
  assert.ok(await small.evaluate(() => document.documentElement.scrollWidth <= 320), 'no sideways scroll');
  await small.evaluate(readFileSync(new URL('../worker/node_modules/axe-core/axe.min.js', import.meta.url), 'utf8'));
  assert.deepEqual(await small.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], preload: false })).violations.map(v => v.id)), []);

  await openTab(admin, 'bookings');
  await admin.locator('#list').getByText('KOJO30').first().waitFor(); // the order shows its promo
  assert.deepEqual([...admin.errors, ...g.errors, ...f.errors, ...small.errors], []);
  // Switch the test promos off so later journeys see normal prices.
  for (const p of store.list('promos')) store.seed('promos', p.id, { ...p.fields, active: false });
});

test('staff sign-in: the Human manager adds a waitress; her PIN is texted and shown to them; she signs in with it straight away, stays signed in the next day, can change it; forgot PIN texts a new one', async () => {
  const mgr = await phone(390);
  await signInAs(mgr, 'hr@dev'); await mgr.waitForURL(/hr\.html/);
  await mgr.click('.bnav [data-k="staff"]'); await mgr.click('#addBtn'); await mgr.waitForSelector('#aRole');
  assert.equal(await mgr.$eval('#aRole', e => e.value), '', 'no job is pre-selected');
  assert.ok(!(await mgr.$$eval('#aRole option', os => os.map(o => o.value))).some(v => ['superAdmin', 'director', 'finance', 'manager', 'hrManager'].includes(v)), 'the Human manager adds the staff, not managers, directors or finance');
  await mgr.fill('#aName', 'Abena Waitress'); await mgr.fill('#aPhone', '024 777 1001'); await mgr.selectOption('#aRole', 'waitStaff'); await mgr.click('#aBtn');
  await mgr.locator('.pincards').getByText(/Texted to 024\*\*\*1001/).waitFor();
  const sms = store.sms.filter(x => x.to === '0247771001').at(-1).message;
  assert.match(sms, /Waiter \/ waitress/); const pin = /PIN: (\d{4})/.exec(sms)[1];
  assert.equal((await mgr.locator('.pincards .pinnum').first().textContent()).trim(), pin, 'the manager sees the same PIN');
  assert.equal(await mgr.locator('#aName').count(), 0, 'the add panel closes once they are added');
  await mgr.locator('[data-person]', { hasText: 'Abena Waitress' }).waitFor(); // she is on the list
  await mgr.click('#addBtn'); assert.equal(await mgr.$eval('#aName', e => e.value), '', 'the form is ready for the next person');

  // She signs in with the texted PIN: nothing to choose first.
  const w = await phone(360);
  await w.goto(`${base}/login.html`); await w.waitForSelector('#pinForm');
  assert.equal(await w.locator('#codeForm, #setForm').count(), 0, 'no extra code or choose-a-PIN screens');
  await w.fill('#phone', '0247771001'); await w.fill('#pin', '9999'); await w.click('#go');
  await w.locator('#msg').getByText(/don’t match/).waitFor();
  await w.fill('#pin', pin); await w.click('#go');
  await w.waitForURL(/waiter\.html/); await w.waitForSelector('#newTab');

  // Full-time staff: still signed in the next day (no morning sign-out).
  // (The old one-night rule read this marker; a sign-in from yesterday must still work today.)
  await w.evaluate(() => localStorage.setItem('mem-staff-signed-in', String(Date.now() - 30 * 3600e3)));
  await w.reload(); await w.waitForSelector('#newTab');
  assert.match(w.url(), /waiter\.html/);

  // Changing it is optional and simple.
  await w.click('#acctBtn'); await w.click('#changePin');
  await w.getByText('The PIN we texted you').waitFor();
  await w.fill('#cpOld', pin); await w.fill('#cpNew', '4826'); await w.fill('#cpNew2', '4826'); await w.click('.sheet button[type=submit]');
  await w.getByText(/Your PIN is changed/).waitFor();
  await w.click('#acctBtn'); await w.click('#signout'); await w.waitForURL(/login\.html/);
  await w.fill('#phone', '0247771001'); await w.fill('#pin', '4826'); await w.click('#go'); await w.waitForURL(/waiter\.html/);

  // Forgot it: "Text me one" sends a new PIN to the number typed in.
  await w.click('#acctBtn'); await w.click('#signout'); await w.waitForURL(/login\.html/);
  const before = store.sms.length;
  await w.fill('#phone', '0247771001'); await w.click('#sendPin');
  await w.locator('#msg').getByText(/new PIN is on its way/).waitFor();
  assert.equal(store.sms.length, before + 1);
  const fresh = /PIN: (\d{4})/.exec(store.sms.at(-1).message)[1];
  await w.fill('#pin', fresh); await w.click('#go'); await w.waitForURL(/waiter\.html/);
  assert.deepEqual([...mgr.errors, ...w.errors], []);
});

test('waiter: new tab → the bar → “I got them”; straight back to My tables; swap a drink; close tab → MoMo: a prompt and the invoice, closed once paid', async () => {
  const w = await phone(360); await signInAs(w, 'waiter@dev'); await w.waitForURL(/waiter\.html/);
  await w.click('#newTab'); await w.waitForURL(/#order$/);
  await w.fill('#odTable', '21'); await w.fill('#odPhone', '024 555 2121');
  // Typing stays while drinks are added.
  await w.click('[data-p="dev-m-beer"]'); await w.click('[data-p="dev-m-beer"]');
  assert.equal(await w.inputValue('#odPhone'), '024 555 2121');
  await w.click('#send');
  // Sent: back on My tables, free to start another tab or a quick sale.
  await w.waitForURL(/#tabs$/); await w.locator('#msg').getByText(/Sent to the bar: Tab \d+ · table 21/).waitFor();
  assert.ok(await w.isVisible('#newTab') && await w.isVisible('#quick'));
  assert.equal(store.sms.filter(x => x.to === '0245552121').length, 0, 'no invoice until the tab is closed');
  await w.locator('[data-tab]', { hasText: '21' }).first().click(); await w.waitForURL(/#tab\//);
  // The waiter grabs the drinks herself; the bar confirms.
  await w.locator('[data-act="took"]').click(); await w.locator('.tcard').getByText(/the bar must confirm/).waitFor();
  const bar = await phone(390); await signInAs(bar, 'bar@dev'); await bar.waitForURL(/bar\.html/);
  await bar.locator('#taken').getByText(/says they took Tab \d+ \(21\)/).waitFor({ timeout: 10000 });
  await bar.locator('#taken [data-a="confirm_taken"]').click();
  await bar.locator('#msgTop').getByText(/Confirmed/).waitFor();
  await w.locator('[data-act="delivered"]').waitFor({ timeout: 10000 }); await w.click('[data-act="delivered"]');
  // The customer wants a shot instead of one beer: one sheet returns it and opens the menu for the new drink.
  await w.locator('[data-act="return"]').waitFor(); await w.click('[data-act="return"]');
  await w.click('#plSwap'); await w.waitForURL(/#add\//);
  await w.locator('h1', { hasText: 'Swap' }).waitFor();
  await w.click('[data-p="dev-m-shot"]'); await w.click('#send'); await w.waitForURL(/#tabs$/);
  await bar.locator('[data-back]').first().waitFor({ timeout: 10000 }); await bar.locator('[data-back]').first().click();
  await bar.locator('#rounds .ord').filter({ hasText: '21' }).locator('[data-a="hand"]').click();
  await w.locator('[data-tab]', { hasText: '21' }).first().click(); await w.waitForURL(/#tab\//);
  await w.locator('[data-act="delivered"]').waitFor({ timeout: 10000 }); await w.click('[data-act="delivered"]');
  await w.locator('.lines-list').getByText('1 × Club beer').waitFor({ timeout: 10000 });
  // Close tab → MoMo: a prompt on their phone and the invoice by text; it closes itself once paid.
  await w.click('#close'); await w.click('#csMomo');
  await w.getByText(/approve on your phone/i).waitFor();
  const inv = store.sms.filter(x => x.to === '0245552121').at(-1).message;
  assert.match(inv, /MEMORIES INVOICE/); assert.match(inv, /1 x Club beer/); assert.match(inv, /bill\.html/);
  await w.locator('.sheet').getByText('Tab closed').waitFor({ timeout: 20000 });
  const tabId = await w.evaluate(() => location.hash.split('/')[1]);
  const tab = docs('tabs').find(t => t.id === tabId);
  assert.equal(tab.status, 'closed'); assert.deepEqual(tab.payments.map(p => p.method), ['digital']);
  await w.click('#csBack'); await w.waitForSelector('#newTab'); assert.match(w.url(), /#tabs$/);
  assert.deepEqual([...w.errors, ...bar.errors], []);
});

test('stock, money and quick sales: finance buys drinks (in stock at once), the manager adds stock the bar confirms, the bar’s count is explained by the manager, an expense, the director’s money; the bar sells for cash; a waiter’s quick sale closes itself', async () => {
  const fin = await phone(390); await signInAs(fin, 'finance@dev'); await fin.waitForURL(/finance\.html/);
  await fin.click('[data-k="stock"]'); await fin.click('#rcv');
  await fin.selectOption('#rvP', 'dev-m-stout'); await fin.fill('#rvQ', '12'); await fin.fill('#rvC', '300'); await fin.fill('#rvS', 'Guinness Ghana'); await fin.click('#rvGo');
  await fin.locator('#stMsg').getByText(/in the bar’s stock/).waitFor();
  assert.equal(docs('stock_moves').filter(m => m.purchase && m.productId === 'dev-m-stout' && m.qty === 12).length, 1, 'a purchase is stock at once');
  // During the party the manager adds stock: the bar confirms it.
  const mgr = await phone(390); await signInAs(mgr, 'manager@dev'); await mgr.waitForURL(/night\.html/);
  await mgr.goto(`${base}/night.html#stock`); await mgr.click('#rcv');
  await mgr.selectOption('#rvP', 'dev-m-water'); await mgr.fill('#rvQ', '6'); await mgr.click('#rvGo');
  await mgr.locator('#app').getByText('Waiting for the bar to confirm').waitFor();
  const bar = await phone(390); await signInAs(bar, 'bar@dev'); await bar.waitForURL(/bar\.html/);
  await bar.click('[data-k="stock"]'); await bar.locator('#vStock').getByText('New stock to confirm').waitFor();
  await bar.click('#vStock [data-dl]'); await bar.locator('#msgTop').getByText(/Confirmed/).waitFor();
  // The bar counts the stock it met: one beer short. Sales aren't held up; the manager explains.
  await bar.click('#openCount'); await bar.waitForSelector('#vStock #cf');
  for (const row of await bar.locator('#vStock [data-p]').all()) {
    const want = await row.evaluate(el => el.dataset.p);
    const sheet = docs('stock_moves').filter(m => m.productId === want && m.stationId === 'dev-main-bar').reduce((n, m) => n + m.qty, 0);
    await row.locator('[data-n]').fill(String(want === 'dev-m-beer' ? sheet - 1 : sheet));
  }
  bar.once('dialog', d => d.accept()); await bar.click('#cfGo'); await bar.locator('#msgTop').getByText(/1 difference\. The manager will explain/).waitFor();
  await mgr.goto(`${base}/night.html#tonight`); await mgr.locator('[data-explain]').click();
  await mgr.fill('#xpWhy', 'One given to the DJ on Thursday'); await mgr.click('#xpGo'); await mgr.locator('#msg').getByText(/Explanation saved/).waitFor();
  await mgr.click('#addExp'); await mgr.selectOption('#exCat', 'dj'); await mgr.fill('#exDesc', 'DJ Kofi'); await mgr.fill('#exAmt', '200'); await mgr.click('#exGo');
  await mgr.locator('#msg').getByText(/waits for a director/).waitFor(); // no expense limit set yet
  // The director: just the money.
  const dir = await phone(390); await signInAs(dir, 'director@dev'); await dir.waitForURL(/night\.html/);
  await dir.click('[data-k="money"]'); await dir.locator('.pos-money').getByText('Money out').waitFor();
  assert.match(await dir.textContent('#app'), /DJ Kofi/); assert.match(await dir.textContent('#app'), /Drinks bought/);
  // The bar sells over the counter, for cash; a finished drink can't be picked.
  await bar.click('[data-k="sell"]'); await bar.waitForSelector('#vSell [data-p="dev-m-beer"]');
  assert.equal(await bar.locator('#vSell [data-p="dev-m-flute"]').count(), 0);
  await bar.click('#vSell [data-p="dev-m-beer"]'); await bar.click('#vSell #send'); await bar.click('#psGo');
  await bar.locator('#msgTop').getByText(/Cash GHS 25 recorded/).waitFor();
  assert.ok(docs('tabs').some(t => t.soldAtBar && t.status === 'closed' && t.payments[0].method === 'cash'));
  await bar.click('[data-k="shift"]'); await bar.locator('#vShift').getByRole('heading', { name: 'Hand all my cash to the Manager' }).waitFor();
  // A waiter's quick sale, by MoMo: the bar hands it over, the waiter taps "I got them", it closes.
  const w = await phone(360); await signInAs(w, 'waiter2@dev'); await w.waitForURL(/waiter\.html/);
  await w.click('#quick'); await w.waitForURL(/#quick/); await w.click('[data-p="dev-m-shot"]'); await w.click('#send');
  await w.click('[data-pm="momo"]'); await w.fill('#psRef', '8812345678'); await w.click('#psGo');
  await w.waitForURL(/#tabs/); await w.locator('#msg').getByText(/MoMo GHS 30 recorded/).waitFor();
  await bar.click('[data-k="orders"]');
  await bar.locator('#rounds .ord').filter({ hasText: 'Quick sale' }).locator('[data-a="hand"]').click();
  await w.locator('.tcard').filter({ hasText: 'Quick sale' }).first().click();
  await w.locator('[data-act="delivered"]').waitFor({ timeout: 10000 }); await w.click('[data-act="delivered"]');
  await w.locator('.say').getByText('Closed').waitFor({ timeout: 10000 });
  // Finance adds a bill due this month; the director sees what's still to pay.
  await fin.goto(`${base}/finance.html#budget`); await fin.click('#bAdd');
  await fin.fill('#blP', 'Staff salaries'); await fin.selectOption('#blC', 'staff'); await fin.fill('#blA', '8000'); await fin.click('#blGo');
  await fin.locator('#app').getByText('Staff salaries').waitFor();
  await dir.goto(`${base}/night.html#money`); await dir.locator('a[href="#budget"]').click();
  await dir.locator('#app').getByText('Staff salaries').waitFor();
  assert.equal(await dir.locator('#bAdd').count(), 0, 'the director looks; finance sets');
  assert.doesNotMatch(await dir.textContent('#app'), /Ticket/);
  await dir.goto(`${base}/night.html#money`); await dir.locator('a[href="#commissions"]').click();
  await dir.locator('#app').getByText('Who is owed').waitFor();
  assert.match(await dir.textContent('#app'), /10% of every table deal over GHS 3,000/);
  // The manager taps a payment: what was bought, who served, how it was paid.
  await mgr.goto(`${base}/night.html#payments`); await mgr.locator('[data-pay]').first().click();
  await mgr.locator('.sheet').getByText('Served by').waitFor(); await mgr.locator('.sheet').getByText('How it was paid').waitFor();
  await mgr.click('.sheet [data-close]'); await mgr.click('[data-tabv="customers"]'); await mgr.locator('#app').getByText('Top customers tonight').waitFor();
  // A guest searches the QR menu with a spelling mistake.
  const g = await phone(360); await g.goto(`${base}/counter.html?s=0123456789abcdef0123456789abcdef`); await g.waitForSelector('#find');
  await g.fill('#find', 'tequlia'); await g.locator('#menuList').getByText('Tequila shot').waitFor();
  assert.equal(await g.locator('#menuList .drink').count(), 1);
  await g.fill('#find', ''); assert.ok(await g.locator('#menuList .drink').count() > 3, 'clearing shows the whole menu');
  assert.deepEqual([...fin.errors, ...mgr.errors, ...dir.errors, ...bar.errors, ...w.errors, ...g.errors], []);
});

test('finance fixes stock: a purchase entered twice is deleted (kept, marked deleted), and the number of a drink is set by hand', async () => {
  const fin = await phone(390); await signInAs(fin, 'finance@dev'); await fin.waitForURL(/finance\.html/);
  await fin.click('[data-k="stock"]');
  for (let i = 0; i < 2; i++) {
    await fin.click('#rcv'); await fin.selectOption('#rvP', 'dev-m-water'); await fin.fill('#rvQ', '7'); await fin.fill('#rvC', '70'); await fin.fill('#rvS', 'Voltic'); await fin.click('#rvGo');
    await fin.locator('#stMsg').getByText(/in the bar’s stock/).waitFor();
  }
  const twice = docs('stock_deliveries').filter(d => d.productId === 'dev-m-water' && d.qty === 7 && d.supplier === 'Voltic');
  assert.equal(twice.length, 2);
  await fin.locator('summary', { hasText: 'New stock, last 7 days' }).click();
  await fin.locator(`[data-fix="${twice[1].id}"]`).click();
  await fin.click('#fxDel'); await fin.locator('#fxM').getByText(/Say why/).waitFor();
  await fin.fill('#fxR', 'entered twice'); await fin.click('#fxDel');
  await fin.locator('#stMsg').getByText(/Deleted\. The bar’s stock is put right/).waitFor();
  const gone = docs('stock_deliveries').find(d => d.id === twice[1].id);
  assert.deepEqual([gone.status, gone.removeReason], ['removed', 'entered twice'], 'kept, marked deleted');
  assert.ok(docs('stock_moves').some(m => m.kind === 'correction' && m.deliveryId === twice[1].id && m.qty === -7), 'the bar’s stock is corrected');
  await fin.locator('summary', { hasText: 'New stock, last 7 days' }).click();
  await fin.locator('#app, body').getByText(/Deleted by Esi|Deleted by/).first().waitFor();
  // Set the number of water in the bar by hand.
  await fin.locator('[data-sk="dev-m-water"]').click(); await fin.click('#skSet');
  await fin.fill('#slQ', '3'); await fin.fill('#slR', 'recounted the store'); await fin.click('#slGo');
  await fin.locator('#stMsg').getByText(/is now 3/).waitFor();
  await fin.locator('[data-sk="dev-m-water"]').getByText('3', { exact: true }).waitFor();
  assert.deepEqual(fin.errors, []);
});

test('service charge & commission: a director sees the capped charge, records a commission and runs the simulation; the night’s finances open for the director and finance', async () => {
  const dir = await phone(390); await signInAs(dir, 'director@dev'); await dir.waitForURL(/night\.html/);
  await dir.goto(`${base}/night.html#charges`); await dir.locator('#app').getByText('On: 5% of the bill, at most GHS 100').waitFor();
  await dir.check('#cmOn'); await dir.fill('#cmPct', '0'); await dir.click('#cmSave');
  await dir.locator('#cmMsg').getByText(/Enter the agreed commission/).waitFor();
  await dir.fill('#cmPct', '2'); await dir.click('#cmSave'); await dir.locator('#cmMsg').getByText(/Saved/).waitFor();
  assert.equal(store.get('settings', 'commercial').fields.commission.percent, 2);
  await dir.fill('#simBill', '200'); await dir.fill('#feeEst', '2'); await dir.click('#simGo');
  await dir.locator('#simOut table').first().waitFor();
  assert.match(await dir.textContent('#simOut'), /GHS 10,100/, 'a GHS 10,000 bill: the customer pays GHS 10,100');
  // Back off again so later tests aren't affected.
  await dir.uncheck('#cmOn'); await dir.click('#cmSave'); await dir.locator('#cmMsg').getByText(/Saved/).waitFor();
  assert.equal(store.get('settings', 'commercial').fields.commission.enabled, false);
  await dir.goto(`${base}/night.html#finance`); await dir.locator('#app .ln.total', { hasText: 'Net product sales' }).waitFor();
  await dir.locator('#app').getByText('Paystack should settle').waitFor();
  await dir.selectOption('#fnCh', 'cash'); await dir.locator('#fnCh').evaluate(el => el.value === 'cash');
  await dir.locator('#app .ln.total', { hasText: 'Net product sales' }).waitFor();
  const fin = await phone(390); await signInAs(fin, 'finance@dev'); await fin.waitForURL(/finance\.html/);
  await fin.goto(`${base}/finance.html#charges`); await fin.locator('#app').getByText('Only a director or the admin can change these', { exact: false }).waitFor();
  assert.equal(await fin.locator('#cmSave').count(), 0, 'finance can look, not change');
  await fin.goto(`${base}/finance.html#finance`); await fin.locator('#app').getByText('C. Transactions', { exact: false }).waitFor();
  assert.deepEqual([...dir.errors, ...fin.errors], []);
});

test('people: the Human manager sets the DJ’s pay and a bonus and sends the month; a director approves; finance pays; the DJ sees the payslip, a notice and a team message', async () => {
  const hr = await phone(390); await signInAs(hr, 'hr@dev'); await hr.waitForURL(/hr\.html/);
  // One line per person: tap the DJ, then their salary and payment details.
  await hr.click('.bnav [data-k="pay"]'); await hr.click('[data-person="uid-dj"]');
  await hr.click('.sheet [data-set="uid-dj"]'); await hr.fill('#sdS', '1500'); await hr.fill('#sdN', '024 455 5666'); await hr.fill('#sdNm', 'Dev DJ'); await hr.click('#sdGo');
  await hr.locator('#app').getByText(/MoMo 024\*\*\*5666/).first().waitFor();
  await hr.click('#pBonus'); await hr.selectOption('#piU', 'uid-dj'); await hr.fill('#piA', '200'); await hr.fill('#piR', 'Packed Saturday'); await hr.click('#piGo');
  await hr.locator('#app').getByText('GHS 1,700').first().waitFor();
  hr.once('dialog', d => d.accept()); await hr.click('#pSend');
  await hr.locator('#app').getByText(/Waiting for a director/i).first().waitFor();
  // Notices from the Human manager.
  await hr.goto(`${base}/me.html#notices`); await hr.locator('summary', { hasText: 'Post a notice' }).click();
  await hr.fill('#nT', 'Staff meeting Friday 6pm'); await hr.click('#nGo'); await hr.locator('.tcard').getByText('Staff meeting Friday 6pm').waitFor();
  // Either director approves.
  const d2 = await phone(390); await signInAs(d2, 'director2@dev'); await d2.waitForURL(/night\.html/);
  await d2.click('.bnav [data-k="approve"]'); await d2.locator('.tcard', { hasText: 'Salaries for' }).locator('[data-yes]').click();
  await d2.locator('#taMsg').getByText(/Approved/).waitFor();
  await d2.goto(`${base}/night.html#money`); await d2.locator('#app').getByText(/Your share \(65%\)/).waitFor();
  // Finance pays; the DJ is texted and sees the payslip.
  const fin = await phone(390); await signInAs(fin, 'finance@dev'); await fin.waitForURL(/finance\.html/);
  await fin.click('.bnav [data-k="pay"]'); await fin.locator('a[href="#salaries"]').click();
  await fin.click('#pPayAll'); await fin.click('#ppGo'); await fin.locator('#app').getByText('Paid').first().waitFor();
  assert.match(store.sms.filter(x => x.to === '0200000016').at(-1).message, /Your pay for .*GHS 1,700/s);
  const dj = await phone(360); await signInAs(dj, 'dj@dev'); await dj.waitForURL(/me\.html/);
  await dj.locator('.tcard').getByText('Staff meeting Friday 6pm').waitFor();
  await dj.click('.bnav [data-k="pay"]'); await dj.locator('summary', { hasText: /GHS 1,700/ }).waitFor();
  await dj.click('.bnav [data-k="messages"]'); await dj.waitForSelector('#mT');
  await dj.fill('#mT', 'Who has the aux cable?'); await dj.click('#mGo'); await dj.locator('.tcard').getByText('Who has the aux cable?').waitFor();
  // The Manager can't close tonight: hands it over; the Human manager takes it; a director can only look.
  const mg = await phone(390); await signInAs(mg, 'manager@dev'); await mg.waitForURL(/night\.html/);
  await mg.goto(`${base}/night.html#close`); await mg.waitForSelector('#clHand');
  // The reason is typed in the app's own writing panel (a quick reply is one tap), not a browser pop-up.
  await mg.click('#clHand'); await mg.locator('.sheet .chip', { hasText: 'Family emergency' }).click(); await mg.click('#askGo');
  await mg.locator('#clMsg').getByText(/Handed over/).waitFor();
  await hr.goto(`${base}/hr.html#close`); await hr.click('#clAccept'); await hr.locator('#clMsg').getByText('You’re closing tonight.').waitFor();
  await d2.goto(`${base}/night.html#tonight`); await d2.locator('#toClose', { hasText: 'How closing is going' }).click();
  await d2.locator('#app').getByText(/Dev Human Manager is closing instead/).waitFor();
  assert.equal(await d2.locator('#closeGo').count(), 0, 'no close button for a director');
  assert.deepEqual([...hr.errors, ...d2.errors, ...fin.errors, ...dj.errors, ...mg.errors], []);
});

test('tips: a waiter’s MoMo quick sale carries a tip for the DJ; the bar records a cash tip; a QR guest adds a tip; finance pays the DJ’s tips; the DJ sees them', async () => {
  const w = await phone(360); await signInAs(w, 'waiter2@dev'); await w.waitForURL(/waiter\.html/);
  await w.click('#quick'); await w.waitForURL(/#quick/); await w.click('[data-p="dev-m-shot"]'); await w.click('#send');
  await w.click('[data-pm="momo"]'); await w.fill('#psRef', '7712345601');
  await w.locator('summary', { hasText: 'Customer gave a tip' }).click();
  await w.waitForSelector('#tipTo option[value="uid-dj"]', { state: 'attached' });
  await w.fill('#tipAmt', '20'); await w.selectOption('#tipTo', 'uid-dj'); await w.click('#psGo');
  await w.waitForURL(/#tabs/); await w.locator('#msg').getByText(/MoMo GHS 30 recorded\. Tip GHS 20 for Dev/).waitFor();
  const tip = docs('tips').find(t => t.momoRef === '7712345601');
  assert.deepEqual([tip.toUid, tip.amountPesewas, tip.status], ['uid-dj', 2000, 'owed']);
  assert.ok(docs('tabs').some(t => t.payments?.[0]?.momoRef === '7712345601' && t.payments[0].amountPesewas === 3000), 'the sale is the drinks only');
  // The bar: a cash tip without a bill, kept by the bartender.
  const bar = await phone(390); await signInAs(bar, 'bar@dev'); await bar.waitForURL(/bar\.html/);
  await bar.click('[data-k="shift"]'); await bar.click('#vShift #tipOnly');
  await bar.waitForSelector('.sheet #tipTo option[value]:not([value=""])', { state: 'attached' });
  await bar.fill('.sheet #tipAmt', '15'); await bar.click('#tsGo');
  await bar.locator('#msgTop').getByText(/Tip GHS 15 recorded/).waitFor();
  // The waiter's quick sale is finished as usual: the bar hands it over, the waiter got them.
  await bar.click('[data-k="orders"]');
  await bar.locator('#rounds .ord').filter({ hasText: 'Quick sale' }).locator('[data-a="hand"]').click();
  await w.locator('.tcard').filter({ hasText: 'Quick sale' }).first().click();
  await w.locator('[data-act="delivered"]').waitFor({ timeout: 10000 }); await w.click('[data-act="delivered"]');
  await w.locator('.say').getByText('Closed').waitFor({ timeout: 10000 });
  // A QR guest adds a tip: the pay button shows drinks + tip.
  const g = await phone(360); await g.goto(`${base}/counter.html?s=0123456789abcdef0123456789abcdef`); await g.waitForSelector('#find');
  await g.locator('[data-p]').first().click(); await g.click('#dockBtn');
  await g.click('[data-tip="1000"]'); await g.waitForSelector('#tipWho:not([hidden])');
  assert.ok((await g.locator('#tipTo option').allTextContents()).every(t => !/Director/.test(t)), 'no directors to tip');
  assert.match(await g.locator('#orderTotals').textContent(), /Tip\s*GHS 10/);
  assert.match(await g.textContent('#pay'), /Pay GHS 36\.25/);
  // Finance pays the DJ's tips; the DJ sees them paid.
  const fin = await phone(390); await signInAs(fin, 'finance@dev'); await fin.waitForURL(/finance\.html/);
  await fin.click('.bnav [data-k="pay"]'); await fin.locator('a[href="#tips"]').click();
  await fin.locator('#app').getByText('Tips owed to staff').first().waitFor();
  await fin.locator('.ln', { hasText: 'Dev DJ' }).locator('[data-payt]').click();
  await fin.fill('#ptRef', 'MM-TIP-1'); await fin.click('#ptGo'); await fin.locator('#tMsg').getByText(/They’ve been texted/).waitFor();
  assert.match(store.sms.filter(x => x.to === '0200000016').at(-1).message, /your tips are paid: GHS 20/);
  const dj = await phone(360); await signInAs(dj, 'dj@dev'); await dj.waitForURL(/me\.html/);
  await dj.click('.bnav [data-k="pay"]'); await dj.locator('h2', { hasText: 'My tips' }).waitFor();
  assert.match(await dj.textContent('#app'), /Paid to me\s*GHS 20/);
  assert.deepEqual([...w.errors, ...bar.errors, ...g.errors, ...fin.errors, ...dj.errors], []);
});

test('sign-in: an email typed in the phone box goes to the email form', async () => {
  const p = await phone(360);
  await p.goto(`${base}/login.html`); await p.waitForSelector('#pinForm');
  await p.fill('#phone', 'manager@dev'); await p.fill('#pin', '1234'); await p.click('#go');
  await p.locator('#f:not([hidden])').waitFor();
  assert.equal(await p.$eval('#email', e => e.value), 'manager@dev');
  await p.fill('#pw', 'memories-dev'); await p.click('#goEmail'); await p.waitForURL(/night\.html/);
  assert.deepEqual(p.errors, []);
});

test('roles: Media runs the nights in the control room; the manager adds an expense and sees the nights; finance sees each waiter', async () => {
  const media = await phone(390); await signInAs(media, 'media@dev'); await media.waitForURL(/admin\.html/);
  await media.locator('[data-group="nights"][aria-selected="true"]').waitFor();
  assert.equal(await media.locator('[data-group]', { hasText: 'Money' }).count(), 0, 'no money for Media');
  assert.equal(await media.evaluate(() => [...document.querySelectorAll('[data-tab]')].some(b => /settings|system|counter/.test(b.dataset.tab))), false, 'no site settings, system or bar setup');
  const mgr = await phone(390); await signInAs(mgr, 'manager@dev'); await mgr.waitForURL(/night\.html/);
  await mgr.click('.bnav [data-k="more"]'); await mgr.click('[data-more="expenses"]');
  await mgr.locator('h1', { hasText: 'Expenses' }).waitFor();
  await mgr.click('#exAdd'); await mgr.selectOption('#exCat', 'supplies'); await mgr.fill('#exDesc', 'Ice for the bar'); await mgr.fill('#exAmt', '40'); await mgr.click('#exGo');
  await mgr.locator('.tcard', { hasText: 'Ice for the bar' }).waitFor();
  await mgr.click('.bnav [data-k="more"]'); await mgr.click('[data-more="nights"]');
  await mgr.locator('h1', { hasText: 'Nights coming up' }).waitFor();
  assert.ok(await mgr.locator('.tcard').count() >= 1, 'the dev night is listed');
  const fin = await phone(390); await signInAs(fin, 'finance@dev'); await fin.waitForURL(/finance\.html/);
  await fin.click('.bnav [data-k="reports"]'); await fin.click('[data-goto="waiters"]');
  await fin.locator('h1', { hasText: 'Waiters' }).waitFor();
  assert.deepEqual([...media.errors, ...mgr.errors, ...fin.errors], []);
});

test('bar manager and front office: the night’s accounts; find a table order by its code; tickets sold tonight', async () => {
  const bm = await phone(390); await signInAs(bm, 'barmgr@dev'); await bm.waitForURL(/bar\.html/);
  await bm.click('.bnav [data-k="accounts"]');
  await bm.locator('#vAccounts h1', { hasText: 'Night accounts' }).waitFor();
  assert.match(await bm.textContent('#vAccounts'), /The drinks should bring/);
  assert.match(await bm.textContent('#vAccounts'), /Each person who sold tonight/);
  await bm.click('.bnav [data-k="waiters"]'); await bm.locator('#vWaiters').getByText(/Cash from waiters and bartenders/).waitFor();
  // A table booked online that nobody could find: the front office finds it by its code.
  const today = new Date().toISOString();
  const ev = docs('events').find(e => e.active !== false) || { id: 'dev-dnd' };
  store.seed('orders', 'zq7tab0001', { eventId: ev.id, kind: 'table', packageName: 'Gold table', amountPesewas: 250000, status: 'confirmed', buyerName: 'Nana Find', buyerPhone: '0277001122', bottles: [{ name: 'Moët', quantity: 1 }], createdAt: today });
  const fo = await phone(390); await signInAs(fo, 'door@dev'); await fo.waitForURL(/checkin\.html/);
  await fo.evaluate(() => { location.hash = 'find'; }); await fo.waitForSelector('#foQ');
  await fo.fill('#foQ', 'TBL-ZQ7TAB'); await fo.click('#foForm button');
  await fo.locator('#foOut .tcard', { hasText: 'Nana Find' }).waitFor();
  assert.match(await fo.textContent('#foOut'), /Gold table/); assert.match(await fo.textContent('#foOut'), /1 × Moët/);
  await fo.evaluate(() => { location.hash = 'tickets'; }); await fo.locator('#vTickets h1', { hasText: 'Tickets' }).waitFor();
  const mgr = await phone(390); await signInAs(mgr, 'manager@dev'); await mgr.waitForURL(/night\.html/);
  await mgr.click('.bnav [data-k="more"]'); await mgr.click('[data-more="tickets"]');
  await mgr.locator('h1', { hasText: 'Tickets' }).waitFor();
  assert.match(await mgr.textContent('#app'), /Tickets sold/);
  await mgr.click('.bnav [data-k="more"]'); await mgr.click('[data-more="accounts"]');
  await mgr.locator('h1', { hasText: 'Night accounts' }).waitFor();
  assert.deepEqual([...bm.errors, ...fo.errors, ...mgr.errors], []);
});

test('a night at the bar: tab without QR → bar → delivered → the customer pays on their phone → another round paid in cash at the cashier → reports, counts, the close and finance’s report', async () => {
  // Waiter
  const w = await phone(360); await signInAs(w, 'waiter@dev'); await w.waitForURL(/waiter\.html/);
  await w.click('#newTab'); await w.waitForURL(/#order$/); await w.fill('#odTable', '12');
  await w.click('[data-p="dev-m-beer"]'); await w.click('[data-p="dev-m-beer"]'); await w.click('[data-p="dev-m-shot"]');
  assert.match(await w.textContent('#send'), /3 drinks · GHS 80/); await w.click('#send');
  await w.waitForURL(/#tabs$/); await w.locator('[data-tab]', { hasText: '12' }).first().click();
  await w.waitForURL(/#tab\//); await w.locator('.tcard').getByText('Sent to bar').waitFor();
  // Bar
  const bar = await phone(390); await signInAs(bar, 'bar@dev'); await bar.waitForURL(/bar\.html/);
  await bar.locator('#rounds .ord').filter({ hasText: '12' }).locator('[data-a="hand"]').click();
  await bar.locator('#msgTop').getByText(/Handed over/).waitFor();
  // Waiter delivers; the customer gets the bill
  await w.locator('[data-act="delivered"]').waitFor({ timeout: 10000 }); await w.click('[data-act="delivered"]');
  await w.locator('.tcard').getByText('Delivered').waitFor();
  await w.click('details.fold summary'); await w.click('#showBill'); await w.locator('#sbQr svg').waitFor();
  const tabId = await w.evaluate(() => location.hash.split('/')[1]);
  const token = docs('tabs').find(t => t.id === tabId).billToken;
  await w.click('[data-close]');
  const cust = await phone(360);
  await cust.goto(`${base}/bill.html?t=${token}`, { waitUntil: 'networkidle' });
  assert.match(await cust.textContent('#root'), /2 × Club beer/); assert.match(await cust.textContent('#pay'), /GHS 84/); assert.match(await cust.textContent('#root'), /service charge \(5%, capped at GHS 100\): GHS 4/, 'the bill page says why it is GHS 84');
  await cust.click('#pay'); await cust.waitForURL(/dev\/paystack/); await cust.getByRole('button', { name: 'Pay' }).click();
  await cust.waitForURL(/bill\.html/); await cust.getByText('Payment confirmed. Thank you!').waitFor({ timeout: 20000 });
  // Paid, but staying: the table stays open and they can order more from the bar menu.
  await cust.getByText(/your table stays open/i).waitFor();
  assert.match(await cust.getAttribute('a:has-text("Order more drinks")', 'href'), /^counter\.html\?s=[0-9a-f]{32}&t=12$/);
  await w.locator('.st').getByText('Paid', { exact: true }).waitFor({ timeout: 10000 });
  // Another round, paid in cash at the cashier
  await w.click('#add'); await w.waitForURL(/#add\//); await w.click('[data-p="dev-m-water"]'); await w.click('#send'); await w.waitForURL(/#tabs$/);
  await w.locator('[data-tab]', { hasText: '12' }).first().click(); await w.waitForURL(/#tab\//);
  await bar.locator('#rounds .ord').filter({ hasText: '12' }).locator('[data-a="hand"]').click();
  await w.locator('[data-act="delivered"]').waitFor({ timeout: 10000 }); await w.click('[data-act="delivered"]');
  const cash = await phone(390); await signInAs(cash, 'cashier@dev'); await cash.waitForURL(/cashier\.html/);
  await cash.click('[data-k="cash"]'); await cash.fill('#fl', '100'); await cash.click('#openGo'); await cash.waitForSelector('#cnt');
  await cash.click('[data-k="bills"]'); await cash.fill('#q', '12'); await cash.locator('[data-id]').first().click();
  await cash.click('#cGo'); await cash.getByText('Cash recorded').waitFor();
  await cash.click('[data-close]');
  // Paid at the cashier: Close tab just closes it.
  // Close tab right from My tables.
  await w.locator('.pay-now').getByText(/paid/).waitFor({ timeout: 10000 }); await w.click('.back-btn'); await w.waitForSelector('#newTab');
  await w.locator('.tcard', { hasText: '12' }).locator('[data-pay]').click(); await w.click('#csDone');
  await w.locator('.sheet').getByText('Tab closed').waitFor(); await w.click('#csBack'); await w.waitForSelector('#newTab');
  await w.locator('.tcard.done', { hasText: '12' }).first().waitFor({ state: 'attached' });
  // Poor signal: an action that can't reach the server never shows as done.
  await w.click('#newTab'); await w.waitForSelector('#odTable'); await w.fill('#odTable', '14'); await w.click('[data-p="dev-m-water"]');
  await w.context().setOffline(true);
  await w.click('#send');
  await w.locator('#pkMsg').getByText(/CONNECTION/i).waitFor();
  assert.ok(!docs('tabs').some(t => t.table === '14'), 'nothing recorded without a connection');
  await w.context().setOffline(false); await w.click('[data-back]'); await w.waitForURL(/#tabs/);
  // The bar opens any waiter's tables: what it gave them, per table, and what's unpaid.
  await bar.click('[data-k="waiters"]');
  await bar.locator('#vWaiters [data-w]', { hasText: 'Dev Waiter' }).first().click();
  await bar.locator('.sheet').getByText(/table 12/).waitFor();
  await bar.locator('.sheet').getByText(/2 ×/).first().waitFor();
  await bar.click('.sheet [data-close]'); await bar.click('[data-k="orders"]');
  // End of night: waiter report, bar count, cash count, front office, the close, finance.
  // The waiter's report is their tabs: nothing to submit.
  await w.click('[data-k="report"]'); await w.getByText('All my tabs are closed').waitFor();
  await bar.click('[data-k="stock"]'); await bar.click('#closeCount'); await bar.waitForSelector('#vStock #cf');
  for (const row of await bar.locator('#vStock [data-p]').all()) await row.locator('[data-n]').fill('0');
  const reasons = bar.locator('#vStock [data-r]:not([hidden])');
  for (let i = 0; i < await reasons.count(); i++) await reasons.nth(i).selectOption('unknown');
  bar.once('dialog', d => d.accept()); await bar.click('#cfGo'); await bar.getByText(/Count submitted with \d+ differences/).waitFor();
  await cash.click('[data-k="cash"]'); await cash.fill('#cnt', '108'); await cash.locator('#whyBox').waitFor();
  await cash.fill('#why', 'gave GHS 2 too much change'); cash.once('dialog', d => d.accept()); await cash.click('#cntGo');
  await cash.getByText(/GHS 2 less than expected/).waitFor();
  const fo = await phone(390); await signInAs(fo, 'door@dev'); await fo.waitForURL(/checkin\.html/);
  await fo.goto(`${base}/checkin.html#report`); await fo.waitForSelector('#frGo'); await fo.click('#frGo'); await fo.getByText(/Submitted by/).waitFor();
  // The manager's screen: tonight's money, the tables, and Close the night. Nothing technical.
  const mgr = await phone(390); await signInAs(mgr, 'manager@dev'); await mgr.waitForURL(/night\.html/);
  // Tonight: the money received big, with what was sold and what's still owed under it.
  await mgr.locator('.hero').getByText('Received tonight').waitFor();
  assert.match(await mgr.textContent('#app'), /Sold/); assert.match(await mgr.textContent('#app'), /Still owed/);
  assert.equal(await mgr.locator('.bnav button').count(), 4, 'four buttons, nothing else');
  assert.equal(await mgr.locator('text=Site settings').count(), 0);
  await mgr.goto(`${base}/admin.html`); await mgr.waitForFunction(() => location.hash === '#members'); // only members and attendance there
  assert.equal(await mgr.locator('text=Site settings').count(), 0); await mgr.goto(`${base}/night.html`);
  await mgr.locator('#toClose').click(); await mgr.waitForSelector('#closeGo');
  assert.match(await mgr.textContent('#app'), /2 less than expected/);
  mgr.on('dialog', d => d.accept());
  await mgr.click('#closeGo'); await mgr.getByText(/Night closed/).waitFor({ timeout: 15000 });
  // Closing is for the accounts: the waiter keeps working after it.
  await w.click('[data-k="tabs"]'); await w.click('#newTab'); await w.waitForSelector('#odTable'); await w.fill('#odTable', '30'); await w.click('[data-p="dev-m-water"]'); await w.click('#send');
  await w.locator('#msg').getByText(/Sent to the bar: Tab \d+ · table 30/).waitFor();
  const fin = await phone(390); await signInAs(fin, 'finance@dev'); await fin.waitForURL(/finance\.html/);
  await fin.click('[data-k="reports"]'); await fin.locator('[data-d]').first().click();
  await fin.getByText(/End of day/).waitFor(); assert.match(await fin.textContent('#app'), /GHS 2 less than expected/);
  await fin.click('#soGo'); await fin.getByText(/Signed off by Dev Finance/).waitFor();
  assert.deepEqual([...w.errors, ...bar.errors, ...cust.errors, ...cash.errors, ...fo.errors, ...mgr.errors, ...fin.errors], []);
});

test('every public page renders at 320px with no sideways scroll and no script errors', async () => {
  for (const p of ['/', '/nights.html', '/event.html?id=dev-afro', '/checkout.html?event=dev-afro&type=dev-afro-reg&qty=2', '/tables.html?event=dev-afro', '/private.html', '/installment.html', '/find.html', '/member.html', '/counter.html?s=0123456789abcdef0123456789abcdef', '/offline.html', '/visit.html', '/login.html']) {
    const page = await phone(320);
    await page.goto(base + p, { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `overflow on ${p}`);
    assert.deepEqual(page.errors, [], `errors on ${p}`);
    await page.context().close();
  }
});

test('the gate: the front office sells for cash and by a MoMo prompt; security checks the number (paid, who sold it); the organiser sees the counts and reports someone not in the system', async () => {
  const door = await phone();
  await signInAs(door, 'door@dev'); await door.waitForURL(/checkin\.html/); await door.waitForLoadState('networkidle');
  await door.goto(`${base}/checkin.html?event=dev-tonight#sell`);
  // Cash: two Regular tickets, their number is the ticket.
  await door.locator('#vSell [data-tt="dev-tonight-reg"]').click();
  await door.click('#sPlus'); await door.fill('#sPhone', '024 555 7777'); await door.fill('#sName', 'Kwame Gate');
  await door.getByRole('button', { name: /took ghs 200 cash/i }).click();
  await door.getByText(/paid · admit 2/i).waitFor();
  const cashOrder = docs('orders').find(o => o.channel === 'gate' && o.buyerPhone === '0245557777');
  assert.equal(cashOrder.paidWith, 'cash'); assert.equal(cashOrder.soldBy, 'uid-door'); assert.equal(cashOrder.amountPesewas, 20000);
  assert.ok(cashOrder.ticketIds.every(t => store.get('tickets', t).fields.status === 'used'), 'gate tickets count as in');
  await door.getByRole('button', { name: 'Next sale' }).click();
  await door.locator('#vSell .hero', { hasText: 'Cash with you' }).getByText('GHS 200').waitFor();
  // MoMo: a prompt on the customer's phone; the sale records once they approve.
  await door.locator('#vSell [data-tt="dev-tonight-reg"]').click();
  await door.fill('#sPhone', '024 555 8888');
  await door.getByRole('button', { name: /momo prompt/i }).click();
  await door.getByText(/approve on your phone/i).waitFor();
  await door.getByText(/paid · admit 1/i).waitFor({ timeout: 20000 });
  assert.equal(docs('orders').find(o => o.channel === 'gate' && o.buyerPhone === '0245558888').paidWith, 'momo');
  assert.deepEqual(door.errors, []);

  // Security checks the cash buyer's number.
  const sec = await phone();
  await signInAs(sec, 'security@dev'); await sec.waitForURL(/checkin\.html/); await sec.waitForLoadState('networkidle');
  await sec.goto(`${base}/checkin.html?event=dev-tonight`);
  await sec.locator('#ckPhone').waitFor();
  await sec.fill('#ckPhone', '0245557777'); await sec.click('#ckForm button[type=submit]');
  await sec.locator('#ckOut .result.ok').getByRole('heading', { name: 'PAID' }).waitFor();
  await sec.locator('#ckOut').getByText(/GHS 200 for 2 cash/).first().waitFor();
  await sec.locator('#ckOut').getByText(/cash at the gate, sold by dev/i).first().waitFor();
  assert.deepEqual(sec.errors, []);

  // The organiser: counts for their night, and a number that isn't in the system is reported.
  const org = await phone();
  await signInAs(org, 'orga@dev'); await org.waitForURL(u => !/login\.html/.test(u.pathname)); await org.waitForLoadState('networkidle');
  await org.goto(`${base}/checkin.html?event=dev-tonight#counts`);
  await org.locator('#vCounts .hero', { hasText: 'Gate cash' }).getByText('GHS 200').waitFor();
  await org.goto(`${base}/checkin.html?event=dev-tonight#check`);
  await org.fill('#ckPhone', '0245550000'); await org.click('#ckForm button[type=submit]');
  await org.getByRole('heading', { name: 'NOT IN THE SYSTEM' }).waitFor();
  await org.click('#ckReport'); await org.locator('#askGo').click();
  await org.locator('#ckOut').getByText('Reported.').waitFor();
  assert.ok(docs('incidents').some(i => i.needsManager && /not in the system/i.test(i.note)));
  assert.deepEqual(org.errors, []);
});

test('trial nights: the admin sees what would go, ticks a practice debt, and clears; official nights stay', async () => {
  const tab = (tid, f) => { store.seed('tabs', tid, { number: 90, waiterUid: 'uid-waiter', waiterName: 'Dev Waiter', status: 'open', payments: [], discounts: [], ...f }); store.seed('rounds', `r_${tid}`, { tabId: tid, waiterUid: f.waiterUid || 'uid-waiter', status: 'delivered', lines: [] }); };
  tab('e2eTrialOpen', { businessDate: '2026-10-18' });
  tab('e2eTrialMgr', { businessDate: '2026-10-18', waiterUid: 'uid-manager', waiterName: 'Dev Manager' });
  tab('e2eTrialDebt', { businessDate: '2026-10-18', number: 91, status: 'owed', debt: { name: 'Practice Ama', amountPesewas: 2500 } });
  tab('e2eTrialRealDebt', { businessDate: '2026-10-19', number: 92, status: 'owed', debt: { name: 'Real Yaw', amountPesewas: 6000 } });
  tab('e2eOfficial', { businessDate: '2026-10-24' });
  const admin = await phone(390);
  await signInAs(admin, 'admin@dev'); await admin.waitForURL(/admin\.html/);
  await openTab(admin, 'system');
  await admin.click('#trialCheck');
  await admin.locator('#trialBox tr', { hasText: 'Practice Ama' }).waitFor();
  assert.ok(await admin.locator('#trialBox tr', { hasText: 'Real Yaw' }).count(), 'every practice debt is listed to decide on');
  await admin.locator('#trialBox tr', { hasText: 'Practice Ama' }).locator('input[type=checkbox]').check();
  const dialog = new Promise(res => admin.once('dialog', d => { res(d.message()); d.accept(); }));
  await admin.click('#trialGo');
  assert.match(await dialog, /1 of them unpaid/);
  await admin.locator('#trialBox').getByText(/Cleared \d+ trial tab/).waitFor();
  const left = new Set(docs('tabs').map(t => t.id));
  for (const gone of ['e2eTrialOpen', 'e2eTrialMgr', 'e2eTrialDebt']) assert.ok(!left.has(gone), `${gone} is cleared`);
  for (const kept of ['e2eTrialRealDebt', 'e2eOfficial']) assert.ok(left.has(kept), `${kept} is kept`);
  const w = await admin.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 390, `the System tab is ${w}px wide on a 390px phone`);
  assert.deepEqual(admin.errors, []);
});

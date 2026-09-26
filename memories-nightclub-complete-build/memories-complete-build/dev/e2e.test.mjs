// End-to-end journeys in a real browser (Chromium via Playwright) against the real Worker code,
// served by dev/server.mjs with in-memory Firestore and a fake Paystack.
//   node --test dev/e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
process.env.PORT ||= '8799';
const { store } = await import('./server.mjs');
const { chromium } = await import('../worker/node_modules/playwright/index.mjs');
const base = `http://localhost:${process.env.PORT}`;
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' }); });
after(async () => { await browser.close(); setTimeout(() => process.exit(0), 50); });

async function phone(width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
  // Fonts come from Google in production; offline they fall back, which is fine for behaviour tests.
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('console', m => /Content Security Policy/i.test(m.text()) && page.errors.push(m.text()));
  return page;
}
const docs = col => store.list(col).map(d => ({ id: d.id, ...d.fields }));
async function buyTicket(page, { name, line, event = 'dev-afro', type }) {
  await page.goto(`${base}/event.html?id=${event}`, { waitUntil: 'networkidle' });
  if (type) await page.click(`[data-type="${type}"]`);
  await page.click('#barGo');
  if (line.own) await page.fill('#ownLine', line.own); else await page.getByRole('radio', { name: line }).click();
  await page.click('#toWho');
  await page.fill('#name', name); await page.fill('#phone', '024 555 1234');
  await page.click('#s1 button[type=submit]');
  await page.click('#pay');
  await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
  await page.waitForURL(/ticket\.html/, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('#postImg')?.src?.startsWith('blob:'), null, { timeout: 15000 });
  return new URL(page.url()).searchParams.get('token');
}

test('homepage "Get tickets" opens a real night and a guest can pay, get a ticket and a share image', async () => {
  const page = await phone();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#next').getByRole('link', { name: /get tickets/i }).click();
  await page.waitForURL(/event\.html\?id=/);
  assert.match(await page.textContent('h1'), /\w/);
  const token = await buyTicket(page, { name: 'Kwame Asante', line: 'SAMPLE LINE THREE.' });
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(await page.textContent('[data-line]'), 'SAMPLE LINE THREE.');
  assert.equal(await page.textContent('[data-name]'), 'Kwame');
  assert.ok(await page.locator('.t-qr svg').count(), 'QR rendered');
  const t = store.get('tickets', token).fields;
  assert.equal(t.identityLine, 'SAMPLE LINE THREE.');
  assert.deepEqual(page.errors, []);
});

test('the line comes first, as "What should others know?", and a guest can write their own', async () => {
  const page = await phone();
  await page.goto(`${base}/checkout.html?event=dev-afro&type=dev-afro-reg&qty=1`, { waitUntil: 'networkidle' });
  assert.equal(await page.isVisible('#s2'), true, 'line step shows first');
  assert.equal(await page.isVisible('#s1'), false);
  assert.match(await page.textContent('#s2 h1'), /What should others know\?/);
  assert.equal(await page.isDisabled('#toWho'), true, 'needs a line first');
  const token = await buyTicket(page, { name: 'Esi Mensah', line: { own: 'birthday girl in the building' } });
  assert.equal(store.get('tickets', token).fields.identityLine, 'birthday girl in the building');
  assert.match(await page.textContent('[data-line]'), /birthday girl in the building/i);
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
  await page.getByRole('radio', { name: 'SAMPLE LINE FOUR.' }).click(); await page.click('#toWho');
  await page.fill('#name', 'Yaw Boateng'); await page.fill('#phone', '0241112222'); await page.click('#s1 button[type=submit]');
  await page.getByRole('radio', { name: /pay in bits/i }).click(); await page.fill('#dep', '30'); await page.click('#pay');
  await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
  await page.getByText(/to go/i).waitFor({ timeout: 20000 });
  const plan = docs('installment_plans').find(p => p.buyerName === 'Yaw Boateng');
  assert.equal(plan.status, 'active'); assert.equal(plan.paidPesewas, 3000);
  assert.equal(docs('tickets').filter(t => t.planId === plan.id).length, 0, 'no ticket yet');
  assert.equal(store.get('raffles', 'evt_dev-afro').fields.spotsTaken, spotsBefore, 'no draw spot yet');
  assert.ok(store.sms.some(s => s.to === '0241112222' && s.message.includes(plan.id) && /Balance/.test(s.message)), 'balance text with order code');
  await page.getByRole('link', { name: /pay more now/i }).click();
  await page.getByRole('button', { name: /all of it/i }).click(); await page.click('form[data-plan] button[type=submit]');
  await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
  await page.waitForURL(/ticket\.html/, { timeout: 20000 });
  assert.equal(store.get('installment_plans', plan.id).fields.status, 'completed');
  assert.equal(docs('tickets').filter(t => t.planId === plan.id).length, 1);
  assert.equal(await page.textContent('[data-line]'), 'SAMPLE LINE FOUR.', 'the line picked at the start is printed at the end');
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
  await admin.goto(`${base}/login.html`); await admin.fill('#email', 'manager@dev'); await admin.fill('#pw', 'memories-dev'); await admin.click('#go');
  await admin.waitForURL(/admin\.html/); await admin.click('[data-tab=requests]');
  await admin.locator(`[data-open="${req.id}"]`).click();
  admin.once('dialog', d => d.accept());
  await admin.locator(`[data-set="ACCEPTED"][data-id="${req.id}"]`).click();
  await admin.waitForTimeout(600);
  assert.equal(store.get('private_event_requests', req.id).fields.status, 'ACCEPTED');
  await page.goto(`${base}/nights.html`, { waitUntil: 'networkidle' });
  const row = page.locator('.cal li').filter({ has: page.locator('.held') });
  assert.ok(await row.count() >= 1, 'a held date is on the calendar');
});

test('admin changes a flyer and a price; the public page shows it with no deploy', async () => {
  const admin = await phone(1280);
  await admin.goto(`${base}/login.html`); await admin.fill('#email', 'admin@dev'); await admin.fill('#pw', 'memories-dev'); await admin.click('#go');
  await admin.waitForURL(/admin\.html/); await admin.goto(`${base}/admin.html#nights/dev-piano`); await admin.waitForLoadState('networkidle');
  await admin.setInputFiles('#artFile', new URL('./fixtures/dnd-party-poster.jpeg', import.meta.url).pathname);
  await admin.getByText(/uploaded/i).waitFor();
  await admin.click('#save'); await admin.getByText(/saved/i).waitFor();
  const row = admin.locator('tr[data-row="dev-piano-reg"]');
  await row.locator('[data-k=price]').fill('125'); await row.locator('[data-save]').click(); await admin.waitForTimeout(700);
  const guest = await phone();
  await guest.goto(`${base}/event.html?id=dev-piano`, { waitUntil: 'networkidle' });
  assert.match(await guest.locator('.event-art img').getAttribute('src'), /\/dev\/uploads\//);
  assert.match(await guest.textContent('[data-type="dev-piano-reg"]'), /GHS 125/);
});

test('door: valid → ENTRY CONFIRMED, second scan → ALREADY CHECKED IN, junk → NOT VALID', async () => {
  const token = docs('tickets').find(t => t.status === 'valid' && t.eventId === 'dev-afro').id;
  const door = await phone();
  await door.goto(`${base}/login.html`); await door.fill('#email', 'door@dev'); await door.fill('#pw', 'memories-dev'); await door.click('#go');
  await door.waitForURL(/checkin\.html/); await door.waitForLoadState('networkidle');
  await door.selectOption('#ev', 'dev-afro');
  await door.fill('#code', `${base}/verify.html?token=${token}`); await door.click('#manual button');
  await door.getByText(/entry confirmed/i).waitFor();
  await door.fill('#code', token); await door.click('#manual button');
  await door.getByText(/already checked in/i).waitFor();
  await door.fill('#code', 'deadbeef'); await door.click('#manual button');
  await door.getByText(/ticket not valid/i).waitFor();
  assert.equal(docs('checkins').filter(c => c.ticketId === token).length, 1);
});

test('organiser A sees only their night and cannot open the control room; a no-role account is refused', async () => {
  const org = await phone(1280);
  await org.goto(`${base}/login.html`); await org.fill('#email', 'orga@dev'); await org.fill('#pw', 'memories-dev'); await org.click('#go');
  await org.waitForURL(/organiser\.html/); await org.waitForLoadState('networkidle');
  const text = await org.textContent('main');
  assert.match(text, /Afrobeats/); assert.doesNotMatch(text, /Amapiano/);
  await org.goto(`${base}/admin.html`); await org.waitForURL(/organiser\.html/);
  const guest = await phone(1280);
  await guest.goto(`${base}/login.html`); await guest.fill('#email', 'guest@dev'); await guest.fill('#pw', 'memories-dev'); await guest.click('#go');
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
  await page.goto(`${base}/login.html`); await page.fill('#email', 'admin@dev'); await page.fill('#pw', 'memories-dev'); await page.click('#go');
  await page.waitForURL(/admin\.html/); await page.waitForLoadState('networkidle');
  for (const h of ['requests', 'nights/dev-dnd', 'bookings']) { await page.goto(`${base}/admin.html#${h}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); if (h === 'requests') await page.locator('[data-open="xss"]').click(); assert.equal(await page.evaluate(() => window.__xss), undefined, `payload executed on admin ${h}`); }
});

test('every public page renders at 320px with no sideways scroll and no script errors', async () => {
  for (const p of ['/', '/nights.html', '/event.html?id=dev-afro', '/checkout.html?event=dev-afro&type=dev-afro-reg&qty=2', '/tables.html?event=dev-afro', '/private.html', '/installment.html', '/visit.html', '/login.html']) {
    const page = await phone(320);
    await page.goto(base + p, { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `overflow on ${p}`);
    assert.deepEqual(page.errors, [], `errors on ${p}`);
    await page.context().close();
  }
});

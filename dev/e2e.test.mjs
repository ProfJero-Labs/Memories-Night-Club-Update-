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
// Wait for a server-side effect instead of a fixed sleep (fails with a clear message after 10s).
async function until(check, what) { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`timed out waiting for ${what}`); }
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

test('remembered buyer details can be cleared from the phone', async () => {
  const page = await phone();
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => localStorage.setItem('mem-buyer', JSON.stringify({ name: 'Kwame Asante', phone: '0245551234', email: 'k@example.com' })));
  await page.goto(`${base}/checkout.html?event=dev-afro&type=dev-afro-reg&qty=1`, { waitUntil: 'networkidle' });
  await page.getByRole('radio').first().click(); await page.click('#toWho');
  assert.equal(await page.inputValue('#name'), 'Kwame Asante');
  await page.getByRole('button', { name: /not you\? clear saved details/i }).click();
  assert.equal(await page.inputValue('#name'), ''); assert.equal(await page.inputValue('#phone'), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('mem-buyer')), null);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('radio').first().click(); await page.click('#toWho');
  assert.equal(await page.inputValue('#name'), '', 'stays cleared');
  assert.equal(await page.getByRole('button', { name: /clear saved details/i }).count(), 0);
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
  assert.equal(await page.isVisible('#ack'), false, 'no tick box for paying in full');
  await page.getByRole('radio', { name: /pay in bits/i }).click(); await page.fill('#dep', '30');
  assert.equal(await page.isChecked('#ack'), false, 'unticked by default');
  await page.click('#pay'); await page.getByText(/tick the box/i).waitFor();
  assert.ok(!/paystack/.test(page.url()), 'no payment without the tick');
  await page.check('#ack'); await page.click('#pay');
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

test('pay-the-rest lookup of a paid order shows no ticket link; "text me the link" is neutral and texts only the right phone', async () => {
  const plan = docs('installment_plans').find(p => p.buyerName === 'Yaw Boateng' && p.status === 'completed');
  assert.match(plan.id, /^MEM-[0-9A-Z]{5}-[0-9A-Z]{5}$/, 'new-format order code');
  const page = await phone();
  await page.goto(`${base}/installment.html?code=${plan.id.toLowerCase()}`, { waitUntil: 'networkidle' });
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
  await admin.goto(`${base}/login.html`); await admin.fill('#email', 'manager@dev'); await admin.fill('#pw', 'memories-dev'); await admin.click('#go');
  await admin.waitForURL(/admin\.html/); await admin.click('[data-tab=requests]');
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
  await admin.goto(`${base}/login.html`); await admin.fill('#email', 'admin@dev'); await admin.fill('#pw', 'memories-dev'); await admin.click('#go');
  await admin.waitForURL(/admin\.html/); await admin.goto(`${base}/admin.html#nights/dev-piano`); await admin.waitForLoadState('networkidle');
  await admin.setInputFiles('#artFile', new URL('./fixtures/dnd-party-poster.jpeg', import.meta.url).pathname);
  await admin.getByText(/uploaded/i).waitFor();
  await admin.click('#save'); await admin.getByText(/saved/i).waitFor();
  const row = admin.locator('tr[data-row="dev-piano-reg"]');
  await row.locator('[data-k=price]').fill('125'); await row.locator('[data-save]').click();
  await until(() => store.get('ticket_types', 'dev-piano-reg').fields.pricePesewas === 12500, 'the new price to be saved');
  await until(() => /\/dev\/uploads\//.test(store.get('events', 'dev-piano').fields.artwork || ''), 'the flyer to be saved');
  const guest = await phone();
  await guest.goto(`${base}/event.html?id=dev-piano`, { waitUntil: 'networkidle' });
  assert.match(await guest.locator('.event-art img').getAttribute('src'), /\/dev\/uploads\//);
  assert.match(await guest.textContent('[data-type="dev-piano-reg"]'), /GHS 125/);
});

test('control room: an unsaved flyer is not lost when a ticket row is saved; a private night says it is not public', async () => {
  const admin = await phone(1280);
  await admin.goto(`${base}/login.html`); await admin.fill('#email', 'admin@dev'); await admin.fill('#pw', 'memories-dev'); await admin.click('#go');
  await admin.waitForURL(/admin\.html/); await admin.goto(`${base}/admin.html#nights/dev-afro`); await admin.waitForLoadState('networkidle');
  await admin.setInputFiles('#artFile', new URL('./fixtures/dnd-party-poster.jpeg', import.meta.url).pathname);
  await admin.getByText(/uploaded/i).waitFor();
  assert.match(await admin.textContent('#saveState'), /unsaved/i, 'flyer upload marks the night unsaved');
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
  assert.match(await guest.textContent('[data-type="dev-afro-reg"]'), /GHS 99/);

  await admin.uncheck('#evPublic'); await admin.click('#save');
  await admin.getByText(/NOT on the public site/).waitFor();
  await until(() => store.get('events', 'dev-afro').fields.visibility === 'private', 'the night to be saved private');
  await admin.check('#evPublic'); await admin.click('#save');
  await admin.getByText(/live on the public site/i).waitFor();
  await until(() => store.get('events', 'dev-afro').fields.visibility === 'public', 'the night to be public again');
});

test('control room: refunds owed are listed and can be marked refunded with a note', async () => {
  store.seed('pending_checkouts', 'e2e-refund', { kind: 'ticket', eventName: 'Afrobeats Friday', buyerName: 'Refund Me', buyerPhone: '0247778888', amountPesewas: 15000, status: 'failed', error: 'sold_out_after_payment', refundStatus: 'manual_required', createdAt: new Date().toISOString() });
  const admin = await phone(1280);
  await admin.goto(`${base}/login.html`); await admin.fill('#email', 'manager@dev'); await admin.fill('#pw', 'memories-dev'); await admin.click('#go');
  await admin.waitForURL(/admin\.html/); await admin.click('[data-tab=refunds]');
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

test('door: no any-night mode; valid → ENTRY CONFIRMED, again → ALREADY CHECKED IN, junk refused; headcount from server; search admits', async () => {
  const valid = docs('tickets').filter(t => t.status === 'valid' && t.eventId === 'dev-afro');
  const token = valid[0].id;
  const door = await phone();
  await door.goto(`${base}/login.html`); await door.fill('#email', 'door@dev'); await door.fill('#pw', 'memories-dev'); await door.click('#go');
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

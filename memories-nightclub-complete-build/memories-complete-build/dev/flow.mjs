// Drives a real journey in the browser and screenshots each step.
// node dev/flow.mjs <name> [width]   — flows defined below
import { chromium } from '../worker/node_modules/playwright/index.mjs';
const [name = 'ticket', w = '390'] = process.argv.slice(2);
const out = process.env.OUT || '/tmp/claude-0/shots';
const base = `http://localhost:${process.env.PORT || 8787}`;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy });
const ctx = await browser.newContext({ viewport: { width: +w, height: +w < 700 ? 844 : 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on('response', r => r.status() === 404 && console.log('404:', r.url()));
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
let n = 0;
const shot = async (label, full = false) => { await page.waitForTimeout(350); const f = `${out}/flow-${name}-${w}-${String(++n).padStart(2, '0')}-${label}.png`; await page.screenshot({ path: f, fullPage: full }); console.log(f); };
const flows = {
  async ticket() {
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: /get tickets/i }).first().click();
    await page.waitForLoadState('networkidle'); await shot('event');
    await page.locator('#barGo:visible, #inlineGo:visible').first().click();
    await page.waitForLoadState('networkidle'); await shot('step1');
    await page.getByRole('radio', { name: /OUTSIDE, CORRECT/ }).click(); await shot('step1-picked');
    await page.click('#toWho'); await shot('step2');
    await page.fill('#name', 'Kwame Asante'); await page.fill('#phone', '024 555 1234');
    await shot('step2-filled');
    await page.click('#s1 button[type=submit]'); await shot('step3', true);
    await page.click('#pay'); await page.waitForLoadState('networkidle'); await shot('paystack');
    await page.getByRole('button', { name: 'Pay' }).click();
    await page.waitForURL(/payment-return/); await page.waitForTimeout(1500); await shot('return', true);
    await page.waitForURL(/ticket\.html/, { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle'); await shot('ticket', true);
  },
  async table() {
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: /^tables$/i }).first().click(); await page.waitForLoadState('networkidle'); await shot('nights');
    await page.getByRole('radio').first().click(); await page.waitForLoadState('networkidle'); await shot('tiers');
    await page.getByRole('radio', { name: /floor table/i }).click(); await shot('tier-picked');
    await page.click('[data-next]'); await shot('bar');
    await page.click('[data-inc="dev-b1"]'); await page.click('[data-inc="dev-b1"]'); await page.click('[data-inc="dev-b4"]'); await shot('bar-picked', true);
    await page.click('[data-next]'); await page.fill('#name', 'Efua Mensah'); await page.fill('#phone', '0551234567'); await shot('review', true);
    await page.click('#pay'); await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
    await page.waitForURL(/payment-return/); await page.getByText(/your table is set/i).waitFor({ timeout: 20000 }); await shot('confirmed', true);
  },
  async private() {
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Birthday' }).click(); await page.waitForLoadState('networkidle'); await shot('when');
    await page.locator('[data-date]:not([disabled])').nth(1).click(); await page.fill('#guests', '35'); await shot('when-picked');
    await page.click('#next'); await page.fill('#name', 'Akosua Darko'); await page.fill('#phone', '0209998888'); await page.fill('#ig', 'akosua'); await shot('contact');
    await page.click('#send'); await page.getByText(/got it/i).waitFor(); await shot('done');
  },
  async bits() {
    await page.goto(`${base}/checkout.html?event=dev-piano&type=dev-piano-reg&qty=1`, { waitUntil: 'networkidle' });
    await page.getByRole('radio', { name: /FULLY ACTIVE/ }).click(); await page.click('#toWho');
    await page.fill('#name', 'Yaw Boateng'); await page.fill('#phone', '0241112222'); await page.click('#s1 button[type=submit]');
    await page.getByRole('radio', { name: /pay in bits/i }).click(); await page.fill('#dep', '40'); await shot('bits', true);
    await page.click('#pay'); await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
    await page.waitForURL(/payment-return/); await page.getByText(/to go/i).waitFor({ timeout: 20000 }); await shot('partial', true);
    await page.getByRole('link', { name: /pay more now/i }).click(); await page.waitForLoadState('networkidle'); await shot('installment', true);
    await page.getByRole('button', { name: /all of it/i }).click(); await page.click('form[data-plan] button[type=submit]');
    await page.waitForURL(/dev\/paystack/); await page.getByRole('button', { name: 'Pay' }).click();
    await page.waitForURL(/ticket\.html/, { timeout: 20000 }); await page.waitForLoadState('networkidle'); await shot('ticket', true);
    const st = await (await fetch(`${base}/dev/state`)).json(); console.log('SMS:', JSON.stringify(st.sms.slice(-3)));
  },
  async admin() {
    const login = async (email) => { await page.goto(`${base}/login.html`); await page.fill('#email', email); await page.fill('#pw', 'memories-dev'); await page.click('#go'); await page.waitForLoadState('networkidle'); };
    await login('admin@dev'); await shot('overview', true);
    await page.click('[data-tab=nights]'); await page.waitForLoadState('networkidle'); await shot('nights');
    await page.locator('[data-edit="dev-afro"]').click(); await page.waitForLoadState('networkidle');
    await page.setInputFiles('#artFile', new URL('./fixtures/dnd-party-poster.jpeg', import.meta.url).pathname);
    await page.getByText(/uploaded/i).waitFor();
    await page.fill('#evName', 'Afrobeats Friday (Edited)');
    await page.click('#save'); await page.getByText(/saved/i).waitFor(); await shot('night-editor', true);
    const reg = page.locator('tr[data-row="dev-afro-reg"]'); await reg.locator('[data-k=price]').fill('150'); await reg.locator('[data-save]').click(); await page.waitForTimeout(800);
    const pub = await (await fetch(`${base}/api/events/dev-afro`)).json();
    console.log('PUBLIC AFTER EDIT:', pub.event.name, '|', pub.event.artwork.includes('/dev/uploads/') ? 'new flyer' : 'OLD FLYER', '|', pub.ticketTypes.find(t => t.id === 'dev-afro-reg').pricePesewas);
    await page.click('[data-tab=requests]'); await page.waitForLoadState('networkidle'); await page.locator('[data-open]').first().click(); await shot('requests', true);
    page.once('dialog', d => d.accept()); await page.locator('[data-set="ACCEPTED"]').first().click(); await page.waitForTimeout(800); await shot('requests-accepted');
    await page.click('[data-tab=settings]'); await page.waitForLoadState('networkidle'); await shot('settings', true);
    await page.click('[data-tab=bookings]'); await page.waitForLoadState('networkidle'); await shot('bookings', true);
    await page.click('[data-tab=staff]'); await page.waitForLoadState('networkidle'); await shot('staff', true);
    await page.goto(`${base}/nights.html`, { waitUntil: 'networkidle' }); await shot('public-nights', true);
  },
  async door() {
    await page.goto(`${base}/login.html`); await page.fill('#email', 'door@dev'); await page.fill('#pw', 'memories-dev'); await page.click('#go'); await page.waitForURL(/checkin/); await page.waitForLoadState('networkidle');
    const st = await (await fetch(`${base}/dev/state`)).json();
    const tok = Object.entries(st.docs).find(([k, v]) => k.startsWith('tickets/') && v.status === 'valid' && v.eventId === 'dev-afro')?.[0]?.split('/')[1];
    if (!tok) throw new Error('no ticket to scan: run the ticket flow first');
    await page.selectOption('#ev', 'dev-afro');
    await page.fill('#code', `${base}/verify.html?token=${tok}`); await page.click('#manual button'); await page.getByText(/entry confirmed/i).waitFor(); await shot('confirmed');
    await page.fill('#code', tok); await page.click('#manual button'); await page.getByText(/already checked in/i).waitFor(); await shot('again');
    await page.fill('#code', 'nonsense-token'); await page.click('#manual button'); await page.getByText(/not valid/i).waitFor(); await shot('invalid');
  },
  async organiser() {
    await page.goto(`${base}/login.html`); await page.fill('#email', 'orga@dev'); await page.fill('#pw', 'memories-dev'); await page.click('#go'); await page.waitForURL(/organiser/); await page.waitForLoadState('networkidle'); await shot('mine', true);
    const txt = await page.textContent('main'); console.log('ORGANISER A SEES B NIGHT?', /Amapiano/i.test(txt) ? 'YES (BAD)' : 'no');
    await page.goto(`${base}/admin.html`); await page.waitForURL(/organiser/); console.log('ORGANISER A → admin.html redirected to', new URL(page.url()).pathname);
  },
};
try { await flows[name](); } catch (e) { console.error('FLOW FAILED:', e.message); await shot('failure', true); }
if (errs.length) console.log('PAGE ERRORS:', errs.join(' | '));
await browser.close();

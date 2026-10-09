// Security signals and the control room's System panel (docs/MONITORING.md, "Security alerts").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker, { reconcilePayments } from '../src/index.js';

const secTexts = store => store.sms.filter(s => /MEMORIES SECURITY/.test(s.message));

test('a forged Paystack notice alerts the team once an hour, carries no detail, and issues nothing', async () => {
  const { store, env } = createMockEnv();
  env.ALERT_PHONES = '0240000001';
  const forge = () => worker.fetch(new Request('https://api.test/api/paystack/webhook', { method: 'POST', headers: { 'x-paystack-signature': 'f'.repeat(128), 'CF-Connecting-IP': '10.9.9.9' }, body: JSON.stringify({ event: 'charge.success', data: { reference: 'MEM-1-AAAA' } }) }), env);
  for (let i = 0; i < 3; i++) assert.equal(await (await forge()).text(), 'ignored');
  assert.equal(secTexts(store).length, 1, 'one text, not one per forgery');
  assert.match(secTexts(store)[0].message, /bad signature/);
  assert.ok(!/10\.9\.9\.9|MEM-1/.test(secTexts(store)[0].message), 'no IP or reference in the text');
  assert.equal(store.list('tickets').length, 0);
});

test('a run of refused staff requests from one address alerts; a few do not', async () => {
  const { store, env } = createMockEnv();
  env.ALERT_PHONES = '0240000001';
  const probe = ip => worker.fetch(new Request('https://api.test/api/admin/orders', { headers: { Authorization: 'Bearer not-a-token', 'CF-Connecting-IP': ip } }), env);
  for (let i = 0; i < 5; i++) assert.equal((await probe('10.1.1.1')).status, 401);
  assert.equal(secTexts(store).length, 0, 'a few failed sign-ins are normal');
  for (let i = 0; i < 10; i++) await probe('10.2.2.2');
  for (let i = 0; i < 15; i++) await probe('10.3.3.3');
  assert.equal(secTexts(store).length, 1);
  assert.match(secTexts(store)[0].message, /15 refused staff requests/);
});

test('System panel: the last payment check and recent alerts, managers only; a stale check is flagged', async () => {
  const { store, env } = createMockEnv();
  env.ALERT_PHONES = '0240000001';
  store.paystackTransactions = [{ reference: 'MEM-1700000000000-NOREC', amount: 5000 }];
  await reconcilePayments(env);
  const get = async claims => { const r = await worker.fetch(new Request('https://api.test/api/admin/system', { headers: { Authorization: `Bearer ${await idToken(claims)}` } }), env); return { status: r.status, data: await r.json() }; };
  assert.equal((await get({ role: 'doorStaff' })).status, 403);
  const { data } = await get({ role: 'manager' });
  assert.equal(data.reconcile.ok, true); assert.equal(data.reconcile.stale, false);
  assert.equal(data.alerts.length, 1); assert.match(data.alerts[0].text, /ACTION NEEDED/);
  assert.equal(data.configured.alertPhones, true); assert.equal(data.configured.sentry, false);
  store.seed('system', 'reconcile', { ...store.get('system', 'reconcile').fields, at: new Date(Date.now() - 45 * 60_000).toISOString() });
  assert.equal((await get({ role: 'manager' })).data.reconcile.stale, true, 'the check stopped running');
});

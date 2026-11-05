// The club's GhQR (MTN MoMo scan-to-pay) code with each bill's amount in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, ghqrValid, ghqrFor, parseTlv } from '../../public/lib/ghqr.js';
import { DEFAULT_ROUTES, cleanRoutes } from '../src/lib/routes.js';

const CLUB = '00020101021132790018GH.NET.GHIPSS.GHQR01163346159950641821020601000003030010416E20761029T1547075204581453039365802GH5919MEMORIES NIGHT CLUB6010Cape Coast610800000001622203083346159907063346156304CD28';

test('the club’s real code checks out (our checksum maths matches MTN’s)', () => {
  assert.equal(crc16(CLUB.slice(0, -4)), 'CD28');
  assert.ok(ghqrValid(CLUB));
  assert.equal(DEFAULT_ROUTES.bigWalletQr, CLUB, 'built in by default');
});

test('a bill’s code: the amount added, marked one-time, everything about who is paid untouched', () => {
  const d = ghqrFor(CLUB, 310000);
  assert.ok(ghqrValid(d), 'a whole, correctly sealed code');
  const t = Object.fromEntries(parseTlv(d)), c = Object.fromEntries(parseTlv(CLUB));
  assert.deepEqual([t['54'], t['01'], c['01']], ['3100.00', '12', '11']);
  for (const k of ['32', '52', '53', '58', '59', '60', '61', '62']) assert.equal(t[k], c[k], `tag ${k} unchanged`);
  assert.equal(parseTlv(d).at(-1)[0], '63', 'the checksum is last');
  assert.equal(Object.fromEntries(parseTlv(ghqrFor(CLUB, 150050)))['54'], '1500.50');
  assert.deepEqual(parseTlv(ghqrFor(d, 5000)).filter(([k]) => k === '54'), [['54', '50.00']], 'a code that already has an amount gets the new one only');
});

test('no code made from nonsense, a changed code or an impossible amount', () => {
  assert.equal(ghqrFor('hello', 1000), '');
  assert.equal(ghqrFor(CLUB.replace('MEMORIES', 'MEMORIEZ'), 1000), '', 'altered: the checksum no longer matches');
  assert.equal(ghqrFor(CLUB, 0), '');
  assert.equal(ghqrFor(CLUB, -5), '');
});

test('the setting accepts the club’s code, blank, and refuses anything else', () => {
  assert.equal(cleanRoutes({ bigWalletQr: CLUB }).bigWalletQr, CLUB);
  assert.equal(cleanRoutes({ bigWalletQr: '' }).bigWalletQr, '');
  assert.match(cleanRoutes({ bigWalletQr: 'https://example.com/pay' }).error, /GhQR/);
  assert.match(cleanRoutes({ bigWalletQr: CLUB.replace('CD28', '0000') }).error, /GhQR/);
});

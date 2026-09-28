import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { esc, normalizePhone, maskPhone, pes, accraDayKey, nightKey, NIGHT_ROLLOVER_HOUR } from '../../public/lib/shared.js';

test('pes: GHS to integer pesewas, no float error', () => {
  assert.equal(pes('150'), 15000);
  assert.equal(pes(150), 15000);
  assert.equal(pes('10.5'), 1050);
  assert.equal(pes('10.10'), 1010);
  assert.equal(pes('0.29'), 29);
  assert.equal(pes('1,500'), 150000);
  assert.equal(pes(' 20 '), 2000);
  assert.equal(pes('0'), 0);
});

test('pes: rejects anything that is not an amount', () => {
  for (const bad of [NaN, null, undefined, '', 'abc', '-5', -5, '10.555', '1e3', '12abc', true, '.5', 'GHS 10'])
    assert.throws(() => pes(bad), TypeError, `pes(${JSON.stringify(bad)}) should throw`);
});

test('normalizePhone: the four accepted Ghana formats, and junk', () => {
  for (const ok of ['024 123 4567', '0241234567', '233241234567', '+233241234567', '024-123-4567', '(024) 123 4567'])
    assert.equal(normalizePhone(ok), '0241234567', ok);
  for (const bad of ['', null, undefined, '24123456', '02412345678', '+44241234567', 'phone', '0241234abc'])
    assert.equal(normalizePhone(bad), null, String(bad));
  assert.equal(maskPhone('+233241234567'), '024***4567');
  assert.equal(maskPhone('nope'), '');
});

test('Accra dates: calendar day and "which night", around midnight and the rollover', () => {
  assert.equal(accraDayKey('2026-10-02T23:59:00Z'), '2026-10-02');
  assert.equal(accraDayKey('2026-10-03T00:00:00Z'), '2026-10-03');
  assert.equal(accraDayKey('not a date'), '');
  assert.equal(NIGHT_ROLLOVER_HOUR, 4);
  assert.equal(nightKey('2026-10-02T22:00:00Z'), '2026-10-02', 'Friday 10pm is Friday night');
  assert.equal(nightKey('2026-10-03T03:59:00Z'), '2026-10-02', '3:59am Saturday is still Friday night');
  assert.equal(nightKey('2026-10-03T04:00:00Z'), '2026-10-03', '4am Saturday is Saturday');
  assert.equal(nightKey('2026-01-01T01:00:00Z'), '2025-12-31', 'across a year boundary');
});

test('esc: escapes every HTML-significant character', () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

test('one escape function, one phone rule, one money parser in the codebase', () => {
  const files = [
    ...readdirSync(new URL('../../public', import.meta.url)).filter(f => /\.(js|html)$/.test(f)).map(f => `../../public/${f}`),
    ...readdirSync(new URL('../../public/pages', import.meta.url)).map(f => `../../public/pages/${f}`),
    ...readdirSync(new URL('../src', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `../src/${f}`),
    ...readdirSync(new URL('../src/lib', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `../src/lib/${f}`),
  ];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\b(const|let|function)\s+esc\s*[=(]/, `${f} defines its own esc()`);
    assert.doesNotMatch(src, /\/\^0\\d\{9\}\$\//, `${f} has its own phone regex`);
    assert.doesNotMatch(src, /\b(const|let|function)\s+pes\s*[=(]/, `${f} defines its own pes()`);
  }
});

test('ticket designs: auto is stable per night and varies across nights; stored choices are validated', async () => {
  const { ticketDesign, TICKET_STYLES, cleanTicketColors } = await import('../../public/lib/shared.js');
  assert.deepEqual(ticketDesign({ id: 'night-a' }), ticketDesign({ id: 'night-a' }), 'same night, same design');
  const styles = new Set(Array.from({ length: 40 }, (_, i) => ticketDesign({ id: `night-${i}` }).style));
  assert.equal(styles.size, TICKET_STYLES.length, 'auto spreads nights across every design');
  assert.equal(ticketDesign({ id: 'x', ticketStyle: 'neon' }).style, 'neon');
  assert.notEqual(ticketDesign({ id: 'x', ticketStyle: '<script>' }).style, '<script>');
  const own = { accent: '#DBA63E', dark: '#1f180a', light: '#f3ede2' };
  assert.deepEqual(ticketDesign({ id: 'x', ticketColors: own }).colors, { accent: '#dba63e', dark: '#1f180a', light: '#f3ede2' });
  assert.equal(cleanTicketColors({ accent: 'red', dark: '#000000', light: '#ffffff' }), null);
  assert.equal(cleanTicketColors({ accent: '#000000', dark: '#000000', light: 'url(x)' }), null);
});

test('a month of nights: every Auto night gets a different design; hand-picked designs are kept and not repeated', async () => {
  const { monthStyles, TICKET_STYLES } = await import('../../public/lib/shared.js');
  const oct = ['02', '03', '09', '10', '16', '17', '23', '24'].map(d => ({ id: `oct-${d}`, date: `2026-10-${d}T22:00:00Z` }));
  const r = monthStyles(oct);
  assert.equal(TICKET_STYLES.length, 8);
  assert.equal(new Set(oct.map(e => r.get(e.id))).size, 8, 'eight nights, eight designs');
  const picked = oct.map((e, i) => (i === 5 ? { ...e, ticketStyle: 'vinyl' } : e));
  const r2 = monthStyles(picked);
  assert.equal(r2.get('oct-17'), 'vinyl');
  assert.equal(new Set(picked.map(e => r2.get(e.id))).size, 8, 'a hand-picked design is not given to another night');
  const nov = monthStyles([{ id: 'nov-06', date: '2026-11-06T22:00:00Z' }]);
  assert.notEqual(nov.get('nov-06'), r.get('oct-02'), 'the starting design moves on each month');
  assert.equal(monthStyles(oct).get('oct-09'), r.get('oct-09'), 'stable: same nights, same designs');
});

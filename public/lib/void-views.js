// Voiding a sale, and test mode: for directors, the Manager and the administrator.
// The rules are in worker/src/ops/void-sale.js; this is only the screens.
import { $, $$, esc } from '../app.js';
import { sapi } from '../staff.js';
import { sheet, say, money, when, dayName, ask } from './ops-ui.js';

// Asks why, then voids one sale. done() redraws whatever list the sale was on.
export async function voidFlow({ kind, id, title }, done) {
  const reason = await ask({ title, label: 'Why is it being voided?', hint: 'e.g. test run, no money was taken', quick: ['Test run, no money taken', 'Rung up by mistake', 'Customer didn’t pay or leave'], send: 'Void sale', danger: true });
  if (!reason) return;
  try { await sapi('/api/ops/sales/void', { method: 'POST', body: { kind, id, reason } }); if (done) await done(); }
  catch (e) { sheet(`<h2>Couldn’t void it</h2><p>${esc(e.message)}</p><button class="big ghost" data-close>OK</button>`, { label: 'Void' }); }
}

// The screen: test mode (on/off, clear what it recorded) and tonight's door sales, each with Void.
export async function voidView(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const [tm, door] = await Promise.all([sapi('/api/ops/test-mode'), sapi('/api/ops/sales/door')]);
  const again = () => voidView(el), tn = tm.testTabs + tm.testDoorSales, plural = n => (n === 1 ? '' : 's');
  el.innerHTML = `<div class="vstack" style="display:grid;gap:14px"><h1>Test mode and voids</h1>
    <div class="card" style="display:grid;gap:8px"><h2 style="margin:0">Test mode: ${tm.on ? 'ON' : 'off'}</h2>
      <p class="muted" style="margin:0">For a practice run. While it’s on, every sale the staff record is marked TEST, no text goes to anyone’s phone and MoMo prompts are off (cash only). When the practice is over, “Clear test sales” takes them all out of the sales, the cash and the door numbers.</p>
      ${tn ? `<p style="margin:0"><b>${tm.testTabs}</b> test tab${plural(tm.testTabs)} · <b>${tm.testDoorSales}</b> door sale${plural(tm.testDoorSales)} · ${money(tm.testPesewas)} that wasn’t real${tm.on ? '' : ', still counted until you clear them'}</p>` : ''}
      <div id="tmMsg"></div>
      <button class="big ${tm.on ? 'ghost' : ''}" id="tmToggle">${tm.on ? 'Turn test mode off' : 'Turn test mode on'}</button>
      ${tn ? '<button class="big red" id="tmClear">Clear test sales</button>' : ''}</div>
    <h2 style="margin:0">Door sales · ${esc(dayName(door.date))}</h2>
    <p class="muted" style="margin:0">Cash tickets and tables sold at the door. Drinks tabs are voided from Sales.</p>
    ${door.sales.length ? `<div class="pos-tables">${door.sales.map((x, i) => `<div class="pos-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="where">${when(x.at)} · ${esc(x.what)}${x.test ? ' · TEST' : ''}<small>${esc(x.soldByName)} · ${x.paidWith === 'cash' ? 'Cash' : 'MoMo'}${x.buyerName ? ` · ${esc(x.buyerName)}` : ''}${x.voided ? ` · voided: ${esc(x.voidReason)}` : ''}</small></span>
      <span class="amt" style="${x.voided ? 'text-decoration:line-through;opacity:.6' : ''}">${money(x.amountPesewas)}</span>${x.canVoid ? `<button type="button" class="mid" data-vd="${i}" style="min-height:40px;padding:0 12px">Void</button>` : ''}</div>`).join('')}</div>`
      : '<div class="empty-box"><b>No door sales</b>Nothing sold at the door tonight.</div>'}</div>`;
  $('#tmToggle', el).onclick = async () => {
    if (!tm.on && !confirm('Turn test mode on? Sales recorded from now are marked TEST, no texts go out and MoMo is off, until you turn it off.')) return;
    try { await sapi('/api/ops/test-mode', { method: 'POST', body: { on: !tm.on } }); await again(); } catch (e) { say($('#tmMsg', el), e.message, 'bad'); }
  };
  const clr = $('#tmClear', el);
  if (clr) clr.onclick = async () => {
    if (!confirm(`Clear ${tn} test sale${plural(tn)}? They stop counting everywhere. Real sales are not touched.`)) return;
    try { const r = await sapi('/api/ops/sales/clear-test', { method: 'POST', body: { confirm: 'CLEAR' } }); await again(); say($('#tmMsg', el), r.message, r.skipped.length ? 'bad' : 'good'); } catch (e) { say($('#tmMsg', el), e.message, 'bad'); }
  };
  $$('[data-vd]', el).forEach(b => b.onclick = () => { const x = door.sales[Number(b.dataset.vd)]; voidFlow({ kind: 'gate', id: x.id, title: `Void ${x.what} (${money(x.amountPesewas)})?` }, again); });
}

// A banner at the top of the staff screens while test mode is on.
export async function testBanner(host) {
  let on = false;
  try { on = (await sapi('/api/ops/test-mode')).on; } catch { return; }
  const old = $('#testBanner'); if (old) old.remove();
  if (!on) return;
  const b = document.createElement('div');
  b.id = 'testBanner'; b.setAttribute('role', 'status');
  b.style.cssText = 'background:#b45309;color:#fff;text-align:center;padding:8px 12px;font-weight:600;font-size:14px';
  b.textContent = 'TEST MODE: sales recorded now are practice, not real';
  host.prepend(b);
}

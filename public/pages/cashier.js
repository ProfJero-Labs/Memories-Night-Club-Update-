// cashier.html: money received. Find a bill → see what's paid → record cash → receipt. "My cash":
// open the shift with the float, drop cash to the safe, ask for a refund or payout (the manager
// approves), and at the end count the cash: the system shows expected vs counted, and any
// difference needs an explanation. A customer saying "I sent MoMo" is not a payment: only payments
// Paystack confirmed show as paid.
import { $, $$, esc } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
import { sheet, say, st, every, bottomNav, busy, ghsIn, moneyField, money, when } from '../lib/ops-ui.js';

const user = await requireStaff(['cashier', 'superAdmin', 'director', 'manager']);
staffHeader(user, 'Cashier');
const app = $('#app');
let stop = null;
const nav = bottomNav([['bills', 'Find a bill'], ['cash', 'My cash']], k => { location.hash = k; });
function route() { if (stop) { stop(); stop = null; } const k = location.hash.slice(1) || 'bills'; nav.setActive(k); k === 'cash' ? cash() : bills(); }
addEventListener('hashchange', route);

async function bills() {
  app.innerHTML = `<h1>Find a bill</h1><div class="sfield"><label for="q">Tab number, table or name</label><input id="q" type="search" autocomplete="off" placeholder="e.g. 12, VIP 2, Efua"></div><div id="msg"></div><div class="cards" id="list"><div class="loading">Loading…</div></div>`;
  let t; const load = async () => {
    const { tabs } = await sapi(`/api/ops/tabs/find?q=${encodeURIComponent($('#q').value)}`);
    $('#list').innerHTML = tabs.map(x => `<button class="tcard ${x.bill.balancePesewas ? 'warn' : 'done'}" data-id="${esc(x.id)}"><span class="row"><span class="t">${esc(x.label)} · ${esc(x.table)}</span><span class="amt">${money(x.bill.balancePesewas)}</span></span><span class="row"><span class="sub">${esc(x.waiterName)}${x.customerName ? ` · ${esc(x.customerName)}` : ''}</span>${st(x.payStatus, x.payLabel)}</span></button>`).join('') || '<div class="empty-box"><b>No open bills</b>Try another number or name.</div>';
    $$('[data-id]').forEach(b => b.onclick = () => openBill(b.dataset.id));
  };
  $('#q').oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch(e => say($('#msg'), e.message, 'bad')), 300); };
  stop = every(10000, load);
}

async function openBill(id) {
  const tab = (await sapi(`/api/ops/tab?id=${encodeURIComponent(id)}`)).tab, b = tab.bill;
  const { box, close } = sheet(`<h2>${esc(tab.label)} · ${esc(tab.table)}</h2><p class="muted" style="margin:0">${esc(tab.waiterName)}</p>
    <div class="lines-list">${b.lines.map(l => `<div class="ln"><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.amountPesewas)}</span></div>`).join('')}
      ${b.discountPesewas ? `<div class="ln"><span>Discount</span><span>−${money(b.discountPesewas)}</span></div>` : ''}
      <div class="ln total"><span>Total</span><span>${money(b.totalPesewas)}</span></div>
      ${tab.payments.map(p => `<div class="ln"><span>${p.method === 'cash' ? 'Cash' : 'MoMo / card (confirmed)'} <small>${when(p.at)}${p.byName ? ` · ${esc(p.byName)}` : ''}</small></span><span>−${money(p.amountPesewas)}</span></div>`).join('')}
      <div class="ln total"><span>Still to pay</span><span>${money(b.balancePesewas)}</span></div></div>
    ${b.balancePesewas ? `${moneyField('cAmt', 'Cash received (GHS)', String(b.balancePesewas / 100), 'Give change from the cash. Only record what this bill gets.')}
      <div id="cMsg"></div><button class="big" id="cGo">Record cash · ${money(b.balancePesewas)}</button>
      <p class="foot-small" style="margin:0">Customer says they paid by MoMo? It shows here only once Paystack confirms it. Ask them to pay from the bill link.</p>` : '<div class="say good"><b>Paid in full</b></div>'}
    <button class="big ghost" data-close>Done</button>`, { label: 'The bill' });
  $('#cAmt', box)?.addEventListener('input', () => { const v = ghsIn($('#cAmt', box).value); $('#cGo', box).textContent = `Record cash · ${money(Number.isFinite(v) ? v : 0)}`; });
  $('#cGo', box) && ($('#cGo', box).onclick = async () => {
    try {
      const r = await busy($('#cGo', box), () => sapi('/api/ops/tabs/cash', { method: 'POST', body: { tabId: tab.id, amountPesewas: ghsIn($('#cAmt', box).value) } }));
      close(); receipt(tab, ghsIn($('#cAmt', box).value), r.balancePesewas);
    } catch (e) { if (e.code === 'no_session') { close(); location.hash = 'cash'; setTimeout(() => say($('#msg'), 'Open your cash shift first.', 'warn'), 100); } else say($('#cMsg', box), e.message, 'bad'); }
  });
}
function receipt(tab, amount, left) {
  sheet(`<h2>Cash recorded</h2><div class="nums"><div class="good"><span>Received</span><b>${money(amount)}</b></div><div class="${left ? 'warn' : 'good'}"><span>Still to pay</span><b>${money(left)}</b></div></div>
    <p class="muted" style="margin:0">${esc(tab.label)} · ${esc(tab.table)} · ${when(new Date())}. The customer can see the receipt on their bill link.</p><button class="big" data-close>Done</button>`);
}

async function cash() {
  app.innerHTML = '<div class="loading">Loading…</div>';
  let s; try { s = (await sapi('/api/ops/cash')).session; } catch (e) { app.innerHTML = `<div class="say bad">${esc(e.message)}</div>`; return; }
  if (!s) {
    app.innerHTML = `<h1>My cash</h1><p class="lead">Start your shift: count the cash you start with (the float).</p>${moneyField('fl', 'Starting cash (GHS)', '0')}<div id="msg"></div><button class="big" id="openGo">Open my cash shift</button>`;
    $('#openGo').onclick = async () => { try { await busy($('#openGo'), () => sapi('/api/ops/cash/open', { method: 'POST', body: { floatPesewas: ghsIn($('#fl').value) } })); cash(); } catch (e) { say($('#msg'), e.message, 'bad'); } };
    return;
  }
  const open = s.status === 'open';
  app.innerHTML = `<h1>My cash</h1><p class="lead">Opened ${when(s.openedAt)} · ${open ? 'open' : s.status === 'reviewed' ? `checked by ${esc(s.reviewedByName)}` : 'counted, waiting for review'}</p>
    <div class="nums"><div><span>Starting cash</span><b>${money(s.floatPesewas)}</b></div><div class="good"><span>Cash taken (${s.paymentsCount})</span><b>${money(s.takenPesewas)}</b></div>
      <div><span>Put in the safe</span><b>${money(s.dropsPesewas)}</b></div><div><span>Refunds and payouts</span><b>${money(s.refundsPesewas + s.payoutsPesewas)}</b></div>
      <div class="warn"><span>You should have</span><b>${money(s.expectedPesewas)}</b></div>
      ${s.countedPesewas != null ? `<div class="${s.differencePesewas ? 'bad' : 'good'}"><span>You counted</span><b>${money(s.countedPesewas)}</b></div>` : ''}</div>
    ${s.differencePesewas ? `<div class="say bad"><b>${money(Math.abs(s.differencePesewas))} ${s.differencePesewas < 0 ? 'less' : 'more'} than expected</b>${esc(s.explanation)}</div>` : ''}
    <div id="msg"></div>
    ${open ? `<div class="btn-row"><button class="mid" id="drop">Put cash in the safe</button><button class="mid" id="addf">Add to the float</button><button class="mid warn" id="refund">Refund or pay out</button></div>
      <h2>End of shift</h2>${moneyField('cnt', 'Count the cash you have now (GHS)')}<div class="sfield" id="whyBox" hidden><label for="why">Explain the difference</label><textarea id="why" rows="3" maxlength="400"></textarea></div><div id="cntMsg"></div>
      <button class="big" id="cntGo">Submit my cash count</button>` : ''}
    ${s.movements.length ? `<h2>Cash movements</h2><div class="lines-list">${s.movements.map(m => `<div class="ln"><span>${esc({ drop: 'To the safe', float_in: 'Float added', refund: 'Refund', payout: 'Pay out' }[m.kind])} <small>${when(m.at)} · ${esc(m.reason || '')}${m.approvedByName ? ` · approved by ${esc(m.approvedByName)}` : ''}</small></span><span>${money(m.amountPesewas)}</span></div>`).join('')}</div>` : ''}`;
  if (!open) return;
  const move = (kind, title) => {
    const { box, close } = sheet(`<h2>${title}</h2>${moneyField('mvA', 'Amount (GHS)')}<div class="sfield"><label for="mvR">${kind === 'drop' ? 'Note (optional)' : 'Why'}</label><input id="mvR" maxlength="200"></div>
      ${kind === 'refund' ? '<div class="sfield"><label for="mvK">Type</label><select id="mvK"><option value="refund">Refund to a customer</option><option value="payout">Pay out (e.g. supplier, transport)</option></select></div>' : ''}
      <div id="mvM"></div><button class="big" id="mvGo">${kind === 'refund' ? 'Ask the manager' : 'Save'}</button><button class="big ghost" data-close>Cancel</button>`);
    $('#mvGo', box).onclick = async () => {
      try { const r = await busy($('#mvGo', box), () => sapi('/api/ops/cash/move', { method: 'POST', body: { kind: kind === 'refund' ? $('#mvK', box).value : kind, amountPesewas: ghsIn($('#mvA', box).value), reason: $('#mvR', box).value } })); close(); await cash(); say($('#msg'), r.requested ? 'Sent to the manager. It shows here once approved.' : 'Saved.'); }
      catch (e) { say($('#mvM', box), e.message, 'bad'); }
    };
  };
  $('#drop').onclick = () => move('drop', 'Put cash in the safe');
  $('#addf').onclick = () => move('float_in', 'Add to the float');
  $('#refund').onclick = () => move('refund', 'Refund or pay out');
  $('#cnt').oninput = () => { const v = ghsIn($('#cnt').value); $('#whyBox').hidden = !Number.isFinite(v) || v === s.expectedPesewas; };
  $('#cntGo').onclick = async () => {
    const v = ghsIn($('#cnt').value);
    if (!Number.isFinite(v)) return say($('#cntMsg'), 'Enter the cash you counted.', 'bad');
    if (!confirm(`Submit ${money(v)} as your cash count? You can’t change it after.`)) return;
    try { await busy($('#cntGo'), () => sapi('/api/ops/cash/close', { method: 'POST', body: { countedPesewas: v, explanation: $('#why').value } }), 'Submitting…'); cash(); }
    catch (e) { if (e.code === 'needs_explanation') { $('#whyBox').hidden = false; $('#why').focus(); } say($('#cntMsg'), e.message, 'bad'); }
  };
}

route();

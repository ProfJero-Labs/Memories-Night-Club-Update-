// bill.html?t={billToken}: a customer's bill from their waiter. Every drink, the total, what's paid,
// what's left, and one big Pay now (MoMo or card on Paystack). The link can only show and pay this
// bill; prices come from the Worker. Back from Paystack (?reference=), the payment is confirmed on
// the server before it shows as paid.
import { api, esc, money, params, $ } from '../app.js';

const root = $('#root');
const token = params.get('t') || '';
const ref = params.get('reference') || params.get('trxref');
const when = d => new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
let timer = null;

async function load(note = '') {
  clearTimeout(timer);
  let b;
  try { b = (await api(`/api/guest/bill/${encodeURIComponent(token)}`)).bill; }
  catch (e) { root.innerHTML = `<div class="say bad"><b>${e.status === 404 ? 'This bill link isn’t valid' : 'Couldn’t load your bill'}</b>${esc(e.status === 404 ? 'Ask your waiter to show it again.' : e.message)}</div>`; return; }
  const paid = ['paid', 'overpaid'].includes(b.status);
  root.innerHTML = `<h1>${esc(b.label)}</h1><p class="lead">${esc(b.table)}${b.waiterFirstName ? ` · served by ${esc(b.waiterFirstName)}` : ''}</p>
    ${note ? `<div class="say ${note.kind}" role="status">${esc(note.text)}</div>` : ''}
    <div class="lines-list">${b.lines.map(l => `<div class="ln"><span>${l.qty} × ${esc(l.name)} <small>@ ${money(l.unitPesewas)}</small></span><span>${money(l.amountPesewas)}</span></div>`).join('') || '<div class="ln"><span class="muted">Nothing on this bill yet.</span></div>'}
      ${b.discountPesewas ? `<div class="ln"><span>Discount</span><span>−${money(b.discountPesewas)}</span></div>` : ''}
      <div class="ln total"><span>Total</span><span>${money(b.totalPesewas)}</span></div>
      ${b.payments.map(p => `<div class="ln"><span>Paid · ${esc(p.method)} <small>${esc(when(p.at))}</small></span><span>−${money(p.amountPesewas)}</span></div>`).join('')}
      <div class="ln total"><span>${paid ? 'Paid in full' : 'To pay'}</span><span>${money(b.balancePesewas)}</span></div></div>
    <p><span class="st ${esc(b.status)}">${esc(b.statusLabel)}</span></p>
    ${!paid && b.balancePesewas >= 100 && b.status !== 'written_off' ? `<div class="field"><label for="ph">Your MoMo number (optional, for the receipt)</label><input id="ph" type="tel" inputmode="tel" placeholder="024 123 4567"></div>
      <button class="big" id="pay">Pay now · ${money(b.balancePesewas)}</button><p class="foot-small" style="margin:0">MoMo or card, by Paystack. Your waiter sees it the moment it’s confirmed.</p>` : ''}
    ${paid ? '<div class="say good"><b>Thank you!</b>This page is your receipt. Show it to your waiter if they ask.</div><button class="big ghost" id="save">Save receipt</button>' : ''}`;
  $('#save') && ($('#save').onclick = () => print());
  $('#pay') && ($('#pay').onclick = async () => {
    const btn = $('#pay'); btn.disabled = true; btn.textContent = 'Opening payment…';
    try { const r = await api(`/api/guest/bill/${encodeURIComponent(token)}/pay`, { method: 'POST', body: { phone: $('#ph').value.trim() } }); location.href = r.authorizationUrl; }
    catch (e) { btn.disabled = false; btn.textContent = `Pay now · ${money(b.balancePesewas)}`; load({ kind: 'bad', text: e.message }); }
  });
  // Still open: refresh now and then, so new rounds and the waiter's cash show up.
  if (!paid) timer = setTimeout(() => load(), 15000);
}

async function confirmReturn() {
  root.innerHTML = '<div class="loading" role="status">Checking your payment…</div>';
  for (let i = 0; i < 12; i++) {
    try {
      const v = await api('/api/checkout/verify', { method: 'POST', body: { reference: ref } });
      if (v.status === 'issued') { history.replaceState(null, '', `bill.html?t=${encodeURIComponent(token)}`); return load({ kind: 'good', text: 'Payment confirmed. Thank you!' }); }
      if (v.status === 'failed') { history.replaceState(null, '', `bill.html?t=${encodeURIComponent(token)}`); return load({ kind: 'bad', text: 'The payment didn’t go through. Nothing was taken. Try again.' }); }
    } catch { /* keep checking */ }
    await new Promise(r => setTimeout(r, 2500));
  }
  load({ kind: 'warn', text: 'Still confirming. MoMo can take a minute; this page updates by itself.' });
}
if (!/^[0-9a-f]{32}$/.test(token)) root.innerHTML = '<div class="say bad"><b>This bill link isn’t valid</b>Ask your waiter to show it again.</div>';
else if (ref) confirmReturn();
else load();

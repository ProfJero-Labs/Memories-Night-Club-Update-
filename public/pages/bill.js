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
// The customer's choices survive the page's own refresh: tip amount, who it's for, their number.
const pick = { tip: 0, other: '', to: '', phone: '' };
const TIPS = [0, 1000, 2000, 5000];
const ghsIn = v => { const n = Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100); return Number.isFinite(n) ? n : 0; };
const tipNow = () => (pick.tip === 'other' ? ghsIn(pick.other) : pick.tip);

async function load(note = '') {
  clearTimeout(timer);
  let b, tip;
  try { ({ bill: b, tip } = await api(`/api/guest/bill/${encodeURIComponent(token)}`)); }
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
    ${!paid && b.balancePesewas >= 100 && b.status !== 'written_off' ? `${tipPart(tip)}<div class="field"><label for="ph">Your MoMo number (optional, for the receipt)</label><input id="ph" type="tel" inputmode="tel" placeholder="024 123 4567" value="${esc(pick.phone)}"></div>
      <button class="big" id="pay">Pay now · ${money(b.balancePesewas + tipNow())}</button><p class="foot-small" style="margin:0">MoMo or card, by Paystack. Your waiter sees it the moment it’s confirmed.</p>` : ''}
    ${paid ? '<div class="say good"><b>Thank you!</b>This page is your receipt. Show it to your waiter if they ask.</div><button class="big ghost" id="save">Save receipt</button><a class="big" href="review.html?s=bill" style="text-align:center;text-decoration:none">How was your night? Rate us</a>' : ''}`;
  $('#save') && ($('#save').onclick = () => print());
  const payLabel = () => { $('#pay') && ($('#pay').textContent = `Pay now · ${money(b.balancePesewas + tipNow())}`); };
  document.querySelectorAll('[data-tip]').forEach(x => x.onclick = () => {
    pick.tip = x.dataset.tip === 'other' ? 'other' : Number(x.dataset.tip);
    document.querySelectorAll('[data-tip]').forEach(y => y.setAttribute('aria-pressed', String(y === x)));
    $('#tipOther').hidden = pick.tip !== 'other'; $('#tipWho').hidden = !pick.tip;
    if (pick.tip === 'other') $('#tipAmt').focus();
    payLabel();
  });
  $('#tipAmt') && ($('#tipAmt').oninput = e => { pick.other = e.target.value; payLabel(); });
  $('#tipTo') && ($('#tipTo').onchange = e => { pick.to = e.target.value; });
  $('#ph') && ($('#ph').oninput = e => { pick.phone = e.target.value; });
  $('#pay') && ($('#pay').onclick = async () => {
    const btn = $('#pay'), t = tipNow();
    if (pick.tip === 'other' && t < 100) return load({ kind: 'bad', text: 'Enter the tip (at least GHS 1), or pick No tip.' });
    btn.disabled = true; btn.textContent = 'Opening payment…';
    try { const r = await api(`/api/guest/bill/${encodeURIComponent(token)}/pay`, { method: 'POST', body: { phone: $('#ph').value.trim(), ...(t ? { tipPesewas: t, tipToUid: pick.to || tip?.defaultId || '' } : {}) } }); location.href = r.authorizationUrl; }
    catch (e) { btn.disabled = false; payLabel(); load({ kind: 'bad', text: e.message }); }
  });
  // Still open: refresh now and then, so new rounds and the waiter's cash show up (not while they type).
  if (!paid) timer = setTimeout(function again() { if (document.activeElement?.matches('input, select')) { timer = setTimeout(again, 5000); return; } load(); }, 15000);
}

// A tip, on top of the bill: for their waiter, or anyone on the team they pick.
function tipPart(tip) {
  if (!tip?.people?.length) return '';
  if (!pick.to) pick.to = tip.defaultId || '';
  const on = v => String(pick.tip === v);
  return `<div class="field"><span class="label" id="tipL">Add a tip? (optional)</span>
    <div class="tipseg" role="group" aria-labelledby="tipL">${TIPS.map(v => `<button type="button" data-tip="${v}" aria-pressed="${on(v)}">${v ? money(v) : 'No tip'}</button>`).join('')}<button type="button" data-tip="other" aria-pressed="${on('other')}">Other</button></div></div>
    <div class="field" id="tipOther" ${pick.tip === 'other' ? '' : 'hidden'}><label for="tipAmt">Tip amount (GHS)</label><input id="tipAmt" inputmode="decimal" autocomplete="off" value="${esc(pick.other)}"></div>
    <div class="field" id="tipWho" ${pick.tip ? '' : 'hidden'}><label for="tipTo">Tip for</label><select id="tipTo">${tip.people.map(p => `<option value="${esc(p.id)}" ${p.id === pick.to ? 'selected' : ''}>${esc(p.name)}${p.job ? ` · ${esc(p.job)}` : ''}</option>`).join('')}</select>
      <p class="foot-small" style="margin:0">The whole tip goes to them, not to the club.</p></div>`;
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

// Selling, shared by the waiter and the bar: pick drinks (showing how many are left, finished ones
// can't be picked) and take the payment (Cash, or MoMo with its transaction ID).
import { $, $$, esc } from '../app.js';
import { sheet, say, busy, money, moneyField, ghsIn, pasteMomoButton } from './ops-ui.js';

// Draws a drink list into `el`. products: from /api/ops/products?stationId=… (with `left`).
// onSend(lines, total) runs when the big button is tapped; it may throw to show an error.
// topEl: a form shown above the drinks that keeps what was typed while drinks are added.
// A search box stays at the top: it narrows the list as you type (any part of the name or the
// category, every word), and what's already picked stays picked.
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function drinkPicker(el, products, { title = 'Pick drinks', top = '', topEl = null, button = n => `Send to bar · ${n}`, onSend, onBack } = {}) {
  const menu = products.filter(p => p.pricePesewas > 0);
  const cart = {};
  let query = '';
  const cats = [...new Set(menu.map(p => p.category))];
  const out = p => !p.available || p.left === 0;
  const cap = p => Math.min(30, p.left == null ? 30 : p.left);
  const row = p => `<div class="pick ${out(p) ? 'out' : ''}"><div class="grow">${esc(p.name)}<small>${money(p.pricePesewas)}${out(p) ? ' · finished' : p.left != null && p.left <= 5 ? ` · only ${p.left} left` : ''}</small></div>
    ${out(p) ? '' : `<div class="qstep"><button type="button" data-m="${esc(p.id)}" aria-label="One fewer ${esc(p.name)}">−</button><span>${cart[p.id] || 0}</span><button type="button" data-p="${esc(p.id)}" aria-label="One more ${esc(p.name)}" ${(cart[p.id] || 0) >= cap(p) ? 'disabled' : ''}>+</button></div>`}</div>`;
  el.innerHTML = `${onBack ? '<div class="backbar"><button type="button" class="back-btn" data-back aria-label="Back">←<span>Back</span></button></div>' : ''}<h1>${esc(title)}</h1>${top}${topEl ? '<div data-top></div>' : ''}
    <div class="pick-search" role="search"><input type="search" id="pkFind" placeholder="Search drinks" aria-label="Search drinks" autocomplete="off" enterkeyhint="search"><button type="button" id="pkClear" aria-label="Clear the search" hidden>×</button></div>
    <div id="pkList"></div><div id="pkMsg"></div>
    <div class="dock"><button class="big" id="send" disabled>Pick drinks</button></div>`;
  $('[data-back]', el) && ($('[data-back]', el).onclick = onBack);
  if (topEl) $('[data-top]', el).replaceWith(topEl);
  const list = $('#pkList', el), send = $('#send', el), find = $('#pkFind', el);
  // The search stays just under the header and the back bar while the list scrolls.
  const bb = $('.backbar', el); $('.pick-search', el).style.setProperty('--pick-top', `${56 + (bb ? bb.offsetHeight : 0)}px`);
  const totals = () => ({ total: Object.entries(cart).reduce((n, [id, q]) => n + q * menu.find(p => p.id === id).pricePesewas, 0), count: Object.values(cart).reduce((a, b) => a + b, 0) });
  const drawList = () => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const hit = p => words.every(w => fold(`${p.name} ${p.category}`).includes(w));
    const shown = cats.map(c => [c, menu.filter(p => p.category === c && hit(p))]).filter(([, ps]) => ps.length);
    list.innerHTML = shown.map(([c, ps]) => `<h3 class="cat-h">${esc(c)}</h3>${ps.map(row).join('')}`).join('')
      || `<div class="empty-box"><b>No drink matches “${esc(query.trim())}”</b>Check the spelling, or clear the search.</div>`;
    const { total, count } = totals();
    send.disabled = !count;
    send.textContent = count ? button(`${count} drink${count > 1 ? 's' : ''} · ${money(total)}`) : 'Pick drinks';
  };
  list.addEventListener('click', ev => {
    const b = ev.target.closest('[data-p],[data-m]'); if (!b) return;
    const id = b.dataset.p || b.dataset.m, p = menu.find(x => x.id === id);
    cart[id] = Math.max(0, Math.min(cap(p), (cart[id] || 0) + (b.dataset.p ? 1 : -1))); if (!cart[id]) delete cart[id];
    drawList();
  });
  const clear = $('#pkClear', el);
  find.addEventListener('input', () => { query = find.value; clear.hidden = !query; drawList(); });
  clear.onclick = () => { find.value = query = ''; clear.hidden = true; drawList(); find.focus(); };
  send.onclick = async () => {
    const { total } = totals();
    try { await busy(send, () => onSend(Object.entries(cart).map(([productId, qty]) => ({ productId, qty })), total), 'Saving…'); }
    catch (e) { say($('#pkMsg', el), e.message, 'bad'); }
  };
  drawList();
}

// "Customer gave a tip": the amount and who it's for (the person serving, unless the customer
// names someone else). Drawn into `holder`; value() gives { tipPesewas, tipToUid } or {}.
// A tip is the staff member's money: never part of the bill or the cash to hand in.
export function tipBox(holder, sapi, defaultUid) {
  holder.innerHTML = `<details class="fold" data-tipbox><summary>Customer gave a tip</summary>
    ${moneyField('tipAmt', 'Tip (GHS)', '', 'On top of the bill. It isn’t the club’s money.')}
    <div class="sfield"><label for="tipTo">Tip for</label><select id="tipTo"><option value="">Loading names…</option></select><span class="hint">You, or whoever the customer names.</span></div>
    <p class="muted" data-tiphint style="margin:0"></p></details>`;
  const sel = $('#tipTo', holder);
  sapi('/api/ops/tips/people').then(d => {
    sel.innerHTML = '<option value="">Pick who it’s for</option>' + d.people.map(p => `<option value="${esc(p.uid)}" ${p.uid === defaultUid ? 'selected' : ''}>${esc(p.name)}${p.roleName ? ` (${esc(p.roleName)})` : ''}</option>`).join('');
  }).catch(() => { sel.innerHTML = '<option value="">Couldn’t load the names</option>'; });
  const hint = method => { $('[data-tiphint]', holder).textContent = method === 'momo' ? 'One MoMo for bill and tip is fine: it has one transaction ID. Finance pays MoMo tips out weekly.' : 'Cash tip: the person keeps it. It isn’t in your cash to hand in.'; };
  hint('cash');
  return {
    method: hint,
    value() {
      const v = $('#tipAmt', holder).value.trim();
      if (!v) return {};
      const tipPesewas = ghsIn(v);
      if (!(tipPesewas >= 100)) throw new Error('A tip is at least GHS 1, or leave it empty.');
      if (!sel.value) throw new Error('Pick who the tip is for.');
      return { tipPesewas, tipToUid: sel.value };
    },
  };
}
const tipSaid = r => (r?.tip ? ` Tip ${money(r.tip.amountPesewas)} for ${String(r.tip.toName || '').split(/\s+/)[0]}.` : '');
export { tipSaid };

// A tip on its own (no bill), e.g. a customer tips the DJ: cash, or MoMo to the club's number.
export function tipSheet(sapi, defaultUid, done = () => {}) {
  const { box, close } = sheet(`<h2>Record a tip</h2><p class="muted" style="margin:0">For a tip without a bill. With a bill, add the tip when you take the payment.</p>
    <div class="seg" role="radiogroup" aria-label="How they paid"><button type="button" class="mid on" data-tm="cash" role="radio" aria-checked="true">Cash</button><button type="button" class="mid" data-tm="momo" role="radio" aria-checked="false">MoMo</button></div>
    <div id="tsBox"></div>
    <div id="tsMomo" hidden><div id="tsPaste"></div><div class="sfield"><label for="tsRef">MoMo transaction ID</label><input id="tsRef" maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="From the MoMo text"></div></div>
    <div id="tsMsg"></div><button class="big" id="tsGo">Record tip</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Record a tip' });
  const tb = tipBox($('#tsBox', box), sapi, defaultUid);
  $('#tsPaste', box).append(pasteMomoButton(m => { if (m.ref) $('#tsRef', box).value = m.ref; if (m.amountPesewas) $('#tipAmt', box).value = String(m.amountPesewas / 100); }));
  $('[data-tipbox]', box).open = true; $('[data-tipbox] summary', box).hidden = true;
  let method = 'cash';
  $$('[data-tm]', box).forEach(b => b.onclick = () => {
    method = b.dataset.tm; tb.method(method);
    $$('[data-tm]', box).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    $('#tsMomo', box).hidden = method !== 'momo';
  });
  $('#tsGo', box).onclick = async () => {
    try {
      const t = tb.value(); if (!t.tipPesewas) throw new Error('Enter the tip amount.');
      const r = await busy($('#tsGo', box), () => sapi('/api/ops/tips', { method: 'POST', body: { method, ...t, ...(method === 'momo' ? { momoRef: $('#tsRef', box).value } : {}) } }));
      close(); done(`Tip ${money(r.amountPesewas)} recorded for ${String(r.toName || '').split(/\s+/)[0]}.`);
    } catch (e) { say($('#tsMsg', box), e.message, 'bad'); }
  };
}

// The payment sheet for a fixed amount. pay({ method, momoRef, momoFrom }) records it; it may throw.
export function paySheet(totalPesewas, pay, { title = 'Customer pays', sapi = null, tipFor = '' } = {}) {
  const { box, close } = sheet(`<h2>${esc(title)}: ${money(totalPesewas)}</h2>
    <div class="seg" role="radiogroup" aria-label="How they paid"><button type="button" class="mid on" data-pm="cash" role="radio" aria-checked="true">Cash</button><button type="button" class="mid" data-pm="momo" role="radio" aria-checked="false">MoMo</button></div>
    <div id="psMomo" hidden>
      <div id="psPaste"></div>
      <div class="sfield"><label for="psRef">MoMo transaction ID</label><input id="psRef" maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="From the MoMo text, e.g. 51234567890"><span class="hint">Only when you can see the money arrived on the club’s MoMo number.</span></div>
    </div>
    <div class="sfield"><label for="psFrom">Customer’s phone (optional)</label><input id="psFrom" type="tel" inputmode="tel" placeholder="024 123 4567"><span class="hint">So the manager sees what each customer spends tonight. For MoMo, the number it came from.</span></div>
    <p class="muted" id="psHint" style="margin:0">Take ${money(totalPesewas)} and give change. It goes in your cash for tonight.</p>
    <div id="psTip"></div>
    <div id="psMsg"></div><button class="big" id="psGo">Cash received</button><button class="big ghost" data-close>Cancel</button>`, { label: title });
  let method = 'cash';
  const tb = sapi ? tipBox($('#psTip', box), sapi, tipFor) : null;
  // Smart paste: the transaction ID (and the number it came from) out of the customer's MoMo text.
  $('#psPaste', box).append(pasteMomoButton(m => { if (m.ref) $('#psRef', box).value = m.ref; if (m.phone && !$('#psFrom', box).value) $('#psFrom', box).value = m.phone; }));
  $$('[data-pm]', box).forEach(b => b.onclick = () => {
    method = b.dataset.pm; tb?.method(method);
    $$('[data-pm]', box).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    $('#psMomo', box).hidden = method !== 'momo';
    $('#psHint', box).textContent = method === 'momo' ? 'Finance checks every MoMo ID against the club’s statement.' : `Take ${money(totalPesewas)} and give change. It goes in your cash for tonight.`;
    $('#psGo', box).textContent = method === 'momo' ? 'MoMo received' : 'Cash received';
    if (method === 'momo') $('#psRef', box).focus();
  });
  $('#psGo', box).onclick = async () => {
    const phone = $('#psFrom', box).value.trim() || undefined;
    try {
      const body = { method, customerPhone: phone, ...(method === 'momo' ? { momoRef: $('#psRef', box).value, momoFrom: phone } : {}), ...(tb ? tb.value() : {}) };
      await busy($('#psGo', box), () => pay(body)); close();
    }
    catch (e) { say($('#psMsg', box), e.message, 'bad'); }
  };
  return close;
}

// "Hand in my cash": the person counts the cash they're holding; a difference needs a reason.
export async function handInCash(el, sapi) {
  let s; try { s = (await sapi('/api/ops/cash')).session; } catch { el.innerHTML = ''; return; }
  if (!s) { el.innerHTML = '<p class="muted">No cash taken tonight.</p>'; return; }
  if (s.status !== 'open') { el.innerHTML = `<div class="say good"><b>Cash handed in: ${money(s.countedPesewas)}</b>${s.differencePesewas ? `${money(Math.abs(s.differencePesewas))} ${s.differencePesewas < 0 ? 'less' : 'more'} than expected. ${esc(s.explanation)}` : 'It matched.'}</div>`; return; }
  el.innerHTML = `<p class="lead" style="margin:0">You should have <b>${money(s.expectedPesewas)}</b> in cash.</p>
    <div class="sfield"><label for="hcAmt">Cash you are holding now (GHS)</label><div class="money-in"><input id="hcAmt" inputmode="decimal" autocomplete="off"></div></div>
    <div class="sfield" id="hcWhyBox" hidden><label for="hcWhy">Why is it different?</label><input id="hcWhy" maxlength="400"></div>
    <div id="hcMsg"></div><button class="big" id="hcGo">Hand in my cash</button>`;
  $('#hcGo', el).onclick = async () => {
    const v = Math.round(Number(String($('#hcAmt', el).value).replace(/[^0-9.]/g, '')) * 100);
    if (!Number.isFinite(v) || $('#hcAmt', el).value === '') return say($('#hcMsg', el), 'Count your cash and enter the amount.', 'bad');
    try { await busy($('#hcGo', el), () => sapi('/api/ops/cash/close', { method: 'POST', body: { countedPesewas: v, explanation: $('#hcWhy', el).value } })); handInCash(el, sapi); }
    catch (e) { $('#hcWhyBox', el).hidden = false; say($('#hcMsg', el), e.message, 'bad'); $('#hcWhy', el).focus(); }
  };
}

// Scan to order: counter.html?s={stationToken}[&t={table}] (old /b/{token} links redirect here;
// Paystack sends the guest back to counter.html). Every link is relative, so it works wherever it's served.
// Pick drinks → pay by MoMo or card → the pickup code appears only once Paystack confirms the
// payment → show it at the bar. Paying cash? Order at the bar as usual.
// A search box finds a drink even with small spelling mistakes (drinkMatch). "My night" shows
// everything paid tonight from the customer's phone (asked with the id of an order they paid).
import { api, esc, money, normalizePhone, $, $$, loadFee, feeLabel, feeOn } from '../app.js';
import { drinkMatch, drinkMatchAny } from '../lib/shared.js';

const app = $('#app');
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const uuid = () => crypto.randomUUID();
const qs = new URLSearchParams(location.search);
const fromPath = location.pathname.match(/\/b\/([0-9a-f]{32})$/)?.[1];
const fromQr = fromPath || (/^[0-9a-f]{32}$/.test(qs.get('s') || '') ? qs.get('s') : null);
const station = fromQr || store.get('mem-bar-station') || '';
// A table card's QR carries the table, so the bar knows where to bring it (or who's asking).
const spot = fromQr ? (qs.get('t') || '').slice(0, 24) : (store.get('mem-bar-spot') || '');
const again = () => `counter.html?s=${encodeURIComponent(station)}${spot ? `&t=${encodeURIComponent(spot)}` : ''}`;
const cart = store.get('mem-bar-cart') || {};
let clientId = store.get('mem-bar-draft') || uuid(), timer = null, query = '';
// An optional tip for anyone on the team (the bartender, a waiter, the DJ…): the whole tip is theirs.
const tipPick = { tip: 0, other: '', to: '' };
const TIPS = [0, 1000, 2000, 5000];
const ghsIn = v => { const n = Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100); return Number.isFinite(n) ? n : 0; };
const tipNow = () => (tipPick.tip === 'other' ? ghsIn(tipPick.other) : tipPick.tip);
// The last order this phone paid tonight: the key to "My night".
const lastPaid = () => { const x = store.get('mem-bar-paid'); return x?.at > Date.now() - 14 * 3600e3 ? x.id : null; };
async function myNight() {
  clearTimeout(timer); dock('', '', null);
  app.innerHTML = '<div class="loading" role="status">Adding it up…</div>';
  let n; try { n = await api(`/api/guest/counter-night/${lastPaid()}`); } catch (e) { app.innerHTML = `${msg(e.message, 'bad')}<a class="btn" href="${esc(again())}">Back to the menu</a>`; return; }
  app.innerHTML = `<p class="kicker red" style="text-align:center">My night</p>
    <div class="pickup" style="font-size:44px" aria-label="Spent tonight">${money(n.totalPesewas)}</div>
    <p class="foot-small" style="text-align:center">Everything paid tonight from ${esc(n.phoneHint)}.</p>
    ${n.items.map(i => `<div class="summary"><div class="r"><span><b>${esc(new Date(i.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' }))}</b> · ${esc(i.where)} · ${esc(i.how)}</span></div>
      ${i.lines.map(l => `<div class="r"><span>${l.qty} × ${esc(l.name)}</span></div>`).join('')}<div class="r t"><span>${i.leftPesewas ? `Still to pay ${money(i.leftPesewas)}` : 'Total'}</span><span>${money(i.totalPesewas)}</span></div></div>`).join('') || msg('Nothing yet tonight.')}
    <div class="row-actions"><a class="btn red" href="${esc(again())}&view=menu">Order more</a></div><p class="foot-small" style="text-align:center;margin:10px 0 0">How was your night? <a href="review.html?s=qr&back=${encodeURIComponent(again())}">Rate us</a> (optional)</p>`;
}
const msg = (t, k = '') => `<div class="notice ${k}" role="status">${esc(t)}</div>`;
const dock = (sum, label, fn) => {
  const d = $('#dock'); d.classList.toggle('show', !!label);
  document.body.style.setProperty('--bar-h', label ? `${d.offsetHeight}px` : '0px');
  $('#dockSum').innerHTML = sum; const b = $('#dockBtn'); b.hidden = !label; b.textContent = label || ''; b.disabled = false; b.onclick = fn ? () => fn(b) : null;
};

// ── After paying: the order, polled until it's settled ──
function showOrder(orderId) {
  dock('', '', null);
  const poll = async () => {
    let o;
    try { o = await api(`/api/guest/counter/${orderId}`); }
    catch (e) { if (e.status === 404) { store.set('mem-bar-order', null); return start(); } app.innerHTML = msg('No connection. We’ll keep checking.'); timer = setTimeout(poll, 5000); return; }
    $('#label').textContent = o.stationName || 'Bar order';
    const lines = `<div class="summary">${o.lines.map(l => `<div class="r"><span>${l.qty} × ${esc(l.name)}</span></div>`).join('')}<div class="r t"><span>Paid</span><span>${money(o.totalPesewas)}</span></div></div>`;
    if (o.status === 'pending_payment') { app.innerHTML = `${msg('Approve the MoMo prompt on your phone. We’re waiting for it to confirm…')}<p class="foot-small">Don’t close this page. Your pickup code shows here the moment it’s paid.</p>`; timer = setTimeout(poll, 4000); return; }
    if (['paid', 'delivered'].includes(o.status)) store.set('mem-bar-paid', { id: orderId, at: Date.now() });
    if (o.status === 'paid') {
      app.innerHTML = `<p class="kicker red" style="text-align:center">Show this at the bar</p><div class="pickup" aria-label="Pickup code">${esc(o.pickupCode)}</div>${lines}
        <p class="foot-small">We’ve also texted you the code. <a href="receipt.html?code=${esc(o.receiptCode)}">Receipt</a></p>
        <div class="row-actions"><a class="btn" href="${esc(again())}&view=menu">Order more while you wait</a></div>`;
      navigator.wakeLock?.request('screen').catch(() => {});
      timer = setTimeout(poll, 8000); return;
    }
    store.set('mem-bar-order', null);
    if (o.status === 'delivered') { app.innerHTML = `${msg('Collected. Enjoy!', 'ok')}<div class="row-actions"><a class="btn red" href="${esc(again())}&view=menu">Order more</a><a class="btn" href="receipt.html?code=${esc(o.receiptCode)}">Receipt</a></div><p class="foot-small" style="text-align:center;margin:10px 0 0">How was your night? <a href="review.html?s=qr&back=${encodeURIComponent(again())}">Rate us</a> (optional)</p>`; return; }
    if (o.status === 'payment_failed') { app.innerHTML = `${msg('Payment didn’t go through. Nothing was taken.', 'bad')}<div class="row-actions"><a class="btn red" href="${esc(again())}">Try again</a></div>`; return; }
    if (o.status === 'refund_due' || o.status === 'refunded') { app.innerHTML = `${msg(o.status === 'refunded' ? 'You’ve been refunded for this order.' : 'The bar couldn’t make your order. You’re owed a refund: staff will sort it. Keep this page, or the receipt.', 'bad')}${o.receiptCode ? `<a class="btn" href="receipt.html?code=${esc(o.receiptCode)}">Receipt</a>` : ''}`; return; }
    app.innerHTML = `${msg('This order was cancelled. Nothing was taken.')}<a class="btn red" href="${esc(again())}">Start again</a>`;
  };
  poll();
}

// ── The menu ──
async function start() {
  await loadFee();
  clearTimeout(timer);
  const open = store.get('mem-bar-order');
  // An order waiting at the bar: its pickup code shows, but the menu is never locked behind it
  // (view=menu orders more; view=order goes back to the code).
  if (open && qs.get('view') !== 'menu' && (!fromQr || qs.get('reference') || qs.get('view') === 'order')) return showOrder(open);
  if (!station) { app.innerHTML = msg('Scan the QR code at the bar to order.'); return; }
  store.set('mem-bar-station', station); store.set('mem-bar-spot', spot || null);
  let r;
  try { r = await api(`/api/guest/menu?station=${encodeURIComponent(station)}`); }
  catch (e) { app.innerHTML = msg(e.message, 'bad'); return; }
  $('#label').textContent = r.station?.name || 'Bar order';
  $('#spot').textContent = spot ? `Table ${spot.replace(/^table\s*/i, '')}` : ''; $('#spot').hidden = !spot;
  if (!r.open) { app.innerHTML = msg('The bar isn’t taking app orders right now. Order at the bar.'); return; }
  if (qs.get('view') === 'night' && lastPaid()) return myNight();
  const price = id => r.items.find(i => i.id === id)?.pricePesewas || 0;
  for (const id of Object.keys(cart)) if (!r.items.some(i => i.id === id && i.available)) delete cart[id];
  const total = () => Object.entries(cart).reduce((a, [id, q]) => a + q * price(id), 0);
  const count = () => Object.values(cart).reduce((a, q) => a + q, 0);
  const drinks = n => `${n} drink${n === 1 ? '' : 's'}`;
  const grand = () => total() + (total() ? tipNow() + feeOn(total()) : 0);
  // A drink not in the basket shows one "+ Add"; once added, the − n + stepper.
  const control = i => (cart[i.id]
    ? `<div class="stepper"><button type="button" data-m="${esc(i.id)}" aria-label="One fewer ${esc(i.name)}">−</button><span aria-live="polite" aria-label="${cart[i.id]} in your order">${cart[i.id]}</span><button type="button" data-p="${esc(i.id)}" aria-label="One more ${esc(i.name)}">+</button></div>`
    : `<button type="button" class="add" data-p="${esc(i.id)}" aria-label="Add ${esc(i.name)}">+ Add</button>`);
  const drink = i => `<div class="drink ${i.available ? (cart[i.id] ? 'in' : '') : 'out'}"><div class="grow">${esc(i.name)}<small>${money(i.pricePesewas)}</small></div>
      ${i.available ? control(i) : '<span class="gone">Finished</span>'}</div>`;
  const cats = [...new Set(r.items.map(i => i.category))];
  const catId = c => `cat-${cats.indexOf(c)}`;
  // The list: everything by group, or the search results (best match first).
  const list = () => {
    if (!query.trim()) return cats.map(c => `<h2 class="cat" id="${catId(c)}">${esc(c)}</h2>${r.items.filter(i => i.category === c).map(drink).join('')}`).join('');
    const rank = fn => r.items.map(i => [i, fn(query, i.name, i.category)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || Number(b[0].available) - Number(a[0].available)).map(([i]) => i);
    let hits = rank(drinkMatch); if (!hits.length) hits = rank(drinkMatchAny);
    return hits.length ? hits.map(drink).join('') : `<p class="empty-find">No drink like “${esc(query)}”.<br>Try another word, or clear the search.</p>`;
  };
  // A changed basket is a new order; the same basket paid twice is the same order.
  const newDraft = () => { clientId = uuid(); store.set('mem-bar-draft', clientId); };
  const step = (id, by) => {
    cart[id] = Math.max(0, Math.min(20, (cart[id] || 0) + by)); if (!cart[id]) delete cart[id];
    newDraft(); store.set('mem-bar-cart', cart);
  };
  const refreshMenu = () => { $('#menuList').innerHTML = list(); $('#chips') && ($('#chips').hidden = !!query.trim()); };
  $('#app').onclick = e => {
    const b = e.target.closest('[data-p],[data-m]'); if (!b || !$('#menuList')?.contains(b)) return;
    const id = b.dataset.p || b.dataset.m; step(id, b.dataset.p ? 1 : -1);
    refreshMenu(); viewDock();
    // Keep the finger's place: focus the same drink's control after the redraw.
    $(`#menuList [data-p="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  };
  const viewDock = () => {
    const n = count();
    dock('', n ? 'View order' : '', () => openOrder());
    if (n) { const btn = $('#dockBtn'); btn.innerHTML = `<span class="n" aria-hidden="true">${n}</span><span class="l">View order</span><span>${drinks(n)} · ${money(total())}</span>`; }
  };

  // ── Step 2: the order panel (items, total, MoMo number, tip, one Pay button) ──
  const panel = $('#order');
  // A reload keeps the history entry the panel pushed: forget it, so ✕ never leaves the page.
  if (history.state?.order === 1) history.replaceState(null, '');
  const phoneNow = { v: store.get('mem-bar-momo') || '' };
  const isOpen = () => !panel.hidden;
  function openOrder() {
    if (!count()) return;
    panel.hidden = false; document.body.classList.add('locked');
    if (history.state?.order !== 1) history.pushState({ order: 1 }, '');
    drawOrder(); $('#orderH').setAttribute('tabindex', '-1'); $('#orderH').focus({ preventScroll: true });
  }
  // Closing never touches the basket. The phone's back button closes it too (popstate).
  function shut() {
    if (!isOpen()) return;
    panel.hidden = true; document.body.classList.remove('locked');
    refreshMenu(); viewDock(); $('#dockBtn').hidden || $('#dockBtn').focus({ preventScroll: true });
  }
  const closeOrder = () => { if (history.state?.order === 1) history.back(); else shut(); };
  $('#orderBack').onclick = closeOrder; $('#orderX').onclick = closeOrder;
  window.onpopstate = () => { if (isOpen()) shut(); };
  panel.onkeydown = e => { if (e.key === 'Escape') closeOrder(); };

  const orderItems = () => `<div class="op-items">${Object.keys(cart).map(id => r.items.find(i => i.id === id)).filter(Boolean).map(i => `<div class="drink"><div class="grow">${esc(i.name)}<small>${money(i.pricePesewas)} each</small></div>${control(i)}<span class="line-t">${money(cart[i.id] * i.pricePesewas)}</span></div>`).join('')}
    <button type="button" class="more" id="addMore">+ Add more drinks</button></div>`;
  const totals = () => `<div class="r"><span>${drinks(count())}</span><span>${money(total())}</span></div>${tipNow() ? `<div class="r"><span>Tip</span><span>${money(tipNow())}</span></div>` : ''}${feeOn(total()) ? `<div class="r"><span>${feeLabel()}</span><span>${money(feeOn(total()))}</span></div>` : ''}<div class="r t"><span>Total</span><span>${money(grand())}</span></div>`;
  const payLabel = () => { const b = $('#pay'); if (!b.disabled) b.textContent = `Pay ${money(grand())}`; };
  const refreshOrder = () => { $('#orderItems').innerHTML = orderItems(); $('#orderTotals').innerHTML = totals(); payLabel(); bindItems(); };
  const bindItems = () => {
    $$('#orderItems [data-p],#orderItems [data-m]').forEach(b => b.onclick = () => {
      const id = b.dataset.p || b.dataset.m; step(id, b.dataset.p ? 1 : -1);
      if (!count()) return closeOrder();
      refreshOrder(); $(`#orderItems [data-${b.dataset.p ? 'p' : 'm'}="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    });
    $('#addMore').onclick = closeOrder;
  };
  const fieldErr = (sel, text) => { const f = $(sel).closest('.field'); f.classList.add('bad'); f.querySelector('.err').textContent = text; $(sel).focus(); f.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const clearErr = sel => { const f = $(sel)?.closest('.field'); if (f) { f.classList.remove('bad'); f.querySelector('.err').textContent = ''; } };
  function drawOrder() {
    $('#orderBody').innerHTML = `<div id="orderItems">${orderItems()}</div>
      <div class="totals" id="orderTotals" aria-live="polite">${totals()}</div>
      <div class="field"><label for="ph">MoMo number</label><input id="ph" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" value="${esc(phoneNow.v)}"><span class="err" role="alert"></span><span class="hint">Your pickup code also comes here by text. Paying cash? Just order at the bar.</span></div>
      ${tipPart()}
      <div id="err"></div>`;
    $('#pay').disabled = false; payLabel(); bindItems();
    $('#ph').oninput = e => { phoneNow.v = e.target.value; clearErr('#ph'); };
    // A different tip is a different payment: a new order id, so the old payment isn't reused.
    const tipChanged = () => { newDraft(); $('#orderTotals').innerHTML = totals(); payLabel(); };
    $$('[data-tip]').forEach(x => x.onclick = () => {
      tipPick.tip = x.dataset.tip === 'other' ? 'other' : Number(x.dataset.tip);
      $$('[data-tip]').forEach(y => y.setAttribute('aria-pressed', String(y === x)));
      $('#tipOther').hidden = tipPick.tip !== 'other'; $('#tipWho').hidden = !tipPick.tip;
      clearErr('#tipAmt'); clearErr('#tipTo');
      if (tipPick.tip === 'other') $('#tipAmt').focus();
      tipChanged();
    });
    $('#tipAmt') && ($('#tipAmt').oninput = e => { tipPick.other = e.target.value; clearErr('#tipAmt'); tipChanged(); });
    $('#tipTo') && ($('#tipTo').onchange = e => { tipPick.to = e.target.value; clearErr('#tipTo'); tipChanged(); });
  }
  $('#pay').onclick = async () => {
    const btn = $('#pay'); $('#err').innerHTML = '';
    const phone = $('#ph').value;
    if (!normalizePhone(phone)) return fieldErr('#ph', 'Enter your MoMo number, e.g. 024 123 4567.');
    const t = tipNow();
    if (tipPick.tip === 'other' && t < 100) return fieldErr('#tipAmt', 'Enter the tip (at least GHS 1), or pick No tip.');
    if (t && !tipPick.to) return fieldErr('#tipTo', 'Pick who the tip is for.');
    btn.disabled = true; btn.textContent = 'Opening payment…';
    try {
      const o = await api('/api/guest/counter/checkout', { method: 'POST', body: { station, spot, items: Object.entries(cart).map(([itemId, qty]) => ({ itemId, qty })), phone, clientId, ...(t ? { tipPesewas: t, tipToUid: tipPick.to } : {}) } });
      store.set('mem-bar-momo', phone); store.set('mem-bar-order', o.orderId); store.set('mem-bar-cart', null); store.set('mem-bar-draft', null);
      location.href = o.authorizationUrl;
    } catch (e) { $('#err').innerHTML = msg(e.message, 'bad'); $('#err').scrollIntoView({ block: 'center', behavior: 'smooth' }); btn.disabled = false; btn.textContent = `Try again · ${money(grand())}`; }
  };

  // ── Step 1: the menu ──
  const draw = () => {
    const waiting = store.get('mem-bar-order');
    app.innerHTML = `${waiting ? `<a class="night-link" href="${esc(again())}&view=order">Your order at the bar: show the pickup code →</a>` : ''}${lastPaid() ? `<a class="night-link" href="${esc(again())}&view=night">My night: what I’ve spent</a>` : ''}
      <div class="find-bar"><label class="sr" for="find">Search drinks</label><input id="find" type="search" placeholder="Search drinks, e.g. Guinness" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" value="${esc(query)}">
        ${cats.length > 1 ? `<nav class="chips" id="chips" aria-label="Drink groups" ${query.trim() ? 'hidden' : ''}>${cats.map(c => `<a href="#${catId(c)}">${esc(c)}</a>`).join('')}</nav>` : ''}</div>
      <div id="menuList">${list()}</div>`;
    // Typing only redraws the list, so the keyboard stays open.
    $('#find').oninput = e => { query = e.target.value; refreshMenu(); };
    $('#find').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
    $$('#chips a').forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    viewDock();
  };
  const tipPart = () => {
    if (!r.tipPeople?.length) return '';
    const on = v => String(tipPick.tip === v);
    return `<div class="field"><span class="label" id="tipL">Add a tip? (optional)</span>
      <div class="tipseg" role="group" aria-labelledby="tipL">${TIPS.map(v => `<button type="button" data-tip="${v}" aria-pressed="${on(v)}">${v ? money(v) : 'No tip'}</button>`).join('')}<button type="button" data-tip="other" aria-pressed="${on('other')}">Other</button></div></div>
      <div class="field" id="tipOther" ${tipPick.tip === 'other' ? '' : 'hidden'}><label for="tipAmt">Tip amount (GHS)</label><input id="tipAmt" inputmode="decimal" autocomplete="off" placeholder="e.g. 15" value="${esc(tipPick.other)}"><span class="err" role="alert"></span></div>
      <div class="field" id="tipWho" ${tipPick.tip ? '' : 'hidden'}><label for="tipTo">Tip for</label><select id="tipTo"><option value="">Pick who it’s for</option>${r.tipPeople.map(p => `<option value="${esc(p.id)}" ${p.id === tipPick.to ? 'selected' : ''}>${esc(p.name)}${p.job ? ` · ${esc(p.job)}` : ''}</option>`).join('')}</select><span class="err" role="alert"></span>
        <span class="hint">The whole tip goes to them, not to the club.</span></div>`;
  };
  draw();
}
start();

// Scan to order: counter.html?s={stationToken}[&t={table}] (old /b/{token} links redirect here;
// Paystack sends the guest back to counter.html). Every link is relative, so it works wherever it's served.
// Pick drinks → pay by MoMo or card → the pickup code appears only once Paystack confirms the
// payment → show it at the bar. Paying cash? Order at the bar as usual.
import { api, esc, money, normalizePhone, $, $$ } from '../app.js';

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
let clientId = store.get('mem-bar-draft') || uuid(), timer = null;
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
    if (o.status === 'paid') {
      app.innerHTML = `<p class="kicker red" style="text-align:center">Show this at the bar</p><div class="pickup" aria-label="Pickup code">${esc(o.pickupCode)}</div>${lines}
        <p class="foot-small">We’ve also texted you the code. <a href="receipt.html?code=${esc(o.receiptCode)}">Receipt</a></p>`;
      navigator.wakeLock?.request('screen').catch(() => {});
      timer = setTimeout(poll, 8000); return;
    }
    store.set('mem-bar-order', null);
    if (o.status === 'delivered') { app.innerHTML = `${msg('Collected. Enjoy!', 'ok')}<div class="row-actions"><a class="btn red" href="${esc(again())}">Order again</a><a class="btn" href="receipt.html?code=${esc(o.receiptCode)}">Receipt</a></div>`; return; }
    if (o.status === 'payment_failed') { app.innerHTML = `${msg('Payment didn’t go through. Nothing was taken.', 'bad')}<div class="row-actions"><a class="btn red" href="${esc(again())}">Try again</a></div>`; return; }
    if (o.status === 'refund_due' || o.status === 'refunded') { app.innerHTML = `${msg(o.status === 'refunded' ? 'You’ve been refunded for this order.' : 'The bar couldn’t make your order. You’re owed a refund: staff will sort it. Keep this page, or the receipt.', 'bad')}${o.receiptCode ? `<a class="btn" href="receipt.html?code=${esc(o.receiptCode)}">Receipt</a>` : ''}`; return; }
    app.innerHTML = `${msg('This order was cancelled. Nothing was taken.')}<a class="btn red" href="${esc(again())}">Start again</a>`;
  };
  poll();
}

// ── The menu ──
async function start() {
  clearTimeout(timer);
  const open = store.get('mem-bar-order');
  if (open && (!fromQr || qs.get('reference'))) return showOrder(open);
  if (!station) { app.innerHTML = msg('Scan the QR code at the bar to order.'); return; }
  store.set('mem-bar-station', station); store.set('mem-bar-spot', spot || null);
  let r;
  try { r = await api(`/api/guest/menu?station=${encodeURIComponent(station)}`); }
  catch (e) { app.innerHTML = msg(e.message, 'bad'); return; }
  $('#label').textContent = r.station?.name || 'Bar order';
  $('#spot').textContent = spot ? `Table ${spot.replace(/^table\s*/i, '')}` : ''; $('#spot').hidden = !spot;
  if (!r.open) { app.innerHTML = msg('The bar isn’t taking app orders right now. Order at the bar.'); return; }
  const price = id => r.items.find(i => i.id === id)?.pricePesewas || 0;
  for (const id of Object.keys(cart)) if (!r.items.some(i => i.id === id && i.available)) delete cart[id];
  const total = () => Object.entries(cart).reduce((a, [id, q]) => a + q * price(id), 0);
  const count = () => Object.values(cart).reduce((a, q) => a + q, 0);
  const draw = () => {
    const cats = [...new Set(r.items.map(i => i.category))];
    app.innerHTML = `${cats.map(c => `<h2 class="cat">${esc(c)}</h2>${r.items.filter(i => i.category === c).map(i => `<div class="drink ${i.available ? '' : 'out'}"><div class="grow">${esc(i.name)}<small>${money(i.pricePesewas)}${i.available ? '' : ' · out tonight'}</small></div>
      ${i.available ? `<div class="stepper"><button type="button" data-m="${esc(i.id)}" aria-label="One fewer ${esc(i.name)}">−</button><span aria-live="polite">${cart[i.id] || 0}</span><button type="button" data-p="${esc(i.id)}" aria-label="One more ${esc(i.name)}">+</button></div>` : ''}</div>`).join('')}`).join('')}
      <div class="field" style="margin-top:14px"><label for="ph">MoMo number</label><input id="ph" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" value="${esc(store.get('mem-bar-momo') || '')}"><span class="hint">Your pickup code also comes here by text. Paying cash? Just order at the bar.</span></div>
      <div id="err"></div>`;
    $$('[data-p],[data-m]').forEach(b => b.onclick = () => {
      const id = b.dataset.p || b.dataset.m;
      cart[id] = Math.max(0, Math.min(20, (cart[id] || 0) + (b.dataset.p ? 1 : -1))); if (!cart[id]) delete cart[id];
      // A changed basket is a new order; the same basket paid twice is the same order.
      clientId = uuid(); store.set('mem-bar-draft', clientId); store.set('mem-bar-cart', cart);
      draw();
    });
    dock(total() ? `${money(total())}<small>${count()} drink${count() > 1 ? 's' : ''}</small>` : '', total() ? `Pay ${money(total())}` : '', async btn => {
      const phone = $('#ph').value;
      if (!normalizePhone(phone)) { $('#err').innerHTML = msg('Enter your MoMo number, e.g. 024 123 4567.', 'bad'); return $('#ph').focus(); }
      btn.disabled = true; btn.textContent = 'Opening payment…';
      try {
        const o = await api('/api/guest/counter/checkout', { method: 'POST', body: { station, spot, items: Object.entries(cart).map(([itemId, qty]) => ({ itemId, qty })), phone, clientId } });
        store.set('mem-bar-momo', phone); store.set('mem-bar-order', o.orderId); store.set('mem-bar-cart', null); store.set('mem-bar-draft', null);
        location.href = o.authorizationUrl;
      } catch (e) { $('#err').innerHTML = msg(e.message, 'bad'); btn.disabled = false; btn.textContent = 'Try again'; }
    });
  };
  draw();
}
start();

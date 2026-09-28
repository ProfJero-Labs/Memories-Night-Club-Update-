// tables.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, normalizePhone, api, esc, params, money, img, $, $$, errorState, shortDate, doors, remember } from '../app.js';
chrome('tables');
const root = $('#root');
const S = { eventId: params.get('event') || '', pkg: '', bottles: {}, step: 1, ...(({ name = '', phone = '', email = '' }) => ({ name, phone, email }))(remember.get()) };
let events = [], B = null;
const phoneOk = p => normalizePhone(p) !== null;
const pkg = () => B?.tablePackages.find(p => p.id === S.pkg);
const bottleTotal = () => Object.entries(S.bottles).reduce((s, [id, q]) => s + q * (B.bottles.find(b => b.id === id)?.pricePesewas || 0), 0);
const total = () => (pkg()?.pricePesewas || 0) + bottleTotal();
const bottleCount = () => Object.values(S.bottles).reduce((a, b) => a + b, 0);

function stepsBar() { const n = B?.bottles.length ? 4 : 3; const cur = S.step === 4 && n === 3 ? 3 : S.step; return `<div class="steps" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('')}</div>`; }
function bar(label, enabled) {
  return `<div class="tbar"><div class="sum">${money(total())}<small>${esc(pkg()?.name || 'Pick a table')}${bottleCount() ? ` + ${bottleCount()} bottle${bottleCount() > 1 ? 's' : ''}` : ''}</small></div><button class="btn red" data-next ${enabled ? '' : 'disabled'}>${label} <span class="arrow">→</span></button></div>`;
}

function render() {
  const s = S.step;
  if (s === 1) {
    root.innerHTML = `${stepsBar()}<div class="step" style="margin-top:22px"><h2 class="display">Which night?</h2>
      <div class="night-pick" role="radiogroup" aria-label="Night">${events.map(e => `<button type="button" role="radio" aria-checked="${S.eventId === e.id}" data-ev="${esc(e.id)}">${img(e.artwork, '') || '<span></span>'}<span><span class="n">${esc(e.name)}</span><span class="d" style="display:block">${esc(shortDate(e.date))} · ${esc(doors(e))}</span></span><span aria-hidden="true">→</span></button>`).join('')}</div></div>`;
    $$('[data-ev]').forEach(b => b.onclick = () => pick(b.dataset.ev));
    return;
  }
  if (s === 2) {
    root.innerHTML = `${stepsBar()}<div class="step" style="margin-top:22px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><button class="link" data-back>← ${esc(B.event.name)}</button><span class="kicker">${esc(shortDate(B.event.date))}</span></div>
      <h2 class="display">Pick your table</h2>
      <div class="tiers" role="radiogroup" aria-label="Table">${B.tablePackages.map(p => `<button type="button" class="tier" role="radio" aria-checked="${S.pkg === p.id}" data-pkg="${esc(p.id)}" ${p.soldOut ? 'disabled' : ''}>
        <span class="n">${esc(p.name)}</span><span class="p">${money(p.pricePesewas)}</span>
        <span class="i">${p.soldOut ? 'Fully booked' : [p.capacity ? `Up to ${p.capacity} people` : '', p.includes, p.lastFew ? 'Last few' : ''].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</span></button>`).join('')}</div>
      ${bar(B.bottles.length ? 'Bottles' : 'Review', !!S.pkg)}</div>`;
    $$('[data-pkg]').forEach(b => b.onclick = () => { S.pkg = b.dataset.pkg; render(); });
  }
  if (s === 3) {
    const cats = [...new Set(B.bottles.map(b => b.category || 'Bottles'))];
    root.innerHTML = `${stepsBar()}<div class="step" style="margin-top:22px">
      <button class="link" data-back style="justify-self:start">← ${esc(pkg().name)}</button>
      <h2 class="display">The bar</h2><p class="muted" style="margin:-10px 0 0">Add what you want on the table. Prices are the bill, nothing on top.</p>
      <div>${cats.map(c => `<div class="menu-cat">${esc(c)}</div>${B.bottles.filter(b => (b.category || 'Bottles') === c).map(b => `
        <div class="menu-item ${S.bottles[b.id] ? 'on' : ''}"><div><div class="nm"><span>${esc(b.name)}</span><i></i><span class="pr">${money(b.pricePesewas)}</span></div>${b.soldOut ? '<small class="muted">Out tonight</small>' : ''}</div>
          <div class="mini-qty"><button type="button" data-dec="${esc(b.id)}" aria-label="Remove one ${esc(b.name)}">−</button><output aria-live="polite">${S.bottles[b.id] || 0}</output><button type="button" data-inc="${esc(b.id)}" aria-label="Add one ${esc(b.name)}" ${b.soldOut ? 'disabled' : ''}>+</button></div></div>`).join('')}`).join('')}</div>
      ${bar('Review', true)}</div>`;
    $$('[data-inc]').forEach(b => b.onclick = () => { S.bottles[b.dataset.inc] = Math.min(50, (S.bottles[b.dataset.inc] || 0) + 1); render(); });
    $$('[data-dec]').forEach(b => b.onclick = () => { const q = (S.bottles[b.dataset.dec] || 0) - 1; if (q > 0) S.bottles[b.dataset.dec] = q; else delete S.bottles[b.dataset.dec]; render(); });
  }
  if (s === 4) {
    const lines = Object.entries(S.bottles).map(([id, q]) => { const b = B.bottles.find(x => x.id === id); return `<div class="r"><span>${q} × ${esc(b.name)}</span><span>${money(q * b.pricePesewas)}</span></div>`; }).join('');
    root.innerHTML = `${stepsBar()}<form class="step" id="rev" novalidate style="margin-top:22px">
      <button class="link" type="button" data-back style="justify-self:start">← Change</button>
      <h2 class="display">Your table</h2>
      <div class="receipt"><h3>${esc(B.event.name)}</h3><span class="kicker" style="color:var(--teal)">${esc(shortDate(B.event.date))} · ${esc(doors(B.event))}</span>
        <div class="r" style="margin-top:8px"><b>${esc(pkg().name)}</b><b>${money(pkg().pricePesewas)}</b></div>${lines}
        <div class="r t"><span>Total</span><span>${money(total())}</span></div></div>
      <div class="field" id="fName"><label for="name">Booking name</label><input id="name" autocomplete="name" value="${esc(S.name)}" required></div>
      <div class="field" id="fPhone"><label for="phone">Phone</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" value="${esc(S.phone)}" required><span class="hint">We text your confirmation here.</span></div>
      <div class="notice" id="err" hidden role="alert"></div>
      <button class="btn red block" type="submit" id="pay">Pay ${money(total())} <span class="arrow">→</span></button>
      <p class="foot-small" style="margin:0">Paid in full by Paystack (MoMo or card). Your table is held once it’s paid.</p></form>`;
    $('#rev').onsubmit = pay;
  }
  $$('[data-back]').forEach(b => b.onclick = () => { S.step = S.step === 4 && !B.bottles.length ? 2 : S.step - 1; render(); });
  $$('[data-next]').forEach(b => b.onclick = () => { S.step = S.step === 2 && !B.bottles.length ? 4 : S.step + 1; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

async function pick(id) {
  S.eventId = id; S.pkg = ''; S.bottles = {};
  root.innerHTML = '<div class="loading" role="status">PULLING UP THE TABLES…</div>';
  try { B = await api(`/api/events/${encodeURIComponent(id)}`); }
  catch (e) {
    if (e.status === 404) {
      root.innerHTML = `<div class="state-msg"><h2 class="display">This night isn’t on.</h2><p>It may have ended or moved.</p><button class="btn red" id="other">See what’s on</button></div>`;
      $('#other').onclick = () => { S.step = 1; render(); };
      return;
    }
    return errorState(root, e.message, () => pick(id));
  }
  if (!B.tablePackages.length) { root.innerHTML = `<div class="state-msg"><h2 class="display">No tables online for this night.</h2><p>Message us and we’ll sort you out.</p><button class="btn" id="other">Pick another night</button></div>`; $('#other').onclick = () => { S.step = 1; render(); }; return; }
  S.step = 2; render();
}

async function pay(ev) {
  ev.preventDefault();
  S.name = $('#name').value.trim(); S.phone = $('#phone').value.trim();
  const err = $('#err'); err.hidden = true;
  if (S.name.length < 2) { err.hidden = false; err.textContent = 'Add a name for the booking.'; return $('#name').focus(); }
  if (!phoneOk(S.phone)) { err.hidden = false; err.textContent = 'Use a Ghana number, e.g. 024 123 4567.'; return $('#phone').focus(); }
  remember.set({ ...remember.get(), name: S.name, phone: S.phone });
  const btn = $('#pay'); btn.disabled = true; btn.textContent = 'Opening payment…';
  try {
    const d = await api('/api/table-checkout/initiate', { method: 'POST', body: { eventId: B.event.id, packageId: S.pkg, name: S.name, phone: S.phone, email: S.email || undefined, bottles: Object.entries(S.bottles).map(([id, quantity]) => ({ id, quantity })) } });
    location.href = d.authorizationUrl;
  } catch (e) { err.hidden = false; err.textContent = e.message; btn.disabled = false; btn.innerHTML = `Pay ${money(total())} <span class="arrow">→</span>`; }
}

async function load() {
  try { events = (await api('/api/events')).events.filter(e => !e.soldOut); }
  catch (e) { return errorState(root, e.message, load); }
  if (!events.length) { root.innerHTML = '<div class="state-msg"><h2 class="display">No nights on sale yet.</h2><p>Tables open when the next night drops.</p><a class="btn red" href="private.html">Book an event</a></div>'; return; }
  if (S.eventId && events.some(e => e.id === S.eventId)) pick(S.eventId); else render();
}
load();

// tables.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
// Tables are reserved, not paid online (owner's rule, November 2026): night → table → name, phone
// and the time they'll arrive. The table is held until an hour after that time. They pay at the club.
// A table's price is its minimum spend: the drinks they pick count towards it (nothing is added on
// top), and they can ask for a drink that isn't on the menu.
import { chrome, normalizePhone, api, esc, params, money, img, $, $$, errorState, shortDate, doors, remember, forgetButton, bindForget } from '../app.js';
chrome('tables');
const root = $('#root');
const S = { eventId: params.get('event') || '', pkg: '', arrive: '', bottles: {}, request: '', done: null, step: 1, ...(({ name = '', phone = '', email = '' }) => ({ name, phone, email }))(remember.get()) };
let events = [], B = null;
const phoneOk = p => normalizePhone(p) !== null;
const pkg = () => B?.tablePackages.find(p => p.id === S.pkg);
const minSpend = () => pkg()?.pricePesewas || 0;
const drinksTotal = () => Object.entries(S.bottles).reduce((n, [id, q]) => n + q * (B?.bottles.find(b => b.id === id)?.pricePesewas || 0), 0);
const bill = () => Math.max(minSpend(), drinksTotal());
// How far the drinks are towards the table's minimum spend, in plain words.
function towards() {
  const min = minSpend(), d = drinksTotal();
  if (!d) return `Minimum spend ${money(min)}`;
  return d >= min ? `${money(d)} of drinks · minimum reached` : `${money(d)} of ${money(min)} · ${money(min - d)} to go`;
}
const HOLD_MINUTES = 60, WINDOW_HOURS = 6;
const clock = ms => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
// Every half hour from the night's start, for six hours (Ghana is on UTC, so HH:MM is the same).
function arrivalTimes(ev) {
  const start = Date.parse(ev.date); if (!Number.isFinite(start)) return [];
  const first = Math.ceil(start / 18e5) * 18e5;
  return Array.from({ length: WINDOW_HOURS * 2 + 1 }, (_, i) => first + i * 18e5).filter(t => t <= start + WINDOW_HOURS * 36e5)
    .map(t => ({ value: new Date(t).toISOString().slice(11, 16), label: clock(t), until: clock(t + HOLD_MINUTES * 6e4) }));
}
function stepsBar() { return `<div class="steps" aria-hidden="true">${[1, 2, 3, 4].map(i => `<i class="${i <= S.step ? 'on' : ''}"></i>`).join('')}</div>`; }

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
        <span class="n">${esc(p.name)}</span><span class="p">${money(p.pricePesewas)} <small style="font-size:.55em;letter-spacing:0">min. spend</small></span>
        <span class="i">${p.soldOut ? 'Fully booked' : [p.capacity ? `Up to ${p.capacity} people` : '', p.includes, p.lastFew ? 'Last few' : ''].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</span></button>`).join('')}</div>
      <p class="muted" style="margin:0">The table’s price is its minimum spend: the drinks you pick count towards it. Nothing to pay now, you pay at the club.</p>
      <div class="tbar"><div class="sum">${esc(pkg()?.name || 'Pick a table')}<small>${pkg() ? `Minimum spend ${money(pkg().pricePesewas)}` : 'Reserve now, pay at the club'}</small></div><button class="btn red" data-next ${S.pkg ? '' : 'disabled'}>Drinks <span class="arrow">→</span></button></div></div>`;
    $$('[data-pkg]').forEach(b => b.onclick = () => { S.pkg = b.dataset.pkg; render(); });
  }
  if (s === 3) {
    const cats = [...new Set(B.bottles.map(b => b.category || 'Bottles'))];
    const min = minSpend(), d = drinksTotal(), pct = min ? Math.min(100, Math.round(d / min * 100)) : 100;
    root.innerHTML = `${stepsBar()}<div class="step" style="margin-top:22px">
      <button class="link" data-back style="justify-self:start">← ${esc(pkg().name)}</button>
      <h2 class="display">Your drinks</h2>
      <p class="muted" style="margin:-10px 0 0">Pick drinks up to the table’s minimum spend of <b>${money(min)}</b>. They count towards it: nothing is added on top. You can also skip this and choose at the club.</p>
      <div role="progressbar" aria-label="Towards the minimum spend" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" style="height:8px;border-radius:4px;background:rgba(127,127,127,.25);overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--teal)"></div></div>
      ${B.bottles.length ? `<div>${cats.map(c => `<div class="menu-cat">${esc(c)}</div>${B.bottles.filter(b => (b.category || 'Bottles') === c).map(b => `
        <div class="menu-item ${S.bottles[b.id] ? 'on' : ''}"><div><div class="nm"><span>${esc(b.name)}</span><i></i><span class="pr">${money(b.pricePesewas)}</span></div>${b.soldOut ? '<small class="muted">Out tonight</small>' : ''}</div>
          <div class="mini-qty"><button type="button" data-dec="${esc(b.id)}" aria-label="Remove one ${esc(b.name)}">−</button><output aria-live="polite">${S.bottles[b.id] || 0}</output><button type="button" data-inc="${esc(b.id)}" aria-label="Add one ${esc(b.name)}" ${b.soldOut ? 'disabled' : ''}>+</button></div></div>`).join('')}`).join('')}</div>` : ''}
      <div class="field"><label for="req">Want a drink that isn’t listed?</label><textarea id="req" maxlength="300" rows="2" placeholder="e.g. a bottle of Hennessy XO">${esc(S.request)}</textarea><span class="hint">We’ll check it’s in and have it ready. It’s charged at the club’s price and counts towards the minimum.</span></div>
      <div class="tbar"><div class="sum">${money(bill())}<small>${esc(towards())}</small></div><button class="btn red" data-next>Next <span class="arrow">→</span></button></div></div>`;
    const keep = () => { S.request = $('#req').value; };
    $('#req').oninput = keep;
    $$('[data-inc]').forEach(b => b.onclick = () => { keep(); S.bottles[b.dataset.inc] = Math.min(50, (S.bottles[b.dataset.inc] || 0) + 1); render(); });
    $$('[data-dec]').forEach(b => b.onclick = () => { keep(); const q = (S.bottles[b.dataset.dec] || 0) - 1; if (q > 0) S.bottles[b.dataset.dec] = q; else delete S.bottles[b.dataset.dec]; render(); });
  }
  if (s === 4) {
    const times = arrivalTimes(B.event);
    root.innerHTML = `${stepsBar()}<form class="step" id="rev" novalidate style="margin-top:22px">
      <button class="link" type="button" data-back style="justify-self:start">← Change</button>
      <h2 class="display">Reserve your table</h2>
      <div class="receipt"><h3>${esc(B.event.name)}</h3><span class="kicker" style="color:var(--teal)">${esc(shortDate(B.event.date))} · ${esc(doors(B.event))}</span>
        <div class="r" style="margin-top:8px"><b>${esc(pkg().name)}</b><span>Minimum spend ${money(minSpend())}</span></div>
        ${Object.entries(S.bottles).map(([id, q]) => { const b = B.bottles.find(x => x.id === id); return b ? `<div class="r"><span>${q} × ${esc(b.name)}</span><span>${money(q * b.pricePesewas)}</span></div>` : ''; }).join('')}
        ${S.request.trim() ? `<div class="r"><span>You asked for: ${esc(S.request.trim())}</span><span>club’s price</span></div>` : ''}
        ${drinksTotal() < minSpend() ? `<div class="r"><span>${drinksTotal() ? 'Left to spend on drinks at the club' : 'To spend on drinks at the club'}</span><span>${money(minSpend() - drinksTotal())}</span></div>` : ''}
        <div class="r"><span>Your bill at the club</span><span>${S.request.trim() ? 'from ' : ''}${money(bill())}</span></div>
        <div class="r t"><span>To pay now</span><span>GHS 0</span></div></div>
      <div class="field" id="fName"><label for="name">Booking name</label><input id="name" autocomplete="name" value="${esc(S.name)}" required></div>
      <div class="field" id="fPhone"><label for="phone">Phone</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" value="${esc(S.phone)}" required><span class="hint">We text your booking here.</span></div>
      <div class="field" id="fTime"><label for="arrive">What time will you arrive?</label><select id="arrive" required><option value="">Pick a time</option>${times.map(t => `<option value="${esc(t.value)}" data-until="${esc(t.until)}" ${S.arrive === t.value ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select><span class="hint" id="holdHint">We hold your table for one hour after this time.</span></div>
      <div class="notice" role="note"><b>Please be on time.</b> If you’re not here within an hour of the time you pick, your table may go to someone else.</div>
      ${forgetButton()}
      <div class="notice" id="err" hidden role="alert"></div>
      <button class="btn red block" type="submit" id="go">Reserve the table <span class="arrow">→</span></button>
      <p class="foot-small" style="margin:0">No payment now. At the club you pay for your drinks, at least the table’s minimum spend, in cash, MoMo or card.</p></form>`;
    const hint = () => { const o = $('#arrive').selectedOptions[0]; $('#holdHint').textContent = o?.dataset.until ? `We hold your table until ${o.dataset.until}.` : 'We hold your table for one hour after this time.'; };
    $('#arrive').onchange = () => { S.arrive = $('#arrive').value; hint(); }; hint();
    $('#rev').onsubmit = reserve;
    bindForget(document, ['name', 'phone'], () => { S.name = S.phone = S.email = ''; });
  }
  if (s === 5) {
    const d = S.done;
    root.innerHTML = `<div class="state-msg"><h2 class="display">Your table is reserved</h2>
      <p><b>${esc(d.packageName)}</b> · ${esc(B.event.name)}, ${esc(shortDate(B.event.date))}</p>
      <p>Arriving ${esc(d.arriveLabel)}. We hold it until <b>${esc(d.holdLabel)}</b>.</p>
      <p>Minimum spend <b>${money(d.minSpendPesewas)}</b>${d.drinksPesewas ? `: your drinks (${money(d.drinksPesewas)}) count towards it` : ', spent on drinks at the club'}.${d.drinkRequest ? ` We’ve noted your request: ${esc(d.drinkRequest)}.` : ''}</p>
      <p>At the door, show <b>${esc(d.code)}</b> or give your name. Nothing to pay now: you pay at the club.</p>
      <p class="muted">We’ve texted this to you.</p><a class="btn" href="index.html">Done</a></div>`;
    return;
  }
  $$('[data-back]').forEach(b => b.onclick = () => { S.step -= 1; render(); });
  $$('[data-next]').forEach(b => b.onclick = () => { S.step += 1; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

async function pick(id) {
  S.eventId = id; S.pkg = ''; S.arrive = ''; S.bottles = {}; S.request = '';
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

async function reserve(ev) {
  ev.preventDefault();
  S.name = $('#name').value.trim(); S.phone = $('#phone').value.trim(); S.arrive = $('#arrive').value;
  const err = $('#err'); err.hidden = true;
  if (S.name.length < 2) { err.hidden = false; err.textContent = 'Add a name for the booking.'; return $('#name').focus(); }
  if (!phoneOk(S.phone)) { err.hidden = false; err.textContent = 'Use a Ghana number, e.g. 024 123 4567.'; return $('#phone').focus(); }
  if (!S.arrive) { err.hidden = false; err.textContent = 'Pick the time you’ll arrive.'; return $('#arrive').focus(); }
  remember.set({ ...remember.get(), name: S.name, phone: S.phone });
  const btn = $('#go'); btn.disabled = true; btn.textContent = 'Reserving…';
  try {
    S.done = await api('/api/table-reserve', { method: 'POST', body: { eventId: B.event.id, packageId: S.pkg, name: S.name, phone: S.phone, email: S.email || undefined, arriveTime: S.arrive, bottles: Object.entries(S.bottles).map(([id, quantity]) => ({ id, quantity })), drinkRequest: S.request.trim() || undefined } });
    S.step = 5; render(); window.scrollTo({ top: 0 });
  } catch (e) { err.hidden = false; err.textContent = e.message; btn.disabled = false; btn.innerHTML = 'Reserve the table <span class="arrow">→</span>'; }
}

async function load() {
  try { events = (await api('/api/events')).events.filter(e => !e.soldOut); }
  catch (e) { return errorState(root, e.message, load); }
  if (!events.length) { root.innerHTML = '<div class="state-msg"><h2 class="display">No nights on sale yet.</h2><p>Tables open when the next night drops.</p><a class="btn red" href="private.html">Book an event</a></div>'; return; }
  if (S.eventId && events.some(e => e.id === S.eventId)) pick(S.eventId); else render();
}
load();

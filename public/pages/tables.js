// tables.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
// Tables are reserved, not paid online (owner's rule, November 2026): night → table → name, phone
// and the time they'll arrive. The table is held until an hour after that time. They pay at the club.
import { chrome, normalizePhone, api, esc, params, money, img, $, $$, errorState, shortDate, doors, remember, forgetButton, bindForget } from '../app.js';
chrome('tables');
const root = $('#root');
const S = { eventId: params.get('event') || '', pkg: '', arrive: '', done: null, step: 1, ...(({ name = '', phone = '', email = '' }) => ({ name, phone, email }))(remember.get()) };
let events = [], B = null;
const phoneOk = p => normalizePhone(p) !== null;
const pkg = () => B?.tablePackages.find(p => p.id === S.pkg);
const HOLD_MINUTES = 60, WINDOW_HOURS = 6;
const clock = ms => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
// Every half hour from the night's start, for six hours (Ghana is on UTC, so HH:MM is the same).
function arrivalTimes(ev) {
  const start = Date.parse(ev.date); if (!Number.isFinite(start)) return [];
  const first = Math.ceil(start / 18e5) * 18e5;
  return Array.from({ length: WINDOW_HOURS * 2 + 1 }, (_, i) => first + i * 18e5).filter(t => t <= start + WINDOW_HOURS * 36e5)
    .map(t => ({ value: new Date(t).toISOString().slice(11, 16), label: clock(t), until: clock(t + HOLD_MINUTES * 6e4) }));
}
function stepsBar() { return `<div class="steps" aria-hidden="true">${[1, 2, 3].map(i => `<i class="${i <= S.step ? 'on' : ''}"></i>`).join('')}</div>`; }

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
      <p class="muted" style="margin:0">Nothing to pay now. You pay at the club.</p>
      <div class="tbar"><div class="sum">${esc(pkg()?.name || 'Pick a table')}<small>${pkg() ? `${money(pkg().pricePesewas)}, paid at the club` : 'Reserve now, pay at the club'}</small></div><button class="btn red" data-next ${S.pkg ? '' : 'disabled'}>Next <span class="arrow">→</span></button></div></div>`;
    $$('[data-pkg]').forEach(b => b.onclick = () => { S.pkg = b.dataset.pkg; render(); });
  }
  if (s === 3) {
    const times = arrivalTimes(B.event);
    root.innerHTML = `${stepsBar()}<form class="step" id="rev" novalidate style="margin-top:22px">
      <button class="link" type="button" data-back style="justify-self:start">← Change</button>
      <h2 class="display">Reserve your table</h2>
      <div class="receipt"><h3>${esc(B.event.name)}</h3><span class="kicker" style="color:var(--teal)">${esc(shortDate(B.event.date))} · ${esc(doors(B.event))}</span>
        <div class="r" style="margin-top:8px"><b>${esc(pkg().name)}</b><b>${money(pkg().pricePesewas)}</b></div>
        <div class="r t"><span>To pay now</span><span>GHS 0</span></div></div>
      <div class="field" id="fName"><label for="name">Booking name</label><input id="name" autocomplete="name" value="${esc(S.name)}" required></div>
      <div class="field" id="fPhone"><label for="phone">Phone</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" value="${esc(S.phone)}" required><span class="hint">We text your booking here.</span></div>
      <div class="field" id="fTime"><label for="arrive">What time will you arrive?</label><select id="arrive" required><option value="">Pick a time</option>${times.map(t => `<option value="${esc(t.value)}" data-until="${esc(t.until)}" ${S.arrive === t.value ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select><span class="hint" id="holdHint">We hold your table for one hour after this time.</span></div>
      <div class="notice" role="note"><b>Please be on time.</b> If you’re not here within an hour of the time you pick, your table may go to someone else.</div>
      ${forgetButton()}
      <div class="notice" id="err" hidden role="alert"></div>
      <button class="btn red block" type="submit" id="go">Reserve the table <span class="arrow">→</span></button>
      <p class="foot-small" style="margin:0">No payment now. You pay for the table and your drinks at the club, in cash, MoMo or card.</p></form>`;
    const hint = () => { const o = $('#arrive').selectedOptions[0]; $('#holdHint').textContent = o?.dataset.until ? `We hold your table until ${o.dataset.until}.` : 'We hold your table for one hour after this time.'; };
    $('#arrive').onchange = () => { S.arrive = $('#arrive').value; hint(); }; hint();
    $('#rev').onsubmit = reserve;
    bindForget(document, ['name', 'phone'], () => { S.name = S.phone = S.email = ''; });
  }
  if (s === 4) {
    const d = S.done;
    root.innerHTML = `<div class="state-msg"><h2 class="display">Your table is reserved</h2>
      <p><b>${esc(d.packageName)}</b> · ${esc(B.event.name)}, ${esc(shortDate(B.event.date))}</p>
      <p>Arriving ${esc(d.arriveLabel)}. We hold it until <b>${esc(d.holdLabel)}</b>.</p>
      <p>At the door, show <b>${esc(d.code)}</b> or give your name. Nothing to pay now: you pay at the club.</p>
      <p class="muted">We’ve texted this to you.</p><a class="btn" href="index.html">Done</a></div>`;
    return;
  }
  $$('[data-back]').forEach(b => b.onclick = () => { S.step -= 1; render(); });
  $$('[data-next]').forEach(b => b.onclick = () => { S.step += 1; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

async function pick(id) {
  S.eventId = id; S.pkg = ''; S.arrive = '';
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
    S.done = await api('/api/table-reserve', { method: 'POST', body: { eventId: B.event.id, packageId: S.pkg, name: S.name, phone: S.phone, email: S.email || undefined, arriveTime: S.arrive } });
    S.step = 4; render(); window.scrollTo({ top: 0 });
  } catch (e) { err.hidden = false; err.textContent = e.message; btn.disabled = false; btn.innerHTML = 'Reserve the table <span class="arrow">→</span>'; }
}

async function load() {
  try { events = (await api('/api/events')).events.filter(e => !e.soldOut); }
  catch (e) { return errorState(root, e.message, load); }
  if (!events.length) { root.innerHTML = '<div class="state-msg"><h2 class="display">No nights on sale yet.</h2><p>Tables open when the next night drops.</p><a class="btn red" href="private.html">Book an event</a></div>'; return; }
  if (S.eventId && events.some(e => e.id === S.eventId)) pick(S.eventId); else render();
}
load();

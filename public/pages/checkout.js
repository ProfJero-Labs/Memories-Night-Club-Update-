// checkout.html: one page, one job. Details, an optional line, how to pay, pay.
//   checkout.html?event={id}&type={typeId}&qty={n}   (the ticket was chosen on tickets.html)
import { chrome, normalizePhone, api, esc, params, money, $, $$, errorState, remember, claims, shortDate, time, forgetButton, bindForget, BITS_ACK_TEXT } from '../app.js';
import { ticketHTML } from '../ticket-art.js';
chrome();

const root = $('#root');
const eventId = params.get('event') || '';
const qty = Math.min(6, Math.max(1, Math.floor(Number(params.get('qty'))) || 1));
const S = { name: '', phone: '', email: '', line: '', mode: 'full', deposit: '', ack: false };
Object.assign(S, (({ name = '', phone = '', email = '' }) => ({ name, phone, email }))(remember.get()));
let B, T;

// The line and how they chose to pay survive "Change" → back to tickets → "Continue" (this tab only).
const draftKey = () => `mem-checkout-${eventId}`;
const loadDraft = () => { try { return JSON.parse(sessionStorage.getItem(draftKey()) || '{}'); } catch { return {}; } };
const saveDraft = () => { try { sessionStorage.setItem(draftKey(), JSON.stringify({ line: S.line, mode: S.mode, deposit: S.deposit })); } catch { /* private mode */ } };

const phoneOk = p => normalizePhone(p) !== null;
const first = n => n.trim().split(/\s+/)[0] || '';
const total = () => T.pricePesewas * qty;
const hasLines = () => B.lines.length > 0;
const ticketsUrl = () => `tickets.html?event=${encodeURIComponent(B.event.id)}&type=${encodeURIComponent(T.id)}&qty=${qty}`;
// Pay in bits closes when the night starts (that's when an unpaid order is forfeited).
const bitsOpen = () => new Date(B.event.date).getTime() > Date.now();
const deadline = () => `${shortDate(B.event.date)}, ${time(B.event.date)}`;
const preview = () => ticketHTML({ line: S.line, firstName: first(S.name), eventName: B.event.name, eventId: B.event.id, ticketStyle: B.event.ticketStyle, ticketColors: B.event.ticketColors, autoStyle: B.event.autoStyle, date: B.event.date, doors: B.event.doors, venue: B.event.venue, artwork: B.event.artwork, type: T.name, admits: T.admits, inDraw: false }, { preview: true });
function refreshPreview() { $$('[data-preview]').forEach(el => { el.innerHTML = preview(); }); }

// Radio groups made of buttons: click, or arrow keys to move (one tab stop per group).
function radios(group, onPick) {
  const items = () => $$('[role=radio]', group);
  const sync = () => { const list = items(); const on = list.find(b => b.getAttribute('aria-checked') === 'true') || list[0]; list.forEach(b => { b.tabIndex = b === on ? 0 : -1; }); };
  group.addEventListener('click', e => { const b = e.target.closest('[role=radio]'); if (b) { onPick(b); sync(); } });
  group.addEventListener('keydown', e => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (!step) return;
    e.preventDefault();
    const list = items(), i = list.indexOf(document.activeElement), next = list[(i + step + list.length) % list.length];
    next.focus(); onPick(next); sync();
  });
  sync();
}

function shell() {
  const lines = hasLines() ? `<div role="radiogroup" aria-label="Your line" id="lineGroup"><ol class="lines">${B.lines.map((l, i) => `<li><button type="button" class="line-btn" role="radio" aria-checked="${S.line === l}" data-line="${esc(l)}"><span class="no">${String(i + 1).padStart(2, '0')}</span><span class="tx">${esc(l)}</span><span class="mk" aria-hidden="true">✓</span></button></li>`).join('')}</ol></div>` : '';
  // One job: who the ticket is for, then pay. The phone is the only thing we need (the ticket goes
  // there by text); everything optional is folded away, and Pay in bits is a quiet second path.
  root.innerHTML = `<div class="flow with-aside">
    <form id="co" class="step" novalidate>
      <div class="for"><a class="link" href="${ticketsUrl()}">← Change ticket</a><span class="kicker">${esc(shortDate(B.event.date))}</span></div>
      <h1 class="display">Your details</h1>
      <div class="summary"><div class="r"><span>${qty} × ${esc(T.name)} · ${esc(B.event.name)}</span><b>${money(total())}</b></div></div>

      <div class="field" id="fPhone"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" required value="${esc(S.phone)}"><span class="hint">Your ticket comes here by text.</span></div>
      <div class="field" id="fName"><label for="name">Your name <span class="muted" style="font-weight:400">(optional)</span></label><input id="name" name="name" autocomplete="name" autocapitalize="words" maxlength="80" value="${esc(S.name)}"><span class="hint">First name goes big on the ticket.</span></div>
      ${forgetButton()}
      <details class="fold" ${S.email ? 'open' : ''}><summary>Email me a receipt too (optional)</summary>
        <div class="field" style="margin-top:10px"><label for="email" class="sr">Email</label><input id="email" type="email" autocomplete="email" inputmode="email" value="${esc(S.email)}"></div></details>
      <details class="fold" id="lineBox" ${S.line ? 'open' : ''}><summary>Add a line to your ticket (optional)</summary>
        <div style="display:grid;gap:16px;margin-top:12px">
          <p class="muted" style="margin:0">It goes big on your ticket and your share image. Skip it and your ticket leads with the night’s name.</p>
          ${lines}
          <div class="field" id="fLine"><label for="ownLine">${hasLines() ? 'Or write your own' : 'Write your line'}</label><input id="ownLine" maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="e.g. BIRTHDAY GIRL" value="${esc(B.lines.includes(S.line) ? '' : S.line)}"><span class="hint">Up to 40 characters.</span></div>
          <button type="button" class="link" id="noLine" style="justify-self:start" ${S.line ? '' : 'hidden'}>No line, thanks</button>
        </div></details>

      <div id="bitsBox" class="bits-box" hidden>
        <div class="section-title"><h2>Pay in bits</h2><button type="button" class="link" id="fullMode">Pay it all instead</button></div>
        <p class="muted" style="margin:0">Pay part now, the rest before ${esc(deadline())}. Your ticket arrives when it’s fully paid.</p>
        <div class="field" id="fDep"><label for="dep">Pay now</label><div class="money-in"><input id="dep" type="number" inputmode="decimal" min="1" max="${total() / 100}" step="0.01" value="${esc(S.deposit)}" placeholder="Any amount"></div><span class="hint" id="depHint">Any amount up to ${money(total())}.</span></div>
        <label class="check ack" id="fAck"><input type="checkbox" id="ack" ${S.ack ? 'checked' : ''}> <span>${esc(BITS_ACK_TEXT)}</span></label>
        <div class="notice" id="bitsNote">Pay the rest before ${esc(deadline())}. Unpaid balances are forfeited once the night starts.</div>
      </div>

      <div class="notice" id="payErr" hidden role="alert"></div>
      <div class="pay-dock"><button class="btn red block" type="submit" id="pay">Pay <span class="arrow">→</span></button></div>
      ${bitsOpen() ? '<button type="button" class="link" id="bitsMode" style="justify-self:center">Can’t pay it all now? Pay in bits</button>' : ''}
      <a href="installment.html" class="link" style="justify-self:center">Already paying in bits? Continue payment</a>
      <p class="foot-small" style="margin:0">Payments by Paystack: MoMo or card. Strictly 18+.</p>
    </form>
    <aside class="aside" aria-label="Your ticket, live"><p class="kicker" style="margin-bottom:14px">Your ticket · live preview</p><div data-preview></div></aside>
  </div>`;
  bind(); refreshPreview();
}

const payAmount = () => (S.mode === 'bits' ? Math.round(Number(S.deposit || 0) * 100) : total());
function syncPay() {
  const bits = S.mode === 'bits';
  $('#bitsBox').hidden = !bits; if ($('#bitsMode')) $('#bitsMode').hidden = bits;
  const hint = bits && payAmount() === total()
    ? 'That’s the full price. Pay in full to get your ticket straight away.'
    : `Any amount from ${money(100)} up to ${money(total())}.`;
  $('#depHint').textContent = hint;
  $('#pay').innerHTML = payAmount() > 0 ? `Pay ${money(payAmount())}${bits ? ' now' : ''} <span class="arrow">→</span>` : 'Pay <span class="arrow">→</span>';
}
function syncLine() {
  $$('.line-btn').forEach(x => x.setAttribute('aria-checked', String(x.dataset.line === S.line)));
  $('#noLine').hidden = !S.line;
  refreshPreview(); saveDraft();
}
const setErr = (f, msg) => { f.classList.toggle('bad', !!msg); f.querySelector('.err')?.remove(); if (msg) f.insertAdjacentHTML('beforeend', `<span class="err">${esc(msg)}</span>`); };
const keep = () => remember.set({ name: S.name.trim(), phone: S.phone.trim(), email: S.email });

function bind() {
  $('#name').oninput = e => { S.name = e.target.value; if (S.name.trim().length > 1) setErr($('#fName')); refreshPreview(); };
  $('#phone').oninput = e => { S.phone = e.target.value; if (phoneOk(S.phone)) setErr($('#fPhone')); };
  $('#email').oninput = e => { S.email = e.target.value.trim(); };
  for (const id of ['name', 'phone', 'email']) $('#' + id).onchange = keep;
  bindForget(document, ['name', 'phone', 'email'], () => { S.name = S.phone = S.email = ''; refreshPreview(); $('#name').focus(); });

  if ($('#lineGroup')) radios($('#lineGroup'), b => { S.line = b.dataset.line; $('#ownLine').value = ''; syncLine(); });
  $('#ownLine').oninput = e => { S.line = e.target.value.replace(/\s+/g, ' ').trimStart(); syncLine(); };
  $('#noLine').onclick = () => { S.line = ''; $('#ownLine').value = ''; syncLine(); $('#ownLine').focus(); };

  const mode = m => { S.mode = m; syncPay(); saveDraft(); (m === 'bits' ? $('#dep') : $('#pay')).focus(); };
  $('#bitsMode')?.addEventListener('click', () => mode('bits'));
  $('#fullMode').onclick = () => mode('full');
  $('#dep').oninput = e => { S.deposit = e.target.value; setErr($('#fDep')); syncPay(); saveDraft(); };
  $('#ack').onchange = e => { S.ack = e.target.checked; };
  $('#co').onsubmit = pay;
  syncPay();
}

async function pay(ev) {
  ev.preventDefault();
  const err = $('#payErr'); err.hidden = true;
  // First problem wins: its message sits by the field, and the cursor goes there.
  const okPhone = phoneOk(S.phone);
  setErr($('#fPhone'), okPhone ? '' : 'Use a Ghana number, e.g. 024 123 4567.');
  if (!okPhone) return $('#phone').focus();
  keep();
  if (S.mode === 'bits') {
    const amt = payAmount();
    if (!(amt >= 100) || amt > total()) { setErr($('#fDep'), `Enter an amount between ${money(100)} and ${money(total())}.`); return $('#dep').focus(); }
    if (!$('#ack').checked) { err.hidden = false; err.textContent = 'Tick the box to confirm how pay in bits works.'; return $('#ack').focus(); }
  }
  const btn = $('#pay'); btn.disabled = true; btn.textContent = 'Opening payment…';
  const body = { eventId: B.event.id, ticketTypeId: T.id, quantity: qty, buyerName: S.name.trim() || undefined, buyerPhone: S.phone.trim(), buyerEmail: S.email || undefined, identityLine: S.line.trim() };
  try {
    const d = S.mode === 'bits'
      ? await api('/api/installments/start', { method: 'POST', body: { ...body, depositPesewas: payAmount(), acknowledged: true } })
      : await api('/api/checkout/initiate', { method: 'POST', body });
    // This order is on its way to Paystack: the next one starts fresh (no borrowed line).
    try { sessionStorage.removeItem(draftKey()); } catch { /* private mode */ }
    if (d.claim) { claims.set(d.reference, d.claim); if (d.planId) claims.set(d.planId, d.claim); }
    location.href = d.authorizationUrl;
  } catch (e) {
    err.hidden = false; err.textContent = e.message; btn.disabled = false; syncPay();
    // A server that still wants a line: open the line picker so the way forward is visible.
    if (/line/i.test(e.message)) { $('#lineBox').open = true; ($('.line-btn') || $('#ownLine')).focus(); }
  }
}

async function load() {
  if (!eventId) { root.innerHTML = '<div class="state-msg"><h2 class="display">This night isn’t on.</h2><a class="btn red" href="nights.html">See what’s on</a></div>'; return; }
  try {
    B = await api(`/api/events/${encodeURIComponent(eventId)}`);
    const type = B.ticketTypes.find(t => t.id === params.get('type'));
    // Old or hand-typed links without a known ticket: pick it on the tickets page instead.
    if (!type) { location.replace(`tickets.html?event=${encodeURIComponent(B.event.id)}`); return; }
    if (type.soldOut || B.event.soldOut || B.event.over) {
      root.innerHTML = `<div class="state-msg"><h2 class="display">That ticket isn’t available.</h2><p>${B.event.over ? 'This night has passed.' : 'It may have sold out. Pick another one.'}</p><a class="btn red" href="${B.event.over ? 'nights.html' : `tickets.html?event=${encodeURIComponent(B.event.id)}`}">${B.event.over ? 'See what’s on' : 'Back to tickets'}</a></div>`;
      return;
    }
    T = type;
    const d = loadDraft();
    S.line = typeof d.line === 'string' && (B.lines.includes(d.line) || d.line.length <= 40) ? d.line : '';
    S.deposit = typeof d.deposit === 'string' ? d.deposit : '';
    S.mode = d.mode === 'bits' && bitsOpen() ? 'bits' : 'full';
    shell();
  } catch (e) {
    if (e.status === 404) root.innerHTML = '<div class="state-msg"><h2 class="display">This night isn’t on.</h2><a class="btn red" href="nights.html">See what’s on</a></div>';
    else errorState(root, e.message, load);
  }
}
load();

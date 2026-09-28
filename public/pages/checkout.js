// checkout.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, normalizePhone, api, esc, params, money, $, $$, errorState, remember, shortDate, toast, forgetButton, bindForget, BITS_ACK_TEXT } from '../app.js';
import { ticketHTML } from '../ticket-art.js';
chrome();

const root = $('#root');
const S = { name: '', phone: '', email: '', line: '', mode: 'full', deposit: '', step: 1 };
let B, T, qty = Math.min(6, Math.max(1, Number(params.get('qty')) || 1));
Object.assign(S, (({ name = '', phone = '', email = '' }) => ({ name, phone, email }))(remember.get()));

const phoneOk = p => normalizePhone(p) !== null;
const first = n => n.trim().split(/\s+/)[0] || '';
const total = () => T.pricePesewas * qty;
const preview = () => ticketHTML({ line: S.line, firstName: first(S.name), eventName: B.event.name, eventId: B.event.id, ticketStyle: B.event.ticketStyle, ticketColors: B.event.ticketColors, autoStyle: B.event.autoStyle, date: B.event.date, doors: B.event.doors, venue: B.event.venue, artwork: B.event.artwork, type: T.name, admits: T.admits, inDraw: false }, { preview: true });
const hasLines = () => B.lines.length > 0;
// The line comes first: it's the point of the ticket. Pick one of the night's, or write your own.
const order = () => ['s2', 's1', 's3'];
const lineReady = () => !!S.line.trim() || !hasLines();
function syncLine() {
  const b = $('#toWho'); b.disabled = !lineReady();
  b.innerHTML = S.line.trim() || hasLines() ? 'This is me <span class="arrow">→</span>' : 'Skip <span class="arrow">→</span>';
}
const at = () => order()[S.step - 1];

function refreshPreview() { $$('[data-preview]').forEach(el => { el.innerHTML = preview(); }); }

function shell() {
  root.innerHTML = `<div class="flow with-aside">
    <div>
      <div class="for" style="margin-bottom:16px"><a class="link" href="event.html?id=${encodeURIComponent(B.event.id)}">← ${esc(B.event.name)}</a><span class="kicker">${esc(shortDate(B.event.date))}</span></div>
      <div class="steps" aria-hidden="true" id="bar"></div>
      <div class="peek" data-preview aria-hidden="true" style="margin-top:22px"></div>
      <div id="s2" class="step" hidden style="margin-top:22px">
        <h1 class="display">What should others know?</h1>
        <p class="muted" style="margin:-8px 0 0">Pick your line. It goes big on your ticket for everyone to see.</p>
        ${hasLines() ? `<div role="radiogroup" aria-label="Your line"><ol class="lines">${B.lines.map((l, i) => `<li><button type="button" class="line-btn" role="radio" aria-checked="${S.line === l}" data-line="${esc(l)}"><span class="no">${String(i + 1).padStart(2, '0')}</span><span class="tx">${esc(l)}</span><span class="mk" aria-hidden="true">✓</span></button></li>`).join('')}</ol></div>` : ''}
        <div class="field"><label for="ownLine">${hasLines() ? 'Or write your own' : 'Write your line (optional)'}</label><input id="ownLine" maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="e.g. BIRTHDAY GIRL" value="${esc(B.lines.includes(S.line) ? '' : S.line)}"><span class="hint">Up to 40 characters.</span></div>
        <div class="step-nav"><button class="btn red" type="button" id="toWho"></button></div>
      </div>
      <form id="s1" class="step" novalidate style="margin-top:22px">
        <h1 class="display">Who’s coming?</h1>
        <div class="field" id="fName"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" autocapitalize="words" required maxlength="80" value="${esc(S.name)}"><span class="hint">First name goes big on the ticket.</span></div>
        <div class="field" id="fPhone"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" required value="${esc(S.phone)}"><span class="hint">Your ticket link comes here by text.</span></div>
        <details ${S.email ? 'open' : ''}><summary class="label" style="cursor:pointer;padding:6px 0">Email receipt (optional)</summary>
          <div class="field" style="margin-top:10px"><label for="email" class="sr">Email</label><input id="email" type="email" autocomplete="email" inputmode="email" value="${esc(S.email)}"></div></details>
        ${forgetButton()}
        <div class="summary"><div class="r"><span>${qty} × ${esc(T.name)}</span><span>${money(total())}</span></div></div>
        <div class="step-nav"><button class="btn back" type="button" data-back aria-label="Back">←</button><button class="btn red" type="submit">Next <span class="arrow">→</span></button></div>
      </form>
      <div id="s3" class="step" hidden style="margin-top:22px">
        <h1 class="display">Your night</h1>
        <div class="review-ticket" data-preview></div>
        <div class="choice" role="radiogroup" aria-label="How to pay">
          <button type="button" role="radio" data-mode="full" aria-checked="${S.mode === 'full'}"><b>Pay in full · ${money(total())}</b><span>Ticket straight to your phone.${B.raffle?.status === 'open' ? ' You’re in the draw if a spot is left.' : ''}</span></button>
          <button type="button" role="radio" data-mode="bits" aria-checked="${S.mode === 'bits'}"><b>Pay in bits</b><span>Start with GHS 10 or more. Top up any time before the night. Ticket arrives when it’s fully paid.</span></button>
        </div>
        <div class="field" id="fDep" ${S.mode === 'bits' ? '' : 'hidden'}><label for="dep">Pay now</label><div class="money-in"><input id="dep" type="number" inputmode="decimal" min="10" max="${total() / 100}" step="1" value="${esc(S.deposit)}" placeholder="10"></div><span class="hint">Between GHS 10 and ${money(total())}.</span></div>
        <label class="check ack" id="fAck" ${S.mode === 'bits' ? '' : 'hidden'}><input type="checkbox" id="ack" ${S.ack ? 'checked' : ''}> <span>${esc(BITS_ACK_TEXT)}</span></label>
        <div class="summary">
          <div class="r"><span>${qty} × ${esc(T.name)}</span><span>${money(total())}</span></div>
          <div class="r muted"><span>For</span><span id="forWho"></span></div>
          <div class="r t"><span id="payLabel">Total</span><span id="payAmt">${money(total())}</span></div>
        </div>
        <div class="notice" id="payErr" hidden role="alert"></div>
        <div class="step-nav"><button class="btn back" type="button" data-back aria-label="Back">←</button><button class="btn red" type="button" id="pay">Pay <span class="arrow">→</span></button></div>
        <p class="foot-small" style="margin:0">Payments by Paystack: MoMo or card. Strictly 18+.</p>
      </div>
    </div>
    <aside class="aside" aria-label="Your ticket, live"><p class="kicker" style="margin-bottom:14px">Your ticket · live preview</p><div data-preview></div></aside>
  </div>`;
  bind(); go(S.step); refreshPreview();
}

function go(n) {
  S.step = n;
  ['s1', 's2', 's3'].forEach(id => { $('#' + id).hidden = id !== at(); });
  $('#bar').innerHTML = order().map((_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  $('.peek').hidden = at() === 's3';
  if (at() === 's3') $('#forWho').textContent = `${S.name.trim()} · ${S.phone.trim()}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function payAmount() { return S.mode === 'bits' ? Math.round(Number(S.deposit || 0) * 100) : total(); }
function syncPay() {
  $('#fDep').hidden = S.mode !== 'bits'; $('#fAck').hidden = S.mode !== 'bits';
  $$('[data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === S.mode)));
  $('#payLabel').textContent = S.mode === 'bits' ? 'Paying now' : 'Total';
  $('#payAmt').textContent = money(payAmount());
  $('#pay').innerHTML = `Pay ${money(payAmount())} <span class="arrow">→</span>`;
}

function bind() {
  const setErr = (f, msg) => { f.classList.toggle('bad', !!msg); f.querySelector('.err')?.remove(); if (msg) f.insertAdjacentHTML('beforeend', `<span class="err">${esc(msg)}</span>`); };
  $('#name').oninput = e => { S.name = e.target.value; refreshPreview(); };
  $('#phone').oninput = e => { S.phone = e.target.value; if (phoneOk(S.phone)) setErr($('#fPhone')); };
  $('#email').oninput = e => { S.email = e.target.value.trim(); };
  bindForget(document, ['name', 'phone', 'email'], () => { S.name = S.phone = S.email = ''; refreshPreview(); $('#name').focus(); });
  $('#s1').onsubmit = ev => {
    ev.preventDefault();
    const okName = S.name.trim().length > 1, okPhone = phoneOk(S.phone);
    setErr($('#fName'), okName ? '' : 'Add your name.');
    setErr($('#fPhone'), okPhone ? '' : 'Use a Ghana number, e.g. 024 123 4567.');
    if (!okName) return $('#name').focus();
    if (!okPhone) return $('#phone').focus();
    remember.set({ name: S.name.trim(), phone: S.phone.trim(), email: S.email });
    go(S.step + 1);
  };
  $$('.line-btn').forEach(b => b.onclick = () => {
    S.line = b.dataset.line;
    $$('.line-btn').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    $('#ownLine').value = ''; syncLine(); refreshPreview();
  });
  $('#ownLine').oninput = e => {
    S.line = e.target.value.replace(/\s+/g, ' ').trimStart();
    $$('.line-btn').forEach(x => x.setAttribute('aria-checked', 'false'));
    syncLine(); refreshPreview();
  };
  syncLine();
  $('#toWho').onclick = () => go(S.step + 1);
  $$('[data-back]').forEach(b => b.onclick = () => go(S.step - 1));
  $$('[data-mode]').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; syncPay(); if (S.mode === 'bits') $('#dep').focus(); });
  $('#dep').oninput = e => { S.deposit = e.target.value; syncPay(); };
  $('#pay').onclick = pay;
  syncPay();
}

async function pay() {
  const err = $('#payErr'); err.hidden = true;
  const btn = $('#pay');
  if (S.mode === 'bits') {
    const amt = payAmount();
    if (!(amt >= 1000) || amt > total()) { err.hidden = false; err.textContent = `Pay between GHS 10 and ${money(total())}.`; return $('#dep').focus(); }
    if (!$('#ack').checked) { err.hidden = false; err.textContent = 'Tick the box to confirm how pay in bits works.'; return $('#ack').focus(); }
  }
  btn.disabled = true; btn.textContent = 'Opening payment…';
  const body = { eventId: B.event.id, ticketTypeId: T.id, quantity: qty, buyerName: S.name.trim(), buyerPhone: S.phone.trim(), buyerEmail: S.email || undefined, identityLine: S.line.trim() };
  try {
    const d = S.mode === 'bits'
      ? await api('/api/installments/start', { method: 'POST', body: { ...body, depositPesewas: payAmount(), acknowledged: true } })
      : await api('/api/checkout/initiate', { method: 'POST', body });
    location.href = d.authorizationUrl;
  } catch (e) {
    err.hidden = false; err.textContent = e.message; btn.disabled = false; syncPay();
  }
}

async function load() {
  try {
    B = await api(`/api/events/${encodeURIComponent(params.get('event') || '')}`);
    T = B.ticketTypes.find(t => t.id === params.get('type') && !t.soldOut);
    if (!T || B.event.soldOut || B.event.over) {
      root.innerHTML = `<div class="state-msg"><h2 class="display">That ticket isn’t available.</h2><p>It may have sold out. Pick another one.</p><a class="btn red" href="event.html?id=${encodeURIComponent(B.event.id)}#tickets">Back to tickets</a></div>`;
      return;
    }
    S.line = '';
    shell();
  } catch (e) {
    if (e.status === 404) root.innerHTML = '<div class="state-msg"><h2 class="display">This night isn’t on.</h2><a class="btn red" href="nights.html">See what’s on</a></div>';
    else errorState(root, e.message, load);
  }
}
load();

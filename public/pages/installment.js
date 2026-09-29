// installment.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, api, esc, params, money, $, $$, shortDate, time, normalizePhone } from '../app.js';
chrome();
const root = $('#root');

function planCard(p) {
  const left = p.remainingPesewas, pct = p.totalPesewas ? Math.round(100 * p.paidPesewas / p.totalPesewas) : 0;
  const head = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline"><span class="kicker">${esc(p.planId)}</span><span class="kicker">${p.eventDate ? esc(shortDate(p.eventDate)) : ''}</span></div>
    <h2 class="display sm">${esc(p.eventName)}</h2>
    <div class="draw-meter" style="height:12px"><i style="width:${pct}%;background:var(--crimson)"></i></div>
    <div style="display:flex;justify-content:space-between"><span>${money(p.paidPesewas)} paid</span><b>${money(p.totalPesewas)}</b></div>`;
  // A paid order never shows its ticket here: the code isn't proof of who you are. The link goes
  // by text to the phone on the order.
  if (p.ticketReady) return `<form class="plan" data-resend="${esc(p.planId)}" novalidate>${head}<div class="notice ok">Paid in full. We texted your ticket link.</div>
    <div class="field"><label for="rs-${esc(p.planId)}">Didn’t get it? Enter the phone number you used</label><input id="rs-${esc(p.planId)}" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567"></div>
    <button class="btn" type="submit">Text me the link</button><div class="notice" hidden role="status"></div></form>`;
  if (p.status !== 'active') return `<div class="plan">${head}<div class="notice">${p.status === 'forfeited' ? 'This order was forfeited: the night started before it was fully paid.' : 'This order is closed. Contact us.'}</div></div>`;
  // The deadline is the night's start: after that an unpaid order is forfeited.
  const due = p.deadline || p.eventDate, dueMs = due ? new Date(due).getTime() - Date.now() : NaN;
  const days = dueMs > 0 ? Math.floor(dueMs / 864e5) : -1;
  const dueNote = due ? `<div class="notice">Pay the rest before ${esc(`${shortDate(due)}, ${time(due)}`)}.${days >= 2 ? ` ${days} days left.` : days === 1 ? ' 1 day left.' : days === 0 ? ' That’s today.' : ''} Unpaid balances are forfeited once the night starts.</div>` : '';
  return `<form class="plan" data-plan="${esc(p.planId)}" data-left="${left}" novalidate>${head}
    <h3 class="display" style="font-size:34px">${money(left)} to go</h3>
    ${dueNote}
    <div class="quick"><button type="button" data-amt="${left}">All of it · ${money(left)}</button>${left >= 2000 ? `<button type="button" data-amt="${Math.round(left / 200) * 100}">Half · ${money(Math.round(left / 200) * 100)}</button>` : ''}</div>
    <div class="field"><label for="amt-${esc(p.planId)}">Pay now</label><div class="money-in"><input id="amt-${esc(p.planId)}" type="number" inputmode="decimal" min="0.01" max="${left / 100}" step="0.01" placeholder="Any amount"></div><span class="hint">Anyone can pay this. The ticket goes to ${esc(p.firstName)} when it’s fully paid.</span></div>
    <div class="notice" hidden role="alert"></div>
    <button class="btn red" type="submit">Pay <span class="arrow">→</span></button></form>`;
}

async function find(q) {
  root.innerHTML = '<div class="loading" role="status">FINDING YOUR ORDER…</div>';
  try {
    const { plans } = await api(`/api/installments/lookup?code=${encodeURIComponent(q.trim())}`);
    if (!plans.length) { root.innerHTML = '<div class="notice">No order with that code. Check the text we sent you, or use “Lost your code?”.</div>'; return; }
    root.innerHTML = `<div style="display:grid;gap:18px">${plans.map(planCard).join('')}</div>`;
    bind();
  } catch (e) { root.innerHTML = `<div class="notice" role="alert">${esc(e.message)}</div>`; }
}

// Same neutral reply whatever happened; the Worker decides whether a text goes out.
async function neutral(form, path, body) {
  const note = $('.notice[role=status]:not(.ok)', form), btn = $('button[type=submit]', form);
  note.hidden = true;
  if (!normalizePhone(body.phone)) { note.hidden = false; note.textContent = 'Use a Ghana number, e.g. 024 123 4567.'; return; }
  btn.disabled = true;
  try { const d = await api(path, { method: 'POST', body }); note.hidden = false; note.textContent = d.message; }
  catch (e) { note.hidden = false; note.textContent = e.message; }
  btn.disabled = false;
}

function bind() {
  $$('form[data-resend]').forEach(f => { f.onsubmit = ev => { ev.preventDefault(); neutral(f, '/api/installments/resend-link', { planId: f.dataset.resend, phone: $('input', f).value }); }; });
  $$('form[data-plan]').forEach(f => {
    const input = $('input', f), note = $('.notice', f), btn = $('button[type=submit]', f);
    const sync = () => { const v = Math.round(Number(input.value || 0) * 100); btn.innerHTML = v ? `Pay ${money(v)} <span class="arrow">→</span>` : 'Pay <span class="arrow">→</span>'; };
    $$('[data-amt]', f).forEach(b => b.onclick = () => { input.value = Number(b.dataset.amt) / 100; sync(); });
    input.oninput = sync;
    f.onsubmit = async ev => {
      ev.preventDefault(); note.hidden = true;
      const v = Math.round(Number(input.value || 0) * 100), left = Number(f.dataset.left);
      if (!(v >= 1) || v > left) { note.hidden = false; note.textContent = `Enter an amount up to ${money(left)}.`; return input.focus(); }
      btn.disabled = true; btn.textContent = 'Opening payment…';
      try { const d = await api('/api/installments/topup', { method: 'POST', body: { planId: f.dataset.plan, amountPesewas: v } }); location.href = d.authorizationUrl; }
      catch (e) { note.hidden = false; note.textContent = e.message; btn.disabled = false; sync(); }
    };
  });
}

$('#find').onsubmit = ev => { ev.preventDefault(); const q = $('#q').value; if (q.trim()) find(q); };
$('#lost').onsubmit = ev => { ev.preventDefault(); neutral($('#lost'), '/api/installments/find', { phone: $('#lostPhone').value }); };
const code = params.get('code');
if (code) { $('#q').value = code; find(code); }

// payment-return.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, api, esc, params, money, $, MSG, shortDate, time, shareUrl, toast, waLink, claims } from '../app.js';
const settingsP = chrome();
const root = $('#root');
const ref = params.get('reference') || params.get('trxref');

const tryAgain = s => `<div class="state-msg"><span class="stamp" style="color:var(--crimson)">Not paid</span>
  <h1 class="display lg">Payment didn’t go through.</h1><p>Your night is still here. Nothing was taken${s?.error && !/not successful/i.test(s.error) ? ` (${esc(s.error)})` : ''}.</p>
  <div class="row-actions" style="width:100%;max-width:520px"><a class="btn red" href="${retryUrl(s)}">Try again</a></div></div>`;
// Back to where this payment started: the order for a top-up, the tables for a table, else the tickets.
function retryUrl(s) {
  if (s?.kind === 'installment_topup' && s.planId) return `installment.html?code=${encodeURIComponent(s.planId)}`;
  if (!s?.eventId) return 'nights.html';
  return s.kind === 'table' ? `tables.html?event=${encodeURIComponent(s.eventId)}` : `tickets.html?event=${encodeURIComponent(s.eventId)}`;
}

// "Fri 03 Oct, 10PM" and "3 days left" for the Pay in bits deadline.
const when = d => `${shortDate(d)}, ${time(d)}`;
function daysLeft(d) {
  const ms = new Date(d).getTime() - Date.now(); if (!(ms > 0)) return '';
  const days = Math.floor(ms / 864e5);
  return days >= 2 ? `${days} days left.` : days === 1 ? '1 day left.' : 'That’s today.';
}

// After a part payment: everything needed to keep paying, from this screen alone. Lines whose
// data the Worker didn't send (an older Worker) are left out rather than shown blank.
async function receipt(s) {
  const left = Math.max(0, s.totalPesewas - s.paidPesewas), pct = s.totalPesewas ? Math.round(100 * s.paidPesewas / s.totalPesewas) : 0;
  const payUrl = `${location.origin}/installment.html?code=${encodeURIComponent(s.planId)}`;
  const night = [s.eventName, s.eventDate ? shortDate(s.eventDate) : ''].filter(Boolean).join(' · ');
  const what = s.ticketTypeName ? `${s.quantity || 1} × ${s.ticketTypeName}` : '';
  const deadline = s.deadline || s.eventDate;
  const settings = await settingsP.catch(() => ({}));
  root.outerHTML = `<div class="state-msg bits-receipt" id="receipt">
    <span class="stamp">${money(s.amountPesewas)} in</span>
    <h1 class="display lg">${money(left)} to go.</h1>
    <div class="summary" style="width:100%;max-width:520px">
      <div class="r"><span class="kicker">Your order code</span><button type="button" class="link no-print" id="copyCode" style="padding:0">Copy</button></div>
      <b style="font:400 clamp(30px,8vw,40px)/1 var(--display);letter-spacing:.04em;overflow-wrap:anywhere">${esc(s.planId)}</b>
      ${night ? `<div class="r"><span>${esc(night)}</span>${what ? `<span class="muted">${esc(what)}</span>` : ''}</div>` : ''}
    </div>
    <div style="width:100%;max-width:520px;display:grid;gap:10px">
      <div class="draw-meter" style="height:12px" aria-hidden="true"><i style="width:${pct}%;background:var(--crimson)"></i></div>
      <div class="summary">
        <div class="r"><span>This payment</span><b>${money(s.amountPesewas)}</b></div>
        <div class="r"><span>Paid so far</span><span>${money(s.paidPesewas)} of ${money(s.totalPesewas)}</span></div>
        <div class="r t"><span>Left to pay</span><span>${money(left)}</span></div>
      </div>
      ${s.reference || ref ? `<p class="foot-small" style="margin:0">Payment reference ${esc(s.reference || ref)}</p>` : ''}
    </div>
    <div class="notice" style="width:100%;max-width:520px">${deadline ? `Pay the rest before ${esc(when(deadline))}. ${esc(daysLeft(deadline))} ` : 'Pay the rest before the night starts. '}If it isn’t fully paid by then, the order is forfeited and what you’ve paid isn’t refunded.</div>
    <div class="row-actions no-print" style="width:100%;max-width:520px">
      <a class="btn red" href="installment.html?code=${encodeURIComponent(s.planId)}">Pay more now</a>
      <button type="button" class="btn" id="sendLink">Send the payment link</button>
    </div>
    <p>Anyone can pay with that link, so you can send it to whoever’s helping. Your ticket comes by text to ${s.phoneHint ? esc(s.phoneHint) : 'your phone'} the moment it’s fully paid. No ticket until then.</p>
    <p>Lost this? Go to <a href="installment.html">Pay the rest</a> and use “Lost your code?”. We’ll text your order codes to your phone.</p>
    <div class="row-actions no-print" style="width:100%;max-width:520px">
      <button type="button" class="btn" id="saveReceipt">Save this receipt</button>
      ${settings.whatsapp ? `<a class="btn" href="${waLink(settings.whatsapp)}" target="_blank" rel="noopener">Questions? WhatsApp us</a>` : ''}
      <a class="btn" href="index.html">Later</a>
    </div>
  </div>`;
  $('#copyCode').onclick = async () => { try { await navigator.clipboard.writeText(s.planId); toast('COPIED.'); } catch { toast(s.planId); } };
  $('#sendLink').onclick = () => shareUrl(`Help me pay for my Memories ticket. Order ${s.planId}.`, payUrl);
  $('#saveReceipt').onclick = () => print();
}

function done(s) {
  if (s.kind === 'table') {
    root.outerHTML = `<div class="state-msg"><span class="stamp">Booked</span><h1 class="display lg">Your table is set.</h1>
      <div class="summary" style="width:100%;max-width:520px">
        <div class="r"><b>${esc(s.packageName)}</b><span>${esc(s.eventName)}</span></div>
        ${(s.bottles || []).map(b => `<div class="r muted"><span>${b.quantity} × ${esc(b.name)}</span><span>${money(b.quantity * b.unitPricePesewas)}</span></div>`).join('')}
        <div class="r t"><span>Paid</span><span>${money(s.amountPesewas)}</span></div></div>
      <p>Confirmation is on its way by text. Reference <b>${esc(ref)}</b>.</p><a class="btn" href="index.html">Back to Memories</a></div>`;
    return;
  }
  if (s.kind === 'installment_topup' && !s.planComplete) { receipt(s); return; }
  const tickets = s.tickets || [];
  // Paid, but this browser didn't start the checkout (another phone, a cleared browser, or the last
  // pay-in-bits payment): the ticket link goes by text to the buyer's phone, never to this page.
  if (!tickets.length) {
    const n = s.ticketCount || 0;
    root.outerHTML = `<div class="state-msg"><span class="stamp">Paid</span><h1 class="display lg">You’re in.</h1>
      <p>Your ticket link${n > 1 ? 's are' : ' is'} on the way by text to ${s.phoneHint ? esc(s.phoneHint) : 'the phone on the order'}. Open ${n > 1 ? 'them' : 'it'} from there.</p>
      ${s.planId ? `<p>Order ${esc(s.planId)}. No text? Go to <a href="installment.html?code=${encodeURIComponent(s.planId)}">Pay the rest</a> and use “Text me the link”.</p>` : ''}
      <a class="btn" href="index.html">Back to Memories</a></div>`;
    return;
  }
  if (tickets.length === 1) { location.replace(`ticket.html?token=${encodeURIComponent(tickets[0].token)}&new=1`); return; }
  root.outerHTML = `<div class="state-msg"><span class="stamp">Paid</span><h1 class="display lg">You’re in. All ${tickets.length} of you.</h1>
    <p>Each ticket has its own QR. Open yours, then send the others to your people.</p>
    <div class="info-rows" style="width:100%;max-width:520px">${tickets.map((t, i) => `<a href="ticket.html?token=${encodeURIComponent(t.token)}&new=1"><span class="k">Ticket ${i + 1}</span><span>Open ↗</span></a>`).join('')}</div></div>`;
}

async function run() {
  if (!ref) { root.outerHTML = tryAgain(null); return; }
  let s;
  for (let i = 0; i < 20; i++) {
    try {
      const v = await api('/api/checkout/verify', { method: 'POST', body: { reference: ref } });
      if (v.status === 'issued' || v.status === 'failed') { s = await api(`/api/checkout/status?reference=${encodeURIComponent(ref)}`, { headers: { 'X-Checkout-Claim': claims.get(ref) } }); break; }
    } catch (e) { if (e.message === MSG.busy) await new Promise(r => setTimeout(r, 4000)); }
    await new Promise(r => setTimeout(r, Math.min(1500 + i * 500, 5000)));
  }
  if (!s) {
    root.innerHTML = `<h1 class="display lg">Still confirming.</h1><p>MoMo can take a minute. You won’t be charged twice. We’ll text you when it lands, or check again now.</p><button class="btn red" id="again">Check again</button>`;
    $('#again').onclick = () => { root.innerHTML = '<h1 class="display lg">Checking your payment…</h1><div class="loading" style="padding:0">One moment</div>'; run(); };
    return;
  }
  if (s.status === 'failed') { root.outerHTML = tryAgain(s); return; }
  done(s);
}
run();

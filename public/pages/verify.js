// verify.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
// What opens when someone scans a ticket QR with a normal phone camera. It only reports the
// ticket's state; admitting someone happens on the door scanner (checkin.html), staff only.
import { chrome, api, esc, params, $ } from '../app.js';
chrome();
const token = params.get('token') || '';
try {
  const d = await api(`/api/verify/${encodeURIComponent(token)}`);
  const t = d.ticket || {};
  $('#root').outerHTML = `<div class="result ${d.valid ? 'ok' : 'no'}" role="status">
    <span class="kicker" style="color:inherit">${esc(t.eventName || 'Memories')}</span>
    <h1 class="display">${esc(d.valid ? 'Valid ticket.' : d.message)}</h1>
    ${t.firstName ? `<p style="margin:0;font-size:18px">${esc(t.firstName)} · ${esc(t.displayCode || '')}${t.admits > 1 ? ` · admits ${t.admits}` : ''}</p>` : ''}
    <p class="foot-small" style="margin:0">${d.valid ? 'Door staff scan this at entry. It works once.' : 'Questions? Show this to the door.'}</p>
    ${d.valid ? `<a class="btn paper" href="ticket.html?token=${encodeURIComponent(token)}">Open the ticket</a>` : ''}</div>`;
} catch (e) { $('#root').outerHTML = `<div class="result no"><h1 class="display">Couldn’t check.</h1><p>${esc(e.message)}</p></div>`; }

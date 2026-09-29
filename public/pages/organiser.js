// organiser.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
// Organisers see their own nights only (the Worker filters by organiserId === their uid) and can't
// change anything except checking guests in at their own door.
import { $, esc, money, shortDate } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
const user = await requireStaff(['organiser', 'superAdmin']);
staffHeader(user, 'My nights');
const panel = $('#panel');
try {
  const { events } = await sapi('/api/admin/organiser/overview');
  panel.innerHTML = `<h1>My nights</h1>${events.map(e => `<section class="card" style="margin-bottom:22px">
    <div class="toolbar" style="margin:0;justify-content:space-between"><div><span class="kicker">${esc(shortDate(e.date))}</span><h2 style="margin:6px 0 0">${esc(e.eventName)}</h2></div>
      <a class="sbtn red" href="checkin.html?event=${encodeURIComponent(e.eventId)}">Door</a></div>
    <div class="kpis" style="margin:0"><div><span>Tickets sold</span><b>${e.ticketsSold}</b></div><div><span>Money in</span><b>${money(e.revenuePesewas)}</b></div>
      <div><span>Still owed (pay in bits)</span><b>${money(e.moneyOwingPesewas)}</b></div><div><span>Part-paid orders</span><b>${e.partialOrdersCount}</b></div>
      <div><span>In the door</span><b>${e.checkins}</b></div><div><span>Tables</span><b>${e.tablesSold}</b></div></div>
    ${Object.keys(e.ticketsSoldByType).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ticket</th><th class="num">Sold</th></tr></thead><tbody>${Object.entries(e.ticketsSoldByType).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${e.raffle ? `<p style="margin:0"><strong>The draw:</strong> ${e.raffle.spotsTaken} of ${e.raffle.cap} spots taken${e.raffle.winner ? ` · won by ${esc(e.raffle.winner.name)} (${esc(e.raffle.winner.code)})` : ''}</p>` : ''}
  </section>`).join('') || '<p class="muted">No nights are linked to your account yet. Ask the club to set you as organiser on your night.</p>'}`;
} catch (e) { panel.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }

// nights.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, api, esc, img, dateStamp, doors, $, errorState, dow, dd, mon } from '../app.js';
chrome('nights');

async function wall() {
  const el = $('#wall');
  try {
    const { events } = await api('/api/events');
    el.innerHTML = events.length ? events.map((e, i) => `<a class="poster" href="event.html?id=${encodeURIComponent(e.id)}">
        <div class="poster-art">${img(e.artwork, `${e.name} flyer`, '', i < 2)}${dateStamp(e.date)}${e.soldOut ? '<span class="flag">Sold out</span>' : ''}</div>
        <h3>${esc(e.name)}</h3><span class="sub">${esc(doors(e))}</span></a>`).join('')
      : '<div class="state-msg" style="grid-column:1/-1"><h2 class="display">New nights drop soon.</h2><p>Check the calendar below, or book one of those Fridays for your event.</p><a class="btn red" href="private.html">Book an event</a></div>';
  } catch (e) { errorState(el, e.message, wall); }
}

async function cal() {
  const el = $('#cal');
  try {
    const { days } = await api('/api/calendar?weeks=8');
    const today = new Date().toISOString().slice(0, 10);
    el.innerHTML = days.map(d => {
      const at = d.date + 'T00:00:00Z';
      const right = d.state === 'event' ? `<a class="state event" href="event.html?id=${encodeURIComponent(d.eventId)}">Tickets</a>`
        : d.state === 'held' ? '<span class="state held">Held</span>'
          : d.state === 'unavailable' ? '<span class="state unavailable">Closed</span>'
            : d.date > today ? `<a class="state open" href="private.html?date=${d.date}">Book it</a>` : '<span class="state unavailable">Open tonight</span>';
      const what = d.state === 'event' ? esc(d.name) : d.state === 'held' ? '<span class="muted">Booked</span>' : d.state === 'unavailable' ? '<span class="muted">Closed</span>' : '<span class="muted">Open</span>';
      return `<li><span class="d"><small>${dow(at)}</small>${dd(at)} ${mon(at)}</span><span class="what">${what}</span>${right}</li>`;
    }).join('');
  } catch (e) { el.innerHTML = `<li><span class="muted">${esc(e.message)}</span></li>`; }
}
wall(); cal();

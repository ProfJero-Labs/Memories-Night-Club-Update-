// event.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, api, esc, img, params, dateStamp, doors, longDate, $, errorState, shareUrl, setMeta, setJsonLd, videoOk, bgVideo } from '../app.js';
const id = params.get('id');
// Buying moved to its own page. Old links (flyers, WhatsApp, "#tickets", "?type=") go straight there.
const legacyType = params.get('type');
if (id && (location.hash === '#tickets' || (legacyType && legacyType !== 'none'))) {
  const q = new URLSearchParams({ event: id }); if (legacyType && legacyType !== 'none') q.set('type', legacyType);
  location.replace(`tickets.html?${q}`);
  await new Promise(() => {}); // stop here while the browser leaves
}
const settingsP = chrome('nights');
const main = $('#main');

// Title, description, canonical, Open Graph and schema.org Event, from the night's own data only.
function describe(b, s) {
  const e = b.event, venue = e.venue || s.venue || '';
  const url = `${location.origin}/event.html?id=${encodeURIComponent(e.id)}`;
  const description = [longDate(e.date), doors(e), venue].filter(Boolean).join(' · ') + (e.description ? `. ${e.description}` : '');
  setMeta({ title: `${e.name} · Memories`, description, image: e.artwork || `${location.origin}/assets/og.png`, url });
  setJsonLd({
    '@context': 'https://schema.org', '@type': 'Event', name: e.name, startDate: e.date, url,
    eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(e.description ? { description: e.description } : {}), ...(e.artwork ? { image: [e.artwork] } : {}),
    ...(venue ? { location: { '@type': 'Place', name: venue } } : {}),
    organizer: { '@type': 'Organization', name: 'Memories', url: location.origin },
    offers: b.ticketTypes.map(t => ({ '@type': 'Offer', name: t.name, price: (t.pricePesewas / 100).toFixed(2), priceCurrency: 'GHS', url, availability: t.soldOut || e.soldOut || e.over ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' })),
  });
}

function render(b, s) {
  const e = b.event, r = b.raffle, venue = e.venue || s.venue || '';
  describe(b, s);
  const ticketsOpen = !e.soldOut && !e.over && b.ticketTypes.some(t => !t.soldOut);
  // The one way in, or an honest reason there isn't one.
  const closed = e.over ? 'This night has passed' : !b.ticketTypes.length ? 'Tickets aren’t on sale yet' : 'Sold out';
  main.innerHTML = `${e.heroVideo && videoOk() ? `<div class="event-banner">${bgVideo(e.heroVideo, e.heroImage)}</div>` : e.heroImage ? `<div class="event-banner">${img(e.heroImage, '', '', true)}</div>` : ''}<div class="event-hero">
    <div class="event-art">${img(e.artwork, `${e.name} flyer`, '', true) || `<div style="aspect-ratio:4/5;display:grid;place-items:center">${dateStamp(e.date, 'red')}</div>`}</div>
    <div class="event-info">
      ${dateStamp(e.date, 'red')}
      <h1 class="display">${esc(e.name)}</h1>
      <div class="meta"><span>${esc(longDate(e.date))}</span><span class="muted">${esc(doors(e))}</span>${venue ? `<a class="muted" href="visit.html" style="color:inherit">${esc(venue)}</a>` : ''}</div>
      ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}
      <div class="row-actions">
        ${ticketsOpen ? `<a class="btn red" href="tickets.html?event=${encodeURIComponent(e.id)}">Get tickets <span class="arrow">→</span></a>` : `<span class="btn" aria-disabled="true">${closed}</span>`}
        ${b.tablePackages.length && !e.over ? `<a class="btn" href="tables.html?event=${encodeURIComponent(e.id)}">Book a table</a>` : ''}
      </div>
      <button type="button" class="link" id="share" style="justify-self:start">Share this night ↗</button>

      ${r ? `<aside class="draw-box" aria-label="The draw">
        <span class="stamp" style="position:absolute;right:14px;top:-16px;background:var(--ink)">The draw</span>
        ${r.status === 'drawn' && r.winner
          ? `<span class="display">Won by ${esc(r.winner.name)}</span>${r.prize ? `<span class="muted">${esc(r.prize)}</span>` : ''}`
          : r.status === 'open'
            ? `<span class="display">${r.cap - r.spotsTaken} of ${r.cap} draw spots left</span>
               <div class="draw-meter" aria-hidden="true"><i style="width:${Math.round(100 * r.spotsTaken / r.cap)}%"></i></div>
               <span class="muted">The first ${r.cap} tickets paid in full online are in the draw${r.prize ? ` for ${esc(r.prize)}` : ''}. No extra cost.</span>`
            : `<span class="display">Draw closed</span><span class="muted">All ${r.cap} spots are taken. Tickets are still on sale.</span>`}
      </aside>` : ''}
    </div>
  </div>`;
  $('#share').onclick = () => shareUrl(`${e.name} · Memories`);
}

async function load() {
  if (!id) return errorState(main, 'That night doesn’t exist.');
  try { const [b, s] = await Promise.all([api(`/api/events/${encodeURIComponent(id)}`), settingsP]); render(b, s); }
  catch (e) { e.status === 404 ? main.innerHTML = '<div class="wrap state-msg"><h2 class="display">This night isn’t on.</h2><p>It may have ended or moved.</p><a class="btn red" href="nights.html">See what’s on</a></div>' : errorState(main, e.message, load); }
}
load();

// event.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, api, esc, img, params, money, dateStamp, doors, longDate, $, $$, errorState, shareUrl, mapLink, setMeta, setJsonLd, videoOk, bgVideo } from '../app.js';
const settingsP = chrome('nights');
const id = params.get('id');
const main = $('#main');
let sel = null, qty = 1, bundle;

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
  const e = b.event, r = b.raffle;
  describe(b, s);
  const ticketsOpen = !e.soldOut && !e.over && b.ticketTypes.some(t => !t.soldOut);
  const minTable = Math.min(...b.tablePackages.map(t => t.pricePesewas));
  main.innerHTML = `${e.heroVideo && videoOk() ? `<div class="event-banner">${bgVideo(e.heroVideo, e.heroImage)}</div>` : e.heroImage ? `<div class="event-banner">${img(e.heroImage, '', '', true)}</div>` : ''}<div class="event-hero">
    <div class="event-art">${img(e.artwork, `${e.name} flyer`, '', true) || `<div style="aspect-ratio:4/5;display:grid;place-items:center">${dateStamp(e.date, 'red')}</div>`}</div>
    <div class="event-info">
      ${dateStamp(e.date, 'red')}
      <h1 class="display">${esc(e.name)}</h1>
      <div class="meta"><span>${esc(longDate(e.date))}</span><span class="muted">${esc(doors(e))}</span><span class="muted">${esc(e.venue || s.venue || '')}</span></div>
      ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}
      <div class="row-actions">
        ${ticketsOpen ? '<a class="btn red" href="#tickets">Get tickets <span class="arrow">↓</span></a>' : `<span class="btn" aria-disabled="true">${e.over ? 'This night has passed' : 'Sold out'}</span>`}
        ${b.tablePackages.length && !e.over ? `<a class="btn" href="tables.html?event=${encodeURIComponent(e.id)}">Book a table</a>` : ''}
      </div>

      <section id="tickets" aria-labelledby="tTitle" style="scroll-margin-top:80px">
        <div class="section-title"><h2 id="tTitle">Tickets</h2><span class="kicker">Pay in full or in bits</span></div>
        <div class="types" role="group" aria-label="Ticket types">${b.ticketTypes.map(t => `
          <button class="type" type="button" data-type="${esc(t.id)}" aria-pressed="false" ${t.soldOut || e.soldOut || e.over ? 'disabled' : ''}>
            <span class="n">${esc(t.name)}</span><span class="p">${money(t.pricePesewas)}</span>
            <span class="s">${t.soldOut || e.soldOut ? 'Sold out' : [t.admits > 1 ? `Admits ${t.admits}` : 'Admits one', t.lastFew ? 'Last few' : '', t.description].filter(Boolean).map(esc).join(' · ')}</span>
          </button>`).join('') || '<p class="muted" style="padding:18px 0">Tickets aren’t on sale yet.</p>'}</div>
        <div id="qtyRow" hidden style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 0">
          <span class="label">How many?</span>
          <div class="qty"><button type="button" id="minus" aria-label="One fewer">−</button><output id="qty" aria-live="polite">1</output><button type="button" id="plus" aria-label="One more">+</button></div>
        </div>
        <a class="btn red block inline-go" id="inlineGo" hidden href="#">Get in <span class="arrow">→</span></a>
      </section>

      ${r ? `<aside class="draw-box" aria-label="The draw">
        <span class="stamp" style="position:absolute;right:14px;top:-16px;background:var(--ink)">The draw</span>
        ${r.status === 'drawn' && r.winner
          ? `<span class="display">Won by ${esc(r.winner.name)}</span><span class="muted">Ticket ${esc(r.winner.code)}${r.prize ? ` · ${esc(r.prize)}` : ''}</span>`
          : r.status === 'open'
            ? `<span class="display">${r.cap - r.spotsTaken} of ${r.cap} draw spots left</span>
               <div class="draw-meter" aria-hidden="true"><i style="width:${Math.round(100 * r.spotsTaken / r.cap)}%"></i></div>
               <span class="muted">The first ${r.cap} tickets paid in full online are in the draw${r.prize ? ` for ${esc(r.prize)}` : ''}. No extra cost.</span>`
            : `<span class="display">Draw closed</span><span class="muted">All ${r.cap} spots are taken. Tickets are still on sale.</span>`}
      </aside>` : ''}

      ${b.tablePackages.length && !e.over ? `<a class="info-rows" href="tables.html?event=${encodeURIComponent(e.id)}" style="margin-top:26px;display:block;text-decoration:none">
        <span style="border-top:1px solid var(--line)"><span><span class="k">Tables</span><br><span class="display" style="font-size:34px">From ${money(minTable)}</span></span><span style="font-size:28px">→</span></span></a>` : ''}

      <div class="info-rows" style="margin-top:10px">
        <a href="${esc(mapLink({ ...s, venue: e.venue || s.venue }))}" target="_blank" rel="noopener"><span class="k">Where</span><span>${esc(e.venue || s.venue || '')} ↗</span></a>
        <button type="button" class="link" id="share" style="display:flex;justify-content:space-between;width:100%;text-decoration:none;padding:16px 0;border:0;border-bottom:1px solid var(--line)"><span class="k">Bring people</span><span>Share this night ↗</span></button>
      </div>
    </div>
  </div>`;

  const bar = $('#buybar');
  const update = () => {
    const t = b.ticketTypes.find(x => x.id === sel);
    $$('.type').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.type === sel)));
    $('#qtyRow').hidden = !t;
    if (!t) { bar.classList.remove('show'); document.body.style.setProperty('--bar-h', '0px'); return; }
    $('#qty').value = qty;
    $('#barSum').innerHTML = `${money(t.pricePesewas * qty)}<small>${qty} × ${esc(t.name)}</small>`;
    $('#barGo').href = $('#inlineGo').href = `checkout.html?event=${encodeURIComponent(e.id)}&type=${encodeURIComponent(t.id)}&qty=${qty}`;
    $('#inlineGo').hidden = false; $('#inlineGo').innerHTML = `Get in · ${money(t.pricePesewas * qty)} <span class="arrow">→</span>`;
    bar.classList.add('show'); document.body.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
  };
  $$('.type').forEach(btn => btn.onclick = () => { sel = btn.dataset.type; update(); });
  if (b.ticketTypes.length) { $('#minus').onclick = () => { qty = Math.max(1, qty - 1); update(); }; $('#plus').onclick = () => { qty = Math.min(6, qty + 1); update(); }; }
  $('#share').onclick = () => shareUrl(`${e.name} · Memories`);
  const first = b.ticketTypes.find(t => !t.soldOut);
  if (first && ticketsOpen && params.get('type') !== 'none') { sel = params.get('type') || first.id; update(); }
}

async function load() {
  if (!id) return errorState(main, 'That night doesn’t exist.');
  try { const [b, s] = await Promise.all([api(`/api/events/${encodeURIComponent(id)}`), settingsP]); bundle = b; render(b, s); }
  catch (e) { e.status === 404 ? main.innerHTML = '<div class="wrap state-msg"><h2 class="display">This night isn’t on.</h2><p>It may have ended or moved.</p><a class="btn red" href="nights.html">See what’s on</a></div>' : errorState(main, e.message, load); }
}
load();

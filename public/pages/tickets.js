// tickets.html: pick the ticket and how many, nothing else. Checkout takes it from there.
//   tickets.html?event={id}[&type={typeId}][&qty=1..6]
import { chrome, api, esc, params, money, doors, shortDate, $, $$, errorState } from '../app.js';
chrome('nights');

const root = $('#root');
const id = params.get('event') || '';
const clampQty = n => Math.min(6, Math.max(1, Math.floor(Number(n)) || 1));
let sel = params.get('type') || '', qty = clampQty(params.get('qty'));

const state = (title, text, href, label) => {
  root.innerHTML = `<div class="state-msg"><h1 class="display">${esc(title)}</h1>${text ? `<p>${esc(text)}</p>` : ''}<a class="btn red" href="${esc(href)}">${esc(label)}</a></div>`;
};

function render(b) {
  const e = b.event, types = b.ticketTypes;
  const back = `event.html?id=${encodeURIComponent(e.id)}`;
  document.title = `Tickets · ${e.name} · Memories`;
  // One next step for every state, and never a way out to tables or anything else.
  if (e.over) return state('This night has passed.', 'Pick another night.', 'nights.html', 'See what’s on');
  if (!types.length) return state('Tickets aren’t on sale yet.', 'Check back soon.', back, `← ${e.name}`);
  if (e.soldOut || types.every(t => t.soldOut)) return state('Sold out.', 'Every ticket for this night is gone.', back, `← ${e.name}`);

  const open = types.filter(t => !t.soldOut);
  if (!open.some(t => t.id === sel)) sel = open.length === 1 ? open[0].id : '';

  root.innerHTML = `
    <div class="for"><a class="link" href="${back}">← ${esc(e.name)}</a><span class="kicker">${esc(shortDate(e.date))} · ${esc(doors(e))}</span></div>
    <h1 class="display">Choose your ticket</h1>
    <div class="types" role="group" aria-label="Ticket types">${types.map(t => `
      <button class="type" type="button" data-type="${esc(t.id)}" aria-pressed="false" ${t.soldOut ? 'disabled' : ''}>
        <span class="n">${esc(t.name)}</span><span class="p">${money(t.pricePesewas)}</span>
        <span class="s">${t.soldOut ? 'Sold out' : [t.admits > 1 ? `Admits ${t.admits}` : 'Admits one', t.lastFew ? 'Last few' : '', t.description].filter(Boolean).map(esc).join(' · ')}</span>
      </button>`).join('')}</div>
    <div id="qtyRow" hidden style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <span class="label" id="qtyLbl">How many?</span>
      <div class="qty" role="group" aria-labelledby="qtyLbl"><button type="button" id="minus" aria-label="One fewer">−</button><output id="qty" aria-live="polite">1</output><button type="button" id="plus" aria-label="One more">+</button></div>
      <span class="hint muted" id="qtyMax" hidden style="flex-basis:100%;font-size:13px">Up to 6 per order.</span>
    </div>
    <a class="btn red block inline-go" id="inlineGo" hidden href="#">Continue <span class="arrow">→</span></a>`;

  const bar = $('#buybar');
  const update = () => {
    const t = types.find(x => x.id === sel);
    $$('.type').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.type === sel)));
    $('#qtyRow').hidden = !t;
    // Keep the choice in the address, so a refresh or Back from checkout lands on the same pick.
    const q = new URLSearchParams({ event: e.id }); if (t) { q.set('type', t.id); q.set('qty', qty); }
    history.replaceState(null, '', `tickets.html?${q}`);
    if (!t) { bar.classList.remove('show'); $('#inlineGo').hidden = true; document.body.style.setProperty('--bar-h', '0px'); return; }
    $('#qty').value = qty;
    $('#minus').disabled = qty <= 1; $('#plus').disabled = qty >= 6; $('#qtyMax').hidden = qty < 6;
    const go = `checkout.html?event=${encodeURIComponent(e.id)}&type=${encodeURIComponent(t.id)}&qty=${qty}`;
    $('#barSum').innerHTML = `${money(t.pricePesewas * qty)}<small>${qty} × ${esc(t.name)}</small>`;
    $('#barGo').href = $('#inlineGo').href = go;
    $('#barGo').innerHTML = `Continue <span class="arrow">→</span>`;
    $('#inlineGo').hidden = false; $('#inlineGo').innerHTML = `Continue · ${money(t.pricePesewas * qty)} <span class="arrow">→</span>`;
    bar.classList.add('show'); document.body.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
  };
  $$('.type').forEach(btn => btn.onclick = () => { sel = btn.dataset.type; update(); });
  $('#minus').onclick = () => { qty = clampQty(qty - 1); update(); };
  $('#plus').onclick = () => { qty = clampQty(qty + 1); update(); };
  update();
}

async function load() {
  if (!id) return state('This night isn’t on.', 'It may have ended or moved.', 'nights.html', 'See what’s on');
  try { render(await api(`/api/events/${encodeURIComponent(id)}`)); }
  catch (e) { e.status === 404 ? state('This night isn’t on.', 'It may have ended or moved.', 'nights.html', 'See what’s on') : errorState(root, e.message, load); }
}
load();

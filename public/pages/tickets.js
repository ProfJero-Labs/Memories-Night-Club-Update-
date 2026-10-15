// tickets.html: pick the ticket and how many, nothing else. Checkout takes it from there.
//   tickets.html?event={id}[&type={typeId}][&qty=1..6][&promo={code}]  (a shared promo link keeps its code)
import { chrome, api, esc, params, money, doors, shortDate, time, $, $$, errorState, pickPromo } from '../app.js';
chrome('nights');

const root = $('#root');
const id = params.get('event') || '';
const clampQty = n => Math.min(6, Math.max(1, Math.floor(Number(n)) || 1));
let sel = params.get('type') || '', qty = clampQty(params.get('qty'));
const code = (params.get('promo') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

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
  // Promos running now (automatic ones; code promos are entered at checkout).
  const promos = b.promo?.promos || [];
  const priced = (t, n) => { const p = pickPromo(promos, t.id, t.pricePesewas, n); return { full: t.pricePesewas * n, total: t.pricePesewas * n - (p?.off || 0), promo: p?.promo || null }; };
  const ends = p => (p.endsAt ? `ends ${shortDate(p.endsAt)}, ${time(p.endsAt)}` : '');
  const banner = promos.length ? `<div class="promo-banner" role="note">${promos.map(p => `<div><span class="promo-tag">${esc(p.name)}</span><b>${esc(p.label)}</b>${[ends(p), p.left !== null && p.left <= 30 ? `${p.left} left at this price` : '', p.ticketTypeIds.length ? `on ${p.ticketTypeIds.map(id => types.find(t => t.id === id)?.name).filter(Boolean).join(', ')}` : ''].filter(Boolean).map(x => `<small>${esc(x)}</small>`).join('')}</div>`).join('')}</div>` : '';
  if (!open.some(t => t.id === sel)) sel = open.length === 1 ? open[0].id : '';

  root.innerHTML = `
    <div class="for"><a class="link" href="${back}">← ${esc(e.name)}</a><span class="kicker">${esc(shortDate(e.date))} · ${esc(doors(e))}</span></div>
    <h1 class="display">Choose your ticket</h1>
    ${banner}${code ? `<div class="notice ok">Promo code <b>${esc(code)}</b> is applied at checkout.</div>` : ''}
    <div class="types" role="group" aria-label="Ticket types">${types.map(t => `
      <button class="type" type="button" data-type="${esc(t.id)}" aria-pressed="false" ${t.soldOut ? 'disabled' : ''}>
        <span class="n">${esc(t.name)}${b.promo?.prices?.[t.id] && !t.soldOut ? ' <span class="promo-tag">Promo</span>' : ''}</span><span class="p">${b.promo?.prices?.[t.id] && !t.soldOut ? `<s>${money(t.pricePesewas)}</s> ${money(b.promo.prices[t.id].pricePesewas)}` : money(t.pricePesewas)}</span>
        <span class="s">${t.soldOut ? 'Sold out' : [t.admits > 1 ? `Admits ${t.admits}` : 'Admits one', t.lastFew ? 'Last few' : '', t.description].filter(Boolean).map(esc).join(' · ')}</span>
      </button>`).join('')}</div>
    <div id="qtyRow" hidden style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <span class="label" id="qtyLbl">How many?</span>
      <div class="qty" role="group" aria-labelledby="qtyLbl"><button type="button" id="minus" aria-label="One fewer">−</button><output id="qty" aria-live="polite">1</output><button type="button" id="plus" aria-label="One more">+</button></div>
      <span class="hint muted" id="qtyMax" hidden style="flex-basis:100%;font-size:13px">Up to 6 per order.</span>
      <span class="hint promo-hint" id="promoHint" hidden style="flex-basis:100%"></span>
    </div>
    <a class="btn red block inline-go" id="inlineGo" hidden href="#">Continue <span class="arrow">→</span></a>`;

  const bar = $('#buybar');
  const update = () => {
    const t = types.find(x => x.id === sel);
    $$('.type').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.type === sel)));
    $('#qtyRow').hidden = !t;
    // Keep the choice in the address, so a refresh or Back from checkout lands on the same pick.
    const q = new URLSearchParams({ event: e.id }); if (t) { q.set('type', t.id); q.set('qty', qty); } if (code) q.set('promo', code);
    history.replaceState(null, '', `tickets.html?${q}`);
    if (!t) { bar.classList.remove('show'); $('#inlineGo').hidden = true; document.body.style.setProperty('--bar-h', '0px'); return; }
    $('#qty').value = qty;
    $('#minus').disabled = qty <= 1; $('#plus').disabled = qty >= 6; $('#qtyMax').hidden = qty < 6;
    const go = `checkout.html?event=${encodeURIComponent(e.id)}&type=${encodeURIComponent(t.id)}&qty=${qty}${code ? `&promo=${encodeURIComponent(code)}` : ''}`;
    const pr = priced(t, qty);
    // A group deal close by: say so ("Get 4, pay for 3").
    const deal = promos.find(p => p.kind === 'bundle' && qty < p.buy && p.buy <= 6 && (!p.ticketTypeIds.length || p.ticketTypeIds.includes(t.id)));
    $('#promoHint').hidden = !(pr.promo || deal);
    $('#promoHint').textContent = pr.promo ? `${pr.promo.name}: you save ${money(pr.full - pr.total)}.` : deal ? `${deal.name}: get ${deal.buy}, pay for ${deal.pay}.` : '';
    $('#barSum').innerHTML = `${money(pr.total)}<small>${pr.promo ? `You save ${money(pr.full - pr.total)}` : `${qty} × ${esc(t.name)}`}</small>`;
    $('#barGo').href = $('#inlineGo').href = go;
    $('#barGo').innerHTML = `Continue <span class="arrow">→</span>`;
    $('#inlineGo').hidden = false; $('#inlineGo').innerHTML = `Continue · ${money(pr.total)} <span class="arrow">→</span>`;
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

// Selling, shared by the waiter and the bar: pick drinks (showing how many are left, finished ones
// can't be picked) and take the payment (Cash, or MoMo with its transaction ID).
import { $, $$, esc } from '../app.js';
import { sheet, say, busy, money } from './ops-ui.js';

// Draws a drink list into `el`. products: from /api/ops/products?stationId=… (with `left`).
// onSend(lines, total) runs when the big button is tapped; it may throw to show an error.
export function drinkPicker(el, products, { title = 'Pick drinks', top = '', button = n => `Send to bar · ${n}`, onSend, onBack } = {}) {
  const menu = products.filter(p => p.pricePesewas > 0);
  const cart = {};
  const cats = [...new Set(menu.map(p => p.category))];
  const out = p => !p.available || p.left === 0;
  const cap = p => Math.min(30, p.left == null ? 30 : p.left);
  const draw = () => {
    const total = Object.entries(cart).reduce((n, [id, q]) => n + q * menu.find(p => p.id === id).pricePesewas, 0), count = Object.values(cart).reduce((a, b) => a + b, 0);
    el.innerHTML = `${onBack ? '<button class="link" data-back style="justify-self:start">← Back</button>' : ''}<h1>${esc(title)}</h1>${top}
      ${cats.map(c => `<h3 class="cat-h">${esc(c)}</h3>${menu.filter(p => p.category === c).map(p => `<div class="pick ${out(p) ? 'out' : ''}"><div class="grow">${esc(p.name)}<small>${money(p.pricePesewas)}${out(p) ? ' · finished' : p.left != null && p.left <= 5 ? ` · only ${p.left} left` : ''}</small></div>
        ${out(p) ? '' : `<div class="qstep"><button type="button" data-m="${esc(p.id)}" aria-label="One fewer ${esc(p.name)}">−</button><span>${cart[p.id] || 0}</span><button type="button" data-p="${esc(p.id)}" aria-label="One more ${esc(p.name)}" ${(cart[p.id] || 0) >= cap(p) ? 'disabled' : ''}>+</button></div>`}</div>`).join('')}`).join('')}
      <div id="pkMsg"></div>
      <div class="dock"><button class="big" id="send" ${count ? '' : 'disabled'}>${count ? esc(button(`${count} drink${count > 1 ? 's' : ''} · ${money(total)}`)) : 'Pick drinks'}</button></div>`;
    $('[data-back]', el) && ($('[data-back]', el).onclick = onBack);
    $$('[data-p],[data-m]', el).forEach(b => b.onclick = () => {
      const id = b.dataset.p || b.dataset.m, p = menu.find(x => x.id === id);
      cart[id] = Math.max(0, Math.min(cap(p), (cart[id] || 0) + (b.dataset.p ? 1 : -1))); if (!cart[id]) delete cart[id];
      const y = scrollY; draw(); scrollTo(0, y);
    });
    $('#send', el).onclick = async () => {
      try { await busy($('#send', el), () => onSend(Object.entries(cart).map(([productId, qty]) => ({ productId, qty })), total), 'Saving…'); }
      catch (e) { say($('#pkMsg', el), e.message, 'bad'); }
    };
  };
  draw();
}

// The payment sheet for a fixed amount. pay({ method, momoRef, momoFrom }) records it; it may throw.
export function paySheet(totalPesewas, pay, { title = 'Customer pays' } = {}) {
  const { box, close } = sheet(`<h2>${esc(title)}: ${money(totalPesewas)}</h2>
    <div class="seg" role="radiogroup" aria-label="How they paid"><button type="button" class="mid on" data-pm="cash" role="radio" aria-checked="true">Cash</button><button type="button" class="mid" data-pm="momo" role="radio" aria-checked="false">MoMo</button></div>
    <div id="psMomo" hidden>
      <div class="sfield"><label for="psRef">MoMo transaction ID</label><input id="psRef" maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="From the MoMo text, e.g. 51234567890"><span class="hint">Only when you can see the money arrived on the club’s MoMo number.</span></div>
    </div>
    <div class="sfield"><label for="psFrom">Customer’s phone (optional)</label><input id="psFrom" type="tel" inputmode="tel" placeholder="024 123 4567"><span class="hint">So the manager sees what each customer spends tonight. For MoMo, the number it came from.</span></div>
    <p class="muted" id="psHint" style="margin:0">Take ${money(totalPesewas)} and give change. It goes in your cash for tonight.</p>
    <div id="psMsg"></div><button class="big" id="psGo">Cash received</button><button class="big ghost" data-close>Cancel</button>`, { label: title });
  let method = 'cash';
  $$('[data-pm]', box).forEach(b => b.onclick = () => {
    method = b.dataset.pm;
    $$('[data-pm]', box).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    $('#psMomo', box).hidden = method !== 'momo';
    $('#psHint', box).textContent = method === 'momo' ? 'Finance checks every MoMo ID against the club’s statement.' : `Take ${money(totalPesewas)} and give change. It goes in your cash for tonight.`;
    $('#psGo', box).textContent = method === 'momo' ? 'MoMo received' : 'Cash received';
    if (method === 'momo') $('#psRef', box).focus();
  });
  $('#psGo', box).onclick = async () => {
    const phone = $('#psFrom', box).value.trim() || undefined;
    const body = { method, customerPhone: phone, ...(method === 'momo' ? { momoRef: $('#psRef', box).value, momoFrom: phone } : {}) };
    try { await busy($('#psGo', box), () => pay(body)); close(); }
    catch (e) { say($('#psMsg', box), e.message, 'bad'); }
  };
  return close;
}

// "Hand in my cash": the person counts the cash they're holding; a difference needs a reason.
export async function handInCash(el, sapi) {
  let s; try { s = (await sapi('/api/ops/cash')).session; } catch { el.innerHTML = ''; return; }
  if (!s) { el.innerHTML = '<p class="muted">No cash taken tonight.</p>'; return; }
  if (s.status !== 'open') { el.innerHTML = `<div class="say good"><b>Cash handed in: ${money(s.countedPesewas)}</b>${s.differencePesewas ? `${money(Math.abs(s.differencePesewas))} ${s.differencePesewas < 0 ? 'less' : 'more'} than expected. ${esc(s.explanation)}` : 'It matched.'}</div>`; return; }
  el.innerHTML = `<p class="lead" style="margin:0">You should have <b>${money(s.expectedPesewas)}</b> in cash.</p>
    <div class="sfield"><label for="hcAmt">Cash you are holding now (GHS)</label><div class="money-in"><input id="hcAmt" inputmode="decimal" autocomplete="off"></div></div>
    <div class="sfield" id="hcWhyBox" hidden><label for="hcWhy">Why is it different?</label><input id="hcWhy" maxlength="400"></div>
    <div id="hcMsg"></div><button class="big" id="hcGo">Hand in my cash</button>`;
  $('#hcGo', el).onclick = async () => {
    const v = Math.round(Number(String($('#hcAmt', el).value).replace(/[^0-9.]/g, '')) * 100);
    if (!Number.isFinite(v) || $('#hcAmt', el).value === '') return say($('#hcMsg', el), 'Count your cash and enter the amount.', 'bad');
    try { await busy($('#hcGo', el), () => sapi('/api/ops/cash/close', { method: 'POST', body: { countedPesewas: v, explanation: $('#hcWhy', el).value } })); handInCash(el, sapi); }
    catch (e) { $('#hcWhyBox', el).hidden = false; say($('#hcMsg', el), e.message, 'bad'); $('#hcWhy', el).focus(); }
  };
}

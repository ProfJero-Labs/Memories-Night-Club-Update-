// The gate, on the Door screen (checkin.html): Sell (tickets and tables, cash or a MoMo prompt on
// the customer's phone), Check (anyone by phone or code: paid, member, table, VIP), table stock
// (free, held, booked) and the organiser's counts. Every sale is recorded with who sold it, so
// security and the organiser can check it and the Manager can count the cash.
import { $, $$, esc, money } from '../app.js';
import { sheet, say, busy, ask, when } from './ops-ui.js';
import { qrSvg } from '../ticket-art.js';
import { handInCash } from './sell.js';

const night = () => $('#ev')?.value || '';
const chooseFirst = '<div class="empty-box"><b>Choose the night</b>Pick tonight’s night at the top first.</div>';
const enc = encodeURIComponent;

// ── Sell ──
export async function sellView(el, sapi, { onSold = () => {} } = {}) {
  if (!night()) { el.innerHTML = chooseFirst; return; }
  const d = await sapi(`/api/door/gate/night?eventId=${enc(night())}`);
  const s = d.sales;
  el.innerHTML = `<h1 class="gate-h">Sell at the gate</h1>
    ${d.canSell ? '<p class="lead">Pick what they’re buying. Their phone number is their ticket: security can check it.</p>' : '<div class="say warn"><b>Not tonight</b>The gate only sells for tonight’s night.</div>'}
    <div class="group-h">Tickets (price at the door)</div>
    <div class="rows">${d.ticketTypes.map(t => `<button class="row-btn" type="button" data-tt="${esc(t.id)}" ${d.canSell && t.remaining !== 0 ? '' : 'disabled'}><span class="t">${esc(t.name)}</span><span class="s">${t.admits > 1 ? `Admits ${t.admits} · ` : ''}${t.remaining === null ? 'On sale' : t.remaining ? `${t.remaining} left` : 'Sold out'}</span><span class="r">${money(t.pricePesewas)}</span></button>`).join('') || '<p class="muted">No tickets on sale for this night.</p>'}</div>
    ${d.tables.length ? `<div class="group-h">Tables</div><div class="rows">${d.tables.map(p => `<button class="row-btn" type="button" data-pkg="${esc(p.packageId)}" ${d.canSell && p.free !== 0 ? '' : 'disabled'}><span class="t">${esc(p.name)}</span><span class="s">${p.free === null ? 'Available' : p.free ? `${p.free} free` : 'None free'}${p.capacity ? ` · up to ${p.capacity} people` : ''}</span><span class="r">${money(p.pricePesewas)}</span></button>`).join('')}</div>` : ''}
    <div class="group-h">Your sales tonight (${s.mine.count})</div>
    <div class="hero-row"><div class="hero"><span>Cash with you</span><b>${money(s.mine.cashPesewas)}</b></div><div class="hero"><span>MoMo</span><b>${money(s.mine.momoPesewas)}</b></div></div>
    <p class="muted" style="margin:0">Whole gate tonight: ${money(s.cashPesewas)} cash · ${money(s.momoPesewas)} MoMo · ${s.people} people · ${s.tables} tables.</p>
    <button class="big ghost" type="button" id="gHand">Hand in my cash</button>
    <button class="big ghost" type="button" id="gQr">Customers scan to buy</button>`;
  $$('[data-tt]', el).forEach(b => b.onclick = () => sellSheet(sapi, { kind: 'ticket', item: d.ticketTypes.find(t => t.id === b.dataset.tt) }, onSold));
  $$('[data-pkg]', el).forEach(b => b.onclick = () => sellSheet(sapi, { kind: 'table', item: d.tables.find(p => p.packageId === b.dataset.pkg) }, onSold));
  $('#gHand', el).onclick = () => { const { box } = sheet('<h2>Hand in my cash</h2><div id="hcBox" style="display:grid;gap:12px"></div><button class="big ghost" data-close>Close</button>', { label: 'Hand in cash' }); handInCash($('#hcBox', box), sapi); };
  $('#gQr', el).onclick = () => buyQr(d.buyUrl, d.event.name);
}

// Big QR for the queue: they scan it and buy on their own phone (online price, ticket texted).
export async function buyQr(url, name) {
  const { box } = sheet(`<h2>Scan to buy</h2><p class="lead" style="margin:0">${esc(name)}: point your camera here and buy on your phone. Then show us your ticket.</p>
    <div class="qr-big">${await qrSvg(url)}</div><p class="muted" style="margin:0;overflow-wrap:anywhere">${esc(url)}</p>
    <button class="big ghost" type="button" id="qrCopy">Copy the link</button><button class="big ghost" data-close>Close</button>`, { label: 'Scan to buy', full: true });
  $('#qrCopy', box).onclick = async () => { try { await navigator.clipboard.writeText(url); $('#qrCopy', box).textContent = 'Copied'; } catch { $('#qrCopy', box).textContent = 'Copy failed: read it out'; } };
}

// One sale: how many, their number, cash or MoMo. holdId sells a table held for someone.
export function sellSheet(sapi, { kind, item, holdId = '', name = '' }, onSold = () => {}) {
  const max = kind === 'ticket' ? Math.min(10, item.remaining ?? 10) : 1;
  let qty = 1;
  const { box, close } = sheet(`<h2>${esc(item.name)}</h2><div id="sBody" style="display:grid;gap:14px">
    ${kind === 'ticket' ? `<div class="sfield"><label>How many</label><div class="stepper"><button type="button" class="sbtn ghost" id="sMinus" aria-label="One less">−</button><b id="sQty">1</b><button type="button" class="sbtn ghost" id="sPlus" aria-label="One more">+</button></div>${item.admits > 1 ? `<span class="hint">Each admits ${item.admits}.</span>` : ''}</div>` : ''}
    <div class="sfield"><label for="sPhone">Their phone (it’s their ticket)</label><input id="sPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="024 123 4567"></div>
    <div class="sfield"><label for="sName">Their name (optional)</label><input id="sName" maxlength="80" autocomplete="off" value="${esc(name)}"></div>
    <div class="sale-total">Total <b id="sTotal">${money(item.pricePesewas)}</b></div>
    <div id="sMsg"></div>
    <button class="big" type="button" id="sCash">Took <span data-t>${money(item.pricePesewas)}</span> cash</button>
    <button class="big ghost" type="button" id="sMomo">MoMo prompt on their phone</button></div>`, { label: 'Sell' });
  const total = () => item.pricePesewas * qty;
  const draw = () => { if ($('#sQty', box)) $('#sQty', box).textContent = qty; $('#sTotal', box).textContent = money(total()); $('[data-t]', box).textContent = money(total()); };
  $('#sMinus', box) && ($('#sMinus', box).onclick = () => { qty = Math.max(1, qty - 1); draw(); });
  $('#sPlus', box) && ($('#sPlus', box).onclick = () => { qty = Math.min(max, qty + 1); draw(); });
  const sell = async (method, btn) => {
    const phone = $('#sPhone', box).value.trim();
    if (!phone) { say($('#sMsg', box), 'Type their phone number first.', 'bad'); $('#sPhone', box).focus(); return; }
    const body = { eventId: night(), phone, name: $('#sName', box).value, method, ...(kind === 'ticket' ? { ticketTypeId: item.id, quantity: qty } : holdId ? { holdId } : { packageId: item.packageId }) };
    try {
      const r = await busy(btn, () => sapi('/api/door/gate/sell', { method: 'POST', body }), method === 'cash' ? 'Recording…' : 'Sending…');
      if (r.status === 'issued') { done(r); return; }
      waitForMomo(r);
    } catch (e) { say($('#sMsg', box), e.status === 0 ? 'No connection. Nothing was recorded: try again.' : e.message, 'bad'); }
  };
  $('#sCash', box).onclick = e => sell('cash', e.currentTarget);
  $('#sMomo', box).onclick = e => sell('momo', e.currentTarget);
  function done(r) {
    $('#sBody', box).innerHTML = `<div class="result ok" role="alert"><h1 class="display">${r.kind === 'table' ? 'Table sold' : `Paid · admit ${r.people}`}</h1>
      <p style="margin:0">${money(r.amountPesewas)} recorded. ${r.kind === 'table' ? 'The table code' : 'Their ticket'} was texted to ${esc(r.phoneHint)}.</p></div><button class="big" data-close>Next sale</button>`;
    $$('[data-close]', box).forEach(b => b.onclick = close);
    navigator.vibrate?.(80); onSold();
  }
  // MoMo: wait for the customer to approve on their phone (or pay on the link), checking every 3s.
  async function waitForMomo(r) {
    $('#sBody', box).innerHTML = `<div class="result warn" role="status"><h1 class="display">${r.prompt ? 'Approve on your phone' : 'Pay on the link'}</h1><p style="margin:0">${esc(r.message)}</p>
      <div id="sLink"></div><p class="muted" style="margin:0" id="sWait">Waiting for the payment…</p></div><button class="big ghost" data-close>Stop waiting</button>`;
    $$('[data-close]', box).forEach(b => b.onclick = close);
    if (r.link) $('#sLink', box).innerHTML = `<div class="qr-big">${await qrSvg(r.link)}</div>`;
    const until = Date.now() + 5 * 60e3;
    while (box.isConnected && Date.now() < until) {
      await new Promise(res => setTimeout(res, 3000));
      if (!box.isConnected) return;
      let s; try { s = await sapi(`/api/door/gate/sale/${enc(r.reference)}`); } catch { continue; }
      if (s.status === 'issued') return done({ ...s, amountPesewas: s.amountPesewas || r.amountPesewas, people: s.people ?? qty, kind: s.kind === 'gate' ? kind : s.kind, phoneHint: s.phoneHint || 'their phone' });
      if (s.status === 'failed') { $('#sBody', box).innerHTML = `<div class="result no" role="alert"><h1 class="display">Not paid</h1><p style="margin:0">${esc(s.error || 'The payment didn’t go through.')} Nothing was sold.</p></div><button class="big" data-close>Close</button>`; $$('[data-close]', box).forEach(b => b.onclick = close); return; }
    }
    if (box.isConnected) $('#sWait', box).textContent = 'Still not paid. If they pay later it records by itself; check their number on Check.';
  }
}

// ── Check anyone: by phone, or the code on their ticket ──
export function checkView(el, sapi) {
  el.innerHTML = `<h1 class="gate-h">Check someone</h1><p class="lead">Did they pay, are they a member, do they have a table or VIP? Type their number.</p>
    <form id="ckForm" style="display:grid;gap:12px" novalidate>
      <div class="sfield"><label for="ckPhone">Their phone</label><input id="ckPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="024 123 4567"></div>
      <details class="fold"><summary>Have a ticket code instead?</summary><div class="sfield" style="margin-top:10px"><label for="ckCode">Ticket code</label><input id="ckCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. 7KQ2"></div></details>
      <button class="big" type="submit">Check</button></form>
    <div id="ckOut" aria-live="assertive"></div>
    <details class="fold" id="tgFold"><summary>A friend joining a table</summary>
      <div id="tgBody" style="display:grid;gap:12px;margin-top:10px">
        <p class="foot-small" style="margin:0">The table’s owner gets a code by text. If they know the friend, they read it to you.</p>
        <div class="sfield"><label for="tgTable">Table code</label><input id="tgTable" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="TBL-AB12CD"></div>
        <div class="sfield"><label for="tgPhone">Friend’s phone</label><input id="tgPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="024 123 4567"></div>
        <div id="tgMsg"></div><button class="big ghost" type="button" id="tgAsk">Text the owner a code</button>
        <div class="sfield" id="tgCodeBox" hidden><label for="tgCode">Code the owner reads out</label><input id="tgCode" inputmode="numeric" maxlength="4" autocomplete="off"></div>
        <button class="big" type="button" id="tgOk" hidden>Confirm the friend</button>
      </div></details>`;
  let lastPhone = '';
  $('#ckForm', el).onsubmit = async e => {
    e.preventDefault();
    if (!night()) { $('#ckOut', el).innerHTML = chooseFirst; return; }
    const phone = $('#ckPhone', el).value.trim(), code = $('#ckCode', el).value.trim();
    if (!phone && !code) { say($('#ckOut', el), 'Type their phone number.', 'bad'); $('#ckPhone', el).focus(); return; }
    lastPhone = phone;
    $('#ckOut', el).innerHTML = '<div class="loading" style="padding:10px 0">Checking…</div>';
    try { showCheck(await sapi(`/api/door/gate/check?eventId=${enc(night())}&phone=${enc(phone)}&code=${enc(code)}`)); }
    catch (er) { say($('#ckOut', el), er.status === 0 ? 'No connection. Not checked: try again.' : er.message, 'bad'); }
  };
  function showCheck(r) {
    const good = r.verdict === 'ok';
    $('#ckOut', el).innerHTML = `<div class="result ${good ? 'ok' : 'no'}" role="alert"><h1 class="display">${esc(r.message)}</h1>
      ${r.name || r.phoneHint ? `<p style="margin:0;font-size:22px"><strong>${esc(r.name)}</strong> ${esc(r.phoneHint)}</p>` : ''}
      ${good ? `<span class="vip ${r.vip ? 'yes' : 'no'}">${r.vip ? 'VIP access: yes' : 'No VIP access'}</span>` : ''}
      ${r.lines.map(l => `<div class="ck-line ${l.ok ? '' : 'bad'}"><b>${esc(l.title)}</b><span>${esc(l.sub)}${l.code ? ` · ${esc(l.code)}` : ''}</span></div>`).join('')}
      ${r.hint ? `<p style="margin:0">${esc(r.hint)}</p>` : ''}
      ${good ? '' : '<button class="big" type="button" id="ckReport">Report to the Manager</button>'}</div>`;
    navigator.vibrate?.(good ? 80 : [60, 60, 160]);
    const rep = $('#ckReport', el);
    if (rep) rep.onclick = async () => {
      const note = await ask({ title: 'Report to the Manager', label: 'Anything to add? (optional)', quick: ['Says they paid at the gate', 'Says they’re a member', 'Says they’re on a table', 'Came in without checking'], send: 'Report', required: false });
      if (note === null || note === undefined) return;
      try { await busy(rep, () => sapi('/api/door/gate/report', { method: 'POST', body: { eventId: night(), phone: lastPhone, note } })); rep.outerHTML = '<p style="margin:0"><b>Reported.</b> The Manager sees it under Issues.</p>'; }
      catch (er) { rep.textContent = er.status === 0 ? 'No connection: tap to try again' : er.message; }
    };
  }
  const tg = () => ({ eventId: night(), tableCode: $('#tgTable', el).value, phone: $('#tgPhone', el).value });
  $('#tgAsk', el).onclick = async e => {
    if (!night()) return say($('#tgMsg', el), 'Choose the night first.', 'bad');
    try { const r = await busy(e.currentTarget, () => sapi('/api/door/gate/table-guest/request', { method: 'POST', body: tg() }), 'Sending…'); say($('#tgMsg', el), r.message, 'warn'); $('#tgCodeBox', el).hidden = false; $('#tgOk', el).hidden = false; $('#tgCode', el).value = ''; $('#tgCode', el).focus(); }
    catch (er) { say($('#tgMsg', el), er.status === 0 ? 'No connection.' : er.message, 'bad'); }
  };
  $('#tgOk', el).onclick = async e => {
    try {
      const r = await busy(e.currentTarget, () => sapi('/api/door/gate/table-guest/confirm', { method: 'POST', body: { ...tg(), code: $('#tgCode', el).value } }), 'Checking…');
      $('#tgMsg', el).innerHTML = `<div class="result ok" role="alert"><h1 class="display">Let them in</h1><p style="margin:0">${esc(r.message)}</p></div>`; navigator.vibrate?.(80); $('#tgCodeBox', el).hidden = true; $('#tgOk', el).hidden = true; $('#tgPhone', el).value = '';
    } catch (er) { say($('#tgMsg', el), er.status === 0 ? 'No connection.' : er.message, 'bad'); }
  };
}

// ── Tables at the gate: free, held for someone, booked ──
export async function tableStock(el, sapi, { onChange = () => {} } = {}) {
  if (!night()) { el.innerHTML = ''; return; }
  const d = await sapi(`/api/door/gate/night?eventId=${enc(night())}`);
  if (!d.tables.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="group-h">Free tables to sell or hold</div>${d.tables.map(p => `<div class="tcard" style="cursor:default">
      <span class="row"><span class="t" style="font-size:20px">${esc(p.name)}</span><b>${p.free === null ? 'Open' : `${p.free} free`}</b></span>
      <span class="sub">${money(p.pricePesewas)}${p.capacity ? ` · up to ${p.capacity}` : ''} · ${p.booked.length} booked (${p.booked.filter(b => b.arrived).length} here)${p.held.length ? ` · ${p.held.length} held` : ''}</span>
      ${p.held.map(h => `<span class="row"><span>Held for <b>${esc(h.name)}</b> ${esc(h.phoneHint)} until ${when(h.until)}</span></span><span class="btn-row">${d.canSell ? `<button class="mid" type="button" data-hsell="${esc(h.id)}" data-pk="${esc(p.packageId)}" data-nm="${esc(h.name)}">Sell</button>` : ''}<button class="mid" type="button" data-rel="${esc(h.id)}">Let it go</button></span>`).join('')}
      ${d.canSell && p.free !== 0 ? `<span class="btn-row"><button class="mid" type="button" data-sell="${esc(p.packageId)}">Sell one</button><button class="mid" type="button" data-hold="${esc(p.packageId)}">Hold 30 min</button></span>` : ''}</div>`).join('')}
    <div id="tsMsg"></div>`;
  const pkg = id => d.tables.find(p => p.packageId === id);
  $$('[data-sell]', el).forEach(b => b.onclick = () => sellSheet(sapi, { kind: 'table', item: pkg(b.dataset.sell) }, onChange));
  $$('[data-hsell]', el).forEach(b => b.onclick = () => sellSheet(sapi, { kind: 'table', item: pkg(b.dataset.pk), holdId: b.dataset.hsell, name: b.dataset.nm }, onChange));
  $$('[data-rel]', el).forEach(b => b.onclick = async () => { try { await busy(b, () => sapi('/api/door/gate/release', { method: 'POST', body: { holdId: b.dataset.rel } })); onChange(); } catch (e) { say($('#tsMsg', el), e.message, 'bad'); } });
  $$('[data-hold]', el).forEach(b => b.onclick = () => {
    const { box, close } = sheet(`<h2>Hold a ${esc(pkg(b.dataset.hold).name)}</h2><p class="lead" style="margin:0">Kept for them for 30 minutes, then it’s free again.</p>
      <div class="sfield"><label for="hName">Their name</label><input id="hName" maxlength="80" autocomplete="off"></div>
      <div class="sfield"><label for="hPhone">Their phone (optional)</label><input id="hPhone" type="tel" inputmode="tel" autocomplete="off"></div>
      <div id="hMsg"></div><button class="big" type="button" id="hGo">Hold it</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Hold a table' });
    $('#hGo', box).onclick = async () => { try { await busy($('#hGo', box), () => sapi('/api/door/gate/hold', { method: 'POST', body: { eventId: night(), packageId: b.dataset.hold, name: $('#hName', box).value, phone: $('#hPhone', box).value } })); close(); onChange(); } catch (e) { say($('#hMsg', box), e.message, 'bad'); } };
  });
}

// ── The organiser's counts for their night ──
export async function countsView(el, sapi) {
  if (!night()) { el.innerHTML = chooseFirst; return; }
  const c = await sapi(`/api/door/gate/counts?eventId=${enc(night())}`);
  el.innerHTML = `<h1 class="gate-h">Counts</h1><p class="lead">${esc(c.event.name)}: everyone who came in, and how.</p>
    <div class="hero good"><span>Inside now (tickets and members)</span><b>${c.inside}</b></div>
    <div class="hero-row"><div class="hero"><span>Online tickets in</span><b>${c.online.in} / ${c.online.sold}</b></div><div class="hero"><span>Bought at the gate</span><b>${c.gate.people}</b></div></div>
    <div class="hero-row"><div class="hero"><span>Gate cash</span><b>${money(c.gate.cashPesewas)}</b></div><div class="hero"><span>Gate MoMo</span><b>${money(c.gate.momoPesewas)}</b></div></div>
    <div class="hero-row"><div class="hero"><span>Tables arrived</span><b>${c.tables.arrived} / ${c.tables.booked}</b></div><div class="hero"><span>Free passes in</span><b>${c.comps.in} / ${c.comps.issued}</b></div></div>
    <div class="hero"><span>Members in</span><b>${c.members}</b></div>
    <p class="muted" style="margin:0">Want to check someone? Use Check: their number shows if they paid, are a member or have a table. Anyone not in the system is reported to the Manager.</p>`;
}

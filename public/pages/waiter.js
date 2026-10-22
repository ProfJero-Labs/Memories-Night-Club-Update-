// waiter.html: a waiter's screen. Every step is one tap, and the waiter is never stuck on a table.
//   New tab: drinks + table (+ the customer's phone) → Send to bar → back to My tables, free to
//     start another tab or a quick sale. The bar hands the drinks over → "I got them" → on the tab.
//   Back on the tab: Add drinks, or Close tab. A drink to return or swap: "Return or swap".
//   Close tab: "Cash or MoMo?" Cash: take it, the tab closes, the receipt is texted. MoMo: a prompt
//     goes to the customer's phone and the invoice (with its pay link) is texted; it closes itself
//     once paid.
//   Quick sale: pick drinks → Cash or MoMo → the bar makes it → "I got them" → done.
// "Bookings": booked tables and the bottles they paid for. "My report": sales, cash, hand in, submit.
import { $, $$, esc, normalizePhone } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
import { qrSvg } from '../ticket-art.js';
import { sheet, say, st, every, bottomNav, busy, ghsIn, moneyField, money, when, backBar, bindBackBar, returnTo, pasteMomoButton, upcomingBookings } from '../lib/ops-ui.js';
import { drinkPicker, paySheet, handInCash, tipBox, tipSheet, tipSaid } from '../lib/sell.js';

const user = await requireStaff(['waitStaff', 'eventManager', 'superAdmin', 'director', 'manager']);
staffHeader(user, 'Tables');
const app = $('#app');
const canCash = user.me?.canCollectCash === true;
let stop = null;
const nav = bottomNav([['tabs', 'My tables'], ['tables', 'Bookings'], ['report', 'My report']], k => { location.hash = k; });

function route() {
  if (stop) { stop(); stop = null; }
  const [k, arg] = location.hash.slice(1).split('/');
  nav.setActive(['tab', 'add', 'quick', 'order'].includes(k) ? 'tabs' : k || 'tabs');
  scrollTo(0, 0);
  if (k === 'tab') return tabView(arg);
  if (k === 'add') return takeOrder(arg);
  if (k === 'order') return takeOrder();
  if (k === 'quick') return quickSale();
  if (k === 'tables') return bookings();
  if (k === 'report') return report();
  return tabsList();
}
addEventListener('hashchange', route);
const fail = e => { app.innerHTML = `<div class="say bad" role="alert"><b>Couldn’t load</b>${esc(e.message)}</div><button class="big ghost" id="retry">Try again</button>`; $('#retry').onclick = route; };

// ── My tabs ──
async function tabsList() {
  app.innerHTML = `<h1>My tables</h1>
    <div id="msg"></div>
    <div class="btn-row"><button class="big" id="newTab">New tab</button><button class="big ghost" id="quick">Quick sale</button></div>
    <div class="cards" id="list"><div class="loading">Loading…</div></div>
    <button class="mid ghost" id="tipOnly">Record a tip (no bill)</button>`;
  $('#newTab').onclick = () => { location.hash = 'order'; };
  $('#quick').onclick = () => { location.hash = 'quick'; };
  $('#tipOnly').onclick = () => tipSheet(sapi, user.uid, m => say($('#msg'), m));
  const flash = sessionStorage.getItem('waiter-flash'); if (flash) { sessionStorage.removeItem('waiter-flash'); say($('#msg'), flash); }
  stop = every(6000, async alive => {
    const { tabs } = await sapi('/api/ops/tabs');
    if (!alive()) return;
    const open = tabs.filter(t => t.status === 'open'), done = tabs.filter(t => t.status !== 'open');
    nav.setDot('tabs', open.length || 0);
    $('#list').innerHTML = (open.length ? open.map(card).join('') : '<div class="empty-box"><b>No open tabs</b>Tap “New tab” when a table or customer orders.</div>')
      + (done.length ? `<details class="fold"><summary>Closed tonight (${done.length})</summary><div class="cards">${done.map(card).join('')}</div></details>` : '');
    $$('[data-tab]').forEach(b => b.onclick = () => { location.hash = `tab/${b.dataset.tab}`; });
    $$('[data-more]').forEach(b => b.onclick = () => { location.hash = `add/${b.dataset.more}`; });
    $$('[data-pay]').forEach(b => b.onclick = async () => {
      try { const { tab } = await busy(b, () => sapi(`/api/ops/tab?id=${encodeURIComponent(b.dataset.pay)}`), 'Opening…'); closeSheet(tab); }
      catch (e) { say($('#msg'), e.message, 'bad'); }
    });
  });
}
// An open tab on My tables: its two next steps right on it.
const card = t => t.status !== 'open' || t.quick ? doneCard(t) : `<div class="tcard ${t.openRounds ? 'warn' : ''}" style="cursor:default">
  <button type="button" class="tcard-open" data-tab="${esc(t.id)}"><span class="row"><span class="t">${esc(t.label)} · ${esc(t.table)}</span><span class="amt">${money(t.bill.balancePesewas || t.bill.totalPesewas)}</span></span>
  <span class="row"><span class="sub">${t.customerName ? `${esc(t.customerName)} · ` : ''}${t.openRounds ? `${t.openRounds} order${t.openRounds > 1 ? 's' : ''} to collect` : 'All collected'}</span>${st(t.payStatus, t.payLabel)}</span></button>
  <span class="btn-row"><button type="button" class="mid" data-more="${esc(t.id)}">Add drinks</button><button type="button" class="mid okc" data-pay="${esc(t.id)}" ${t.bill.totalPesewas ? '' : 'disabled'}>Close tab</button></span></div>`;
const doneCard = t => `<button class="tcard ${t.status !== 'open' ? 'done' : t.openRounds ? 'warn' : ''}" data-tab="${esc(t.id)}">
  <span class="row"><span class="t">${esc(t.label)} · ${esc(t.table)}</span><span class="amt">${money(t.bill.balancePesewas || t.bill.totalPesewas)}</span></span>
  <span class="row"><span class="sub">${t.customerName ? `${esc(t.customerName)} · ` : ''}${t.status !== 'open' ? 'Closed' : t.openRounds ? `${t.openRounds} order${t.openRounds > 1 ? 's' : ''} to collect` : 'Add drinks or close'}</span>${st(t.payStatus, t.payLabel)}</span></button>`;

// ── One tab: Add drinks or Close tab, the orders to collect, the bill ──
async function tabView(id) {
  app.innerHTML = '<div class="loading">Loading…</div>';
  let t;
  const draw = async (alive = () => true) => {
    const fresh = (await sapi(`/api/ops/tab?id=${encodeURIComponent(id)}`)).tab;
    if (!alive()) return;
    t = fresh;
    const b = t.bill, toCollect = t.rounds.filter(r => !['delivered', 'cancelled'].includes(r.status)).length;
    const open = t.status === 'open';
    app.innerHTML = `${backBar('', 'tabs')}
      <div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h1>${esc(t.label)} · ${esc(t.table)}</h1>${st(t.payStatus, t.payLabel)}</div>
      ${t.customerName || t.customerPhoneHint ? `<p class="lead">${esc(t.customerName)}${t.customerPhoneHint ? ` · ${esc(t.customerPhoneHint)}` : ''}</p>` : ''}
      <div id="msg"></div>
      ${open && t.quick ? '<div class="say warn"><b>Quick sale</b>Collect the drinks at the bar, then tap “I got them”. It closes by itself.</div>' : ''}
      ${open && !t.quick ? `<div class="pay-now"><b>${money(b.balancePesewas)} ${b.paidPesewas && !b.balancePesewas ? 'paid' : 'so far'}</b>
        <div class="btn-row"><button class="big ghost" id="add">Add drinks</button><button class="big" id="close" ${b.totalPesewas ? '' : 'disabled'}>Close tab</button></div>
        ${toCollect ? `<span class="sub">${toCollect} order${toCollect > 1 ? 's' : ''} to collect from the bar first (below).</span>` : ''}</div>` : ''}
      ${!open ? `<div class="say ${t.status === 'closed' ? 'good' : 'warn'}"><b>${t.status === 'closed' ? 'Closed' : 'Written off'}</b>This tab is finished.</div>` : ''}
      <h2>Orders</h2>
      <div class="cards">${t.rounds.map(roundCard).join('') || '<div class="empty-box"><b>No drinks yet</b>Tap “Add drinks”.</div>'}</div>
      <h2>Bill</h2>
      <div class="lines-list">${b.lines.map(l => `<div class="ln"><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.amountPesewas)}</span></div>`).join('')}
        ${b.discountPesewas ? `<div class="ln"><span>Discount</span><span>−${money(b.discountPesewas)}</span></div>` : ''}
        <div class="ln total"><span>Total</span><span>${money(b.totalPesewas)}</span></div>
        <div class="ln"><span>Paid${t.payments.length ? ` <small>(${t.payments.map(p => `${p.method === 'cash' ? 'cash' : 'MoMo'} ${money(p.amountPesewas)}`).join(', ')})</small>` : ''}</span><span>${money(b.paidPesewas)}</span></div>
        <div class="ln total"><span>Still to pay</span><span>${money(b.balancePesewas)}</span></div></div>
      ${open && !t.quick ? `<details class="fold"><summary>More</summary><div class="btn-row" style="margin-top:10px">
        ${b.balancePesewas ? '<button class="mid" id="showBill">Show QR to pay</button><button class="mid" id="invoice">Text the invoice now</button>' : ''}
        ${b.balancePesewas && canCash ? '<button class="mid" id="cash">Part payment / MoMo to the club’s number</button>' : ''}
        <button class="mid" id="ask">Ask the manager</button></div></details>` : ''}`;
    bindBackBar(app);
    const flash = sessionStorage.getItem('waiter-flash'); if (flash) { sessionStorage.removeItem('waiter-flash'); say($('#msg'), flash); }
    $('#add') && ($('#add').onclick = () => { location.hash = `add/${t.id}`; });
    $('#close') && ($('#close').onclick = () => closeSheet(t));
    $('#showBill') && ($('#showBill').onclick = () => showBill(t));
    $('#cash') && ($('#cash').onclick = () => takePayment(t));
    $('#invoice') && ($('#invoice').onclick = async e => {
      if (!t.customerPhoneHint) return sendInvoice(t);
      try { const r = await busy(e.currentTarget, () => sapi('/api/ops/tabs/text-bill', { method: 'POST', body: { tabId: t.id } }), 'Sending…'); say($('#msg'), r.sent ? `Invoice texted to ${r.phoneHint}.` : 'The text didn’t send. Show the QR instead.', r.sent ? 'good' : 'bad'); }
      catch (er) { say($('#msg'), er.message, 'bad'); }
    });
    $('#ask') && ($('#ask').onclick = () => askManager(t));
    $$('[data-act]').forEach(btn => btn.onclick = () => roundAct(btn.dataset.r, btn.dataset.act, t));
  };
  stop = every(5000, alive => { if (document.querySelector('.sheet-back')) return; return draw(alive).catch(e => alive() && fail(e)); });
}

// Close tab: cash or MoMo. Cash → take it, closed, receipt texted. MoMo → a prompt on their phone and
// the invoice by text; it closes by itself once paid.
function closeSheet(t) {
  const b = t.bill, toCollect = t.rounds.filter(r => !['delivered', 'cancelled'].includes(r.status)).length;
  if (toCollect) return say($('#msg'), `${toCollect === 1 ? 'One order isn’t' : `${toCollect} orders aren’t`} collected yet. Tap “I got them” (or cancel it) first, then close the tab.`, 'bad');
  const paid = !b.balancePesewas;
  const { box, close } = sheet(`<h2>Close ${esc(t.label)}</h2><div id="csBody" style="display:grid;gap:14px">
    <div class="sale-total"><span>${paid ? 'Already paid' : 'To pay'}</span><b>${money(paid ? b.totalPesewas : b.balancePesewas)}</b></div>
    <div class="sfield"><label for="csPhone">Customer’s phone (gets the ${paid ? 'receipt' : 'invoice'})</label><input id="csPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="${esc(t.customerPhoneHint || '024 123 4567')}">${t.customerPhoneHint ? `<span class="hint">Empty: it goes to ${esc(t.customerPhoneHint)}.</span>` : '<span class="hint">Optional for cash. Needed for MoMo.</span>'}</div>
    <div id="csMsg"></div>
    ${paid ? '<button class="big" id="csDone">Close the tab</button>' : `<p class="lead" style="margin:0">How is the customer paying?</p>
    <div class="btn-row"><button class="big" id="csCash" ${canCash ? '' : 'disabled'}>Cash</button><button class="big" id="csMomo">MoMo</button></div>
    ${canCash ? '' : '<span class="hint">Cash: your job doesn’t include taking cash. Send them to the cashier.</span>'}`}</div>`, { label: 'Close tab' });
  const phone = () => $('#csPhone', box)?.value.trim() || '';
  // Opened from My tables: just close the panel and refresh the list. From a tab: back to My tables.
  const backToTables = () => { if (!location.hash.startsWith('#tab/')) { close(); setTimeout(route, 0); } else returnTo('tabs'); };
  const go = async (method, btn) => {
    if (phone() && !normalizePhone(phone())) return say($('#csMsg', box), 'That phone number doesn’t look right.', 'bad');
    try {
      const r = await busy(btn, () => sapi('/api/ops/tabs/checkout', { method: 'POST', body: { tabId: t.id, method, phone: phone() } }), method === 'momo' ? 'Sending…' : 'Closing…');
      if (r.closed) return done(`${r.cashPesewas ? `${money(r.cashPesewas)} cash taken.` : 'Paid.'} ${t.label} closed.${r.receiptSent ? ` Receipt texted to ${r.phoneHint}.` : ''}`);
      waitMomo(r);
    } catch (e) { say($('#csMsg', box), e.status === 0 ? 'No connection. Nothing was recorded: try again.' : e.message, 'bad'); }
  };
  $('#csDone', box) && ($('#csDone', box).onclick = e => go('cash', e.currentTarget));
  $('#csCash', box) && ($('#csCash', box).onclick = () => {
    const btn = $('#csCash', box); btn.textContent = `Got ${money(b.balancePesewas)} cash · close`; btn.classList.add('okc');
    btn.onclick = e => go('cash', e.currentTarget); $('#csMomo', box).hidden = true;
  });
  $('#csMomo', box) && ($('#csMomo', box).onclick = e => go('momo', e.currentTarget));
  function done(text) {
    $('#csBody', box).innerHTML = `<div class="result ok" role="alert"><h1 class="display">Tab closed</h1><p style="margin:0">${esc(text)}</p></div><button class="big" id="csBack">Back to my tables</button>`;
    navigator.vibrate?.(80);
    $('#csBack', box).onclick = backToTables; // closes the panel too
  }
  async function waitMomo(r) {
    $('#csBody', box).innerHTML = `<div class="result warn" role="status"><h1 class="display">${r.prompt ? 'Approve on your phone' : 'Pay from the text'}</h1><p style="margin:0">${esc(r.message)}</p>
      <div class="qr-big" id="csQr"></div><p class="muted" style="margin:0" id="csWait">Waiting for the payment… The tab closes by itself once paid.</p></div>
      <button class="big ghost" id="csLater">Back to my tables (it closes when paid)</button>`;
    $('#csQr', box).innerHTML = await qrSvg(r.billUrl).catch(() => '');
    $('#csLater', box).onclick = backToTables;
    const until = Date.now() + 10 * 60e3;
    while (box.isConnected && Date.now() < until) {
      await new Promise(res => setTimeout(res, 3000));
      if (!box.isConnected) return;
      try {
        const s = r.reference ? await sapi(`/api/ops/tabs/charge?ref=${encodeURIComponent(r.reference)}`) : { tabStatus: (await sapi(`/api/ops/tab?id=${encodeURIComponent(t.id)}`)).tab.status };
        if (s.tabStatus === 'closed') return done(`Paid by MoMo (${money(r.amountPesewas)}). ${t.label} closed.`);
        if (s.status === 'failed') { r.reference = ''; $('#csWait', box).textContent = 'The prompt wasn’t approved. They can still pay from the invoice text or this QR.'; }
      } catch { /* weak signal: keep checking */ }
    }
  }
}

const roundCard = r => {
  const back = r.lines.some(l => l.returnPending);
  const took = `<button class="mid" data-r="${esc(r.id)}" data-act="took">I took them from the bar</button>`;
  // The waiter confirms once that they got the drinks from the bar. After that, a drink the customer
  // didn't take can go back to the bar, or be recorded as broken.
  const got = `<button class="mid okc" data-r="${esc(r.id)}" data-act="delivered">I got them ✓</button>`;
  const after = `<button class="mid" data-r="${esc(r.id)}" data-act="return">Return or swap</button><button class="sbtn" data-r="${esc(r.id)}" data-act="broken">Broken</button>`;
  const open = r.lines.some(l => l.qty - l.returnedQty - l.brokenQty - l.compQty - l.returnPending > 0);
  const acts = r.status === 'waiting' ? `<button class="mid" data-r="${esc(r.id)}" data-act="cancel">Cancel</button>${took}`
    : ['preparing', 'ready'].includes(r.status) ? took
    : ['handed', 'received'].includes(r.status) ? got
      : r.status === 'delivered' && open ? after
        : '';
  return `<div class="tcard ${['delivered', 'cancelled'].includes(r.status) ? 'done' : ['handed', 'received'].includes(r.status) ? 'warn' : ''}" style="cursor:default">
    <span class="row"><span class="sub">${when(r.createdAt)}${r.handedByName ? ` · from ${esc(r.handedByName)}` : ''}</span>${st(r.status, r.statusLabel)}</span>
    <span>${r.lines.map(l => `<b>${l.qty} ×</b> ${esc(l.name)}${l.returnedQty ? ` <small class="muted">(${l.returnedQty} sent back)</small>` : ''}${l.brokenQty ? ` <small class="muted">(${l.brokenQty} broken)</small>` : ''}${l.compQty ? ` <small class="muted">(${l.compQty} free)</small>` : ''}`).join('<br>')}</span>
    ${back ? '<span class="sub">Waiting for the bar to take drinks back.</span>' : ''}${r.cancelReason ? `<span class="sub">${esc(r.cancelReason)}</span>` : ''}
    ${acts ? `<span class="btn-row">${acts}</span>` : ''}</div>`;
};
async function roundAct(rid, action, t) {
  const r = t.rounds.find(x => x.id === rid);
  if (action === 'return' || action === 'broken') return pickLine(r, action);
  if (action === 'cancel' && !confirm('Cancel this order? The bar hasn’t started it.')) return;
  try { await sapi('/api/ops/tabs/round-action', { method: 'POST', body: { roundId: rid, action } }); route(); }
  catch (e) { say($('#msg'), e.message, 'bad'); }
}
function pickLine(r, action) {
  const lines = r.lines.filter(l => l.qty - l.returnedQty - l.brokenQty - l.compQty - l.returnPending > 0);
  const { box, close } = sheet(`<h2>${action === 'return' ? 'Return or swap' : 'Record broken'}</h2>
    <p class="muted" style="margin:0">${action === 'return' ? 'The customer doesn’t want it, or wants something else. It comes off the bill when the bar has it back.' : 'Drinks that broke or spilled. They come off the bill and show in your report.'}</p>
    <div class="sfield"><label for="plLine">Drink</label><select id="plLine">${lines.map(l => `<option value="${esc(l.lineId)}">${esc(l.name)} (up to ${l.qty - l.returnedQty - l.brokenQty - l.compQty - l.returnPending})</option>`).join('')}</select></div>
    <div class="sfield"><label for="plQty">How many</label><input id="plQty" inputmode="numeric" value="1"></div>
    ${action === 'broken' ? '<div class="sfield"><label for="plNote">What happened (optional)</label><input id="plNote" maxlength="120"></div>' : ''}
    <div id="plMsg"></div>
    ${action === 'return' ? '<button class="big" id="plSwap">Swap: return it and pick the new drink</button><button class="big ghost" id="plGo">Just return it</button>' : '<button class="big" id="plGo">Save</button>'}<button class="big ghost" data-close>Cancel</button>`, { label: action === 'return' ? 'Return or swap' : 'Broken' });
  const send = btn => busy(btn, () => sapi('/api/ops/tabs/round-action', { method: 'POST', body: { roundId: r.id, action, lineId: $('#plLine', box).value, qty: Number($('#plQty', box).value), note: $('#plNote', box)?.value } }));
  $('#plGo', box).onclick = async e => { try { await send(e.currentTarget); close(); route(); } catch (er) { say($('#plMsg', box), er.message, 'bad'); } };
  // Swap: the drink goes back (off the bill once the bar has it) and the new one goes to the bar.
  $('#plSwap', box) && ($('#plSwap', box).onclick = async e => {
    try { await send(e.currentTarget); close(); sessionStorage.setItem('waiter-swap', r.tabId); setTimeout(() => { location.hash = `add/${r.tabId}`; }, 0); }
    catch (er) { say($('#plMsg', box), er.message, 'bad'); }
  });
}

async function showBill(t) {
  const { box } = sheet(`<h2>${esc(t.label)}: ${money(t.bill.balancePesewas)} to pay</h2>
    <p class="muted" style="margin:0">The customer scans this with their phone camera, sees every drink, and pays by MoMo or card.</p>
    <div class="qrbox" id="sbQr"></div>
    <div class="btn-row"><button class="mid" id="sbShare">Send the link</button><button class="mid" id="sbCopy">Copy link</button></div>
    <div class="sfield"><label for="sbPhone">Or text it to their phone</label><input id="sbPhone" type="tel" inputmode="tel" placeholder="024 123 4567"></div>
    <button class="mid red" id="sbText">Text the bill</button><div id="sbMsg"></div><button class="big ghost" data-close>Done</button>`, { label: 'The bill' });
  $('#sbQr', box).innerHTML = await qrSvg(t.billUrl).catch(() => '');
  $('#sbCopy', box).onclick = async () => { try { await navigator.clipboard.writeText(t.billUrl); $('#sbCopy', box).textContent = 'Copied'; } catch { prompt('Copy this link:', t.billUrl); } };
  $('#sbShare', box).onclick = async () => { if (navigator.share) { try { await navigator.share({ title: `Memories ${t.label}`, text: `Your Memories bill: ${money(t.bill.balancePesewas)}`, url: t.billUrl }); } catch { /* closed */ } } else $('#sbCopy', box).click(); };
  $('#sbText', box).onclick = async () => {
    try { const r = await busy($('#sbText', box), () => sapi('/api/ops/tabs/text-bill', { method: 'POST', body: { tabId: t.id, phone: $('#sbPhone', box).value } }), 'Sending…'); say($('#sbMsg', box), r.sent ? `Texted to ${r.phoneHint}.` : 'The text didn’t send. Show the QR instead.', r.sent ? 'good' : 'bad'); }
    catch (e) { say($('#sbMsg', box), e.message, 'bad'); }
  };
}

// The invoice by text: to the phone on the table (or one typed now). Lists every drink and the total.
function sendInvoice(t) {
  const { box, close } = sheet(`<h2>Send invoice · ${esc(t.label)}</h2>
    <p class="muted" style="margin:0">A text with every drink, the total, and a link to pay with MoMo or card.</p>
    <div class="sfield"><label for="ivPhone">Customer’s phone</label><input id="ivPhone" type="tel" inputmode="tel" placeholder="${esc(t.customerPhoneHint || '024 123 4567')}"><span class="hint">${t.customerPhoneHint ? `Leave empty to use ${esc(t.customerPhoneHint)}.` : 'Ghana number.'}</span></div>
    <div id="ivMsg"></div><button class="big" id="ivGo">Send invoice</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Send invoice' });
  $('#ivGo', box).onclick = async () => {
    const phone = $('#ivPhone', box).value.trim();
    if (phone && !normalizePhone(phone)) return say($('#ivMsg', box), 'That phone number doesn’t look right.', 'bad');
    if (!phone && !t.customerPhoneHint) return say($('#ivMsg', box), 'Enter the customer’s phone number.', 'bad');
    try {
      const r = await busy($('#ivGo', box), () => sapi('/api/ops/tabs/text-bill', { method: 'POST', body: { tabId: t.id, phone } }), 'Sending…');
      if (!r.sent) return say($('#ivMsg', box), 'The text didn’t send. Use “Show bill (QR)” instead.', 'bad');
      close(); say($('#msg'), `Invoice texted to ${r.phoneHint}.`);
    } catch (e) { say($('#ivMsg', box), e.message, 'bad'); }
  };
}

// "Customer paid": cash (into your cash bag) or MoMo sent to the club's number (with its ID).
function takePayment(t) {
  const { box, close } = sheet(`<h2>Customer paid · ${esc(t.label)}</h2>
    <div class="seg" role="radiogroup" aria-label="How they paid"><button type="button" class="mid on" data-m="cash" role="radio" aria-checked="true">Cash</button><button type="button" class="mid" data-m="momo" role="radio" aria-checked="false">MoMo</button></div>
    ${moneyField('tcAmt', 'Amount paid (GHS)', (t.bill.balancePesewas / 100).toString(), `Still to pay: ${money(t.bill.balancePesewas)}.`)}
    <div id="tcMomo" hidden>
      <div id="tcPaste"></div>
      <div class="sfield"><label for="tcRef">MoMo transaction ID</label><input id="tcRef" maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="From the MoMo text, e.g. 51234567890"><span class="hint">Check the customer’s MoMo text, or the club’s MoMo phone.</span></div>
      <div class="sfield"><label for="tcFrom">Paid from number (optional)</label><input id="tcFrom" type="tel" inputmode="tel" placeholder="024 123 4567"></div>
    </div>
    <p class="muted" id="tcHint" style="margin:0">Give change from the cash. Cash you take goes in your report.</p>
    <div id="tcTip"></div>
    <div id="tcMsg"></div><button class="big" id="tcGo">Record cash</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Customer paid' });
  let method = 'cash';
  const tb = tipBox($('#tcTip', box), sapi, t.waiterUid || user.uid);
  // Smart paste: the ID, the amount and the number, out of the MoMo text (checked, not retyped).
  $('#tcPaste', box).append(pasteMomoButton(m => { if (m.ref) $('#tcRef', box).value = m.ref; if (m.amountPesewas && m.amountPesewas <= t.bill.balancePesewas) $('#tcAmt', box).value = String(m.amountPesewas / 100); if (m.phone) $('#tcFrom', box).value = m.phone; }));
  $$('[data-m]', box).forEach(b => b.onclick = () => {
    method = b.dataset.m; tb.method(method);
    $$('[data-m]', box).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    $('#tcMomo', box).hidden = method !== 'momo';
    $('#tcHint', box).textContent = method === 'momo' ? 'Only record MoMo you can see arrived on the club’s number. Finance checks every ID.' : 'Give change from the cash. Cash you take goes in your report.';
    $('#tcGo', box).textContent = method === 'momo' ? 'Record MoMo' : 'Record cash';
    if (method === 'momo') $('#tcRef', box).focus();
  });
  $('#tcGo', box).onclick = async () => {
    try {
      const body = { tabId: t.id, method, amountPesewas: ghsIn($('#tcAmt', box).value), ...tb.value() };
      if (method === 'momo') Object.assign(body, { momoRef: $('#tcRef', box).value, momoFrom: $('#tcFrom', box).value.trim() || undefined });
      const r = await busy($('#tcGo', box), () => sapi('/api/ops/tabs/pay', { method: 'POST', body }));
      const what = `${method === 'momo' ? 'MoMo recorded.' : 'Cash recorded.'}${tipSaid(r)}`;
      close(); route(); setTimeout(() => say($('#msg'), r.balancePesewas ? `${what} ${money(r.balancePesewas)} still to pay.` : `${what} The table is paid.`), 50);
    } catch (e) { say($('#tcMsg', box), e.message, 'bad'); }
  };
}

function askManager(t) {
  const lines = t.rounds.filter(r => r.status !== 'cancelled').flatMap(r => r.lines.map(l => ({ ...l, roundId: r.id })));
  const { box, close } = sheet(`<h2>Ask the manager</h2><p class="muted" style="margin:0">The manager approves it on their phone. Nothing changes until they do.</p>
    <div class="sfield"><label for="amKind">What do you need?</label><select id="amKind"><option value="comp">A free drink</option><option value="discount">Money off the bill</option><option value="write_off">The customer can’t pay</option></select></div>
    <div id="amComp"><div class="sfield"><label for="amLine">Which drink</label><select id="amLine">${lines.map(l => `<option value="${esc(l.roundId)}|${esc(l.lineId)}">${esc(l.name)} (${l.qty})</option>`).join('')}</select></div>
      <div class="sfield"><label for="amQty">How many free</label><input id="amQty" inputmode="numeric" value="1"></div></div>
    <div id="amDisc" hidden>${moneyField('amAmt', 'Amount off (GHS)')}</div>
    <div class="sfield"><label for="amWhy">Why</label><input id="amWhy" maxlength="200" placeholder="e.g. birthday, drink was wrong"></div>
    <div id="amMsg"></div><button class="big" id="amGo">Send to manager</button><button class="big ghost" data-close>Cancel</button>`);
  const sync = () => { const k = $('#amKind', box).value; $('#amComp', box).hidden = k !== 'comp'; $('#amDisc', box).hidden = k !== 'discount'; };
  $('#amKind', box).onchange = sync; sync();
  $('#amGo', box).onclick = async () => {
    const kind = $('#amKind', box).value, [roundId, lineId] = ($('#amLine', box)?.value || '|').split('|');
    try { const r = await busy($('#amGo', box), () => sapi('/api/ops/approvals/request', { method: 'POST', body: { kind, tabId: t.id, roundId, lineId, qty: Number($('#amQty', box).value), amountPesewas: ghsIn($('#amAmt', box)?.value || ''), reason: $('#amWhy', box).value } }), 'Sending…'); close(); say($('#msg'), r.message || 'Sent to the manager.'); }
    catch (e) { say($('#amMsg', box), e.message, 'bad'); }
  };
}

// ── Take an order: new (drinks + table + phone on one screen) or more drinks for a table ──
async function takeOrder(tabId = '') {
  app.innerHTML = '<div class="loading">Loading the menu…</div>';
  let t = null, d, booked = [];
  try {
    if (tabId) t = (await sapi(`/api/ops/tab?id=${encodeURIComponent(tabId)}`)).tab;
    const stations = (await sapi('/api/ops/products')).stations;
    let stationId = t?.stationId || sessionStorage.getItem('waiter-bar') || stations[0]?.id || '';
    if (!stations.some(x => x.id === stationId)) stationId = stations[0]?.id || '';
    d = { stations, stationId, products: (await sapi(`/api/ops/products?stationId=${encodeURIComponent(stationId)}`)).products };
    if (!t) booked = (await sapi('/api/ops/tables').catch(() => ({ tables: [] }))).tables.filter(x => x.arrived).map(x => x.tableNumber || x.firstName).filter(Boolean);
  } catch (e) { return fail(e); }
  // The table and the customer's phone: typed once, kept while drinks are added.
  const top = document.createElement('div'); top.className = 'order-top';
  top.innerHTML = t ? `<p class="lead" style="margin:0">${esc(t.table === 'Walk-in' ? 'No table' : `Table ${t.table}`)}${t.customerPhoneHint ? ` · invoice to ${esc(t.customerPhoneHint)}` : ''}</p>${t.customerPhoneHint ? '' : '<div class="sfield"><label for="odPhone">Customer’s phone, for the invoice (optional)</label><input id="odPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="024 123 4567"></div>'}`
    : `<div class="sfield"><label for="odTable">Table (leave empty if standing)</label><input id="odTable" maxlength="30" autocomplete="off" placeholder="e.g. 5, VIP 2"></div>
    ${booked.length ? `<div class="chips" aria-label="Booked tables here tonight">${booked.map(b => `<button type="button" data-t="${esc(b)}">${esc(b)}</button>`).join('')}</div>` : ''}
    <div class="sfield"><label for="odPhone">Customer’s phone, for the invoice (optional)</label><input id="odPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="024 123 4567"><span class="hint">The invoice goes to it when you close the tab.</span></div>
    ${d.stations.length > 1 ? `<div class="sfield"><label for="odBar">Which bar makes the drinks?</label><select id="odBar">${d.stations.map(x => `<option value="${esc(x.id)}" ${x.id === d.stationId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
    <details class="fold"><summary>Someone brought this table? (commission)</summary>
      <div class="sfield"><label for="odBy">Their name</label><input id="odBy" maxlength="60" autocomplete="off"></div>
      <div class="sfield"><label for="odByPh">Their phone</label><input id="odByPh" type="tel" inputmode="tel" placeholder="024 123 4567"></div></details>`;
  $$('[data-t]', top).forEach(b => b.onclick = () => { $('#odTable', top).value = b.dataset.t; });
  $('#odBar', top) && ($('#odBar', top).onchange = e => { sessionStorage.setItem('waiter-bar', e.target.value); takeOrder(); });
  const v = s => $(s, top)?.value.trim() || '';
  drinkPicker(app, d.products, {
    title: sessionStorage.getItem('waiter-swap') === tabId && tabId ? `Swap · pick the new drink · ${t.label}` : t ? `More drinks · ${t.label}` : 'New tab', topEl: top, button: n => `Send order · ${n}`,
    onBack: () => returnTo(t ? `tab/${t.id}` : 'tabs'),
    onSend: async lines => {
      sessionStorage.removeItem('waiter-swap');
      const phone = v('#odPhone');
      if (phone && !normalizePhone(phone)) throw new Error('That phone number doesn’t look right. Fix it, or leave it empty.');
      const r = await sapi('/api/ops/tabs/order', { method: 'POST', body: { tabId: t?.id, table: v('#odTable'), stationId: v('#odBar') || d.stationId, customerPhone: phone, broughtByName: v('#odBy'), broughtByPhone: v('#odByPh'), lines } });
      // Back to My tables: free to take the next order. The tab is one tap away to add or close.
      sessionStorage.setItem('waiter-flash', `Sent to the bar: Tab ${r.number}${t?.table && t.table !== 'Walk-in' ? ` · table ${t.table}` : v('#odTable') ? ` · table ${v('#odTable')}` : ''}. Collect it when it’s ready, then tap “I got them”.`);
      returnTo('tabs');
    },
  });
}

// ── Quick sale: pick drinks → paid → the bar makes it → "I got them" ──
async function quickSale(stationId) {
  app.innerHTML = '<div class="loading">Loading the menu…</div>';
  let d;
  try {
    const stations = (await sapi('/api/ops/products')).stations;
    stationId ||= sessionStorage.getItem('waiter-bar') || stations[0]?.id || '';
    if (!stations.some(x => x.id === stationId)) stationId = stations[0]?.id || '';
    d = await sapi(`/api/ops/products?stationId=${encodeURIComponent(stationId)}`);
  } catch (e) { return fail(e); }
  const pickBar = d.stations.length > 1 ? `<div class="sfield"><label for="qsBar">Which bar makes the drinks?</label><select id="qsBar">${d.stations.map(x => `<option value="${esc(x.id)}" ${x.id === stationId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : '';
  drinkPicker(app, d.products, {
    title: 'Quick sale', top: pickBar, button: n => `Customer pays · ${n}`, onBack: () => returnTo('tabs'),
    onSend: async (lines, total) => {
      paySheet(total, async pay => {
        const r = await sapi('/api/ops/quick-sale', { method: 'POST', body: { lines, stationId, ...pay } });
        sessionStorage.setItem('waiter-flash', `${pay.method === 'momo' ? 'MoMo' : 'Cash'} ${money(total)} recorded.${tipSaid(r)} Collect the drinks at the bar, then tap “I got them”.`);
        returnTo('tabs');
      }, { title: 'Quick sale', sapi, tipFor: user.uid });
    },
  });
  $('#qsBar') && ($('#qsBar').onchange = e => { sessionStorage.setItem('waiter-bar', e.target.value); quickSale(e.target.value); });
}

// ── Bookings tonight ──
async function bookings() {
  app.innerHTML = '<h1>Bookings tonight</h1><p class="lead">Tables booked online, and the bottles they already paid for. Tick when served.</p><div id="msg"></div><div class="cards" id="list"><div class="loading">Loading…</div></div><h2>Coming up</h2><div id="soon"></div>';
  stop = every(15000, async alive => {
    const { tables, upcoming } = await sapi('/api/ops/tables');
    if (!alive()) return;
    $('#list').innerHTML = tables.map(t => `<div class="tcard ${t.bottlesServed ? 'done' : t.arrived ? 'warn' : ''}" style="cursor:default">
      <span class="row"><span class="t">${esc(t.tableNumber ? `Table ${t.tableNumber}` : t.packageName)}</span><span class="sub">${t.arrived ? `Arrived ${when(t.arrivedAt)}` : 'Not here yet'}</span></span>
      <span class="sub">${esc(t.name)} · ${esc(t.packageName)}${t.capacity ? ` · up to ${t.capacity}` : ''}</span>
      ${t.bottles.length ? `<span>${t.bottles.map(b => `<b>${b.quantity} ×</b> ${esc(b.name)}`).join('<br>')}</span>` : '<span class="sub">No bottles booked.</span>'}
      ${t.bottles.length ? `<button class="mid ${t.bottlesServed ? '' : 'okc'}" data-served="${esc(t.orderId)}" data-v="${t.bottlesServed ? '0' : '1'}">${t.bottlesServed ? 'Served ✓ (undo)' : 'Bottles served'}</button>` : ''}</div>`).join('') || '<div class="empty-box"><b>No bookings tonight</b></div>';
    $('#soon').innerHTML = upcomingBookings(upcoming);
    $$('[data-served]').forEach(b => b.onclick = async () => { try { await sapi('/api/ops/tables', { method: 'POST', body: { orderId: b.dataset.served, bottlesServed: b.dataset.v === '1' } }); route(); } catch (e) { say($('#msg'), e.message, 'bad'); } });
  });
}

// ── My report ──
async function report() {
  app.innerHTML = '<div class="loading">Loading…</div>';
  let d; try { d = await sapi('/api/ops/my-report'); } catch (e) { return fail(e); }
  const f = d.figures, sub = d.submitted;
  app.innerHTML = `<h1>My report</h1><p class="lead">Tonight so far.</p>
    <div class="nums">
      <div><span>I sold</span><b>${money(f.salesPesewas)}</b></div>
      <div class="good"><span>Cash with me</span><b>${money(f.cashCollectedPesewas)}</b></div>
      <div class="good"><span>MoMo I took</span><b>${money(f.momoRecordedPesewas)}</b></div>
      <div class="${f.unpaidPesewas ? 'bad' : 'good'}"><span>Not paid yet</span><b>${money(f.unpaidPesewas)}</b></div>
      <div><span>My tips tonight</span><b>${money(f.tipsPesewas || 0)}</b><small class="muted">Yours: not in the cash to hand in</small></div></div>
    <details class="fold"><summary>More details</summary><div class="nums">
      <div><span>Orders taken</span><b>${f.ordersTaken}</b></div><div><span>Your sales</span><b>${money(f.salesPesewas)}</b></div>
      <div><span>Drinks from the bar</span><b>${f.receivedQty}</b><small class="muted">${money(f.receivedPesewas)}</small></div>
      <div><span>Delivered to customers</span><b>${f.deliveredQty}</b><small class="muted">${money(f.deliveredPesewas)}</small></div>
      <div><span>Sent back to the bar</span><b>${f.returnedQty}${f.returnPendingQty ? ` <small>(+${f.returnPendingQty} waiting)</small>` : ''}</b></div>
      <div class="${f.brokenQty ? 'warn' : ''}"><span>Broken</span><b>${f.brokenQty}</b></div>
      <div><span>Free (approved)</span><b>${f.freeQty}</b></div>
      <div class="${f.withYouQty ? 'bad' : 'good'}"><span>With you, not delivered</span><b>${f.withYouQty}</b><small class="muted">${money(f.withYouPesewas)}</small></div>
      <div class="good"><span>Bills paid</span><b>${f.billsPaid}</b><small class="muted">${money(f.paidPesewas)}</small></div>
      <div class="${f.billsUnpaid ? 'bad' : 'good'}"><span>Bills unpaid</span><b>${f.billsUnpaid}</b><small class="muted">${money(f.unpaidPesewas)}</small></div>
      <div><span>Waiting at the bar</span><b>${f.waitingAtBar}</b></div></div></details>
    ${f.withYou.length ? `<div class="say bad"><b>Drinks you haven’t confirmed</b>${f.withYou.map(x => `${x.qty} × ${esc(x.name)}`).join(', ')}. Tap “I got them”, or send them back to the bar.</div>` : ''}
    ${f.unpaidTabs.length ? `<div class="say warn"><b>Unpaid bills</b>${f.unpaidTabs.map(x => `Tab ${x.number} (${esc(x.table)}): ${money(x.balancePesewas)}`).join(' · ')}</div>` : ''}
    ${canCash ? '<h2>Hand in my cash</h2><div id="cashIn"><div class="loading">Loading…</div></div>' : ''}
    <h2>End of shift</h2>
    ${sub ? `<div class="say good"><b>Report submitted at ${when(sub.at)}</b>${sub.explanation ? esc(sub.explanation) : 'Thank you.'}</div>` : `
      <div class="sfield"><label for="rpWhy">Anything to explain? (needed if drinks or bills are still open)</label><textarea id="rpWhy" rows="3" maxlength="600"></textarea></div>
      <div id="rpMsg"></div><button class="big" id="rpGo">Submit my report</button>`}`;
  $('#cashIn') && handInCash($('#cashIn'), sapi);
  $('#rpGo') && ($('#rpGo').onclick = async () => {
    try { await busy($('#rpGo'), () => sapi('/api/ops/my-report', { method: 'POST', body: { explanation: $('#rpWhy').value } }), 'Submitting…'); report(); }
    catch (e) { say($('#rpMsg'), e.message, 'bad'); $('#rpWhy').focus(); }
  });
}

route();

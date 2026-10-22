// receipt.html?code=…: a bar order's receipt. The code is a long random key, texted to the guest.
import { api, esc, money, params, $ } from '../app.js';
const root = $('#root');
// The bar this phone ordered from: back to its menu to order more.
const station = () => { try { const t = JSON.parse(localStorage.getItem('mem-bar-station')); const sp = JSON.parse(localStorage.getItem('mem-bar-spot')); return /^[0-9a-f]{32}$/.test(t || '') ? `counter.html?s=${t}${sp ? `&t=${encodeURIComponent(sp)}` : ''}&view=menu` : ''; } catch { return ''; } };
try {
  const { receipt: r } = await api(`/api/guest/receipt/${encodeURIComponent(params.get('code') || '')}`);
  root.innerHTML = `<img src="/assets/logo-sm.webp" alt="Memories" width="110" height="26">
    <h1 class="display" style="font-size:clamp(44px,12vw,64px);margin:18px 0 4px">Receipt</h1>
    <p class="muted" style="margin:0">${esc(r.stationName)} · ${esc(new Date(r.paidAt).toLocaleString('en-GB', { timeZone: 'Africa/Accra', dateStyle: 'medium', timeStyle: 'short' }))}</p>
    <div class="summary" style="margin-top:18px">${r.lines.map(l => `<div class="r"><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.qty * l.unitPesewas)}</span></div>`).join('')}
      <div class="r t"><span>Paid</span><span>${money(r.totalPesewas)}</span></div></div>
    <p class="foot-small">Pickup code ${esc(r.pickupCode || '')} · Payment reference ${esc(r.reference)}${r.status === 'refund_due' ? ' · <strong>Refund owed</strong>' : r.status === 'refunded' ? ' · Refunded' : ''}</p>
    <div class="row-actions"><button class="btn" type="button" id="print">Save / print</button>${station() ? `<a class="btn red" href="${esc(station())}">Order more</a>` : ''}</div><p class="foot-small" style="text-align:center;margin:10px 0 0">How was your night? <a href="review.html?s=qr${station() ? `&back=${encodeURIComponent(station())}` : ''}">Rate us</a> (optional)</p>`;
  $('#print').onclick = () => print();
} catch (e) { root.innerHTML = `<div class="notice" role="alert">${esc(e.status === 404 ? 'We can’t find that receipt. Check the link from your text.' : e.message)}</div>`; }

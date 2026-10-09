// find.html: "Lost your ticket?" The Worker texts the links to the phone given, if it has any; the
// page always says the same thing, so it can't be used to check whether a number bought tickets.
import { chrome, api, normalizePhone, remember, $ } from '../app.js';
chrome();
const phone = $('#phone'), msg = $('#msg'), go = $('#go');
phone.value = remember.get().phone || '';
$('#find').onsubmit = async ev => {
  ev.preventDefault(); msg.hidden = true; msg.classList.remove('ok');
  if (!normalizePhone(phone.value)) { msg.hidden = false; msg.textContent = 'Use a Ghana number, e.g. 024 123 4567.'; return phone.focus(); }
  go.disabled = true; go.textContent = 'Sending…';
  try { const d = await api('/api/tickets/find', { method: 'POST', body: { phone: phone.value } }); msg.textContent = `${d.message} It can take a minute to arrive.`; msg.classList.add('ok'); }
  catch (e) { msg.textContent = e.message; }
  msg.hidden = false; go.disabled = false; go.innerHTML = 'Text me my tickets <span class="arrow">→</span>';
};

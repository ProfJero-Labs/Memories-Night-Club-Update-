// GhQR: Ghana's national scan-to-pay QR (an EMVCo "merchant-presented" code). Any MoMo or bank app
// can scan it. The club's own code (from MTN MoMo) has no amount in it (a "static" code), so the
// customer would have to type one. Here the amount is added for each bill, so scanning shows it
// already filled in: the customer only confirms and enters their PIN.
//
// A code is a list of tag-length-value items: 2-digit tag, 2-digit length, then the value. The last
// one (tag 63) is a CRC16 checksum over everything before it, which has to be worked out again
// whenever anything changes.
// Shared by the pages (which draw it) and the Worker (which checks the settings).

// CRC-16/CCITT-FALSE (polynomial 0x1021, start 0xFFFF), as 4 hex digits.
export function crc16(text) {
  let c = 0xFFFF;
  for (let i = 0; i < text.length; i++) {
    c ^= text.charCodeAt(i) << 8;
    for (let k = 0; k < 8; k++) c = (c & 0x8000) ? (((c << 1) ^ 0x1021) & 0xFFFF) : ((c << 1) & 0xFFFF);
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}

// "000201..." → [['00', '01'], ['01', '11'], ...], or null if it isn't well formed.
export function parseTlv(text) {
  const out = [];
  let i = 0;
  const s = String(text || '');
  while (i < s.length) {
    const tag = s.slice(i, i + 2), len = s.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(len)) return null;
    const end = i + 4 + Number(len);
    if (end > s.length) return null;
    out.push([tag, s.slice(i + 4, end)]);
    i = end;
  }
  return out;
}
const item = (tag, value) => tag + String(value.length).padStart(2, '0') + value;
const seal = body => { const head = body + '6304'; return head + crc16(head); };

// Is this a whole, unaltered GhQR code (checksum right, Ghana's scheme inside)?
export function ghqrValid(payload) {
  const s = String(payload || '').trim();
  if (!/^000201/.test(s) || s.length < 40 || s.length > 600) return false;
  if (s.slice(-8, -4) !== '6304' || crc16(s.slice(0, -4)) !== s.slice(-4)) return false;
  const items = parseTlv(s);
  return !!items && items.some(([t, v]) => Number(t) >= 26 && Number(t) <= 51 && v.includes('GHIPSS.GHQR'));
}

// The club's code with an amount in it: { amountPesewas } → a code that asks for exactly that.
// Only two things change: the amount is added, and the code is marked as one-time ("12"), then the
// checksum is worked out again. Everything that says who gets the money stays as MTN made it.
export function ghqrFor(staticPayload, amountPesewas) {
  const pesewas = Math.round(Number(amountPesewas));
  if (!ghqrValid(staticPayload) || !(pesewas > 0) || pesewas > 99999999) return '';
  const items = parseTlv(String(staticPayload).trim()).filter(([t]) => t !== '63' && t !== '54');
  const out = [];
  for (const [tag, value] of items) {
    out.push(item(tag, tag === '01' ? '12' : value));
    if (tag === '53') out.push(item('54', (pesewas / 100).toFixed(2))); // right after the currency
  }
  if (!items.some(([t]) => t === '53')) return ''; // no currency in it: not a code we can add an amount to
  return seal(out.join(''));
}

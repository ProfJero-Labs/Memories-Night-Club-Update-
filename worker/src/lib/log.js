// Every Worker log line goes through here. Errors from Firestore/Paystack can quote document
// paths (a ticket's path is its token), phone numbers or keys, so they're redacted before logging.
import { maskPhone } from './util.js';

export function redact(value) {
  const s = value instanceof Error ? `${value.name}: ${value.message}` : typeof value === 'string' ? value : JSON.stringify(value);
  return String(s ?? '')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[token]')                        // ticket tokens, ids
    .replace(/(tickets|pending_checkouts|installment_plans)\/[^\s"'/]+/g, '$1/[id]')
    .replace(/\bMEM-[0-9A-Z]{5}-?[0-9A-Z]{5}\b|\bMEM-[A-Z]{2}\d{4}\b/g, 'MEM-[code]')
    .replace(/(?:\+?233|0)\d{9}\b/g, m => maskPhone(m) || '[phone]')
    .replace(/\b(sk|pk)_(test|live)_[A-Za-z0-9]+/g, '$1_$2_[redacted]')
    .replace(/xkeysib-[A-Za-z0-9-]+/g, 'xkeysib-[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
}
export const logError = (label, ...details) => console.error(label, ...details.map(redact));

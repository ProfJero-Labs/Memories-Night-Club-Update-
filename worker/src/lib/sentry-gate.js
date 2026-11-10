// Keeps Sentry inside its monthly allowance without losing anything: the first report of a problem
// goes at once; the same problem again within `everyMs` is held back and counted, and the next
// report that goes says how many were held back ("+12 more since"). Different problems are never
// held back by each other. Per Worker instance (each counts on its own), so a busy night with a
// broken route costs a handful of reports instead of thousands.
const seen = new Map(); // key → { at, held }
const MAX_KEYS = 500;

// Returns null to hold the report back, or { held } (how many were held back since the last one).
export function sentryGate(key, everyMs = 10 * 60_000, now = Date.now()) {
  const k = String(key).slice(0, 200), s = seen.get(k);
  if (s && now - s.at < everyMs) { s.held += 1; return null; }
  if (seen.size >= MAX_KEYS) seen.clear();
  seen.set(k, { at: now, held: 0 });
  return { held: s ? s.held : 0 };
}
export const heldNote = g => (g?.held ? ` (+${g.held} more since the last report)` : '');
export const resetSentryGate = () => seen.clear(); // tests

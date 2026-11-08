// How a record is written down in Firebase's REST format (typed values) and read back into plain
// JavaScript. The rest of the app writes records as typed values (updateWrite / foundFields), so the
// Supabase side uses the same helpers to turn them into plain JSON and back.

export function firestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(firestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, firestoreValue(x)])) } };
  return { stringValue: String(v) };
}
export function docFields(obj) { return Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, firestoreValue(v)])); }
function parseValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(parseValue);
  if ('mapValue' in v) return parseFields(v.mapValue.fields || {});
  return null;
}
export function parseFields(fields = {}) { return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, parseValue(v)])); }

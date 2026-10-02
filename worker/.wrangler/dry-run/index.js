var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/lib/http.js
function cors(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allow = origin && allowed.includes(origin) ? origin : allowed[0] || "";
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Vary": "Origin" };
}
__name(cors, "cors");
var json = /* @__PURE__ */ __name((req, env, data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req, env), ...extra } }), "json");
var ok = /* @__PURE__ */ __name((req, env, data = {}) => json(req, env, { success: true, ...data }), "ok");
var fail = /* @__PURE__ */ __name((req, env, message2, status = 400) => json(req, env, { success: false, error: message2 }, status), "fail");
var reply = /* @__PURE__ */ __name((req, env, r) => r && r.error ? fail(req, env, r.error, r.status || 400) : ok(req, env, r), "reply");
var buckets = /* @__PURE__ */ new Map();
var LIMITS = { strict: { binding: "RL_STRICT", limit: 10 }, standard: { binding: "RL_STANDARD", limit: 60 } };
function rateLimitedKey(k, limit, windowMs) {
  const t = Date.now();
  const fresh = (buckets.get(k) || []).filter((x) => t - x < windowMs);
  if (fresh.length >= limit) {
    buckets.set(k, fresh);
    return true;
  }
  fresh.push(t);
  buckets.set(k, fresh);
  if (buckets.size > 5e3) buckets.clear();
  return false;
}
__name(rateLimitedKey, "rateLimitedKey");
function rateLimited(req, key, limit, windowMs) {
  const ip = req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "unknown";
  const k = `${key}:${ip}`, t = Date.now();
  const fresh = (buckets.get(k) || []).filter((x) => t - x < windowMs);
  if (fresh.length >= limit) {
    buckets.set(k, fresh);
    return true;
  }
  fresh.push(t);
  buckets.set(k, fresh);
  if (buckets.size > 5e3) buckets.clear();
  return false;
}
__name(rateLimited, "rateLimited");
async function throttled(req, env, key, tier = "standard", subject) {
  const { binding, limit } = LIMITS[tier];
  const who = subject ?? (req.headers.get("CF-Connecting-IP") || "unknown");
  if (env[binding]?.limit) {
    try {
      const { success } = await env[binding].limit({ key: `${key}:${who}` });
      return !success;
    } catch {
    }
  }
  return subject === void 0 ? rateLimited(req, key, limit, 6e4) : rateLimitedKey(`${key}:${who}`, limit, 6e4);
}
__name(throttled, "throttled");

// ../public/lib/shared.js
var esc = /* @__PURE__ */ __name((s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
function normalizePhone(raw) {
  const p = String(raw ?? "").replace(/[\s\-().]/g, "").replace(/^\+?233/, "0");
  return /^0\d{9}$/.test(p) ? p : null;
}
__name(normalizePhone, "normalizePhone");
var maskPhone = /* @__PURE__ */ __name((p) => {
  const n = normalizePhone(p);
  return n ? `${n.slice(0, 3)}***${n.slice(-4)}` : "";
}, "maskPhone");
var TZ = "Africa/Accra";
var parts = /* @__PURE__ */ __name((d) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(d)).map((p) => [p.type, p.value])), "parts");
function accraDayKey(d = /* @__PURE__ */ new Date()) {
  const t = new Date(d);
  if (isNaN(t)) return "";
  const p = parts(t);
  return `${p.year}-${p.month}-${p.day}`;
}
__name(accraDayKey, "accraDayKey");
var formatAccra = /* @__PURE__ */ __name((d, opts = {}) => {
  const t = new Date(d);
  return isNaN(t) ? "" : t.toLocaleString("en-GB", { timeZone: TZ, ...opts });
}, "formatAccra");
var BITS_POLICY_VERSION = "2026-09-forfeit-at-start";
var TICKET_STYLES = ["classic", "poster", "neon", "split", "stamp", "marquee", "vinyl", "sunburst", "holo", "coast"];
var HEX = /^#[0-9a-f]{6}$/i;
var cleanTicketColors = /* @__PURE__ */ __name((c) => c && HEX.test(c.accent) && HEX.test(c.dark) && HEX.test(c.light) ? { accent: c.accent.toLowerCase(), dark: c.dark.toLowerCase(), light: c.light.toLowerCase() } : null, "cleanTicketColors");
function monthStyles(events) {
  const byMonth = /* @__PURE__ */ new Map();
  for (const e of events) {
    const m = accraDayKey(e.date).slice(0, 7);
    if (m) (byMonth.get(m) || byMonth.set(m, []).get(m)).push(e);
  }
  const out = /* @__PURE__ */ new Map();
  for (const [month, list] of byMonth) {
    list.sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.id).localeCompare(String(b.id)));
    const used = new Set(list.map((e) => e.ticketStyle).filter((st) => TICKET_STYLES.includes(st)));
    const [y, mo] = month.split("-").map(Number);
    let next = (y * 12 + mo) % TICKET_STYLES.length;
    for (const e of list) {
      if (TICKET_STYLES.includes(e.ticketStyle)) {
        out.set(e.id, e.ticketStyle);
        continue;
      }
      let pick = null;
      for (let k = 0; k < TICKET_STYLES.length; k++) {
        const st = TICKET_STYLES[(next + k) % TICKET_STYLES.length];
        if (!used.has(st)) {
          pick = st;
          next = (next + k + 1) % TICKET_STYLES.length;
          break;
        }
      }
      if (!pick) {
        pick = TICKET_STYLES[next];
        next = (next + 1) % TICKET_STYLES.length;
      }
      used.add(pick);
      out.set(e.id, pick);
    }
  }
  return out;
}
__name(monthStyles, "monthStyles");

// src/lib/util.js
var now = /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "now");
var id = /* @__PURE__ */ __name(() => crypto.randomUUID().replaceAll("-", ""), "id");
var hex = /* @__PURE__ */ __name((n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join(""), "hex");
var paymentRef = /* @__PURE__ */ __name(() => `MEM-${Date.now()}-${hex(8).toUpperCase()}`, "paymentRef");
var ticketToken = /* @__PURE__ */ __name(() => id() + id(), "ticketToken");
var displayCode = /* @__PURE__ */ __name((token) => `MEM-${token.slice(0, 6).toUpperCase()}`, "displayCode");
var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function orderCode() {
  const c = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => CROCKFORD[b & 31]).join("");
  return `MEM-${c.slice(0, 5)}-${c.slice(5)}`;
}
__name(orderCode, "orderCode");
function normalizeOrderCode(raw) {
  const s = String(raw ?? "").toUpperCase().replace(/\s+/g, "");
  if (/^MEM-[A-Z]{2}\d{4}$/.test(s)) return s;
  const body2 = s.replace(/^MEM-?/, "").replace(/-/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(body2)) return null;
  return `MEM-${body2.slice(0, 5)}-${body2.slice(5)}`;
}
__name(normalizeOrderCode, "normalizeOrderCode");
var clean = /* @__PURE__ */ __name((s, max = 200) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max), "clean");
var money = /* @__PURE__ */ __name((pesewas) => `GHS ${(Number(pesewas || 0) / 100).toLocaleString("en-GH", { maximumFractionDigits: 2 })}`, "money");
var validEmail = /* @__PURE__ */ __name((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "")), "validEmail");
var firstName = /* @__PURE__ */ __name((full) => String(full || "").trim().split(/\s+/)[0] || "", "firstName");
var dateKey = accraDayKey;
function generatePassword(len = 14) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
__name(generatePassword, "generatePassword");

// src/lib/log.js
function redact(value) {
  const s = value instanceof Error ? `${value.name}: ${value.message}` : typeof value === "string" ? value : JSON.stringify(value);
  return String(s ?? "").replace(/\b[0-9a-f]{32,}\b/gi, "[token]").replace(/(tickets|pending_checkouts|installment_plans)\/[^\s"'/]+/g, "$1/[id]").replace(/\bMEM-[0-9A-Z]{5}-?[0-9A-Z]{5}\b|\bMEM-[A-Z]{2}\d{4}\b/g, "MEM-[code]").replace(/(?:\+?233|0)\d{9}\b/g, (m) => maskPhone(m) || "[phone]").replace(/\b(sk|pk)_(test|live)_[A-Za-z0-9]+/g, "$1_$2_[redacted]").replace(/xkeysib-[A-Za-z0-9-]+/g, "xkeysib-[redacted]").replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}
__name(redact, "redact");
var logError = /* @__PURE__ */ __name((label, ...details) => console.error(label, ...details.map(redact)), "logError");

// node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var strictDecoder = new TextDecoder("utf-8", { fatal: true });
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0), buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers)
    buf.set(buffer, i), i += buffer.length;
  return buf;
}
__name(concat, "concat");
var NON_ASCII = /[^\x00-\x7f]/;
function encode(string) {
  if (typeof string == "string" && string.length >= 128) {
    if (NON_ASCII.test(string))
      throw new TypeError("non-ASCII string encountered in encode()");
    return encoder.encode(string);
  }
  const bytes = new Uint8Array(string.length);
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code > 127)
      throw new TypeError("non-ASCII string encountered in encode()");
    bytes[i] = code;
  }
  return bytes;
}
__name(encode, "encode");
function decodeBase64(encoded, url = false) {
  if (Uint8Array.fromBase64)
    return Uint8Array.fromBase64(encoded, { alphabet: url ? "base64url" : "base64" });
  if (url) {
    if (encoded.includes("+") || encoded.includes("/"))
      throw new TypeError("Invalid base64url");
    encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  }
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(decodeBase64, "decodeBase64");

// node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  static {
    __name(this, "JOSEError");
  }
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options), this.name = this.constructor.name, Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static {
    __name(this, "JWTClaimValidationFailed");
  }
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static {
    __name(this, "JWTExpired");
  }
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static {
    __name(this, "JOSEAlgNotAllowed");
  }
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static {
    __name(this, "JOSENotSupported");
  }
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static {
    __name(this, "JWSInvalid");
  }
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static {
    __name(this, "JWTInvalid");
  }
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWKSInvalid = class extends JOSEError {
  static {
    __name(this, "JWKSInvalid");
  }
  static code = "ERR_JWKS_INVALID";
  code = "ERR_JWKS_INVALID";
};
var JWKSNoMatchingKey = class extends JOSEError {
  static {
    __name(this, "JWKSNoMatchingKey");
  }
  static code = "ERR_JWKS_NO_MATCHING_KEY";
  code = "ERR_JWKS_NO_MATCHING_KEY";
  constructor(message2 = "no applicable key found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSMultipleMatchingKeys = class extends JOSEError {
  static {
    __name(this, "JWKSMultipleMatchingKeys");
  }
  [Symbol.asyncIterator] = async function* () {
  };
  static code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSTimeout = class extends JOSEError {
  static {
    __name(this, "JWKSTimeout");
  }
  static code = "ERR_JWKS_TIMEOUT";
  code = "ERR_JWKS_TIMEOUT";
  constructor(message2 = "request timed out", options) {
    super(message2, options);
  }
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static {
    __name(this, "JWSSignatureVerificationFailed");
  }
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// node_modules/jose/dist/webapi/util/base64url.js
var invalid = "The input to be decoded is not correctly encoded.";
function decode(input) {
  try {
    return decodeBase64(typeof input == "string" ? input : decoder.decode(input), true);
  } catch (cause) {
    throw new TypeError(invalid, { cause });
  }
}
__name(decode, "decode");

// node_modules/jose/dist/webapi/lib/validate.js
function isObject(input) {
  if (typeof input != "object" || input === null || Object.prototype.toString.call(input) !== "[object Object]")
    return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}
__name(isObject, "isObject");
function isJwkSet(input) {
  return isObject(input) && Array.isArray(input.keys) && Array.from(input.keys).every(isObject);
}
__name(isJwkSet, "isJwkSet");
function isDisjoint(...headers) {
  const parameters = /* @__PURE__ */ new Set();
  for (const header of headers)
    if (header)
      for (const parameter of Object.keys(header)) {
        if (parameters.has(parameter))
          return false;
        parameters.add(parameter);
      }
  return true;
}
__name(isDisjoint, "isDisjoint");
function decodeBase64url(value, label, ErrorClass) {
  try {
    return decode(value);
  } catch {
    throw new ErrorClass(`Failed to base64url decode the ${label}`);
  }
}
__name(decodeBase64url, "decodeBase64url");
function encodeBase64url(value, label, ErrorClass) {
  try {
    return encode(value);
  } catch {
    throw new ErrorClass(`The ${label} is not a valid base64url string`);
  }
}
__name(encodeBase64url, "encodeBase64url");
function parseJoseHeader(b642, ErrorClass, message2) {
  let parsed;
  try {
    parsed = JSON.parse(strictDecoder.decode(decode(b642)));
  } catch {
    throw new ErrorClass(message2);
  }
  if (!isObject(parsed))
    throw new ErrorClass(message2);
  return parsed;
}
__name(parseJoseHeader, "parseJoseHeader");
var JWS_RECOGNIZED = { __proto__: null, b64: true };
function validateAlgorithms(option, algorithms) {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s != "string")))
    throw new TypeError(`"${option}" option must be an array of strings`);
  return algorithms === void 0 ? void 0 : new Set(algorithms);
}
__name(validateAlgorithms, "validateAlgorithms");
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0)
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  if (!protectedHeader || protectedHeader.crit === void 0)
    return [];
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input != "string" || input.length === 0))
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  const recognized = recognizedOption === void 0 ? recognizedDefault : { __proto__: null, ...recognizedOption, ...recognizedDefault };
  for (const parameter of protectedHeader.crit) {
    if (!(parameter in recognized))
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    if (!Object.hasOwn(joseHeader, parameter) || joseHeader[parameter] === void 0)
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    if (recognized[parameter] && (!Object.hasOwn(protectedHeader, parameter) || protectedHeader[parameter] === void 0))
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
  }
  return protectedHeader.crit;
}
__name(validateCrit, "validateCrit");
function validateB64(protectedHeader, extensions) {
  if (extensions.includes("b64")) {
    const b642 = protectedHeader.b64;
    if (typeof b642 != "boolean")
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    return b642;
  }
  return true;
}
__name(validateB64, "validateB64");

// node_modules/jose/dist/webapi/lib/key.js
var tag = /* @__PURE__ */ __name((key) => key[Symbol.toStringTag], "tag");
var jwkMatchesOp = /* @__PURE__ */ __name((entry, key, usage) => {
  const { alg } = entry;
  if (key.use !== void 0) {
    const expected = usage === "sign" || usage === "verify" ? "sig" : "enc";
    if (key.use !== expected)
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
  }
  if (key.alg !== void 0 && key.alg !== alg)
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  if (Array.isArray(key.key_ops)) {
    const expectedKeyOp = usage === "encrypt" || usage === "decrypt" ? entry.ops?.[usage === "encrypt" ? 0 : 1] : usage;
    if (expectedKeyOp && !key.key_ops.includes(expectedKeyOp))
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
  }
}, "jwkMatchesOp");
async function prepareKey(entry, key, usage) {
  const { alg, secret } = entry, privateKey = usage === "decrypt" || usage === "sign";
  if (secret && key instanceof Uint8Array)
    return key;
  let normalized, keyObject;
  if (isObject(key)) {
    if (normalized = normalizeJwk(key), typeof normalized.kty != "string")
      throw invalidKeyType(alg, key, secret);
    if (!(secret ? normalized.kty === "oct" && typeof normalized.k == "string" : normalized.kty !== "oct" && (privateKey ? normalized.kty === "AKP" && typeof normalized.priv == "string" || typeof normalized.d == "string" : normalized.d === void 0 && normalized.priv === void 0)))
      throw new TypeError(secret ? 'JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present' : `JSON Web Key for this operation must be a ${privateKey ? "private" : "public"} JWK`);
    if (jwkMatchesOp(entry, normalized, usage), normalized.kty === "oct")
      return decode(normalized.k);
    if (!Object.isFrozen(key)) {
      const { key_ops } = key;
      Array.isArray(key_ops) && Object.freeze(key_ops), Object.freeze(key);
    }
  } else {
    if (!isKeyLike(key))
      throw invalidKeyType(alg, key, secret);
    const expectedType = secret ? "secret" : privateKey ? "private" : "public";
    if (key.type !== expectedType && (secret || ["secret", "public", "private"].includes(key.type)))
      throw new TypeError(`${tag(key)} instances must be of type "${expectedType}" for the ${alg} algorithm`);
    if (isCryptoKey(key))
      return key;
    if (keyObject = key, keyObject.type === "secret")
      return keyObject.export();
  }
  cache ||= /* @__PURE__ */ new WeakMap();
  const cacheKey = key;
  let cached = cache.get(cacheKey);
  if (cached?.[alg])
    return cached[alg];
  if (cached || cache.set(cacheKey, cached = {}), keyObject && typeof keyObject.toCryptoKey == "function") {
    const isPublic = keyObject.type === "public", crv = nist[keyObject.asymmetricKeyDetails?.namedCurve], params = entry.resolve?.({ crv, asymmetricKeyType: keyObject.asymmetricKeyType }) ?? entry.subtle;
    return cached[alg] = keyObject.toCryptoKey(params, isPublic, entry.usages[isPublic ? 0 : 1]);
  }
  return normalized ??= keyObject.export({ format: "jwk" }), normalized.alg = alg, cached[alg] = await jwkToKey(entry, normalized);
}
__name(prepareKey, "prepareKey");
var cache;
var nist = {
  __proto__: null,
  prime256v1: "P-256",
  secp384r1: "P-384",
  secp521r1: "P-521"
};
var isCryptoKey = /* @__PURE__ */ __name((key) => {
  if (key?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key instanceof CryptoKey;
  } catch {
    return false;
  }
}, "isCryptoKey");
var isKeyObject = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag] === "KeyObject", "isKeyObject");
var isKeyLike = /* @__PURE__ */ __name((key) => isCryptoKey(key) || isKeyObject(key), "isKeyLike");
function message(msg, actual, ...types) {
  if (types.length > 2) {
    const last2 = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last2}.`;
  } else types.length === 2 ? msg += `one of type ${types[0]} or ${types[1]}.` : msg += `of type ${types[0]}.`;
  return actual == null ? msg += ` Received ${actual}` : typeof actual == "function" && actual.name ? msg += ` Received function ${actual.name}` : typeof actual == "object" && actual != null && actual.constructor?.name && (msg += ` Received an instance of ${actual.constructor.name}`), msg;
}
__name(message, "message");
function invalidKeyType(alg, actual, secret) {
  const types = ["CryptoKey", "KeyObject", "JSON Web Key"];
  return secret && types.push("Uint8Array"), new TypeError(message(`Key for the ${alg} algorithm must be `, actual, ...types));
}
__name(invalidKeyType, "invalidKeyType");
var unusable = /* @__PURE__ */ __name((name, prop = "algorithm.name") => new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`), "unusable");
function checkUsage(key, usage) {
  if (usage && !key.usages.includes(usage))
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
}
__name(checkUsage, "checkUsage");
function checkModulusLength(alg, key) {
  const { modulusLength } = key.algorithm;
  if (typeof modulusLength != "number" || modulusLength < 2048)
    throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
}
__name(checkModulusLength, "checkModulusLength");
function checkCryptoKey(key, expected, usage) {
  const algorithm = key.algorithm;
  if (algorithm.name !== expected.name)
    throw unusable(expected.name);
  if (expected.hash && algorithm.hash?.name !== expected.hash)
    throw unusable(expected.hash, "algorithm.hash");
  if (expected.namedCurve && algorithm.namedCurve !== expected.namedCurve)
    throw unusable(expected.namedCurve, "algorithm.namedCurve");
  if (expected.length !== void 0 && algorithm.length !== expected.length)
    throw unusable(expected.length, "algorithm.length");
  checkUsage(key, usage);
}
__name(checkCryptoKey, "checkCryptoKey");
function snapshotJwk(jwk) {
  return { __proto__: null, ...jwk };
}
__name(snapshotJwk, "snapshotJwk");
function normalizeJwk(jwk) {
  const normalized = snapshotJwk(jwk);
  if (normalized.ext !== void 0 && typeof normalized.ext != "boolean")
    throw new TypeError('"ext" (Extractable) Parameter must be a boolean');
  if (normalized.key_ops !== void 0) {
    const value = normalized.key_ops, keyOps = Array.isArray(value) ? [...value] : void 0;
    if (!keyOps || keyOps.some((operation) => typeof operation != "string") || new Set(keyOps).size !== keyOps.length)
      throw new TypeError('"key_ops" (Key Operations) Parameter must be an array of unique strings');
    normalized.key_ops = keyOps;
  }
  return normalized;
}
__name(normalizeJwk, "normalizeJwk");
async function jwkToKey(entry, jwk, extractable) {
  if (!entry.kty.includes(jwk.kty))
    throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
  const algorithm = entry.resolve?.({ kty: jwk.kty, crv: jwk.crv }) ?? entry.subtle, isPrivate = !!(jwk.d || jwk.priv), keyData = { ...jwk, ext: extractable ?? jwk.ext };
  return keyData.kty !== "AKP" && delete keyData.alg, delete keyData.use, crypto.subtle.importKey("jwk", keyData, algorithm, keyData.ext ?? !isPrivate, jwk.key_ops ?? entry.usages[isPrivate ? 1 : 0]);
}
__name(jwkToKey, "jwkToKey");
async function rawKey(key, expected, usage, extractable = false) {
  return key instanceof Uint8Array && (key = await crypto.subtle.importKey("raw", key, expected, extractable, [usage])), checkCryptoKey(key, expected, usage), key;
}
__name(rawKey, "rawKey");

// node_modules/jose/dist/webapi/lib/key_descriptor.js
function table(entries) {
  const out = { __proto__: null };
  for (const alg in entries)
    out[alg] = { ...entries[alg], alg };
  return out;
}
__name(table, "table");

// node_modules/jose/dist/webapi/lib/jws_algorithms.js
var sig = [["verify"], ["sign"]];
function hmac(bits) {
  const subtle = { name: "HMAC", hash: `SHA-${bits}` };
  return { kty: ["oct"], secret: true, subtle, signing: subtle, usages: sig };
}
__name(hmac, "hmac");
function rsa(bits, saltLength) {
  const subtle = { name: saltLength ? "RSA-PSS" : "RSASSA-PKCS1-v1_5", hash: `SHA-${bits}` };
  return {
    kty: ["RSA"],
    subtle,
    signing: saltLength ? { ...subtle, saltLength } : subtle,
    usages: sig,
    minRsaBits: 2048
  };
}
__name(rsa, "rsa");
function ecdsa(crv, bits) {
  return {
    kty: ["EC"],
    crv,
    subtle: { name: "ECDSA", namedCurve: crv },
    signing: { name: "ECDSA", hash: `SHA-${bits}` },
    usages: sig
  };
}
__name(ecdsa, "ecdsa");
function eddsa() {
  const subtle = { name: "Ed25519" };
  return {
    kty: ["OKP"],
    crv: "Ed25519",
    subtle,
    signing: subtle,
    usages: sig
  };
}
__name(eddsa, "eddsa");
function mldsa(bits) {
  const subtle = { name: `ML-DSA-${bits}` };
  return {
    kty: ["AKP"],
    subtle,
    signing: subtle,
    usages: sig
  };
}
__name(mldsa, "mldsa");
var JWS = table({
  HS256: hmac(256),
  HS384: hmac(384),
  HS512: hmac(512),
  RS256: rsa(256),
  RS384: rsa(384),
  RS512: rsa(512),
  PS256: rsa(256, 32),
  PS384: rsa(384, 48),
  PS512: rsa(512, 64),
  ES256: ecdsa("P-256", 256),
  ES384: ecdsa("P-384", 384),
  ES512: ecdsa("P-521", 512),
  EdDSA: eddsa(),
  Ed25519: eddsa(),
  "ML-DSA-44": mldsa(44),
  "ML-DSA-65": mldsa(65),
  "ML-DSA-87": mldsa(87)
});
function jwsAlgorithm(alg) {
  const entry = typeof alg == "string" ? JWS[alg] : void 0;
  if (!entry)
    throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  return entry;
}
__name(jwsAlgorithm, "jwsAlgorithm");

// node_modules/jose/dist/webapi/lib/jws_verify.js
function prepareVerify(options) {
  return [options && validateAlgorithms("algorithms", options.algorithms), options?.crit];
}
__name(prepareVerify, "prepareVerify");
function parseProtectedHeader(encodedProtected) {
  return encodedProtected === void 0 ? {} : parseJoseHeader(encodedProtected, JWSInvalid, "JWS Protected Header is invalid");
}
__name(parseProtectedHeader, "parseProtectedHeader");
function encodeCompactUnencodedPayload(payload) {
  try {
    return encode(payload);
  } catch {
    throw new JWSInvalid("JWS Compact Serialization payload must use only ASCII characters");
  }
}
__name(encodeCompactUnencodedPayload, "encodeCompactUnencodedPayload");
async function verifySignature(jws, shared, key, encodeUnencodedPayload, parsedProtected) {
  const { protected: encodedProtected, header, payload: inputPayload } = jws, parsedProt = parsedProtected ?? parseProtectedHeader(encodedProtected);
  if (!isDisjoint(parsedProt, header))
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  const joseHeader = { ...parsedProt, ...header }, b642 = validateB64(parsedProt, validateCrit(JWSInvalid, JWS_RECOGNIZED, shared[1], parsedProt, joseHeader)), { alg } = joseHeader;
  if (typeof alg != "string" || !alg)
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  if (shared[0] && !shared[0].has(alg))
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  if (b642) {
    if (typeof inputPayload != "string")
      throw new JWSInvalid("JWS Payload must be a string");
  } else if (typeof inputPayload != "string" && !(inputPayload instanceof Uint8Array))
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  const signingPayload = b642 || typeof inputPayload != "string" ? inputPayload : encodeUnencodedPayload(inputPayload);
  let resolvedKey = false;
  typeof key == "function" && (key = await key(parsedProt, jws), resolvedKey = true);
  const entry = jwsAlgorithm(alg), data = concat(encodedProtected !== void 0 ? encode(encodedProtected) : new Uint8Array(), encode("."), typeof signingPayload == "string" ? shared[2] ??= encodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload), signature = decodeBase64url(jws.signature, "signature", JWSInvalid), k = await prepareKey(entry, key, "verify"), cryptoKey = await rawKey(k, entry.subtle, "verify");
  entry.minRsaBits && checkModulusLength(entry.alg, cryptoKey);
  let verified = false;
  try {
    verified = await crypto.subtle.verify(entry.signing, cryptoKey, signature, data);
  } catch {
  }
  if (!verified)
    throw new JWSSignatureVerificationFailed();
  const result = { payload: typeof signingPayload == "string" ? decodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload };
  return encodedProtected !== void 0 && (result.protectedHeader = parsedProt), header !== void 0 && (result.unprotectedHeader = header), resolvedKey ? [{ ...result, key: k }, b642] : [result, b642];
}
__name(verifySignature, "verifySignature");
async function verifyCompact(jws, shared, key) {
  if (jws instanceof Uint8Array && (jws = decoder.decode(jws)), typeof jws != "string")
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3)
    throw new JWSInvalid("Invalid Compact JWS");
  return verifySignature({ payload, protected: protectedHeader, signature }, shared, key, encodeCompactUnencodedPayload);
}
__name(verifyCompact, "verifyCompact");

// node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var epoch = /* @__PURE__ */ __name((date) => Math.floor(date.getTime() / 1e3), "epoch");
var multipliers = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  y: 31557600
};
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var checkFailed = "check_failed";
function invalidDuration() {
  throw new TypeError("Invalid time period format");
}
__name(invalidDuration, "invalidDuration");
function secs(str) {
  typeof str != "string" && invalidDuration();
  const matched = REGEX.exec(str);
  (!matched || matched[4] && matched[1]) && invalidDuration();
  const value = parseFloat(matched[2]), numericDate2 = Math.round(value * multipliers[matched[3][0].toLowerCase()]);
  return Number.isFinite(numericDate2) || invalidDuration(), matched[1] === "-" || matched[4] === "ago" ? -numericDate2 : numericDate2;
}
__name(secs, "secs");
function validateInput(label, input) {
  if (!Number.isFinite(input))
    throw new TypeError(`Invalid ${label} input`);
  return input;
}
__name(validateInput, "validateInput");
var normalizeTyp = /* @__PURE__ */ __name((value) => {
  const normalized = value.toLowerCase();
  return value.includes("/") ? normalized : `application/${normalized}`;
}, "normalizeTyp");
var checkAudiencePresence = /* @__PURE__ */ __name((audPayload, audOption) => typeof audPayload == "string" ? audOption.includes(audPayload) : Array.isArray(audPayload) ? audOption.some((aud) => audPayload.includes(aud)) : false, "checkAudiencePresence");
function validateNumericDate(payload, claim, required = false) {
  const value = payload[claim];
  if (!(value === void 0 && !required)) {
    if (typeof value != "number")
      throw new JWTClaimValidationFailed(`"${claim}" claim must be a number`, payload, claim, "invalid");
    return value;
  }
}
__name(validateNumericDate, "validateNumericDate");
function unexpectedClaim(payload, claim) {
  throw new JWTClaimValidationFailed(`unexpected "${claim}" claim value`, payload, claim, checkFailed);
}
__name(unexpectedClaim, "unexpectedClaim");
function validateClaimsSet(protectedHeader, encodedPayload, options = {}) {
  let payload;
  try {
    payload = JSON.parse(strictDecoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload))
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  const { typ } = options;
  if (typ !== void 0 && (typeof protectedHeader.typ != "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ)))
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", checkFailed);
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options, presenceCheck = [...requiredClaims];
  maxTokenAge !== void 0 && presenceCheck.push("iat"), audience !== void 0 && presenceCheck.push("aud"), subject !== void 0 && presenceCheck.push("sub"), issuer !== void 0 && presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse()))
    if (!Object.hasOwn(payload, claim))
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
  issuer !== void 0 && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss) && unexpectedClaim(payload, "iss"), subject !== void 0 && payload.sub !== subject && unexpectedClaim(payload, "sub"), audience !== void 0 && !checkAudiencePresence(payload.aud, typeof audience == "string" ? [audience] : audience) && unexpectedClaim(payload, "aud");
  const { clockTolerance } = options;
  let tolerance = 0;
  if (typeof clockTolerance == "string")
    tolerance = secs(clockTolerance);
  else if (clockTolerance !== void 0) {
    if (typeof clockTolerance != "number")
      throw new TypeError("Invalid clockTolerance option type");
    tolerance = clockTolerance;
  }
  validateInput("clockTolerance option", tolerance);
  const { currentDate } = options, now2 = validateInput("currentDate option", epoch(currentDate === void 0 ? /* @__PURE__ */ new Date() : currentDate)), iat = validateNumericDate(payload, "iat", maxTokenAge !== void 0), nbf = validateNumericDate(payload, "nbf");
  if (nbf !== void 0 && nbf > now2 + tolerance)
    throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", checkFailed);
  const exp = validateNumericDate(payload, "exp");
  if (exp !== void 0 && exp <= now2 - tolerance)
    throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", checkFailed);
  if (maxTokenAge !== void 0) {
    const age = now2 - iat, max = validateInput("maxTokenAge option", typeof maxTokenAge == "number" ? maxTokenAge : secs(maxTokenAge));
    if (age - tolerance > max)
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", checkFailed);
    if (age < -tolerance)
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", checkFailed);
  }
  return payload;
}
__name(validateClaimsSet, "validateClaimsSet");

// node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const [verified, b642] = await verifyCompact(jwt, prepareVerify(options), key);
  if (!b642)
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  const payload = validateClaimsSet(verified.protectedHeader, verified.payload, options);
  return { ...verified, payload };
}
__name(jwtVerify, "jwtVerify");

// node_modules/jose/dist/webapi/jwks/local.js
function isUsableJWK(jwk, entry, alg, kid) {
  const { kty, key_ops: keyOps, ext, kid: jwkKid, alg: jwkAlg, use, crv } = jwk;
  return (ext === void 0 || typeof ext == "boolean") && (keyOps === void 0 || Array.isArray(keyOps) && keyOps.every((operation, index) => typeof operation == "string" && keyOps.indexOf(operation) === index) && keyOps.includes("verify")) && entry.kty.includes(kty) && (kid === void 0 || typeof kid == "string" && kid === jwkKid) && (jwkAlg === void 0 ? kty !== "AKP" : alg === jwkAlg) && (use === void 0 || use === "sig") && (!entry.crv || crv === entry.crv);
}
__name(isUsableJWK, "isUsableJWK");
async function importWithAlgCache(cache2, jwk, entry) {
  const cached = cache2.get(jwk) || cache2.set(jwk, {}).get(jwk), { alg } = entry;
  if (cached[alg] === void 0) {
    const pending = jwkToKey(entry, jwk, true).then((key) => {
      if (key.type !== "public")
        throw new JWKSInvalid("JSON Web Key Set members must be public keys");
      return cached[alg] = key, key;
    }).catch((error) => {
      throw cached[alg] === pending && delete cached[alg], error;
    });
    cached[alg] = pending;
  }
  return cached[alg];
}
__name(importWithAlgCache, "importWithAlgCache");
function createLocalJWKSet(jwks2) {
  let snapshot;
  try {
    snapshot = structuredClone(jwks2);
  } catch {
  }
  if (!isJwkSet(snapshot))
    throw new JWKSInvalid("JSON Web Key Set malformed");
  const metadata = snapshot.keys.map((jwk) => {
    const normalized = snapshotJwk(jwk);
    return Array.isArray(normalized.key_ops) && (normalized.key_ops = [...normalized.key_ops]), normalized;
  }), cached = /* @__PURE__ */ new WeakMap();
  return Object.defineProperty(async (protectedHeader, token) => {
    const { alg, kid } = { ...protectedHeader, ...token?.header }, entry = typeof alg == "string" ? JWS[alg] : void 0;
    if (!entry || entry.secret)
      throw new JOSENotSupported('Unsupported "alg" value for a JSON Web Key Set');
    const candidates = snapshot.keys.filter((_, index) => isUsableJWK(metadata[index], entry, alg, kid)), { 0: jwk, length } = candidates;
    if (!length)
      throw new JWKSNoMatchingKey();
    if (length !== 1) {
      const error = new JWKSMultipleMatchingKeys();
      throw error[Symbol.asyncIterator] = async function* () {
        for (const jwk2 of candidates)
          try {
            yield await importWithAlgCache(cached, jwk2, entry);
          } catch {
          }
      }, error;
    }
    return importWithAlgCache(cached, jwk, entry);
  }, "jwks", {
    value: /* @__PURE__ */ __name(() => structuredClone(snapshot), "value")
  });
}
__name(createLocalJWKSet, "createLocalJWKSet");

// node_modules/jose/dist/webapi/jwks/remote.js
function isCloudflareWorkers() {
  return typeof WebSocketPair < "u" || typeof navigator < "u" && true || typeof EdgeRuntime < "u" && EdgeRuntime === "vercel";
}
__name(isCloudflareWorkers, "isCloudflareWorkers");
var USER_AGENT;
(typeof navigator > "u" || !"Cloudflare-Workers"?.startsWith?.("Mozilla/5.0 ")) && (USER_AGENT = "jose/v6.2.12");
var customFetch = /* @__PURE__ */ Symbol();
async function fetchJwks(url, headers, signal, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
    redirect: "manual",
    headers
  }).catch((err) => {
    throw err.name === "TimeoutError" ? new JWKSTimeout() : err;
  });
  if (response.status !== 200)
    throw new JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
  try {
    return await response.json();
  } catch {
    throw new JOSEError("Failed to parse the JSON Web Key Set HTTP response as JSON");
  }
}
__name(fetchJwks, "fetchJwks");
var jwksCache = /* @__PURE__ */ Symbol();
function isFreshFor(timestamp, duration) {
  return Number.isFinite(timestamp) && Date.now() < timestamp + duration;
}
__name(isFreshFor, "isFreshFor");
function validateDuration(value, fallback, option) {
  if (Number.isNaN(value))
    throw new TypeError(`"${option}" option must not be NaN`);
  return typeof value == "number" ? value : fallback;
}
__name(validateDuration, "validateDuration");
function createRemoteJWKSet(url, options) {
  if (!(url instanceof URL))
    throw new TypeError("url must be an instance of URL");
  const href = new URL(url.href).href, opts = options ?? {}, timeoutOption = opts.timeoutDuration;
  if (typeof timeoutOption == "number" && (!Number.isInteger(timeoutOption) || timeoutOption < 0))
    throw new TypeError('"timeoutDuration" option must be a non-negative integer');
  const timeoutDuration = typeof timeoutOption == "number" ? timeoutOption : 5e3, cooldownDuration = validateDuration(opts.cooldownDuration, 3e4, "cooldownDuration"), cacheMaxAge = validateDuration(opts.cacheMaxAge, 6e5, "cacheMaxAge"), headers = new Headers(opts.headers);
  USER_AGENT && !headers.has("User-Agent") && headers.set("User-Agent", USER_AGENT), headers.has("accept") || headers.set("accept", "application/json, application/jwk-set+json");
  const fetchImpl = opts[customFetch], cache2 = opts[jwksCache];
  let jwksTimestamp, pendingFetch, reloadSequence = 0, appliedSequence = 0, local;
  if (cache2 && typeof cache2 == "object") {
    const { uat, jwks: jwks2 } = cache2;
    isFreshFor(uat, cacheMaxAge) && isJwkSet(jwks2) && (jwksTimestamp = uat, local = createLocalJWKSet(jwks2));
  }
  const reload = /* @__PURE__ */ __name(async () => {
    if (pendingFetch && isCloudflareWorkers() && (pendingFetch = void 0), !pendingFetch) {
      const sequence = ++reloadSequence, current = pendingFetch = fetchJwks(href, headers, AbortSignal.timeout(timeoutDuration), fetchImpl).then((json2) => {
        const next = createLocalJWKSet(json2);
        if (sequence <= appliedSequence)
          return;
        local = next;
        const updatedAt = Date.now();
        cache2 && (cache2.uat = updatedAt, cache2.jwks = json2), jwksTimestamp = updatedAt, appliedSequence = sequence;
      }).finally(() => {
        pendingFetch === current && (pendingFetch = void 0);
      });
    }
    await pendingFetch;
  }, "reload");
  return Object.defineProperties(async (protectedHeader, token) => {
    (!local || !isFreshFor(jwksTimestamp, cacheMaxAge)) && await reload();
    try {
      return await local(protectedHeader, token);
    } catch (err) {
      if (err instanceof JWKSNoMatchingKey && !isFreshFor(jwksTimestamp, cooldownDuration))
        return await reload(), local(protectedHeader, token);
      throw err;
    }
  }, {
    coolingDown: {
      get: /* @__PURE__ */ __name(() => isFreshFor(jwksTimestamp, cooldownDuration), "get"),
      enumerable: true
    },
    fresh: {
      get: /* @__PURE__ */ __name(() => isFreshFor(jwksTimestamp, cacheMaxAge), "get"),
      enumerable: true
    },
    reload: {
      value: reload,
      enumerable: true
    },
    reloading: {
      get: /* @__PURE__ */ __name(() => !!pendingFetch, "get"),
      enumerable: true
    },
    jwks: {
      value: /* @__PURE__ */ __name(() => local?.jwks(), "value"),
      enumerable: true
    }
  });
}
__name(createRemoteJWKSet, "createRemoteJWKSet");

// src/lib/auth.js
var STAFF_ROLES = ["superAdmin", "manager", "eventManager", "doorStaff", "organiser"];
var CMS = ["superAdmin", "manager", "eventManager"];
var MONEY = ["superAdmin", "manager"];
var DOOR = ["superAdmin", "manager", "eventManager", "doorStaff", "organiser"];
var jwks;
async function verifyStaff(req, env) {
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  try {
    jwks ||= createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
    const { payload } = await jwtVerify(h.slice(7), jwks, { issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, audience: env.FIREBASE_PROJECT_ID });
    if (payload.admin === true || STAFF_ROLES.includes(payload.role)) return { ...payload, uid: payload.uid || payload.sub };
    return null;
  } catch {
    return null;
  }
}
__name(verifyStaff, "verifyStaff");
function requireRole(user, roles) {
  return !!user && (user.admin === true || roles.includes(user.role));
}
__name(requireRole, "requireRole");
var uidOf = /* @__PURE__ */ __name((user) => user?.uid || user?.sub, "uidOf");

// src/lib/notify.js
function smsRequest(env, path, init = {}) {
  const headers = { "Content-Type": "application/json", ...init.headers || {} };
  if (env.SMS_WORKER_KEY) headers["X-Memories-Key"] = env.SMS_WORKER_KEY;
  if (env.SMS?.fetch) return env.SMS.fetch(new Request(`https://sms.internal${path}`, { ...init, headers }));
  if (!env.SMS_WORKER_URL) throw new Error("SMS is not configured");
  return fetch(`${env.SMS_WORKER_URL.replace(/\/$/, "")}${path}`, { ...init, headers });
}
__name(smsRequest, "smsRequest");
async function sendSms(env, phone, message2) {
  if (!phone || !(env.SMS?.fetch || env.SMS_WORKER_URL)) return false;
  try {
    const r = await smsRequest(env, "/send-sms", { method: "POST", body: JSON.stringify({ sender: env.SMS_SENDER || "MEMORIES", recipients: [phone], message: message2 }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.success === false) {
      logError("SMS send failed", String(r.status), d.error || "");
      return false;
    }
    return true;
  } catch (e) {
    logError("SMS send threw", e);
    return false;
  }
}
__name(sendSms, "sendSms");
async function sendEmail(env, to, subject, lines) {
  if (!to || !env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return false;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME || "Memories Night Club" }, to: [{ email: to }], subject, html }) });
    if (!r.ok) logError("Brevo failed", String(r.status));
    return r.ok;
  } catch (e) {
    logError("Brevo threw", e);
    return false;
  }
}
__name(sendEmail, "sendEmail");
var siteUrl = /* @__PURE__ */ __name((env, path) => `${(env.PUBLIC_SITE_URL || "").replace(/\/$/, "")}${path}`, "siteUrl");

// src/lib/firestore.js
var enc = new TextEncoder();
var b64url = /* @__PURE__ */ __name((bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64url");
var b64 = /* @__PURE__ */ __name((s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64");
var fromB64 = /* @__PURE__ */ __name((s) => {
  const p = "=".repeat((4 - s.length % 4) % 4);
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + p), (c) => c.charCodeAt(0));
}, "fromB64");
function firestoreValue(v) {
  if (v === null || v === void 0) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(firestoreValue) } };
  if (typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, firestoreValue(x)])) } };
  return { stringValue: String(v) };
}
__name(firestoreValue, "firestoreValue");
function docFields(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== void 0).map(([k, v]) => [k, firestoreValue(v)]));
}
__name(docFields, "docFields");
function parseValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("referenceValue" in v) return v.referenceValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(parseValue);
  if ("mapValue" in v) return parseFields(v.mapValue.fields || {});
  return null;
}
__name(parseValue, "parseValue");
function parseFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, parseValue(v)]));
}
__name(parseFields, "parseFields");
var tokenCache = {};
async function googleAccessToken(env, scope = "https://www.googleapis.com/auth/datastore") {
  const cached = tokenCache[scope];
  if (cached && cached.sa === env.FIREBASE_SERVICE_ACCOUNT_JSON && Date.now() < cached.expires - 6e4) return cached.value;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const keyPem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", fromB64(keyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const t = Math.floor(Date.now() / 1e3);
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: t, exp: t + 3600 }));
  const signature = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${payload}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${payload}.${signature}` }) });
  const d = await r.json();
  if (!r.ok) throw new Error("Google access token failed");
  tokenCache[scope] = { value: d.access_token, expires: Date.now() + d.expires_in * 1e3, sa: env.FIREBASE_SERVICE_ACCOUNT_JSON };
  return d.access_token;
}
__name(googleAccessToken, "googleAccessToken");
var basePath = /* @__PURE__ */ __name((env) => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`, "basePath");
var docName = /* @__PURE__ */ __name((env, col, id2) => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${id2}`, "docName");
async function call(env, url, options = {}) {
  const token = await googleAccessToken(env);
  const r = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers || {} } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(d.error?.message || `Firestore ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return d;
}
__name(call, "call");
var fs = /* @__PURE__ */ __name((env, path, options) => call(env, basePath(env) + path, options), "fs");
async function getDoc(env, col, docId) {
  if (!docId) return null;
  try {
    const d = await fs(env, `/${col}/${encodeURIComponent(docId)}`);
    return d.name ? { id: docId, fields: parseFields(d.fields) } : null;
  } catch (e) {
    if (e.status === 404 || String(e.message).includes("NOT_FOUND")) return null;
    throw e;
  }
}
__name(getDoc, "getDoc");
async function listDocs(env, col) {
  let docs = [], pageToken;
  do {
    const qs = new URLSearchParams({ pageSize: "300" });
    if (pageToken) qs.set("pageToken", pageToken);
    const d = await fs(env, `/${col}?${qs}`);
    docs = docs.concat((d.documents || []).map((x) => ({ id: x.name.split("/").pop(), fields: parseFields(x.fields) })));
    pageToken = d.nextPageToken || null;
  } while (pageToken);
  return docs;
}
__name(listDocs, "listDocs");
async function setDoc(env, col, docId, data) {
  await fs(env, `/${col}/${encodeURIComponent(docId)}`, { method: "PATCH", body: JSON.stringify({ fields: docFields(data) }) });
}
__name(setDoc, "setDoc");
async function createDoc(env, col, docId, data) {
  return fs(env, `/${col}?documentId=${encodeURIComponent(docId)}`, { method: "POST", body: JSON.stringify({ fields: docFields(data) }) });
}
__name(createDoc, "createDoc");
async function deleteDoc(env, col, docId) {
  await fs(env, `/${col}/${encodeURIComponent(docId)}`, { method: "DELETE" });
}
__name(deleteDoc, "deleteDoc");
async function queryWhere(env, col, filters, { limit = 1e3, transaction } = {}) {
  const fieldFilters = filters.map((f) => ({ fieldFilter: { field: { fieldPath: f.field }, op: "EQUAL", value: firestoreValue(f.value) } }));
  const where = fieldFilters.length === 1 ? fieldFilters[0] : { compositeFilter: { op: "AND", filters: fieldFilters } };
  const body2 = { structuredQuery: { from: [{ collectionId: col }], where, limit } };
  if (transaction) body2.transaction = transaction;
  const d = await call(env, `${basePath(env)}:runQuery`, { method: "POST", body: JSON.stringify(body2) });
  return (d || []).filter((x) => x.document).map((x) => ({ id: x.document.name.split("/").pop(), fields: parseFields(x.document.fields) }));
}
__name(queryWhere, "queryWhere");
async function beginTx(env) {
  const d = await fs(env, ":beginTransaction", { method: "POST", body: JSON.stringify({ options: { readWrite: {} } }) });
  return d.transaction;
}
__name(beginTx, "beginTx");
async function batchGet(env, paths, transaction) {
  const documents = paths.map((p) => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${p}`);
  return call(env, `${basePath(env)}:batchGet`, { method: "POST", body: JSON.stringify({ documents, transaction }) });
}
__name(batchGet, "batchGet");
async function commitTx(env, writes, transaction) {
  return call(env, `${basePath(env)}:commit`, { method: "POST", body: JSON.stringify({ writes, transaction }) });
}
__name(commitTx, "commitTx");
var updateWrite = /* @__PURE__ */ __name((env, col, docId, data) => ({ update: { name: docName(env, col, docId), fields: docFields(data) } }), "updateWrite");
function foundFields(result, suffix) {
  const found = (result || []).filter((x) => x.found).map((x) => ({ path: x.found.name, fields: parseFields(x.found.fields) }));
  return found.find((x) => x.path.endsWith(suffix));
}
__name(foundFields, "foundFields");
async function withTransaction(env, fn, attempts = 5) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const tx = await beginTx(env);
    try {
      return await fn(tx);
    } catch (e) {
      lastErr = e;
      if (e && e.status === 409 && attempt < attempts - 1) {
        await new Promise((res) => setTimeout(res, Math.min(1e3, 50 * 2 ** attempt) + Math.floor(Math.random() * 50)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
__name(withTransaction, "withTransaction");

// src/public.js
var DEFAULT_SETTINGS = {
  venue: "SamRit Hotel, Cape Coast",
  address: "",
  nightsLine: "Friday + Saturday",
  doorsLine: "Doors 10PM",
  phone: "",
  whatsapp: "0249050086",
  email: "",
  instagram: "@memoriesnightclub.gh",
  facebook: "memoriesnightclub.gh",
  tiktok: "@memoriesnightclub.gh",
  mapUrl: "",
  heroImage: "",
  heroVideo: "",
  defaultLines: [],
  closedDates: []
};
var SETTINGS_FIELDS = { venue: 120, address: 200, nightsLine: 60, doorsLine: 60, phone: 30, whatsapp: 30, email: 120, instagram: 60, facebook: 60, tiktok: 60, mapUrl: 500, heroImage: 500, heroVideo: 1e3 };
async function getSettings(env) {
  const d = await getDoc(env, "settings", "site");
  const saved = Object.fromEntries(Object.entries(d?.fields || {}).filter(([, v]) => v !== ""));
  return { ...DEFAULT_SETTINGS, ...saved };
}
__name(getSettings, "getSettings");
var resolveLines = /* @__PURE__ */ __name((event, settings) => {
  const own = (event?.ticketLines || []).filter(Boolean);
  return own.length ? own : (settings?.defaultLines || []).filter(Boolean);
}, "resolveLines");
var isLive = /* @__PURE__ */ __name((e) => e && e.visibility === "public" && e.active !== false, "isLive");
var isOver = /* @__PURE__ */ __name((e) => new Date(e.date).getTime() + 8 * 36e5 < Date.now(), "isOver");
function publicEvent(id2, f, settings) {
  return {
    id: id2,
    name: f.name || "",
    date: f.date,
    doors: f.doors || "",
    venue: f.venue || settings?.venue || "",
    artwork: f.artwork || "",
    heroImage: f.heroImage || "",
    heroVideo: f.heroVideo || "",
    description: clean(f.description, 240),
    soldOut: f.soldOut === true,
    featured: f.featured === true,
    ticketStyle: f.ticketStyle || "auto",
    ticketColors: cleanTicketColors(f.ticketColors)
  };
}
__name(publicEvent, "publicEvent");
var autoStylesFrom = /* @__PURE__ */ __name((docs) => monthStyles(docs.filter((x) => x.fields.active !== false).map((x) => ({ id: x.id, date: x.fields.date, ticketStyle: x.fields.ticketStyle }))), "autoStylesFrom");
async function autoStyleFor(env, eventId) {
  return autoStylesFrom(await listDocs(env, "events")).get(eventId) || null;
}
__name(autoStyleFor, "autoStyleFor");
async function publicEvents(env) {
  const [docs, settings] = await Promise.all([listDocs(env, "events"), getSettings(env)]);
  const auto = autoStylesFrom(docs);
  return docs.filter((x) => isLive(x.fields) && !isOver(x.fields)).map((x) => ({ ...publicEvent(x.id, x.fields, settings), autoStyle: auto.get(x.id) || null })).sort((a, b) => new Date(a.date) - new Date(b.date));
}
__name(publicEvents, "publicEvents");
async function eventBundle(env, eventId) {
  const e = await getDoc(env, "events", eventId);
  if (!e || !isLive(e.fields)) return null;
  const [tickets, tables, bottles, globalBottles, raffles, settings, autoStyle] = await Promise.all([
    queryWhere(env, "ticket_types", [{ field: "eventId", value: eventId }]),
    queryWhere(env, "table_packages", [{ field: "eventId", value: eventId }]),
    queryWhere(env, "bottles", [{ field: "eventId", value: eventId }]),
    queryWhere(env, "bottles", [{ field: "eventId", value: "all" }]),
    queryWhere(env, "raffles", [{ field: "eventId", value: eventId }]),
    getSettings(env),
    autoStyleFor(env, eventId)
  ]);
  const stock = /* @__PURE__ */ __name((f) => typeof f.remaining === "number" ? { soldOut: f.remaining <= 0, lastFew: f.remaining > 0 && f.remaining <= 10 } : { soldOut: false, lastFew: false }, "stock");
  const bySort = /* @__PURE__ */ __name((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.pricePesewas - b.pricePesewas, "bySort");
  const raffle = raffles.find((x) => x.fields.public === true && x.fields.enabled === true);
  return {
    event: { ...publicEvent(eventId, e.fields, settings), over: isOver(e.fields), autoStyle },
    lines: resolveLines(e.fields, settings),
    ticketTypes: tickets.filter((x) => x.fields.active === true).map((x) => ({ id: x.id, name: x.fields.name, pricePesewas: Number(x.fields.pricePesewas || 0), admits: Number(x.fields.admits || 1), description: clean(x.fields.description, 140), sortOrder: x.fields.sortOrder ?? 0, ...stock(x.fields) })).sort(bySort),
    tablePackages: tables.filter((x) => x.fields.active === true).map((x) => ({ id: x.id, name: x.fields.name, pricePesewas: Number(x.fields.pricePesewas || 0), capacity: Number(x.fields.capacity || 0), includes: clean(x.fields.description, 200), sortOrder: x.fields.sortOrder ?? 0, ...stock(x.fields) })).sort(bySort),
    bottles: [...bottles, ...globalBottles].filter((x) => x.fields.active === true).map((x) => ({ id: x.id, name: x.fields.name, category: x.fields.category || "", pricePesewas: Number(x.fields.pricePesewas || 0), ...stock(x.fields) })).sort((a, b) => a.category.localeCompare(b.category) || a.pricePesewas - b.pricePesewas),
    // Whitelisted: a drawn raffle's raw ticket id is a bearer token and never leaves the server.
    raffle: raffle ? {
      prize: raffle.fields.prize || "",
      status: raffle.fields.status || "open",
      cap: Number(raffle.fields.cap) > 0 ? Number(raffle.fields.cap) : 20,
      spotsTaken: Number(raffle.fields.spotsTaken || 0),
      winner: raffle.fields.status === "drawn" ? { name: raffle.fields.winnerDisplayName || "Winner", code: raffle.fields.winnerDisplayCode || "" } : null
    } : null
  };
}
__name(eventBundle, "eventBundle");
async function calendar(env, weeks = 10) {
  const [events, held, settings] = await Promise.all([
    listDocs(env, "events"),
    queryWhere(env, "private_event_requests", [{ field: "status", value: "ACCEPTED" }]),
    getSettings(env)
  ]);
  const byDate = /* @__PURE__ */ new Map();
  for (const e of events) {
    if (e.fields.active === false) continue;
    const k = dateKey(e.fields.date);
    if (!k) continue;
    const cur = byDate.get(k);
    if (e.fields.visibility === "public") {
      if (!cur || cur.state !== "event") byDate.set(k, { state: "event", eventId: e.id, name: e.fields.name || "" });
    } else if (!cur) byDate.set(k, { state: "held" });
  }
  for (const r of held) {
    const k = r.fields.date;
    if (k && !byDate.has(k)) byDate.set(k, { state: "held" });
  }
  const closed = new Set(settings.closedDates || []);
  const days = [];
  const start = /* @__PURE__ */ new Date(dateKey(now()) + "T00:00:00Z");
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getTime() + i * 864e5), k = dateKey(d), dow = d.getUTCDay();
    const hit = byDate.get(k);
    if (hit) days.push({ date: k, ...hit });
    else if (dow === 5 || dow === 6) days.push({ date: k, state: closed.has(k) ? "unavailable" : "open" });
  }
  return { days };
}
__name(calendar, "calendar");
var PRIVATE_TYPES = ["Corporate", "Event organiser", "Large group", "Other"];
var LEGACY_TYPES = ["Birthday", "Concert", "Private celebration"];
async function createPrivateRequest(env, b) {
  const name = clean(b?.name, 80), phone = normalizePhone(b?.phone);
  const eventType = [...PRIVATE_TYPES, ...LEGACY_TYPES].includes(b?.eventType) ? b.eventType : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b?.date || "") ? b.date : null;
  const guests = Number(b?.guests);
  if (!eventType) return { error: "Pick what you are planning." };
  if (!date) return { error: "Pick a date." };
  if (!Number.isInteger(guests) || guests < 1 || guests > 3e3) return { error: "How many people are coming?" };
  if (!name) return { error: "We need your name." };
  if (!phone) return { error: "That phone number doesn\u2019t look right. Use a Ghana number, e.g. 024 123 4567." };
  if (b?.email && !validEmail(b.email)) return { error: "That email doesn\u2019t look right." };
  if (date <= dateKey(now())) return { error: "Pick a date from tomorrow onwards." };
  const { days } = await calendar(env, 60);
  const slot = days.find((d) => d.date === date);
  if (slot && slot.state !== "open") return { error: slot.state === "event" ? `${slot.name} is on that night. Pick another date.` : "That date is already taken. Pick another." };
  const rid = id();
  await setDoc(env, "private_event_requests", rid, {
    eventType,
    date,
    guests,
    name,
    phone,
    instagram: clean(b.instagram, 60).replace(/^@?/, b.instagram ? "@" : ""),
    email: clean(b.email, 120),
    message: clean(b.message, 500),
    status: "NEW",
    createdAt: now()
  });
  await sendEmail(env, env.STAFF_NOTIFY_EMAIL || env.BREVO_SENDER_EMAIL, "New event booking request", [
    `${eventType} \xB7 ${date} \xB7 ${guests} guests`,
    `${name} \xB7 ${phone}${b.instagram ? " \xB7 " + clean(b.instagram, 60) : ""}`,
    clean(b.message, 500)
  ]);
  return { id: rid };
}
__name(createPrivateRequest, "createPrivateRequest");
async function publicTicket(env, token) {
  const d = await getDoc(env, "tickets", token);
  if (!d) return null;
  const t = d.fields;
  const [ev, raffles, autoStyle] = await Promise.all([getDoc(env, "events", t.eventId), queryWhere(env, "raffles", [{ field: "eventId", value: t.eventId }]), autoStyleFor(env, t.eventId)]);
  const raffle = raffles.find((x) => x.fields.enabled === true && x.fields.public === true);
  return {
    token,
    firstName: firstName(t.customerName),
    type: t.type,
    admits: Number(t.admitCount || 1),
    eventId: t.eventId,
    eventName: ev?.fields?.name || t.eventName || "",
    eventDate: ev?.fields?.date || t.eventDate || "",
    doors: ev?.fields?.doors || "",
    venue: ev?.fields?.venue || "",
    artwork: ev?.fields?.artwork || "",
    ticketStyle: ev?.fields?.ticketStyle || "auto",
    ticketColors: cleanTicketColors(ev?.fields?.ticketColors),
    autoStyle,
    identityLine: t.identityLine || "",
    displayCode: t.displayCode,
    status: t.revoked || t.cancelled ? "cancelled" : t.status,
    inDraw: t.inDraw === true,
    comp: t.comp === true,
    raffle: raffle ? { prize: raffle.fields.prize || "", status: raffle.fields.status, winner: raffle.fields.status === "drawn" ? { name: raffle.fields.winnerDisplayName, code: raffle.fields.winnerDisplayCode } : null } : null
  };
}
__name(publicTicket, "publicTicket");

// src/raffle.js
var DEFAULT_CAP = 20;
var capOf = /* @__PURE__ */ __name((f) => Number(f.cap) > 0 ? Number(f.cap) : DEFAULT_CAP, "capOf");
async function openRaffleForEvent(env, tx, eventId) {
  const raffles = await queryWhere(env, "raffles", [{ field: "eventId", value: eventId }], { transaction: tx });
  const raffle = raffles.find((r) => r.fields.enabled === true && r.fields.status === "open");
  if (!raffle) return null;
  const cap = capOf(raffle.fields), spotsTaken = Number(raffle.fields.spotsTaken || 0);
  if (spotsTaken >= cap) return null;
  return { raffleId: raffle.id, fields: raffle.fields, cap, spotsTaken };
}
__name(openRaffleForEvent, "openRaffleForEvent");
function raffleSpotWrites(env, raffle, eventId, ticketId, orderId) {
  if (!raffle) return [];
  const next = raffle.spotsTaken + 1;
  return [
    updateWrite(env, "raffle_entries", id(), { raffleId: raffle.raffleId, eventId, ticketId, orderId, status: "eligible", createdAt: now() }),
    updateWrite(env, "raffles", raffle.raffleId, { ...raffle.fields, spotsTaken: next, status: next >= raffle.cap ? "closed" : "open", updatedAt: now() })
  ];
}
__name(raffleSpotWrites, "raffleSpotWrites");
var raffleIdFor = /* @__PURE__ */ __name((eventId) => `evt_${eventId}`, "raffleIdFor");
async function upsertRaffle(env, b, user) {
  if (!requireRole(user, CMS)) return { error: "Forbidden.", status: 403 };
  if (!b?.eventId) return { error: "Pick a night." };
  const ev = await getDoc(env, "events", b.eventId);
  if (!ev) return { error: "Night not found.", status: 404 };
  const existing = (await queryWhere(env, "raffles", [{ field: "eventId", value: b.eventId }]))[0];
  const rid = existing?.id || raffleIdFor(b.eventId);
  const cur = existing?.fields || { spotsTaken: 0, status: "open" };
  const prize = clean(b.prize ?? cur.prize, 140);
  if (!prize) return { error: "Add the prize." };
  const cap = b.cap === void 0 ? capOf(cur) : Number(b.cap);
  if (!Number.isInteger(cap) || cap < 1 || cap > 500) return { error: "Cap must be a whole number from 1 to 500." };
  const spotsTaken = Number(cur.spotsTaken || 0);
  if (cap < spotsTaken) return { error: `${spotsTaken} spots are already taken \u2014 the cap can't go below that.` };
  let status = cur.status || "open";
  if (status !== "drawn") {
    if (b.status === "closed") status = "closed";
    else if (b.status === "open") status = spotsTaken >= cap ? "closed" : "open";
    else status = spotsTaken >= cap ? "closed" : status;
  }
  const data = { ...cur, eventId: b.eventId, prize, cap, spotsTaken, status, enabled: b.enabled === void 0 ? cur.enabled !== false : b.enabled === true, public: true, updatedAt: now(), createdAt: cur.createdAt || now() };
  await setDoc(env, "raffles", rid, data);
  await setDoc(env, "audit_logs", id(), { action: "RAFFLE_UPDATED", actorUid: uidOf(user), raffleId: rid, eventId: b.eventId, prize, cap, status, timestamp: now() });
  return { raffleId: rid };
}
__name(upsertRaffle, "upsertRaffle");
function safeWinnerName(name) {
  const parts2 = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts2.length) return "Winner";
  return parts2[1] ? `${parts2[0]} ${parts2[1][0]}.` : parts2[0];
}
__name(safeWinnerName, "safeWinnerName");
async function drawRaffle(env, b, user) {
  if (!requireRole(user, CMS)) return { error: "Forbidden.", status: 403 };
  const raffleId = b?.raffleId;
  if (!raffleId) return { error: "raffleId is required." };
  try {
    const result = await withTransaction(env, async (tx) => {
      const f = foundFields(await batchGet(env, [`raffles/${raffleId}`], tx), `/raffles/${raffleId}`);
      if (!f) throw Object.assign(new Error("Raffle not found."), { clientError: true });
      if (f.fields.status === "drawn") throw Object.assign(new Error("This raffle has already been drawn."), { clientError: true });
      const entries = await queryWhere(env, "raffle_entries", [{ field: "raffleId", value: raffleId }, { field: "status", value: "eligible" }], { transaction: tx });
      if (!entries.length) throw Object.assign(new Error("No eligible entries yet."), { clientError: true });
      const rnd = crypto.getRandomValues(new Uint32Array(1))[0];
      const winner = entries[rnd % entries.length];
      const wg = await batchGet(env, [`tickets/${winner.fields.ticketId}`, ...winner.fields.orderId ? [`orders/${winner.fields.orderId}`] : []], tx);
      const ticket = foundFields(wg, `/tickets/${winner.fields.ticketId}`);
      const order = winner.fields.orderId ? foundFields(wg, `/orders/${winner.fields.orderId}`) : null;
      const winnerDisplayName = safeWinnerName(ticket?.fields.customerName), winnerDisplayCode = ticket?.fields.displayCode || "";
      const when = now();
      await commitTx(env, [
        updateWrite(env, "raffles", raffleId, { ...f.fields, status: "drawn", winnerDisplayName, winnerDisplayCode, drawnAt: when, eligibleEntryCount: entries.length }),
        updateWrite(env, "raffle_entries", winner.id, { ...winner.fields, status: "won" }),
        updateWrite(env, "audit_logs", id(), { action: "RAFFLE_DRAWN", raffleId, eventId: f.fields.eventId, drawnAt: when, drawnBy: uidOf(user), actorUid: uidOf(user), eligibleEntryCount: entries.length, winningTicketId: winner.fields.ticketId, winnerTicketId: winner.fields.ticketId, winnerEntryId: winner.id, timestamp: when })
      ], tx);
      return { winnerDisplayName, winnerDisplayCode, phone: order?.fields.buyerPhone || ticket?.fields.phone, eventName: order?.fields.eventName || ticket?.fields.eventName || "", prize: f.fields.prize || "", eligible: entries.length };
    });
    if (result.phone) await sendSms(env, result.phone, `MEMORIES
${result.winnerDisplayName}, you won the draw for ${result.eventName}${result.prize ? `: ${result.prize}` : ""}.
Ticket ${result.winnerDisplayCode}. See you at the door.`);
    return { winnerDisplayName: result.winnerDisplayName, winnerDisplayCode: result.winnerDisplayCode, eligibleEntryCount: result.eligible, notified: !!result.phone };
  } catch (e) {
    if (e.clientError) return { error: e.message, status: 400 };
    throw e;
  }
}
__name(drawRaffle, "drawRaffle");

// src/splits.js
var PAYSTACK_BASE = "https://api.paystack.co";
async function paystack(env, path, options = {}) {
  const r = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...options.headers || {}
    }
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.status === false) {
    const err = new Error(d.message || `Paystack ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return d.data;
}
__name(paystack, "paystack");
async function listSettlementBanks(env) {
  return paystack(env, "/bank?currency=GHS&country=ghana&type=ghipss,mobile_money");
}
__name(listSettlementBanks, "listSettlementBanks");
async function resolveBankAccount(env, { bankCode, accountNumber }) {
  const code = clean(bankCode, 20);
  const num = clean(accountNumber, 30);
  if (!code) throw new Error("Pick a settlement bank or mobile money provider.");
  if (!num) throw new Error("Enter the account number.");
  const d = await paystack(env, `/bank/resolve?account_number=${encodeURIComponent(num)}&bank_code=${encodeURIComponent(code)}`);
  return { accountName: d.account_name || "", accountNumber: d.account_number || num };
}
__name(resolveBankAccount, "resolveBankAccount");
async function createPlatformSubaccount(env, { businessName, bankCode, accountNumber, percentageCharge, email, phone }) {
  const name = clean(businessName, 100);
  const code = clean(bankCode, 20);
  const num = clean(accountNumber, 30);
  const pct = Number(percentageCharge);
  if (!name) throw new Error("Enter the business name Paystack should show on settlements.");
  if (!code) throw new Error("Pick a settlement bank or mobile money provider.");
  if (!num) throw new Error("Enter the account or MoMo number.");
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw new Error("The platform share must be a whole number from 1 to 100.");
  const d = await paystack(env, "/subaccount", {
    method: "POST",
    body: JSON.stringify({
      business_name: name,
      settlement_bank: code,
      account_number: num,
      percentage_charge: pct,
      ...clean(email, 120) ? { primary_contact_email: clean(email, 120) } : {},
      ...clean(phone, 30) ? { primary_contact_phone: clean(phone, 30) } : {}
    })
  });
  return {
    subaccountCode: d.subaccount_code,
    accountName: d.account_name || name,
    settlementBank: d.settlement_bank,
    accountNumber: d.account_number
  };
}
__name(createPlatformSubaccount, "createPlatformSubaccount");
async function buildSplitObject(env) {
  const d = await getDoc(env, "settings", "site");
  const s = d?.fields || {};
  const subaccount = clean(s.platformSubaccount, 40);
  const pct = Number(s.platformSharePct);
  if (!subaccount || !Number.isInteger(pct) || pct < 1 || pct > 100) return null;
  return {
    type: "percentage",
    bearer_type: "account",
    subaccounts: [{ subaccount, share: pct }]
  };
}
__name(buildSplitObject, "buildSplitObject");

// src/checkout.js
async function paystack2(env, path, options = {}) {
  const r = await fetch(`https://api.paystack.co${path}`, { ...options, headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json", ...options.headers || {} } });
  const d = await r.json();
  if (!r.ok || !d.status) throw new Error(d.message || "Paystack request failed");
  return d.data;
}
__name(paystack2, "paystack");
async function platformSplitFor(env) {
  const split = await buildSplitObject(env);
  if (!split) return { split: null, snapshot: null };
  const sub = split.subaccounts[0];
  return { split, snapshot: { sharePct: sub.share, subaccount: sub.subaccount, capturedAt: now() } };
}
__name(platformSplitFor, "platformSplitFor");
var LINE_MAX = 40;
var returnUrl = /* @__PURE__ */ __name((env) => /^https?:\/\//.test(env.PUBLIC_SITE_URL || "") ? siteUrl(env, "/payment-return.html") : "", "returnUrl");
var payEmail = /* @__PURE__ */ __name((env, email, phone) => validEmail(email) ? email : `guest-${phone}@${new URL(env.PUBLIC_SITE_URL || "https://memoriesnightclub.com").hostname.replace(/^www\./, "")}`, "payEmail");
async function ticketContext(env, b) {
  const buyerName = clean(b?.buyerName, 80), buyerPhone = normalizePhone(b?.buyerPhone);
  if (!b?.eventId || !b?.ticketTypeId) return { error: "Pick a ticket." };
  if (!buyerName) return { error: "We need your name for the ticket." };
  if (!buyerPhone) return { error: "That phone number doesn\u2019t look right. Use a Ghana number, e.g. 024 123 4567." };
  if (b.buyerEmail && !validEmail(b.buyerEmail)) return { error: "That email doesn\u2019t look right." };
  const qty = Number(b.quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 6) return { error: "You can get 1 to 6 tickets at a time." };
  if (!returnUrl(env)) return { error: "Payments are not set up yet.", status: 503 };
  const [ev, tt, settings] = await Promise.all([getDoc(env, "events", b.eventId), getDoc(env, "ticket_types", b.ticketTypeId), getSettings(env)]);
  if (!ev || !tt || ev.fields.active === false || ev.fields.visibility !== "public" || tt.fields.eventId !== b.eventId || tt.fields.active !== true) return { error: "This ticket is no longer available." };
  if (ev.fields.soldOut === true || typeof tt.fields.remaining === "number" && tt.fields.remaining < qty) return { error: "Not enough tickets left for that." };
  if (isOver(ev.fields)) return { error: "This night has already happened." };
  const lines = resolveLines(ev.fields, settings);
  const own = clean(b.identityLine, 400).replace(/\s+/g, " ").slice(0, LINE_MAX).trim();
  const identityLine = lines.includes(b.identityLine) ? b.identityLine : own;
  const unit = Number(tt.fields.pricePesewas || 0);
  if (!(unit > 0)) return { error: "This ticket is no longer available." };
  return { ev, tt, qty, buyerName, buyerPhone, buyerEmail: clean(b.buyerEmail, 120), identityLine, totalPesewas: unit * qty };
}
__name(ticketContext, "ticketContext");
async function initiateTicket(env, b) {
  const c = await ticketContext(env, b);
  if (c.error) return c;
  const reference = paymentRef();
  const { split, snapshot: platformSplit } = await platformSplitFor(env);
  await setDoc(env, "pending_checkouts", reference, {
    reference,
    kind: "ticket",
    eventId: c.ev.id,
    eventName: c.ev.fields.name || "",
    ticketTypeId: c.tt.id,
    ticketTypeName: c.tt.fields.name || "Ticket",
    admits: Number(c.tt.fields.admits || 1),
    quantity: c.qty,
    amountPesewas: c.totalPesewas,
    buyerName: c.buyerName,
    buyerPhone: c.buyerPhone,
    buyerEmail: c.buyerEmail,
    identityLine: c.identityLine,
    status: "pending",
    createdAt: now(),
    ...platformSplit ? { platformSplit } : {}
  });
  try {
    const payload = { email: payEmail(env, c.buyerEmail, c.buyerPhone), amount: c.totalPesewas, currency: "GHS", reference, callback_url: returnUrl(env), metadata: { kind: "ticket", eventId: c.ev.id, ticketTypeId: c.tt.id, quantity: c.qty } };
    const p = await paystack2(env, "/transaction/initialize", { method: "POST", body: JSON.stringify(split ? { ...payload, split } : payload) });
    return { reference, authorizationUrl: p.authorization_url };
  } catch (e) {
    await setDoc(env, "pending_checkouts", reference, { reference, kind: "ticket", eventId: c.ev.id, status: "failed", error: "payment_initialization_failed", failedAt: now() });
    throw e;
  }
}
__name(initiateTicket, "initiateTicket");
async function confirmCharge(env, pending, reference) {
  const payment = await paystack2(env, `/transaction/verify/${encodeURIComponent(reference)}`);
  if (payment.status !== "success") return { status: payment.status === "failed" || payment.status === "abandoned" ? "failed" : "pending", error: payment.status === "failed" ? "Payment was not successful." : void 0 };
  if (payment.currency !== "GHS" || Number(payment.amount) !== Number(pending.fields.amountPesewas)) {
    await setDoc(env, "pending_checkouts", reference, { ...pending.fields, status: "failed", error: "amount_mismatch" });
    return { status: "failed", error: "Payment amount did not match. Contact us with your reference." };
  }
  return null;
}
__name(confirmCharge, "confirmCharge");
function ticketWrites(env, { tokens, holder, phone, eventId, eventName, typeName, admits, identityLine, reference, inDrawToken, extra = {} }) {
  return tokens.map((token) => updateWrite(env, "tickets", token, {
    customerName: holder,
    phoneLast4: String(phone || "").slice(-4),
    type: typeName,
    admitCount: admits,
    eventId,
    eventName,
    identityLine,
    reference,
    displayCode: displayCode(token),
    status: "valid",
    revoked: false,
    cancelled: false,
    inDraw: token === inDrawToken,
    issuedAt: now(),
    ...extra
  }));
}
__name(ticketWrites, "ticketWrites");
async function fulfillTicket(env, reference) {
  const pending = await getDoc(env, "pending_checkouts", reference);
  if (!pending) return { status: "failed", error: "Checkout not found." };
  if (pending.fields.status === "issued") return { status: "issued", ticketIds: pending.fields.ticketIds || [], orderId: pending.fields.orderId };
  if (pending.fields.status === "failed") return { status: "failed", error: pending.fields.error || "Payment was not successful." };
  const bad = await confirmCharge(env, pending, reference);
  if (bad) return bad;
  const P = pending.fields;
  const result = await withTransaction(env, async (tx) => {
    const got = await batchGet(env, [`pending_checkouts/${reference}`, `ticket_types/${P.ticketTypeId}`], tx);
    const fresh = foundFields(got, `/pending_checkouts/${reference}`), tt = foundFields(got, `/ticket_types/${P.ticketTypeId}`);
    if (!fresh || !tt) throw new Error("Checkout data disappeared.");
    if (fresh.fields.status === "issued") return { status: "issued", ticketIds: fresh.fields.ticketIds || [], orderId: fresh.fields.orderId, already: true };
    const remaining = typeof tt.fields.remaining === "number" ? tt.fields.remaining : null;
    if (remaining !== null && remaining < P.quantity) {
      await commitTx(env, [updateWrite(env, "pending_checkouts", reference, { ...fresh.fields, status: "failed", error: "sold_out_after_payment", refundStatus: "manual_required" })], tx);
      return { status: "failed", error: "Tickets sold out while your payment was confirming. Contact us for a refund." };
    }
    const orderId = id();
    const raffle = await openRaffleForEvent(env, tx, P.eventId);
    const tokens = Array.from({ length: P.quantity }, ticketToken);
    const inDraw = !!raffle;
    const writes = [
      ...ticketWrites(env, { tokens, holder: P.buyerName, phone: P.buyerPhone, eventId: P.eventId, eventName: P.eventName, typeName: P.ticketTypeName, admits: P.admits || 1, identityLine: P.identityLine || "", reference, inDrawToken: inDraw ? tokens[0] : null }),
      ...raffleSpotWrites(env, raffle, P.eventId, tokens[0], orderId),
      updateWrite(env, "orders", orderId, {
        orderId,
        kind: "ticket",
        reference,
        eventId: P.eventId,
        eventName: P.eventName,
        ticketTypeId: P.ticketTypeId,
        ticketTypeName: P.ticketTypeName,
        quantity: P.quantity,
        amountPesewas: P.amountPesewas,
        buyerName: P.buyerName,
        buyerPhone: P.buyerPhone,
        buyerEmail: P.buyerEmail || "",
        status: "confirmed",
        inDraw,
        ticketIds: tokens,
        createdAt: now(),
        ...fresh.fields.platformSplit ? { platformSplit: fresh.fields.platformSplit } : {}
      }),
      updateWrite(env, "pending_checkouts", reference, { ...fresh.fields, status: "issued", ticketIds: tokens, orderId, issuedAt: now() })
    ];
    if (remaining !== null) writes.push(updateWrite(env, "ticket_types", P.ticketTypeId, { ...tt.fields, remaining: remaining - P.quantity }));
    await commitTx(env, writes, tx);
    return { status: "issued", ticketIds: tokens, orderId };
  });
  if (result.status === "issued" && !result.already) {
    const link = siteUrl(env, `/ticket.html?token=${result.ticketIds[0]}`);
    await sendSms(env, P.buyerPhone, `MEMORIES
You're in for ${P.eventName}.
Your ticket: ${link}`);
    await sendEmail(env, P.buyerEmail, "Your Memories ticket", [`You're in for ${P.eventName}.`, `Your ticket: ${link}`, `Reference: ${reference}`]);
  }
  delete result.already;
  return result;
}
__name(fulfillTicket, "fulfillTicket");
async function initiateTable(env, b) {
  const name = clean(b?.name, 80), phone = normalizePhone(b?.phone);
  if (!b?.eventId || !b?.packageId) return { error: "Pick a table." };
  if (!name) return { error: "We need a name for the booking." };
  if (!phone) return { error: "That phone number doesn\u2019t look right. Use a Ghana number, e.g. 024 123 4567." };
  if (b.email && !validEmail(b.email)) return { error: "That email doesn\u2019t look right." };
  if (!returnUrl(env)) return { error: "Payments are not set up yet.", status: 503 };
  const [ev, pkg] = await Promise.all([getDoc(env, "events", b.eventId), getDoc(env, "table_packages", b.packageId)]);
  if (!ev || !pkg || ev.fields.active === false || ev.fields.visibility !== "public" || pkg.fields.eventId !== b.eventId || pkg.fields.active !== true) return { error: "This table isn\u2019t available any more." };
  if (isOver(ev.fields)) return { error: "This night has already happened." };
  if (typeof pkg.fields.remaining === "number" && pkg.fields.remaining < 1) return { error: "That table is fully booked." };
  const chosen = (Array.isArray(b.bottles) ? b.bottles : []).map((x) => ({ id: String(x.id || ""), quantity: Number(x.quantity || 0) })).filter((x) => x.id && Number.isInteger(x.quantity) && x.quantity > 0 && x.quantity <= 50);
  let amount = Number(pkg.fields.pricePesewas || 0);
  const bottleItems = [];
  for (const item of chosen) {
    const btl = await getDoc(env, "bottles", item.id);
    if (!btl || btl.fields.eventId !== b.eventId && btl.fields.eventId !== "all" || btl.fields.active !== true) return { error: "A bottle you picked isn\u2019t available any more." };
    if (typeof btl.fields.remaining === "number" && btl.fields.remaining < item.quantity) return { error: `Not enough ${btl.fields.name || "of that bottle"} left.` };
    amount += Number(btl.fields.pricePesewas || 0) * item.quantity;
    bottleItems.push({ id: item.id, name: btl.fields.name, quantity: item.quantity, unitPricePesewas: Number(btl.fields.pricePesewas || 0) });
  }
  if (!(amount > 0)) return { error: "This table isn\u2019t available any more." };
  const reference = paymentRef();
  const { split, snapshot: platformSplit } = await platformSplitFor(env);
  await setDoc(env, "pending_checkouts", reference, {
    reference,
    kind: "table",
    eventId: b.eventId,
    eventName: ev.fields.name || "",
    packageId: b.packageId,
    packageName: pkg.fields.name || "",
    packagePricePesewas: Number(pkg.fields.pricePesewas || 0),
    bottles: bottleItems,
    amountPesewas: amount,
    buyerName: name,
    buyerPhone: phone,
    buyerEmail: clean(b.email, 120),
    status: "pending",
    createdAt: now(),
    ...platformSplit ? { platformSplit } : {}
  });
  const payload = { email: payEmail(env, b.email, phone), amount, currency: "GHS", reference, callback_url: returnUrl(env), metadata: { kind: "table", eventId: b.eventId, packageId: b.packageId } };
  const p = await paystack2(env, "/transaction/initialize", { method: "POST", body: JSON.stringify(split ? { ...payload, split } : payload) });
  return { reference, authorizationUrl: p.authorization_url };
}
__name(initiateTable, "initiateTable");
async function fulfillTable(env, reference) {
  const pending = await getDoc(env, "pending_checkouts", reference);
  if (!pending) return { status: "failed", error: "Checkout not found." };
  if (pending.fields.status === "issued") return { status: "issued", orderId: pending.fields.orderId };
  if (pending.fields.status === "failed") return { status: "failed", error: pending.fields.error || "Payment failed." };
  const bad = await confirmCharge(env, pending, reference);
  if (bad) return bad;
  const P = pending.fields;
  const bottlePaths = (P.bottles || []).map((x) => `bottles/${x.id}`);
  const result = await withTransaction(env, async (tx) => {
    const got = await batchGet(env, [`pending_checkouts/${reference}`, `table_packages/${P.packageId}`, ...bottlePaths], tx);
    const fresh = foundFields(got, `/pending_checkouts/${reference}`), pkg = foundFields(got, `/table_packages/${P.packageId}`);
    if (!fresh || !pkg) throw new Error("Table checkout data disappeared.");
    if (fresh.fields.status === "issued") return { status: "issued", orderId: fresh.fields.orderId, already: true };
    const soldOut = /* @__PURE__ */ __name(async (error) => {
      await commitTx(env, [updateWrite(env, "pending_checkouts", reference, { ...fresh.fields, status: "failed", error, refundStatus: "manual_required" })], tx);
      return { status: "failed", error: "Something you picked sold out while your payment was confirming. Contact us for a refund." };
    }, "soldOut");
    if (typeof pkg.fields.remaining === "number" && pkg.fields.remaining < 1) return soldOut("table_sold_out_after_payment");
    for (const item of P.bottles || []) {
      const bt = foundFields(got, `/bottles/${item.id}`);
      if (!bt) throw new Error("Bottle disappeared.");
      if (typeof bt.fields.remaining === "number" && bt.fields.remaining < item.quantity) return soldOut("bottle_sold_out_after_payment");
    }
    const orderId = id();
    const writes = [
      updateWrite(env, "orders", orderId, {
        orderId,
        kind: "table",
        reference,
        eventId: P.eventId,
        eventName: P.eventName,
        packageId: P.packageId,
        packageName: P.packageName,
        bottles: P.bottles || [],
        amountPesewas: P.amountPesewas,
        buyerName: P.buyerName,
        buyerPhone: P.buyerPhone,
        buyerEmail: P.buyerEmail || "",
        status: "confirmed",
        createdAt: now(),
        ...fresh.fields.platformSplit ? { platformSplit: fresh.fields.platformSplit } : {}
      }),
      updateWrite(env, "pending_checkouts", reference, { ...fresh.fields, status: "issued", orderId, issuedAt: now() })
    ];
    if (typeof pkg.fields.remaining === "number") writes.push(updateWrite(env, "table_packages", P.packageId, { ...pkg.fields, remaining: pkg.fields.remaining - 1 }));
    for (const item of P.bottles || []) {
      const bt = foundFields(got, `/bottles/${item.id}`);
      if (typeof bt.fields.remaining === "number") writes.push(updateWrite(env, "bottles", item.id, { ...bt.fields, remaining: bt.fields.remaining - item.quantity }));
    }
    await commitTx(env, writes, tx);
    return { status: "issued", orderId };
  });
  if (result.status === "issued" && !result.already) {
    await sendSms(env, P.buyerPhone, `MEMORIES
Table confirmed: ${P.packageName}, ${P.eventName}.
Total paid ${money(P.amountPesewas)}. Ref ${reference}.`);
    await sendEmail(env, P.buyerEmail, "Your Memories table is confirmed", [`${P.packageName} \xB7 ${P.eventName}`, `Total paid: ${money(P.amountPesewas)}`, `Reference: ${reference}`]);
  }
  delete result.already;
  return result;
}
__name(fulfillTable, "fulfillTable");
async function startInstallment(env, b) {
  if (b?.acknowledged !== true) return { error: "Tick the box to confirm how pay in bits works." };
  const c = await ticketContext(env, b);
  if (c.error) return c;
  if (bitsClosed(c.ev.fields.date)) return { error: "Pay in bits closes when the night starts. Pay in full instead." };
  const deposit = Number(b.depositPesewas);
  if (!Number.isInteger(deposit) || deposit < 1) return { error: "Enter an amount to pay now." };
  if (deposit > c.totalPesewas) return { error: "That\u2019s more than the ticket costs." };
  let planId;
  for (let attempt = 0; attempt < 6 && !planId; attempt++) {
    const code = orderCode();
    try {
      await createDoc(env, "installment_plans", code, {
        eventId: c.ev.id,
        eventName: c.ev.fields.name || "",
        eventDate: c.ev.fields.date || "",
        ticketTypeId: c.tt.id,
        ticketTypeName: c.tt.fields.name || "Ticket",
        admits: Number(c.tt.fields.admits || 1),
        quantity: c.qty,
        totalPesewas: c.totalPesewas,
        paidPesewas: 0,
        buyerName: c.buyerName,
        firstName: firstName(c.buyerName),
        buyerPhone: c.buyerPhone,
        buyerEmail: c.buyerEmail,
        identityLine: c.identityLine,
        status: "active",
        payments: [],
        createdAt: now(),
        updatedAt: now(),
        policyVersion: BITS_POLICY_VERSION,
        acknowledgedAt: now()
      });
      planId = code;
    } catch (e) {
      if (!String(e.message).includes("ALREADY_EXISTS")) throw e;
    }
  }
  if (!planId) return { error: "Couldn\u2019t start your order right now. Try again." };
  return startInstallmentTopup(env, planId, deposit, payEmail(env, c.buyerEmail, c.buyerPhone));
}
__name(startInstallment, "startInstallment");
async function startInstallmentTopup(env, planId, amountPesewas, email) {
  const reference = paymentRef();
  const { split, snapshot: platformSplit } = await platformSplitFor(env);
  await setDoc(env, "pending_checkouts", reference, {
    reference,
    kind: "installment_topup",
    planId,
    amountPesewas,
    status: "pending",
    createdAt: now(),
    ...platformSplit ? { platformSplit } : {}
  });
  try {
    const payload = { email, amount: amountPesewas, currency: "GHS", reference, callback_url: returnUrl(env), metadata: { kind: "installment_topup", planId } };
    const p = await paystack2(env, "/transaction/initialize", { method: "POST", body: JSON.stringify(split ? { ...payload, split } : payload) });
    return { reference, authorizationUrl: p.authorization_url, planId };
  } catch (e) {
    await setDoc(env, "pending_checkouts", reference, { reference, kind: "installment_topup", planId, amountPesewas, status: "failed", error: "payment_initialization_failed", failedAt: now() });
    throw e;
  }
}
__name(startInstallmentTopup, "startInstallmentTopup");
async function topupInstallment(env, b) {
  const planId = normalizeOrderCode(b?.planId);
  if (!planId) return { error: "Enter your order code." };
  if (!returnUrl(env)) return { error: "Payments are not set up yet.", status: 503 };
  const plan = await getDoc(env, "installment_plans", planId);
  if (!plan) return { error: "We couldn\u2019t find that order." };
  if (await maybeForfeitPlan(env, plan)) return { error: "This order was forfeited because the night has passed." };
  if (plan.fields.status !== "active") return { error: plan.fields.status === "completed" ? "This order is already fully paid." : "This order is no longer active." };
  const remaining = Number(plan.fields.totalPesewas) - Number(plan.fields.paidPesewas || 0);
  const amount = Number(b.amountPesewas);
  if (!Number.isInteger(amount) || amount < 1) return { error: "Enter an amount to pay." };
  if (amount > remaining) return { error: `Your balance is ${money(remaining)}. Pay that or less.` };
  return startInstallmentTopup(env, planId, amount, payEmail(env, plan.fields.buyerEmail, plan.fields.buyerPhone));
}
__name(topupInstallment, "topupInstallment");
var bitsClosed = /* @__PURE__ */ __name((date) => {
  const t = new Date(date).getTime();
  return Number.isFinite(t) && t <= Date.now();
}, "bitsClosed");
async function maybeForfeitPlan(env, plan) {
  if (plan.fields.status !== "active") return plan.fields.status === "forfeited";
  const ev = await getDoc(env, "events", plan.fields.eventId);
  if (ev && bitsClosed(ev.fields.date)) {
    await setDoc(env, "installment_plans", plan.id, { ...plan.fields, status: "forfeited", updatedAt: now() });
    return true;
  }
  return false;
}
__name(maybeForfeitPlan, "maybeForfeitPlan");
var planSummary = /* @__PURE__ */ __name((p) => {
  const total = Number(p.fields.totalPesewas || 0), paid = Number(p.fields.paidPesewas || 0);
  return {
    planId: p.id,
    eventName: p.fields.eventName || "",
    eventDate: p.fields.eventDate || "",
    firstName: p.fields.firstName || firstName(p.fields.buyerName),
    // The balance has to be paid before this moment (the night's start), or the plan is forfeited.
    deadline: p.fields.eventDate || "",
    totalPesewas: total,
    paidPesewas: paid,
    remainingPesewas: Math.max(0, total - paid),
    status: p.fields.status,
    ticketReady: p.fields.status === "completed"
  };
}, "planSummary");
async function lookupInstallments(env, { code }) {
  const c = normalizeOrderCode(code);
  if (!c) return [];
  const p = await getDoc(env, "installment_plans", c);
  return p ? [planSummary(p)] : [];
}
__name(lookupInstallments, "lookupInstallments");
var NEUTRAL_CODES = "If that number has orders with us, we\u2019ve texted the order codes to it.";
var NEUTRAL_LINK = "If this order is yours and paid in full, we\u2019ve texted the ticket link to the number on it.";
async function textOrderCodes(env, { phone }) {
  const ph = normalizePhone(phone);
  if (!ph) return false;
  const plans = (await queryWhere(env, "installment_plans", [{ field: "buyerPhone", value: ph }])).filter((p) => ["active", "completed"].includes(p.fields.status)).slice(0, 5);
  if (!plans.length) return false;
  const lines = plans.map((p) => `${p.id}: ${p.fields.eventName || "your night"}${p.fields.status === "completed" ? " (paid)" : ` (${money(Number(p.fields.totalPesewas) - Number(p.fields.paidPesewas || 0))} left)`}`);
  return sendSms(env, ph, `MEMORIES
Your orders:
${lines.join("\n")}
Pay or check: ${siteUrl(env, "/installment.html")}`);
}
__name(textOrderCodes, "textOrderCodes");
async function resendTicketLink(env, { planId, phone }) {
  const c = normalizeOrderCode(planId), ph = normalizePhone(phone);
  if (!c || !ph) return false;
  const p = await getDoc(env, "installment_plans", c);
  if (!p || p.fields.status !== "completed" || p.fields.buyerPhone !== ph || !(p.fields.ticketIds || []).length) return false;
  const links = p.fields.ticketIds.map((t) => siteUrl(env, `/ticket.html?token=${t}`));
  return sendSms(env, ph, `MEMORIES
${p.fields.eventName || "Your night"}.
Your ticket${links.length > 1 ? "s" : ""}: ${links.join(" ")}`);
}
__name(resendTicketLink, "resendTicketLink");
async function fulfillInstallment(env, reference) {
  const pending = await getDoc(env, "pending_checkouts", reference);
  if (!pending) return { status: "failed", error: "Checkout not found." };
  if (pending.fields.status === "issued") return { status: "issued", kind: "installment", planId: pending.fields.planId, ticketIds: pending.fields.ticketIds || [], planComplete: pending.fields.planComplete === true };
  if (pending.fields.status === "failed") return { status: "failed", error: pending.fields.error || "Payment was not successful." };
  const bad = await confirmCharge(env, pending, reference);
  if (bad) return bad;
  const planId = pending.fields.planId;
  const result = await withTransaction(env, async (tx) => {
    const got = await batchGet(env, [`pending_checkouts/${reference}`, `installment_plans/${planId}`], tx);
    const fresh = foundFields(got, `/pending_checkouts/${reference}`), plan = foundFields(got, `/installment_plans/${planId}`);
    if (!fresh || !plan) throw new Error("Installment plan data disappeared.");
    const P = plan.fields;
    if (fresh.fields.status === "issued") return { status: "issued", kind: "installment", planId, ticketIds: fresh.fields.ticketIds || [], planComplete: fresh.fields.planComplete === true, already: true };
    const payment = { reference, amountPesewas: fresh.fields.amountPesewas, paidAt: now(), ...fresh.fields.platformSplit ? { platformSplit: fresh.fields.platformSplit } : {} };
    if (P.status === "forfeited") {
      await commitTx(env, [updateWrite(env, "pending_checkouts", reference, { ...fresh.fields, status: "failed", error: "plan_forfeited", refundStatus: "manual_required" })], tx);
      return { status: "failed", error: "This order was forfeited. Contact us." };
    }
    if (P.status === "completed") {
      await commitTx(env, [
        updateWrite(env, "pending_checkouts", reference, { ...fresh.fields, status: "issued", planComplete: false, overpaid: true, ticketIds: P.ticketIds || [], orderId: P.orderId, issuedAt: now() }),
        updateWrite(env, "installment_plans", planId, { ...P, paidPesewas: Number(P.paidPesewas || 0) + Number(fresh.fields.amountPesewas || 0), overpaidPesewas: Number(P.overpaidPesewas || 0) + Number(fresh.fields.amountPesewas || 0), payments: [...P.payments || [], { ...payment, note: "overpayment_after_completion" }], updatedAt: now() })
      ], tx);
      return { status: "issued", kind: "installment", planId, ticketIds: P.ticketIds || [], planComplete: false, overpaid: true };
    }
    const paidPesewas = Number(P.paidPesewas || 0) + Number(fresh.fields.amountPesewas || 0);
    const payments = [...P.payments || [], payment];
    const writes = [];
    let planComplete = false, tokens = [], orderId = null;
    if (paidPesewas >= P.totalPesewas) {
      const tt = foundFields(await batchGet(env, [`ticket_types/${P.ticketTypeId}`], tx), `/ticket_types/${P.ticketTypeId}`);
      const remaining = tt && typeof tt.fields.remaining === "number" ? tt.fields.remaining : null;
      if (remaining !== null && remaining < P.quantity) {
        await commitTx(env, [
          updateWrite(env, "pending_checkouts", reference, { ...fresh.fields, status: "failed", error: "sold_out_after_payment", refundStatus: "manual_required" }),
          updateWrite(env, "installment_plans", planId, { ...P, paidPesewas, payments, status: "sold_out", updatedAt: now() })
        ], tx);
        return { status: "failed", error: "Tickets sold out before your last payment landed. Contact us for a refund." };
      }
      planComplete = true;
      orderId = id();
      const raffle = await openRaffleForEvent(env, tx, P.eventId);
      tokens = Array.from({ length: P.quantity }, ticketToken);
      writes.push(
        ...ticketWrites(env, { tokens, holder: P.buyerName, phone: P.buyerPhone, eventId: P.eventId, eventName: P.eventName, typeName: P.ticketTypeName, admits: P.admits || 1, identityLine: P.identityLine || "", reference, inDrawToken: raffle ? tokens[0] : null, extra: { planId } }),
        ...raffleSpotWrites(env, raffle, P.eventId, tokens[0], orderId),
        updateWrite(env, "orders", orderId, {
          orderId,
          kind: "ticket",
          reference,
          eventId: P.eventId,
          eventName: P.eventName,
          ticketTypeId: P.ticketTypeId,
          ticketTypeName: P.ticketTypeName,
          quantity: P.quantity,
          amountPesewas: P.totalPesewas,
          buyerName: P.buyerName,
          buyerPhone: P.buyerPhone,
          buyerEmail: P.buyerEmail || "",
          status: "confirmed",
          inDraw: !!raffle,
          paidInInstallments: true,
          planId,
          ticketIds: tokens,
          createdAt: now(),
          // The final top-up's split snapshot: correct because EvolveIT got their share per top-up,
          // and the amount here equals what all those shares were computed against.
          ...fresh.fields.platformSplit ? { platformSplit: fresh.fields.platformSplit } : {}
        }),
        updateWrite(env, "installment_plans", planId, { ...P, paidPesewas, payments, status: "completed", ticketIds: tokens, orderId, completedAt: now(), updatedAt: now() })
      );
      if (remaining !== null) writes.push(updateWrite(env, "ticket_types", P.ticketTypeId, { ...tt.fields, remaining: remaining - P.quantity }));
    } else {
      writes.push(updateWrite(env, "installment_plans", planId, { ...P, paidPesewas, payments, updatedAt: now() }));
    }
    writes.push(updateWrite(env, "pending_checkouts", reference, { ...fresh.fields, status: "issued", planComplete, ticketIds: tokens, orderId, issuedAt: now() }));
    await commitTx(env, writes, tx);
    return { status: "issued", kind: "installment", planId, ticketIds: tokens, planComplete, orderId, plan: P, paidPesewas, received: fresh.fields.amountPesewas };
  });
  if (result.status === "issued" && !result.already && result.plan) {
    const P = result.plan;
    if (result.planComplete) {
      const link = siteUrl(env, `/ticket.html?token=${result.ticketIds[0]}`);
      await sendSms(env, P.buyerPhone, `MEMORIES
Paid in full. Order ${planId}.
You're in for ${P.eventName}: ${link}`);
      await sendEmail(env, P.buyerEmail, "Your Memories ticket", [`Paid in full. Order ${planId}.`, `You're in for ${P.eventName}.`, `Your ticket: ${link}`]);
    } else {
      const balance = P.totalPesewas - result.paidPesewas;
      await sendSms(env, P.buyerPhone, balanceMessage(env, planId, result.received, balance, P));
      await sendEmail(env, P.buyerEmail, `Memories: ${money(balance)} left to pay`, balanceEmailLines(env, planId, result.received, balance, P));
    }
  }
  delete result.already;
  delete result.plan;
  delete result.received;
  delete result.paidPesewas;
  return result;
}
__name(fulfillInstallment, "fulfillInstallment");
var smsDay = /* @__PURE__ */ __name((d) => formatAccra(d, { weekday: "short", day: "2-digit", month: "short" }).replace(/,/g, ""), "smsDay");
var smsWhen = /* @__PURE__ */ __name((d) => {
  const day = smsDay(d);
  const t = formatAccra(d, { hour: "numeric", minute: "2-digit", hour12: true }).replace(":00", "").replace(/\s/g, "").toUpperCase();
  return day && t ? `${day}, ${t}` : day;
}, "smsWhen");
var balanceMessage = /* @__PURE__ */ __name((env, planId, received, balance, P = null) => {
  const link = siteUrl(env, `/installment.html?code=${planId}`);
  if (!P) return `MEMORIES
${received ? `${money(received)} received. ` : ""}Balance: ${money(balance)}.
Order ${planId}.
Pay the rest: ${link}`;
  const name = String(P.eventName || "").slice(0, 30), day = smsDay(P.eventDate), by = smsWhen(P.eventDate);
  return [
    "MEMORIES",
    `${received ? `${money(received)} received` : "Your order"}${name ? ` for ${name}${day ? `, ${day}` : ""}` : ""}.`,
    `Paid ${money(Number(P.totalPesewas) - balance)} of ${money(P.totalPesewas)}. Left: ${money(balance)}.`,
    by ? `Pay the rest before ${by} or the order is forfeited.` : "Pay the rest before the night starts or the order is forfeited.",
    `Order ${planId}`,
    `Pay: ${link}`
  ].join("\n");
}, "balanceMessage");
var balanceEmailLines = /* @__PURE__ */ __name((env, planId, received, balance, P) => {
  const by = smsWhen(P.eventDate);
  return [
    `${money(received)} received for ${P.eventName || "your Memories night"}${P.eventDate ? ` (${smsDay(P.eventDate)})` : ""}.`,
    `${P.quantity || 1} \xD7 ${P.ticketTypeName || "Ticket"}. Paid ${money(Number(P.totalPesewas) - balance)} of ${money(P.totalPesewas)}. Left to pay: ${money(balance)}.`,
    `Pay the rest before ${by || "the night starts"}. If it isn't fully paid by then, the order is forfeited and what you've paid isn't refunded.`,
    `Your order code: ${planId}. Anyone can pay with it.`,
    `Pay the rest: ${siteUrl(env, `/installment.html?code=${planId}`)}`,
    "Your ticket comes by text the moment it is fully paid."
  ];
}, "balanceEmailLines");
async function forfeitStalePlans(env) {
  const active = await queryWhere(env, "installment_plans", [{ field: "status", value: "active" }]);
  let forfeited = 0;
  for (const plan of active) if (await maybeForfeitPlan(env, plan)) forfeited++;
  return { checked: active.length, forfeited };
}
__name(forfeitStalePlans, "forfeitStalePlans");
async function fulfill(env, reference) {
  const p = await getDoc(env, "pending_checkouts", reference);
  if (!p) return { status: "failed", error: "Checkout not found." };
  if (p.fields.kind === "table") return { kind: "table", ...await fulfillTable(env, reference) };
  if (p.fields.kind === "installment_topup") return fulfillInstallment(env, reference);
  return { kind: "ticket", ...await fulfillTicket(env, reference) };
}
__name(fulfill, "fulfill");
async function checkoutStatus(env, reference) {
  const d = await getDoc(env, "pending_checkouts", reference);
  if (!d) return null;
  const f = d.fields;
  const out = { status: f.status, kind: f.kind || "ticket", eventId: f.eventId || "", eventName: f.eventName || "", packageName: f.packageName || "", amountPesewas: f.amountPesewas, bottles: f.bottles || [], tickets: (f.ticketIds || []).map((token) => ({ token })), error: f.status === "failed" ? f.error : void 0 };
  if (f.kind === "installment_topup" && f.planId) {
    const plan = await getDoc(env, "installment_plans", f.planId);
    if (plan) {
      const P = plan.fields;
      Object.assign(out, {
        eventId: P.eventId,
        planId: f.planId,
        planStatus: P.status,
        paidPesewas: P.paidPesewas,
        totalPesewas: P.totalPesewas,
        eventName: P.eventName,
        planComplete: f.planComplete === true || P.status === "completed",
        // What the receipt page needs to tell the guest how to keep paying. Never the full phone.
        eventDate: P.eventDate || "",
        deadline: P.eventDate || "",
        ticketTypeName: P.ticketTypeName || "",
        quantity: Number(P.quantity || 1),
        firstName: P.firstName || firstName(P.buyerName),
        phoneHint: maskPhone(P.buyerPhone),
        reference
      });
    }
  }
  return out;
}
__name(checkoutStatus, "checkoutStatus");

// src/door.js
var tokenFrom = /* @__PURE__ */ __name((raw) => {
  const s = String(raw || "").trim();
  try {
    const u = new URL(s);
    return u.searchParams.get("token") || "";
  } catch {
    return s;
  }
}, "tokenFrom");
async function checkin(env, rawToken, user, { eventId, code } = {}) {
  if (!eventId) return { valid: false, code: "no_event", message: "PICK TONIGHT\u2019S NIGHT FIRST" };
  let token = tokenFrom(rawToken);
  if (!token && code) {
    const hit = (await queryWhere(env, "tickets", [{ field: "eventId", value: String(eventId) }])).find((t) => t.fields.displayCode === String(code).toUpperCase());
    if (!hit) return { valid: false, code: "invalid", message: "TICKET NOT VALID" };
    token = hit.id;
  }
  if (!/^[0-9A-Za-z_-]{1,100}$/.test(token)) return { valid: false, code: "invalid", message: "TICKET NOT VALID" };
  let organiserEvents = null;
  if (!requireRole(user, ["superAdmin", "manager", "eventManager", "doorStaff"])) {
    if (user?.role !== "organiser") return { valid: false, code: "forbidden", message: "NOT ALLOWED" };
    organiserEvents = true;
  }
  return withTransaction(env, async (tx) => {
    const f = (await batchGet(env, [`tickets/${token}`], tx)).find((x) => x.found)?.found;
    if (!f) return { valid: false, code: "invalid", message: "TICKET NOT VALID" };
    const t = parseFields(f.fields);
    const summary = { firstName: firstName(t.customerName), eventName: t.eventName, type: t.type, admits: Number(t.admitCount || 1), displayCode: t.displayCode, comp: t.comp === true };
    if (organiserEvents) {
      const ev = await getDoc(env, "events", t.eventId);
      if (!ev || ev.fields.organiserId !== uidOf(user)) return { valid: false, code: "forbidden", message: "NOT YOUR NIGHT", ticket: { eventName: t.eventName } };
    }
    if (eventId && t.eventId !== eventId) return { valid: false, code: "wrong_night", message: "WRONG NIGHT", ticket: summary };
    if (t.revoked || t.cancelled) return { valid: false, code: "cancelled", message: "TICKET CANCELLED", ticket: summary };
    if (t.status === "used") return { valid: false, code: "used", message: "ALREADY CHECKED IN", ticket: { ...summary, checkedInAt: t.checkedInAt } };
    const when = now();
    await commitTx(env, [
      updateWrite(env, "tickets", token, { ...t, status: "used", checkedInAt: when, checkedInBy: uidOf(user) }),
      updateWrite(env, "checkins", id(), { ticketId: token, eventId: t.eventId, admits: summary.admits, checkedInAt: when, checkedInBy: uidOf(user) })
    ], tx);
    return { valid: true, code: "ok", message: "ENTRY CONFIRMED", ticket: summary };
  });
}
__name(checkin, "checkin");
async function verifyTicket(env, rawToken) {
  const token = tokenFrom(rawToken);
  const d = /^[0-9A-Za-z_-]{1,100}$/.test(token) ? await getDoc(env, "tickets", token) : null;
  if (!d) return { valid: false, code: "invalid", message: "THIS TICKET ISN\u2019T VALID." };
  const t = d.fields;
  if (t.revoked || t.cancelled) return { valid: false, code: "cancelled", message: "THIS TICKET WAS CANCELLED." };
  if (t.status === "used") return { valid: false, code: "used", message: "THIS TICKET HAS ALREADY BEEN USED.", ticket: { eventName: t.eventName, firstName: firstName(t.customerName), displayCode: t.displayCode } };
  return { valid: true, code: "ok", message: "VALID TICKET", ticket: { eventName: t.eventName, firstName: firstName(t.customerName), displayCode: t.displayCode, admits: Number(t.admitCount || 1) } };
}
__name(verifyTicket, "verifyTicket");
async function doorNight(env, user, eventId) {
  const ev = eventId ? await getDoc(env, "events", String(eventId)) : null;
  if (!ev) return null;
  if (!requireRole(user, ["superAdmin", "manager", "eventManager", "doorStaff"]) && ev.fields.organiserId !== uidOf(user)) return null;
  return ev;
}
__name(doorNight, "doorNight");
async function doorSummary(env, user, eventId) {
  const ev = await doorNight(env, user, eventId);
  if (!ev) return { error: "Not your night.", status: 403 };
  const tickets = (await queryWhere(env, "tickets", [{ field: "eventId", value: ev.id }])).map((t) => t.fields).filter((t) => !t.revoked && !t.cancelled);
  const heads = /* @__PURE__ */ __name((list) => list.reduce((n, t) => n + Number(t.admitCount || 1), 0), "heads");
  return { eventId: ev.id, admitted: heads(tickets.filter((t) => t.status === "used")), expected: heads(tickets), comps: heads(tickets.filter((t) => t.comp === true)), tickets: tickets.length };
}
__name(doorSummary, "doorSummary");
async function doorSearch(env, user, eventId, q) {
  const ev = await doorNight(env, user, eventId);
  if (!ev) return { error: "Not your night.", status: 403 };
  const s = String(q || "").trim().toLowerCase();
  if (s.length < 2) return { results: [] };
  const code = s.replace(/^mem-?/, "");
  const results = (await queryWhere(env, "tickets", [{ field: "eventId", value: ev.id }])).map((t) => t.fields).filter((t) => firstName(t.customerName).toLowerCase().startsWith(s) || String(t.customerName || "").toLowerCase().includes(s) || code.length >= 3 && String(t.displayCode || "").toLowerCase().replace(/^mem-/, "").startsWith(code) || /^\d{4}$/.test(s) && t.phoneLast4 === s).slice(0, 20).map((t) => ({ code: t.displayCode, firstName: firstName(t.customerName), phoneLast4: t.phoneLast4 || "", type: t.type || "", admits: Number(t.admitCount || 1), status: t.revoked || t.cancelled ? "cancelled" : t.status, comp: t.comp === true }));
  return { results };
}
__name(doorSearch, "doorSearch");

// src/admin.js
var FORBIDDEN = { error: "Forbidden.", status: 403 };
var audit = /* @__PURE__ */ __name((env, user, action, data) => setDoc(env, "audit_logs", id(), { action, actorUid: uidOf(user), ...data, timestamp: now() }), "audit");
var httpsUrl = /* @__PURE__ */ __name((s, env) => {
  const v = clean(s, 500);
  return !v || (env?.DEV_ALLOW_HTTP_ASSETS ? /^https?:\/\// : /^https:\/\//).test(v) ? v : null;
}, "httpsUrl");
var ownImage = /* @__PURE__ */ __name((s, env, previous = "") => {
  const v = clean(s, 1e3);
  if (!v || v === previous) return v;
  if (env?.DEV_ALLOW_HTTP_ASSETS) return /^https?:\/\//.test(v) ? v : null;
  const project = env?.FIREBASE_PROJECT_ID;
  const buckets2 = [env?.FIREBASE_STORAGE_BUCKET, `${project}.firebasestorage.app`, `${project}.appspot.com`].filter(Boolean);
  if (buckets2.some((bk) => v.startsWith(`https://firebasestorage.googleapis.com/v0/b/${bk}/o/event-art%2F`))) return v;
  if (/^https:\/\/res\.cloudinary\.com\/[a-z0-9]+\/image\/upload\//.test(v)) return v;
  if (/^https:\/\/res\.cloudinary\.com\/[a-z0-9]+\/video\/upload\//.test(v)) return v;
  return null;
}, "ownImage");
var intOrNull = /* @__PURE__ */ __name((v) => v === null || v === "" || v === void 0 ? null : Number(v), "intOrNull");
var DEFAULT_TABLE_PACKAGES = [
  { name: "Table", pricePesewas: 2e5, sortOrder: 1 },
  { name: "Floor Table", pricePesewas: 35e4, sortOrder: 2 },
  { name: "Birthday Table", pricePesewas: 45e4, sortOrder: 3 }
];
async function adminOverview(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const [events, orders, checkins, requests, plans] = await Promise.all([listDocs(env, "events"), listDocs(env, "orders"), listDocs(env, "checkins"), queryWhere(env, "private_event_requests", [{ field: "status", value: "NEW" }]), queryWhere(env, "installment_plans", [{ field: "status", value: "active" }])]);
  const upcoming = events.filter((e) => e.fields.active !== false && !isOver(e.fields)).sort((a, b) => new Date(a.fields.date) - new Date(b.fields.date));
  const confirmed = orders.filter((o) => o.fields.status === "confirmed");
  const nights = upcoming.slice(0, 6).map((e) => {
    const mine = confirmed.filter((o) => o.fields.eventId === e.id);
    return {
      id: e.id,
      name: e.fields.name,
      date: e.fields.date,
      visibility: e.fields.visibility,
      tickets: mine.filter((o) => o.fields.kind === "ticket").reduce((s, o) => s + Number(o.fields.quantity || 0), 0),
      comps: mine.filter((o) => o.fields.kind === "comp").reduce((s, o) => s + Number(o.fields.quantity || 1), 0),
      tables: mine.filter((o) => o.fields.kind === "table").length,
      revenuePesewas: mine.reduce((s, o) => s + Number(o.fields.amountPesewas || 0), 0),
      checkins: checkins.filter((c) => c.fields.eventId === e.id).length
    };
  });
  return {
    nights,
    newRequests: requests.length,
    activePlans: plans.length,
    owingPesewas: plans.reduce((s, p) => s + Math.max(0, Number(p.fields.totalPesewas) - Number(p.fields.paidPesewas || 0)), 0),
    revenuePesewas: confirmed.reduce((s, o) => s + Number(o.fields.amountPesewas || 0), 0)
  };
}
__name(adminOverview, "adminOverview");
async function listEvents(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const events = (await listDocs(env, "events")).map((x) => ({ id: x.id, ...x.fields })).sort((a, b) => new Date(b.date) - new Date(a.date));
  return { events };
}
__name(listEvents, "listEvents");
async function eventDetail(env, eventId, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const e = await getDoc(env, "events", eventId);
  if (!e) return { error: "Night not found.", status: 404 };
  const [tickets, tables, bottles, raffles, entries] = await Promise.all(["ticket_types", "table_packages", "bottles", "raffles"].map((c) => queryWhere(env, c, [{ field: "eventId", value: eventId }])).concat(queryWhere(env, "raffle_entries", [{ field: "eventId", value: eventId }])));
  const rows = /* @__PURE__ */ __name((xs) => xs.map((x) => ({ id: x.id, ...x.fields })).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.pricePesewas - b.pricePesewas), "rows");
  const raffle = raffles[0] ? { id: raffles[0].id, ...raffles[0].fields, entryCount: entries.length } : null;
  return { event: { id: e.id, ...e.fields, autoStyle: await autoStyleFor(env, e.id) }, ticketTypes: rows(tickets), tablePackages: rows(tables), bottles: rows(bottles), raffle };
}
__name(eventDetail, "eventDetail");
async function upsertEvent(env, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const name = clean(b?.name, 80);
  const date = b?.date && !isNaN(new Date(b.date)) ? new Date(b.date).toISOString() : null;
  if (!name) return { error: "Give the night a name." };
  if (!date) return { error: "Set the date and start time." };
  const lines = (Array.isArray(b.ticketLines) ? b.ticketLines : []).map((l) => clean(l, 48)).filter(Boolean);
  if (lines.length > 12) return { error: "Keep it to 12 lines or fewer." };
  if (new Set(lines.map((l) => l.toUpperCase())).size !== lines.length) return { error: "Two of the lines are the same." };
  const eventId = b.id ? String(b.id) : id();
  const existing = b.id ? await getDoc(env, "events", eventId) : null;
  if (b.id && !existing) return { error: "Night not found.", status: 404 };
  const organiserId = clean(b.organiserId, 128) || null;
  if (organiserId && organiserId !== existing?.fields?.organiserId) {
    const acct = await getDoc(env, "users", organiserId);
    if (acct?.fields?.role !== "organiser") return { error: "Pick an organiser from the list (give them the Organiser role under Staff first)." };
  }
  const artwork = ownImage(b.artwork, env, existing?.fields?.artwork), heroImage = ownImage(b.heroImage, env, existing?.fields?.heroImage), heroVideo = ownImage(b.heroVideo, env, existing?.fields?.heroVideo);
  if (artwork === null || heroImage === null || heroVideo === null) return { error: "Upload images here in the control room (links to other sites aren\u2019t allowed)." };
  const data = {
    name,
    date,
    doors: clean(b.doors, 40),
    venue: clean(b.venue, 120),
    description: clean(b.description, 240),
    artwork,
    heroImage,
    heroVideo,
    ticketLines: lines,
    ticketStyle: TICKET_STYLES.includes(b.ticketStyle) ? b.ticketStyle : "auto",
    ticketColors: cleanTicketColors(b.ticketColors) || existing?.fields?.ticketColors || null,
    visibility: b.visibility === "public" ? "public" : "private",
    active: b.active !== false,
    soldOut: b.soldOut === true,
    featured: b.featured === true,
    organiserId,
    updatedAt: now(),
    createdAt: existing?.fields?.createdAt || now()
  };
  await setDoc(env, "events", eventId, { ...existing?.fields || {}, ...data });
  if (!existing) {
    for (const p of DEFAULT_TABLE_PACKAGES) await setDoc(env, "table_packages", id(), { eventId, ...p, capacity: 0, remaining: null, active: true, description: "", createdAt: now() });
  }
  await audit(env, user, existing ? "EVENT_UPDATED" : "EVENT_CREATED", { eventId, name });
  return { eventId };
}
__name(upsertEvent, "upsertEvent");
async function deleteEvent(env, eventId, user) {
  if (!requireRole(user, ["superAdmin"])) return FORBIDDEN;
  const sold = await queryWhere(env, "orders", [{ field: "eventId", value: eventId }], { limit: 1 });
  if (sold.length) return { error: "This night has sales. Switch it off instead of deleting it." };
  for (const col of ["ticket_types", "table_packages", "bottles", "raffles"]) for (const d of await queryWhere(env, col, [{ field: "eventId", value: eventId }])) await deleteDoc(env, col, d.id);
  await deleteDoc(env, "events", eventId);
  await audit(env, user, "EVENT_DELETED", { eventId });
  return {};
}
__name(deleteEvent, "deleteEvent");
var CATALOG = {
  ticket_types: { fields: ["name", "pricePesewas", "admits", "remaining", "active", "description", "sortOrder"], minPrice: 1 },
  table_packages: { fields: ["name", "pricePesewas", "capacity", "remaining", "active", "description", "sortOrder"], minPrice: 1 },
  bottles: { fields: ["name", "pricePesewas", "category", "remaining", "active"], minPrice: 1 }
};
async function upsertCatalog(env, col, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const spec = CATALOG[col];
  if (!spec) return { error: "Unknown collection." };
  const eventId = col === "bottles" && (!b?.eventId || b.eventId === "all") ? "all" : String(b?.eventId || "");
  if (!eventId) return { error: "Pick a night." };
  if (eventId !== "all" && !await getDoc(env, "events", eventId)) return { error: "Night not found.", status: 404 };
  const docId = b.id ? String(b.id) : id();
  const existing = b.id ? await getDoc(env, col, docId) : null;
  if (b.id && (!existing || existing.fields.eventId !== eventId)) return { error: "Item not found.", status: 404 };
  const d = { ...existing?.fields || {} };
  if (b.name !== void 0) d.name = clean(b.name, 60);
  if (!d.name) return { error: "Add a name." };
  if (b.pricePesewas !== void 0) d.pricePesewas = Number(b.pricePesewas);
  if (!Number.isInteger(d.pricePesewas) || d.pricePesewas < spec.minPrice) return { error: "Add a price above zero." };
  if (spec.fields.includes("admits")) {
    d.admits = b.admits === void 0 ? d.admits || 1 : Number(b.admits);
    if (!Number.isInteger(d.admits) || d.admits < 1 || d.admits > 20) return { error: "Admits must be 1 to 20." };
  }
  if (spec.fields.includes("capacity") && b.capacity !== void 0) {
    d.capacity = Number(b.capacity || 0);
    if (!Number.isInteger(d.capacity) || d.capacity < 0) return { error: "Capacity must be a whole number." };
  }
  if (b.remaining !== void 0) {
    d.remaining = intOrNull(b.remaining);
    if (d.remaining !== null && (!Number.isInteger(d.remaining) || d.remaining < 0)) return { error: "Quantity left must be a whole number, or blank for no limit." };
  }
  if (b.active !== void 0) d.active = b.active === true;
  if (b.description !== void 0) d.description = clean(b.description, 200);
  if (b.category !== void 0) d.category = clean(b.category, 40);
  if (b.sortOrder !== void 0) d.sortOrder = Number(b.sortOrder) || 0;
  d.eventId = eventId;
  d.updatedAt = now();
  d.createdAt = existing?.fields?.createdAt || now();
  if (d.active === void 0) d.active = true;
  await setDoc(env, col, docId, d);
  await audit(env, user, "CATALOG_UPSERT", { collection: col, id: docId, eventId, name: d.name, pricePesewas: d.pricePesewas });
  return { id: docId };
}
__name(upsertCatalog, "upsertCatalog");
async function deleteCatalog(env, col, docId, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  if (!CATALOG[col]) return { error: "Unknown collection." };
  await deleteDoc(env, col, docId);
  await audit(env, user, "CATALOG_DELETE", { collection: col, id: docId });
  return {};
}
__name(deleteCatalog, "deleteCatalog");
async function listBottles(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  return { bottles: (await queryWhere(env, "bottles", [{ field: "eventId", value: "all" }])).map((x) => ({ id: x.id, ...x.fields })).sort((a, b) => String(a.category).localeCompare(String(b.category)) || a.pricePesewas - b.pricePesewas) };
}
__name(listBottles, "listBottles");
async function listOrders(env, q, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const filters = [];
  if (q.eventId) filters.push({ field: "eventId", value: q.eventId });
  if (q.kind) filters.push({ field: "kind", value: q.kind });
  const docs = filters.length ? await queryWhere(env, "orders", filters) : await listDocs(env, "orders");
  return { orders: docs.map((x) => {
    const o = { id: x.id, ...x.fields };
    delete o.ticketIds;
    return o;
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) };
}
__name(listOrders, "listOrders");
async function issueComp(env, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const name = clean(b?.name, 80), phone = b?.phone ? normalizePhone(b.phone) : "";
  const admits = Number(b?.admits || 1);
  if (!b?.eventId) return { error: "Pick a night." };
  if (!name) return { error: "Who is the comp for?" };
  if (phone === null) return { error: "That phone number doesn\u2019t look right." };
  if (!Number.isInteger(admits) || admits < 1 || admits > 10) return { error: "A comp admits 1 to 10 people." };
  const ev = await getDoc(env, "events", b.eventId);
  if (!ev) return { error: "Night not found.", status: 404 };
  const token = ticketToken(), orderId = id(), issuedBy = uidOf(user);
  const wantDraw = b.inDraw === true;
  const res = await withTransaction(env, async (tx) => {
    const raffle = wantDraw ? await openRaffleForEvent(env, tx, b.eventId) : null;
    await commitTx(env, [
      updateWrite(env, "tickets", token, { customerName: name, phone: phone || "", phoneLast4: (phone || "").slice(-4), type: "Comp", admitCount: admits, eventId: b.eventId, eventName: ev.fields.name || "", identityLine: "", reference: orderId, displayCode: displayCode(token), status: "valid", revoked: false, cancelled: false, comp: true, issuedBy, compNote: clean(b.note, 200), inDraw: !!raffle, issuedAt: now() }),
      updateWrite(env, "orders", orderId, { orderId, kind: "comp", eventId: b.eventId, eventName: ev.fields.name || "", quantity: 1, admits, amountPesewas: 0, buyerName: name, buyerPhone: phone || "", status: "confirmed", issuedBy, note: clean(b.note, 200), inDraw: !!raffle, ticketIds: [token], createdAt: now() }),
      ...raffleSpotWrites(env, raffle, b.eventId, token, orderId)
    ], tx);
    return { inDraw: !!raffle };
  });
  await audit(env, user, "COMP_ISSUED", { eventId: b.eventId, orderId, admits, inDraw: res.inDraw, name });
  const link = siteUrl(env, `/ticket.html?token=${token}`);
  const texted = phone ? await sendSms(env, phone, `MEMORIES
${firstName(name)}, you're on the list for ${ev.fields.name}.
Your ticket: ${link}`) : false;
  return { token, link, inDraw: res.inDraw, drawRequestedButFull: wantDraw && !res.inDraw, texted };
}
__name(issueComp, "issueComp");
async function listRequests(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  return { requests: (await listDocs(env, "private_event_requests")).map((x) => ({ id: x.id, ...x.fields })).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) };
}
__name(listRequests, "listRequests");
async function updatePrivateRequest(env, requestId, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const existing = await getDoc(env, "private_event_requests", requestId);
  if (!existing) return { error: "Request not found.", status: 404 };
  const status = ["NEW", "ACCEPTED", "DECLINED"].includes(b?.status) ? b.status : existing.fields.status;
  const note = b?.note !== void 0 ? clean(b.note, 2e3) : existing.fields.note || "";
  if (status === "ACCEPTED" && existing.fields.status !== "ACCEPTED") {
    const clash = (await queryWhere(env, "private_event_requests", [{ field: "status", value: "ACCEPTED" }])).find((r) => r.fields.date === existing.fields.date && r.id !== requestId);
    const events = (await listDocs(env, "events")).find((e) => e.fields.active !== false && dateKey(e.fields.date) === existing.fields.date);
    if (clash) return { error: "Another event is already held on that date." };
    if (events) return { error: `${events.fields.name} is already on that date.` };
  }
  await setDoc(env, "private_event_requests", requestId, { ...existing.fields, status, note, updatedAt: now(), updatedBy: uidOf(user) });
  await audit(env, user, "PRIVATE_REQUEST_UPDATED", { requestId, status, from: existing.fields.status });
  if (status !== existing.fields.status && (status === "ACCEPTED" || status === "DECLINED")) {
    const msg = status === "ACCEPTED" ? `MEMORIES
Your event on ${existing.fields.date} is held. We'll call you to lock in the details.` : `MEMORIES
We can't hold ${existing.fields.date} for your event. Reply or call us and we'll find another date.`;
    await sendSms(env, existing.fields.phone, msg);
    await sendEmail(env, existing.fields.email, status === "ACCEPTED" ? "Your Memories event date is held" : "About your Memories event booking", msg.split("\n").slice(1));
  }
  return {};
}
__name(updatePrivateRequest, "updatePrivateRequest");
async function adminInstallments(env, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const plans = await listDocs(env, "installment_plans");
  return { plans: plans.map((p) => {
    const x = { id: p.id, ...p.fields };
    delete x.ticketIds;
    return x;
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) };
}
__name(adminInstallments, "adminInstallments");
async function listRefunds(env, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const [flagged, plans] = await Promise.all([
    queryWhere(env, "pending_checkouts", [{ field: "refundStatus", value: "manual_required" }]),
    listDocs(env, "installment_plans")
  ]);
  const soldOutPlans = new Set(plans.filter((p) => p.fields.status === "sold_out").map((p) => p.id));
  const who = /* @__PURE__ */ __name((f) => ({ buyerName: f.buyerName || f.name || "", buyerPhone: f.buyerPhone || f.phone || "", eventName: f.eventName || "" }), "who");
  const refunds = [
    ...flagged.filter((c) => !(c.fields.kind === "installment_topup" && soldOutPlans.has(c.fields.planId))).map((c) => ({ source: "checkout", id: c.id, reason: c.fields.error || "refund_required", amountPesewas: Number(c.fields.amountPesewas || 0), ...who(c.fields), planId: c.fields.planId || "", at: c.fields.createdAt || "" })),
    ...plans.filter((p) => p.fields.status === "sold_out" && p.fields.refundStatus !== "refunded").map((p) => ({ source: "plan", id: p.id, reason: "sold_out_after_payment", amountPesewas: Number(p.fields.paidPesewas || 0), ...who(p.fields), planId: p.id, at: p.fields.updatedAt || "" })),
    ...plans.filter((p) => Number(p.fields.overpaidPesewas || 0) > 0 && p.fields.overpayRefundStatus !== "refunded").map((p) => ({ source: "overpay", id: p.id, reason: "overpaid", amountPesewas: Number(p.fields.overpaidPesewas), ...who(p.fields), planId: p.id, at: p.fields.updatedAt || "" }))
  ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return { refunds, totalPesewas: refunds.reduce((n, r) => n + r.amountPesewas, 0) };
}
__name(listRefunds, "listRefunds");
async function markRefunded(env, b, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const note = clean(b?.note, 300), source = b?.source, rid = String(b?.id || "");
  if (!note) return { error: "Add a note: how it was refunded (e.g. Paystack refund ref)." };
  const col = source === "checkout" ? "pending_checkouts" : ["plan", "overpay"].includes(source) ? "installment_plans" : null;
  if (!col || !rid) return { error: "Unknown refund." };
  const doc = await getDoc(env, col, rid);
  if (!doc) return { error: "Unknown refund.", status: 404 };
  const stamp = { refundedAt: now(), refundedBy: uidOf(user), refundNote: note };
  if (source === "checkout") {
    if (doc.fields.refundStatus !== "manual_required") return { error: "Already marked refunded." };
    await setDoc(env, col, rid, { ...doc.fields, refundStatus: "refunded", ...stamp });
  } else if (source === "plan") {
    if (doc.fields.status !== "sold_out" || doc.fields.refundStatus === "refunded") return { error: "Already marked refunded." };
    await setDoc(env, col, rid, { ...doc.fields, refundStatus: "refunded", ...stamp });
  } else {
    if (!(Number(doc.fields.overpaidPesewas) > 0) || doc.fields.overpayRefundStatus === "refunded") return { error: "Already marked refunded." };
    await setDoc(env, col, rid, { ...doc.fields, overpayRefundStatus: "refunded", overpayRefundedAt: stamp.refundedAt, overpayRefundedBy: stamp.refundedBy, overpayRefundNote: note });
  }
  await audit(env, user, "REFUND_MARKED", { source, id: rid, note });
  return { ok: true };
}
__name(markRefunded, "markRefunded");
async function resendInstallmentSms(env, b, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const plan = await getDoc(env, "installment_plans", String(b?.planId || ""));
  if (!plan) return { error: "Order not found.", status: 404 };
  const P = plan.fields;
  const msg = P.status === "completed" ? `MEMORIES
Order ${plan.id} is paid in full. Your ticket: ${siteUrl(env, `/ticket.html?token=${(P.ticketIds || [])[0]}`)}` : balanceMessage(env, plan.id, 0, Number(P.totalPesewas) - Number(P.paidPesewas || 0), P);
  const sent = await sendSms(env, P.buyerPhone, msg);
  await audit(env, user, "INSTALLMENT_SMS_RESENT", { planId: plan.id, sent });
  return sent ? {} : { error: "The text didn\u2019t send. Check the SMS balance.", status: 502 };
}
__name(resendInstallmentSms, "resendInstallmentSms");
async function updateSettings(env, b, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const cur = await getSettings(env);
  const data = {};
  for (const [k, max] of Object.entries(SETTINGS_FIELDS)) if (b?.[k] !== void 0) data[k] = clean(b[k], max);
  if (data.mapUrl && httpsUrl(data.mapUrl, env) === null) return { error: "Links must start with https://" };
  if (data.heroImage !== void 0 && ownImage(data.heroImage, env, cur.heroImage) === null) return { error: "Upload the hero image here in the control room." };
  if (data.heroVideo !== void 0 && ownImage(data.heroVideo, env, cur.heroVideo) === null) return { error: "Upload the video here in the control room." };
  if (b?.defaultLines !== void 0) {
    const lines = (Array.isArray(b.defaultLines) ? b.defaultLines : []).map((l) => clean(l, 48)).filter(Boolean);
    if (lines.length > 12) return { error: "Keep it to 12 lines or fewer." };
    data.defaultLines = lines;
  }
  if (b?.closedDates !== void 0) data.closedDates = (Array.isArray(b.closedDates) ? b.closedDates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 200);
  const next = { ...DEFAULT_SETTINGS, ...cur, ...data, updatedAt: now() };
  await setDoc(env, "settings", "site", next);
  await audit(env, user, "SETTINGS_UPDATED", { fields: Object.keys(data) });
  return { settings: next };
}
__name(updateSettings, "updateSettings");
async function getPlatformSubaccount(env, user) {
  if (!requireRole(user, ["superAdmin", "manager"])) return FORBIDDEN;
  const d = await getDoc(env, "settings", "site");
  const s = d?.fields || {};
  return {
    subaccountCode: s.platformSubaccount || "",
    sharePct: Number(s.platformSharePct) || 0,
    accountName: s.platformAccountName || "",
    settlementBank: s.platformSettlementBank || "",
    accountNumber: s.platformAccountNumber || "",
    verifiedAt: s.platformAccountVerifiedAt || ""
  };
}
__name(getPlatformSubaccount, "getPlatformSubaccount");
async function listBanks(env, user) {
  if (!requireRole(user, ["superAdmin", "manager"])) return FORBIDDEN;
  try {
    const banks = await listSettlementBanks(env);
    return { banks: banks.map((b) => ({ code: b.code, name: b.name, type: b.type || "" })) };
  } catch (e) {
    return { error: `Couldn't load the settlement list: ${e.message}` };
  }
}
__name(listBanks, "listBanks");
async function resolveSubaccount(env, b, user) {
  if (!requireRole(user, ["superAdmin", "manager"])) return FORBIDDEN;
  try {
    const r = await resolveBankAccount(env, { bankCode: b?.bankCode, accountNumber: b?.accountNumber });
    return { accountName: r.accountName, accountNumber: r.accountNumber };
  } catch (e) {
    return { error: e.message || "Could not verify that account." };
  }
}
__name(resolveSubaccount, "resolveSubaccount");
async function setupPlatformSubaccount(env, b, user) {
  if (!requireRole(user, ["superAdmin"])) return FORBIDDEN;
  try {
    const r = await createPlatformSubaccount(env, {
      businessName: b?.businessName,
      bankCode: b?.bankCode,
      accountNumber: b?.accountNumber,
      percentageCharge: b?.sharePct,
      email: b?.email,
      phone: b?.phone
    });
    const cur = await getDoc(env, "settings", "site");
    const fields = cur?.fields || {};
    await setDoc(env, "settings", "site", {
      ...fields,
      platformSubaccount: r.subaccountCode,
      platformSharePct: Number(b.sharePct),
      platformAccountName: r.accountName,
      platformSettlementBank: r.settlementBank,
      platformAccountNumber: r.accountNumber,
      platformAccountVerifiedAt: now(),
      updatedAt: now()
    });
    await audit(env, user, "PLATFORM_SUBACCOUNT_SET", { subaccount: r.subaccountCode, sharePct: Number(b.sharePct) });
    return { subaccountCode: r.subaccountCode, accountName: r.accountName, sharePct: Number(b.sharePct) };
  } catch (e) {
    return { error: e.message || "Paystack refused that subaccount." };
  }
}
__name(setupPlatformSubaccount, "setupPlatformSubaccount");
async function listOrganisers(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const organisers = (await queryWhere(env, "users", [{ field: "role", value: "organiser" }])).map((x) => ({ uid: x.id, email: x.fields.email || "" }));
  return { organisers: organisers.sort((a, b) => a.email.localeCompare(b.email)) };
}
__name(listOrganisers, "listOrganisers");
async function listStaff(env, user) {
  if (!requireRole(user, ["superAdmin"])) return FORBIDDEN;
  return { staff: (await listDocs(env, "users")).map((x) => ({ uid: x.id, email: x.fields.email, role: x.fields.role, updatedAt: x.fields.updatedAt })) };
}
__name(listStaff, "listStaff");
async function identity(env, path, body2) {
  const token = await googleAccessToken(env, "https://www.googleapis.com/auth/identitytoolkit");
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body2) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || "Identity Toolkit call failed");
  return d;
}
__name(identity, "identity");
async function setRole(env, b, user) {
  if (!requireRole(user, ["superAdmin"])) return FORBIDDEN;
  const email = clean(b?.email, 120).toLowerCase(), role = String(b?.role || "");
  if (!email || !(STAFF_ROLES.includes(role) || role === "none")) return { error: "A valid email and role are required." };
  const account = ((await identity(env, "accounts:lookup", { email: [email] })).users || [])[0];
  if (!account) return { error: "No account with that email. Create it in Firebase Authentication first.", status: 404 };
  if (account.localId === uidOf(user) && role !== "superAdmin") return { error: "You can\u2019t remove your own super admin role." };
  const claims = role === "none" ? {} : { role, admin: role === "superAdmin" };
  await identity(env, "accounts:update", { localId: account.localId, customAttributes: JSON.stringify(claims) });
  if (role === "none") await deleteDoc(env, "users", account.localId).catch(() => {
  });
  else await setDoc(env, "users", account.localId, { email, role, admin: claims.admin, updatedAt: now() });
  await audit(env, user, "ROLE_SET", { targetUid: account.localId, targetEmail: email, role });
  return { uid: account.localId, email, role };
}
__name(setRole, "setRole");
async function inviteStaff(env, b, user) {
  if (!requireRole(user, ["superAdmin"])) return FORBIDDEN;
  const email = clean(b?.email, 120).toLowerCase();
  const name = clean(b?.name, 80);
  const phone = normalizePhone(b?.phone);
  const role = String(b?.role || "");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Add a valid email address." };
  if (!name) return { error: "Add a name for this staff member." };
  if (!phone) return { error: "Add a Ghana phone number so we can text their sign-in details." };
  if (!STAFF_ROLES.includes(role)) return { error: "Pick a role." };
  const existing = ((await identity(env, "accounts:lookup", { email: [email] })).users || [])[0];
  if (existing) return { error: "That email already has an account. Use \u201CSave role\u201D below to change their role." };
  const password = generatePassword();
  const claims = { role, admin: role === "superAdmin" };
  let account;
  try {
    account = await identity(env, "accounts", {
      email,
      password,
      displayName: name,
      emailVerified: false,
      disabled: false
    });
  } catch (e) {
    return { error: `Could not create the account: ${e.message}` };
  }
  if (!account?.localId) return { error: "Account creation returned no uid." };
  await identity(env, "accounts:update", {
    localId: account.localId,
    customAttributes: JSON.stringify(claims)
  });
  await setDoc(env, "users", account.localId, {
    email,
    name,
    phone,
    role,
    admin: claims.admin === true,
    updatedAt: now()
  });
  await audit(env, user, "STAFF_INVITED", { targetUid: account.localId, targetEmail: email, role, name });
  const link = siteUrl(env, "/login.html");
  const msg = `MEMORIES STAFF
Sign in: ${link}
Email: ${email}
Password: ${password}
Change it after your first sign-in.`;
  const texted = await sendSms(env, phone, msg);
  return { uid: account.localId, email, role, texted };
}
__name(inviteStaff, "inviteStaff");
async function organiserOverview(env, user) {
  if (!requireRole(user, ["organiser", "superAdmin"])) return FORBIDDEN;
  const uid = uidOf(user);
  const events = (await listDocs(env, "events")).filter((e) => e.fields.organiserId === uid).sort((a, b) => new Date(b.fields.date) - new Date(a.fields.date));
  const results = [];
  for (const e of events) {
    const [orders, checkins, plans, raffles] = await Promise.all(["orders", "checkins", "installment_plans", "raffles"].map((c) => queryWhere(env, c, [{ field: "eventId", value: e.id }])));
    const confirmed = orders.filter((o) => o.fields.status === "confirmed");
    const ticketOrders = confirmed.filter((o) => o.fields.kind === "ticket");
    const byType = {};
    for (const o of ticketOrders) byType[o.fields.ticketTypeName || "Ticket"] = (byType[o.fields.ticketTypeName || "Ticket"] || 0) + Number(o.fields.quantity || 0);
    const active = plans.filter((p) => p.fields.status === "active");
    const r = raffles.find((x) => x.fields.enabled === true) || raffles[0];
    results.push({
      eventId: e.id,
      eventName: e.fields.name,
      date: e.fields.date,
      visibility: e.fields.visibility,
      active: e.fields.active !== false,
      ticketsSold: ticketOrders.reduce((s, o) => s + Number(o.fields.quantity || 0), 0),
      ticketsSoldByType: byType,
      tablesSold: confirmed.filter((o) => o.fields.kind === "table").length,
      revenuePesewas: confirmed.reduce((s, o) => s + Number(o.fields.amountPesewas || 0), 0),
      moneyOwingPesewas: active.reduce((s, p) => s + Math.max(0, Number(p.fields.totalPesewas || 0) - Number(p.fields.paidPesewas || 0)), 0),
      partialOrdersCount: active.length,
      checkins: checkins.reduce((s, c) => s + Number(c.fields.admits || 1), 0),
      raffle: r ? { prize: r.fields.prize, cap: Number(r.fields.cap) > 0 ? Number(r.fields.cap) : 20, spotsTaken: Number(r.fields.spotsTaken || 0), status: r.fields.status, winner: r.fields.status === "drawn" ? { name: r.fields.winnerDisplayName || "Winner", code: r.fields.winnerDisplayCode || "" } : null } : null
    });
  }
  return { events: results };
}
__name(organiserOverview, "organiserOverview");
async function doorEvents(env, user) {
  const all = await listDocs(env, "events");
  const mine = user.role === "organiser" && user.admin !== true ? all.filter((e) => e.fields.organiserId === uidOf(user)) : all;
  return { events: mine.filter((e) => e.fields.active !== false && new Date(e.fields.date).getTime() + 12 * 36e5 > Date.now()).map((e) => ({ id: e.id, name: e.fields.name, date: e.fields.date })).sort((a, b) => new Date(a.date) - new Date(b.date)) };
}
__name(doorEvents, "doorEvents");

// src/index.js
var enc2 = new TextEncoder();
var fromHex = /* @__PURE__ */ __name((s) => Uint8Array.from(String(s).match(/.{2}/g) || [], (x) => parseInt(x, 16)), "fromHex");
var body = /* @__PURE__ */ __name(async (req) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
}, "body");
var tooMany = /* @__PURE__ */ __name((req, env) => fail(req, env, "Too many attempts. Wait a minute and try again.", 429), "tooMany");
var last = /* @__PURE__ */ __name((p) => decodeURIComponent(p.split("/").pop()), "last");
async function paystackWebhook(req, env) {
  const raw = await req.text();
  const key = await crypto.subtle.importKey("raw", enc2.encode(env.PAYSTACK_SECRET_KEY), { name: "HMAC", hash: "SHA-512" }, false, ["verify"]);
  const sig2 = req.headers.get("x-paystack-signature") || "";
  const valid = /^[0-9a-f]{128}$/i.test(sig2) && await crypto.subtle.verify("HMAC", key, fromHex(sig2), enc2.encode(raw));
  if (!valid) return new Response("ignored", { status: 200 });
  const event = JSON.parse(raw);
  if (event.event === "charge.success" && event.data?.reference) await fulfill(env, event.data.reference);
  return new Response("ok", { status: 200 });
}
__name(paystackWebhook, "paystackWebhook");
var later = /* @__PURE__ */ __name(async (ctx, promise) => {
  const p = Promise.resolve(promise).catch((e) => logError("background task failed", e));
  if (ctx?.waitUntil) ctx.waitUntil(p);
  else await p;
}, "later");
async function route(req, env, ctx) {
  const u = new URL(req.url), p = u.pathname, m = req.method;
  if (m === "GET" && p === "/api/events") return ok(req, env, { events: await publicEvents(env) });
  if (m === "GET" && p.startsWith("/api/events/")) {
    const d = await eventBundle(env, last(p));
    return d ? ok(req, env, d) : fail(req, env, "Event not found.", 404);
  }
  if (m === "GET" && p === "/api/settings") {
    const s = await getSettings(env);
    delete s.closedDates;
    delete s.updatedAt;
    return ok(req, env, { settings: s });
  }
  if (m === "GET" && p === "/api/calendar") return ok(req, env, await calendar(env, Math.min(26, Math.max(1, Number(u.searchParams.get("weeks")) || 10))));
  if (m === "POST" && p === "/api/checkout/initiate") {
    if (await throttled(req, env, "checkout", "standard")) return tooMany(req, env);
    return reply(req, env, await initiateTicket(env, await body(req)));
  }
  if (m === "POST" && p === "/api/table-checkout/initiate") {
    if (await throttled(req, env, "checkout", "standard")) return tooMany(req, env);
    return reply(req, env, await initiateTable(env, await body(req)));
  }
  if (m === "POST" && p === "/api/installments/start") {
    if (await throttled(req, env, "checkout", "standard")) return tooMany(req, env);
    return reply(req, env, await startInstallment(env, await body(req)));
  }
  if (m === "POST" && p === "/api/installments/topup") {
    if (await throttled(req, env, "checkout", "standard")) return tooMany(req, env);
    return reply(req, env, await topupInstallment(env, await body(req)));
  }
  if (m === "GET" && p === "/api/installments/lookup") {
    const code = u.searchParams.get("code") || "";
    if (await throttled(req, env, "lookup", "strict") || await throttled(req, env, "lookup-code", "strict", code.toUpperCase().replace(/\W/g, "").slice(0, 20))) return tooMany(req, env);
    if (!code) return ok(req, env, { plans: [] });
    return ok(req, env, { plans: await lookupInstallments(env, { code }) });
  }
  if (m === "POST" && p === "/api/installments/find") {
    const b = await body(req), ph = normalizePhone(b.phone);
    if (!ph) return fail(req, env, "Use a Ghana number, e.g. 024 123 4567.");
    if (await throttled(req, env, "find", "strict") || await throttled(req, env, "find-phone", "strict", ph)) return tooMany(req, env);
    await later(ctx, textOrderCodes(env, { phone: ph }));
    return ok(req, env, { message: NEUTRAL_CODES });
  }
  if (m === "POST" && p === "/api/installments/resend-link") {
    const b = await body(req), ph = normalizePhone(b.phone), code = normalizeOrderCode(b.planId);
    if (!ph || !code) return fail(req, env, "Enter your order code and the phone number you used.");
    if (await throttled(req, env, "resend", "strict") || await throttled(req, env, "resend-phone", "strict", ph) || await throttled(req, env, "resend-plan", "strict", code)) return tooMany(req, env);
    await later(ctx, resendTicketLink(env, { planId: code, phone: ph }));
    return ok(req, env, { message: NEUTRAL_LINK });
  }
  if (m === "POST" && p === "/api/checkout/verify") {
    if (await throttled(req, env, "verify", "standard")) return tooMany(req, env);
    const b = await body(req);
    if (!b.reference) return fail(req, env, "Reference is required.");
    return ok(req, env, await fulfill(env, String(b.reference)));
  }
  if (m === "GET" && p === "/api/checkout/status") {
    const r = u.searchParams.get("reference");
    if (!r) return fail(req, env, "Reference is required.");
    const d = await checkoutStatus(env, r);
    return d ? ok(req, env, d) : fail(req, env, "Not found.", 404);
  }
  if (m === "GET" && p.startsWith("/api/tickets/")) {
    if (await throttled(req, env, "ticket", "standard")) return tooMany(req, env);
    const t = await publicTicket(env, last(p));
    return t ? ok(req, env, { ticket: t }) : fail(req, env, "Ticket not found.", 404);
  }
  if (m === "GET" && p.startsWith("/api/verify/")) {
    if (await throttled(req, env, "ticket", "standard")) return tooMany(req, env);
    return ok(req, env, await verifyTicket(env, last(p)));
  }
  if (m === "POST" && p === "/api/private-requests") {
    if (await throttled(req, env, "private", "strict")) return tooMany(req, env);
    return reply(req, env, await createPrivateRequest(env, await body(req)));
  }
  if (m === "POST" && p === "/api/paystack/webhook") return paystackWebhook(req, env);
  if (!p.startsWith("/api/admin/") && !["/api/checkin", "/api/door/events", "/api/door/summary", "/api/door/search", "/api/send-sms", "/api/balance"].includes(p)) return fail(req, env, "Not found.", 404);
  const user = await verifyStaff(req, env);
  if (!user) return fail(req, env, "Sign in again.", 401);
  if (m === "POST" && p === "/api/checkin") {
    if (!requireRole(user, DOOR)) return fail(req, env, "Forbidden.", 403);
    if (await throttled(req, env, "checkin", "standard")) return tooMany(req, env);
    const b = await body(req);
    if (!b.token && !b.code) return fail(req, env, "Scan or enter a ticket.");
    return ok(req, env, await checkin(env, b.token || "", user, { eventId: b.eventId || null, code: b.code || null }));
  }
  if (m === "GET" && p === "/api/door/summary") {
    if (!requireRole(user, DOOR)) return fail(req, env, "Forbidden.", 403);
    return reply(req, env, await doorSummary(env, user, u.searchParams.get("eventId")));
  }
  if (m === "GET" && p === "/api/door/search") {
    if (!requireRole(user, DOOR)) return fail(req, env, "Forbidden.", 403);
    if (await throttled(req, env, "door-search", "standard")) return tooMany(req, env);
    return reply(req, env, await doorSearch(env, user, u.searchParams.get("eventId"), u.searchParams.get("q")));
  }
  if (m === "GET" && p === "/api/door/events") {
    if (!requireRole(user, DOOR)) return fail(req, env, "Forbidden.", 403);
    return ok(req, env, await doorEvents(env, user));
  }
  if ((p === "/api/send-sms" || p === "/api/admin/sms/send") && m === "POST") {
    if (!requireRole(user, MONEY)) return fail(req, env, "Forbidden.", 403);
    if (await throttled(req, env, "sms", "strict")) return tooMany(req, env);
    const r = await smsRequest(env, "/send-sms", { method: "POST", body: await req.text() });
    return new Response(await r.text(), { status: r.status, headers: { ...cors(req, env), "Content-Type": "application/json" } });
  }
  if ((p === "/api/balance" || p === "/api/admin/sms/balance") && m === "GET") {
    if (!requireRole(user, MONEY)) return fail(req, env, "Forbidden.", 403);
    const r = await smsRequest(env, "/balance", { method: "GET" });
    return new Response(await r.text(), { status: r.status, headers: { ...cors(req, env), "Content-Type": "application/json" } });
  }
  if (m === "GET" && p === "/api/admin/me") return ok(req, env, { uid: user.uid, email: user.email || "", role: user.admin === true ? "superAdmin" : user.role });
  if (m === "GET" && p === "/api/admin/overview") return reply(req, env, await adminOverview(env, user));
  if (m === "GET" && p === "/api/admin/events") return reply(req, env, await listEvents(env, user));
  if (m === "GET" && p.startsWith("/api/admin/events/")) return reply(req, env, await eventDetail(env, last(p), user));
  if (m === "POST" && p === "/api/admin/events") return reply(req, env, await upsertEvent(env, await body(req), user));
  if (m === "DELETE" && p.startsWith("/api/admin/events/")) return reply(req, env, await deleteEvent(env, last(p), user));
  const catalog = { "ticket-types": "ticket_types", "table-packages": "table_packages", bottles: "bottles" };
  for (const [slug, col] of Object.entries(catalog)) {
    if (m === "POST" && p === `/api/admin/${slug}`) return reply(req, env, await upsertCatalog(env, col, await body(req), user));
    if (m === "DELETE" && p.startsWith(`/api/admin/${slug}/`)) return reply(req, env, await deleteCatalog(env, col, last(p), user));
  }
  if (m === "GET" && p === "/api/admin/bottles") return reply(req, env, await listBottles(env, user));
  if (m === "GET" && p === "/api/admin/orders") return reply(req, env, await listOrders(env, { eventId: u.searchParams.get("eventId"), kind: u.searchParams.get("kind") }, user));
  if (m === "POST" && p === "/api/admin/comps") return reply(req, env, await issueComp(env, await body(req), user));
  if (m === "POST" && p === "/api/admin/raffles") return reply(req, env, await upsertRaffle(env, await body(req), user));
  if (m === "POST" && p === "/api/admin/raffle/draw") {
    if (await throttled(req, env, "draw", "strict")) return tooMany(req, env);
    return reply(req, env, await drawRaffle(env, await body(req), user));
  }
  if (m === "GET" && p === "/api/admin/requests") return reply(req, env, await listRequests(env, user));
  if (m === "POST" && p.startsWith("/api/admin/requests/")) return reply(req, env, await updatePrivateRequest(env, last(p), await body(req), user));
  if (m === "GET" && p === "/api/admin/refunds") return reply(req, env, await listRefunds(env, user));
  if (m === "POST" && p === "/api/admin/refunds/mark") return reply(req, env, await markRefunded(env, await body(req), user));
  if (m === "GET" && p === "/api/admin/installments") return reply(req, env, await adminInstallments(env, user));
  if (m === "POST" && p === "/api/admin/installments/resend-sms") {
    if (await throttled(req, env, "sms", "strict")) return tooMany(req, env);
    return reply(req, env, await resendInstallmentSms(env, await body(req), user));
  }
  if (m === "GET" && p === "/api/admin/settings") {
    if (!requireRole(user, MONEY)) return fail(req, env, "Forbidden.", 403);
    return ok(req, env, { settings: await getSettings(env) });
  }
  if (m === "POST" && p === "/api/admin/settings") return reply(req, env, await updateSettings(env, await body(req), user));
  if (m === "GET" && p === "/api/admin/organisers") return reply(req, env, await listOrganisers(env, user));
  if (m === "GET" && p === "/api/admin/staff") return reply(req, env, await listStaff(env, user));
  if (m === "POST" && p === "/api/admin/set-role") return reply(req, env, await setRole(env, await body(req), user));
  if (m === "POST" && p === "/api/admin/staff/invite") {
    if (await throttled(req, env, "invite", "strict")) return tooMany(req, env);
    return reply(req, env, await inviteStaff(env, await body(req), user));
  }
  if (m === "GET" && p === "/api/admin/organiser/overview") return reply(req, env, await organiserOverview(env, user));
  return fail(req, env, "Not found.", 404);
  if (m === "GET" && p === "/api/admin/subaccounts/banks") return reply(req, env, await listBanks(env, user));
  if (m === "POST" && p === "/api/admin/subaccounts/resolve") return reply(req, env, await resolveSubaccount(env, await body(req), user));
  if (m === "GET" && p === "/api/admin/subaccounts/platform") return reply(req, env, await getPlatformSubaccount(env, user));
  if (m === "POST" && p === "/api/admin/subaccounts/platform") return reply(req, env, await setupPlatformSubaccount(env, await body(req), user));
}
__name(route, "route");
var index_default = {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env) });
    try {
      return await route(req, env, ctx);
    } catch (e) {
      logError("request failed", `${req.method} ${new URL(req.url).pathname}`, e);
      return fail(req, env, "Something went wrong on our side. Try again.", 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(forfeitStalePlans(env).catch((e) => logError("forfeitStalePlans failed", e)));
  }
};
export {
  adminInstallments,
  adminOverview,
  calendar,
  checkin,
  createPrivateRequest,
  index_default as default,
  drawRaffle,
  eventBundle,
  forfeitStalePlans,
  fulfillInstallment,
  fulfillTable,
  fulfillTicket,
  getSettings,
  initiateTable,
  initiateTicket,
  inviteStaff,
  issueComp,
  listDocs,
  listEvents,
  listOrders,
  lookupInstallments,
  organiserOverview,
  publicTicket,
  queryWhere,
  rateLimited,
  requireRole,
  setRole,
  startInstallment,
  startInstallmentTopup,
  topupInstallment,
  updatePrivateRequest,
  updateSettings,
  upsertCatalog,
  upsertEvent,
  upsertRaffle,
  verifyTicket,
  withTransaction
};
//# sourceMappingURL=index.js.map

// Web Crypto helpers for the encrypted guest index. Works in browsers and Node 24 (globalThis.crypto).
// Formats follow CONTRACTS section 6: PBKDF2-SHA256 -> AES-GCM-256, iv/ct as base64.
// Privacy level: obfuscation-grade (keeps casual visitors out; not a vault). Never log secrets or plaintext.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** @param {ArrayBuffer|Uint8Array} buf @returns {string} base64 */
export function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** @param {string} s base64 @returns {Uint8Array} */
export function fromB64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** @param {string} s @returns {Promise<string>} lowercase hex SHA-256 */
export async function sha256Hex(s) {
  const h = await subtle().digest("SHA-256", enc.encode(String(s)));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Random base64 salt. @param {number} [bytes] */
export function randomSaltB64(bytes = 16) {
  return toB64(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * PBKDF2-SHA256 -> AES-GCM-256 key (non-extractable).
 * @param {string} secret @param {string} saltB64 @param {number} iter @returns {Promise<CryptoKey>}
 */
export async function deriveKey(secret, saltB64, iter) {
  if (!Number.isInteger(iter) || iter < 1) throw new Error("Invalid iteration count");
  const base = await subtle().importKey("raw", enc.encode(String(secret)), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: fromB64(saltB64), iterations: iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** @param {CryptoKey} key @param {any} obj @returns {Promise<{iv:string, ct:string}>} fresh random 12-byte IV each call */
export async function encryptJSON(key, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

/** @param {CryptoKey} key @param {{iv:string, ct:string}} rec @returns {Promise<any>} rejects on wrong key or tampering */
export async function decryptJSON(key, rec) {
  if (!rec || typeof rec.iv !== "string" || typeof rec.ct !== "string") throw new Error("Malformed record");
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(rec.iv) }, key, fromB64(rec.ct));
  return JSON.parse(dec.decode(pt));
}

/**
 * Random code from CODE_ALPHABET (31 chars) with rejection sampling, so there is no modulo bias.
 * 10 chars is about 49.5 bits.
 * @param {number} [len] @returns {string}
 */
export function randomCode(len = 10) {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n); // 248: bytes at or above are rejected
  let out = "";
  while (out.length < len) {
    const buf = globalThis.crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of buf) {
      if (b < limit && out.length < len) out += CODE_ALPHABET[b % n];
    }
  }
  return out;
}

/** Normalise a person's name for lookup: lowercase, diacritics stripped, non-letters removed, whitespace collapsed. */
export function normName(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalise a typed access code: trim, drop spaces/dashes, uppercase. */
export function normCode(s) {
  return String(s ?? "").replace(/[\s-]+/g, "").toUpperCase();
}

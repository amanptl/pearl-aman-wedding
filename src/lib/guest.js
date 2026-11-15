// Guest resolution: personal link / remembered code / name lookup. Never logs codes or decrypted data.
import { loadGuests } from "./store.js";
import { sha256Hex, deriveKey, decryptJSON, normName, normCode } from "./crypto.js";

const LS_KEY = "pa.guest.v1";
const SS_GUEST = "pa.guest.session";
export const BADCODE_KEY = "pa.badcode";

const safe = (fn) => { try { return fn(); } catch { return null; } };

let guestsPromise;
const getGuests = () => (guestsPromise ||= loadGuests());

const validCode = (c) => /^[A-Z0-9]{4,32}$/.test(c);

/** Decrypt a household record by code. @returns {Promise<object|null>} */
async function openRecord(guests, code) {
  const rec = guests.records?.[await sha256Hex(code)];
  if (!rec || !guests.kdf) return null;
  try {
    const key = await deriveKey(code, guests.kdf.salt, guests.kdf.iter);
    const g = await decryptJSON(key, rec);
    return g && typeof g === "object" ? { ...g, code } : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the current guest from ?i=CODE or the remembered code. Returns a Guest (CONTRACTS section 6) or null.
 * A bad ?i= code is forgotten and flagged with sessionStorage['pa.badcode'] so the lookup UI can explain.
 * @returns {Promise<null|object>}
 */
export async function resolveGuest() {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.has("i");
  const code = fromUrl ? normCode(url.searchParams.get("i")) : normCode(safe(() => JSON.parse(localStorage.getItem(LS_KEY))?.code));
  if (!code) return null;
  if (!validCode(code)) {
    if (fromUrl) { stripParam(url); safe(() => sessionStorage.setItem(BADCODE_KEY, "1")); }
    forgetGuest();
    return null;
  }

  // Session cache avoids repeating PBKDF2 on every page load. Decrypted data stays in sessionStorage only.
  const cached = safe(() => JSON.parse(sessionStorage.getItem(SS_GUEST)));
  let guest = cached && cached.code === code ? cached : null;
  if (!guest) guest = await openRecord(await getGuests(), code);

  if (!guest) {
    forgetGuest();
    safe(() => sessionStorage.removeItem(SS_GUEST));
    if (fromUrl) { safe(() => sessionStorage.setItem(BADCODE_KEY, "1")); stripParam(url); }
    return null;
  }
  safe(() => sessionStorage.setItem(SS_GUEST, JSON.stringify(guest)));
  safe(() => sessionStorage.removeItem(BADCODE_KEY));
  rememberGuest(code);
  if (fromUrl) stripParam(url);
  return guest;
}

function stripParam(url) {
  url.searchParams.delete("i");
  safe(() => history.replaceState(history.state, "", url.pathname + url.search + url.hash));
}

/**
 * Look a household up by a member's name. Accepts "Raj","Sharma", "sharma","raj", or the whole name in `first` with `last` empty.
 * @param {string} first @param {string} [last]
 * @returns {Promise<null|{code:string}|{choices:{code:string, household:string}[]}>}
 */
export async function lookupByName(first, last = "") {
  const guests = await getGuests();
  if (!guests.kdf || !guests.names) return null;
  const whole = normName(`${first ?? ""} ${last ?? ""}`);
  if (!whole) return null;
  const parts = whole.split(" ");
  const cands = new Set([whole]);
  if (parts.length > 1) {
    cands.add(`${parts[0]} ${parts[parts.length - 1]}`);
    cands.add(`${parts[parts.length - 1]} ${parts[0]}`);
  }
  const codes = new Set();
  for (const nn of cands) {
    const rec = guests.names[await sha256Hex(nn)];
    if (!rec) continue;
    try {
      const key = await deriveKey(nn, guests.kdf.salt, guests.kdf.iter);
      const pt = await decryptJSON(key, rec);
      for (const c of pt.codes || (pt.code ? [pt.code] : [])) codes.add(c);
    } catch { /* ignore a corrupt entry */ }
  }
  if (!codes.size) return null;
  if (codes.size === 1) return { code: [...codes][0] };
  const choices = (await Promise.all([...codes].map(async (code) => {
    const g = await openRecord(guests, code);
    return g ? { code, household: g.household } : null;
  }))).filter(Boolean);
  if (!choices.length) return null;
  return choices.length === 1 ? { code: choices[0].code } : { choices };
}

/** Remember the guest's code in localStorage (pa.guest.v1). @param {string} code */
export function rememberGuest(code) {
  safe(() => localStorage.setItem(LS_KEY, JSON.stringify({ code: normCode(code) })));
}

/** Forget the remembered guest (and the session cache). */
export function forgetGuest() {
  safe(() => localStorage.removeItem(LS_KEY));
  safe(() => sessionStorage.removeItem(SS_GUEST));
}

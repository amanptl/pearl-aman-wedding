// Build / open the encrypted guest files (CONTRACTS section 6). No DOM; shared by tools/make-guests.mjs and the editor.
import { sha256Hex, deriveKey, encryptJSON, decryptJSON, randomCode, randomSaltB64, normName } from "./crypto.js";

const SKIP_NAME = /^(guest|guests|plus ?one|tbd|tba|unknown)(\s|$)/;

/** True when a member name should not be searchable (empty / placeholder). */
export function isPlaceholderName(name) {
  const n = normName(name);
  return !n || SKIP_NAME.test(n);
}

/**
 * Name-lookup keys for one person: "first last", "last first", plus the full name as typed when it has 3+ parts.
 * @param {string} name @returns {string[]} normalised, de-duplicated
 */
export function nameVariants(name) {
  if (isPlaceholderName(name)) return [];
  const full = normName(name);
  const parts = full.split(" ");
  const out = new Set();
  if (parts.length === 1) out.add(full);
  else {
    const first = parts[0], last = parts[parts.length - 1];
    out.add(`${first} ${last}`);
    out.add(`${last} ${first}`);
    if (parts.length >= 3) out.add(full);
  }
  return [...out];
}

/**
 * Build a household (a Guest without privateEvents). Generates a code and member ids unless supplied.
 * `eventSeats` is how many people may come to each event (0 = not invited). `eventIds` stays the events with a
 * count above 0. `seats` is the largest event count so older readers still have one number. Older lists with only
 * `seats` + `eventIds` (or members + plus-ones) keep working.
 * @param {{household:string, members?:(string|{id?:string,name:string})[], seats?:number, eventSeats?:Record<string,number>, eventIds?:string[], tags?:string[], plusOnes?:number, code?:string, greeting?:string, id?:string}} h
 * @param {Set<string>} [taken] codes already in use (the new code is added)
 */
export function makeHousehold({ household, members = [], seats, eventSeats, eventIds = [], tags = [], plusOnes = 0, code, greeting, id }, taken = new Set()) {
  if (!household || !String(household).trim()) throw new Error("Household name is required");
  let c = code;
  if (!c) { do c = randomCode(10); while (taken.has(c)); }
  taken.add(c);
  const ms = members.map((m, i) => {
    const o = typeof m === "string" ? { name: m } : m;
    return { id: o.id || `m${i + 1}`, name: String(o.name ?? "").trim() };
  });
  const name = String(household).trim();
  const hh = { code: c, household: name, greeting: greeting || `Dear ${name}`, members: ms, seats: seatsOf({ seats, members: ms, plusOnes, eventSeats, eventIds }), eventIds: [...eventIds], tags: [...tags] };
  if (eventSeats && typeof eventSeats === "object") hh.eventSeats = { ...eventSeats };
  syncEventSeats(hh);
  if (id) hh.id = id;
  return hh;
}

/** How many people a household may bring overall: max of `eventSeats`, else `seats`, else (older lists) names + plus-ones; 1 to MAX_SEATS. */
export const MAX_SEATS = 20;
export function seatsOf(h) {
  const fromEvents = Object.values(h?.eventSeats || {}).map((n) => Math.round(+n) || 0).filter((n) => n > 0);
  if (fromEvents.length) return Math.max(1, Math.min(MAX_SEATS, Math.max(...fromEvents)));
  const n = Number.isFinite(+h?.seats) && +h.seats > 0 ? Math.round(+h.seats)
    : (h?.members || []).filter((m) => String(m?.name ?? m ?? "").trim()).length + (Number(h?.plusOnes) || 0);
  return Math.max(1, Math.min(MAX_SEATS, n || 1));
}

/** Clamp a per-event invited count to 0..MAX_SEATS. */
export function clampEventSeats(n) {
  const v = Math.round(+n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(MAX_SEATS, v);
}

/**
 * How many people this household may bring to one event. Uses `eventSeats[id]` when present; otherwise the shared
 * `seatsOf()` value when the id is in `eventIds`, else 0.
 */
export function eventSeatsOf(h, eventId) {
  if (!eventId) return 0;
  if (h?.eventSeats && Object.prototype.hasOwnProperty.call(h.eventSeats, eventId)) return clampEventSeats(h.eventSeats[eventId]);
  return (h?.eventIds || []).includes(eventId) ? seatsOf(h) : 0;
}

/** Full map of event id -> invited count for the events this household knows about. */
export function eventSeatsMap(h, eventIds = h?.eventIds || []) {
  const ids = new Set([...(h?.eventIds || []), ...Object.keys(h?.eventSeats || {}), ...eventIds]);
  const out = {};
  for (const id of ids) {
    const n = eventSeatsOf(h, id);
    if (n > 0) out[id] = n;
  }
  return out;
}

/**
 * Keep `eventIds` (ids with count > 0) and `seats` (the largest count) in sync with `eventSeats`.
 * Mutates and returns the household.
 */
export function syncEventSeats(h) {
  if (!h) return h;
  if (h.eventSeats && typeof h.eventSeats === "object") {
    const clean = {};
    for (const [id, n] of Object.entries(h.eventSeats)) {
      const v = clampEventSeats(n);
      if (v > 0 && id) clean[id] = v;
    }
    h.eventSeats = clean;
    h.eventIds = Object.keys(clean);
    h.seats = seatsOf(h);
    delete h.plusOnes;
  } else if (h.eventIds?.length) {
    // Older household: invent eventSeats from the shared seats so the editor and RSVP share one shape.
    const cap = seatsOf(h);
    h.eventSeats = Object.fromEntries(h.eventIds.map((id) => [id, cap]));
    h.seats = cap;
    delete h.plusOnes;
  } else {
    h.eventSeats = h.eventSeats || {};
    h.eventIds = h.eventIds || [];
    h.seats = seatsOf(h);
  }
  return h;
}

/**
 * Carry codes over from an earlier bundle so links already sent keep working. Matches by `id`, then `household` name.
 * Households that already carry a code keep it. @returns {object[]}
 */
export function reuseCodes(households, existing = []) {
  const byId = new Map(existing.filter((e) => e.id).map((e) => [e.id, e]));
  const byName = new Map(existing.map((e) => [normName(e.household), e]));
  return households.map((h) => {
    if (h.code) return h;
    const prev = (h.id && byId.get(h.id)) || byName.get(normName(h.household));
    return prev ? { ...h, code: prev.code } : h;
  });
}

/**
 * @param {{households:object[], privateEvents:object[], passphrase:string, rsvpAdminKey?:string, iter?:number, presets?:object[], waTemplate?:string, waReminder?:string}} opts
 * @returns {Promise<{guestsJson:object, adminJson:object}>}
 */
export async function buildGuestFiles({ households, privateEvents = [], passphrase, nameLookup = true, rsvpAdminKey, iter = 150000, presets, waTemplate, waReminder }) {
  if (!passphrase) throw new Error("A passphrase is required");
  const taken = new Set(households.map((h) => h.code).filter(Boolean));
  const hhs = households.map((h) => makeHousehold(h, taken));
  if (new Set(hhs.map((h) => h.code)).size !== hhs.length) throw new Error("Duplicate household code");
  const evById = new Map(privateEvents.map((e) => [e.id, e]));

  const salt = randomSaltB64();
  const records = {};
  const names = {};

  await Promise.all(hhs.map(async (h) => {
    const guest = { ...h, privateEvents: h.eventIds.map((id) => evById.get(id)).filter(Boolean) };
    delete guest.id;
    const key = await deriveKey(h.code, salt, iter);
    records[await sha256Hex(h.code)] = await encryptJSON(key, guest);
  }));

  // Name index: normName -> Set(codes). Left empty when name lookup is off (site.nameLookup), so a known name can't be
  // turned into a household's code, even by reading guests.json directly.
  const byName = new Map();
  if (nameLookup) for (const h of hhs) for (const m of h.members) for (const v of nameVariants(m.name)) {
    if (!byName.has(v)) byName.set(v, new Set());
    byName.get(v).add(h.code);
  }
  await Promise.all([...byName].map(async ([nn, set]) => {
    const list = [...set];
    const key = await deriveKey(nn, salt, iter);
    names[await sha256Hex(nn)] = await encryptJSON(key, list.length === 1 ? { code: list[0] } : { codes: list });
  }));

  const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  const guestsJson = { v: 1, kdf: { iter, salt }, records: sortKeys(records), names: sortKeys(names) };

  const adminSalt = randomSaltB64();
  const adminIter = iter >= 100000 ? 600000 : iter;
  const key = await deriveKey(passphrase, adminSalt, adminIter);
  const bundle = { households: hhs, privateEvents, rsvpAdminKey: rsvpAdminKey || randomCode(24) };
  if (presets) bundle.presets = presets; // editor-only extras, only ever stored inside the encrypted bundle
  if (waTemplate) bundle.waTemplate = waTemplate;
  if (waReminder) bundle.waReminder = waReminder;
  const adminJson = { v: 1, kdf: { iter: adminIter, salt: adminSalt }, ...(await encryptJSON(key, bundle)) };
  return { guestsJson, adminJson };
}

/**
 * Decrypt the admin bundle.
 * @returns {Promise<{households:object[], privateEvents:object[], rsvpAdminKey:string}>}
 * @throws {Error} "Wrong passphrase"
 */
export async function openAdmin(adminJson, passphrase) {
  try {
    const key = await deriveKey(passphrase, adminJson.kdf.salt, adminJson.kdf.iter);
    return await decryptJSON(key, adminJson);
  } catch {
    throw new Error("Wrong passphrase");
  }
}

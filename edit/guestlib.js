// Pure helpers for the guest manager (no DOM, so they can be unit-tested in Node).
import { makeHousehold } from "../src/lib/guestfiles.js";

export const isPrivate = (e) => e?.visibility === "private";
const clone = (x) => structuredClone(x);

/** Presets are stored in the admin bundle. "*" in eventIds means "every event" (so new events are included automatically). */
export const DEFAULT_PRESETS = [
  { id: "close-family", name: "Close family", tag: "close-family", eventIds: ["*"] },
  { id: "friends", name: "Friends", tag: "friends", eventIds: ["sangeet", "wedding", "reception"] },
  { id: "colleagues", name: "Colleagues", tag: "colleagues", eventIds: ["wedding", "reception"] },
];

export const DEFAULT_WA_TEMPLATE =
  "Dear {greeting},\n\nWe are so excited to celebrate with you! Here is your personal invitation, with your events and the RSVP form:\n{link}\n\nWith love,\n{couple}";
export const DEFAULT_WA_REMINDER =
  "Dear {greeting},\n\nA gentle reminder to send us your RSVP{deadline} so we can plan for you. Your personal link:\n{link}\n\nWith love,\n{couple}";

export const getPresets = (admin) => (Array.isArray(admin?.presets) ? admin.presets : DEFAULT_PRESETS);

/** Event ids a preset resolves to, limited to events that exist. */
export function presetEventIds(preset, events) {
  const all = events.map((e) => e.id);
  if (!preset) return [];
  return preset.eventIds.includes("*") ? all : preset.eventIds.filter((id) => all.includes(id));
}

export const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** "Dear Sharma Family" -> "Sharma Family" (templates add their own "Dear"). */
export const greetingName = (h) => String(h.greeting || h.household || "").replace(/^\s*dear\s+/i, "").trim() || h.household;

export function personalLink(site, code, here = typeof location !== "undefined" ? location.href : "https://example.org/edit/") {
  const base = (site?.siteUrl || new URL("../", here).href).replace(/\/?$/, "/");
  return `${base}?i=${code}`;
}

export function waMessage(template, { household, link, content }) {
  const site = content?.site || {};
  const couple = site.couple ? `${site.couple.first} & ${site.couple.second}` : site.title || "";
  const dl = content?.rsvp?.deadlineText || content?.rsvp?.deadline || "";
  return String(template || DEFAULT_WA_TEMPLATE)
    .replaceAll("{greeting}", greetingName(household))
    .replaceAll("{household}", household.household)
    .replaceAll("{link}", link)
    .replaceAll("{couple}", couple)
    .replaceAll("{deadline}", dl ? ` by ${dl}` : "");
}

/** The Guest object a household's phone would receive (CONTRACTS section 6), built locally for "Preview as". */
export function makeGuestFor(household, events) {
  const g = clone(household);
  delete g.id;
  g.privateEvents = events.filter((e) => isPrivate(e) && (household.eventIds || []).includes(e.id)).map(clone);
  return g;
}

/** Private events sorted for stable comparison and storage. */
export const sortEvents = (list) => [...list].sort((a, b) => (a.start || "").localeCompare(b.start || "") || a.id.localeCompare(b.id));

/* ---------- CSV ---------- */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const src = String(text).replace(/^﻿/, "");
  const delim = (src.split("\n", 1)[0].match(/;/g) || []).length > (src.split("\n", 1)[0].match(/,/g) || []).length && !/"/.test(src.split("\n", 1)[0]) ? ";" : ",";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export function toCsv(rows) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

const splitList = (s) => String(s || "").split(/[;|]/).map((x) => x.trim()).filter(Boolean);

/**
 * Turn parsed CSV into import rows. Columns: household, members (; separated), tags, events (ids or a preset name), plusOnes.
 * @returns {{headerErrors:string[], rows:{line:number, action:"add"|"update"|"error", errors:string[], warnings:string[], data:object}[]}}
 */
export function importRows(csvRows, { events, presets, existing }) {
  const out = { headerErrors: [], rows: [] };
  if (!csvRows.length) { out.headerErrors.push("The file is empty."); return out; }
  const head = csvRows[0].map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ci = { household: col("household", "name", "family"), members: col("members", "guests", "people"), tags: col("tags", "tag", "group"), events: col("events", "event", "invitedto"), plusOnes: col("plusones", "plusone", "plus1") };
  if (ci.household < 0) out.headerErrors.push('Missing a "household" column.');
  if (ci.members < 0) out.headerErrors.push('Missing a "members" column.');
  if (out.headerErrors.length) return out;
  const ids = new Set(events.map((e) => e.id));
  const byName = new Map(existing.map((h) => [h.household.trim().toLowerCase(), h]));
  const seen = new Set();
  csvRows.slice(1).forEach((r, i) => {
    const get = (k) => (ci[k] >= 0 ? (r[ci[k]] ?? "").trim() : "");
    const errors = [], warnings = [];
    const household = get("household");
    const members = splitList(get("members"));
    const tags = splitList(get("tags")).map(slug).filter(Boolean);
    let eventIds = [];
    const evRaw = get("events");
    const preset = presets.find((p) => p.name.toLowerCase() === evRaw.toLowerCase() || p.id === evRaw.toLowerCase());
    if (preset) { eventIds = presetEventIds(preset, events); if (!tags.includes(preset.tag) && preset.tag) tags.push(preset.tag); }
    else if (evRaw.toLowerCase() === "all") eventIds = [...ids];
    else for (const id of splitList(evRaw)) { if (ids.has(id)) eventIds.push(id); else errors.push(`Unknown event "${id}"`); }
    const po = get("plusOnes");
    const plusOnes = po === "" ? 0 : Number(po);
    if (!household) errors.push("Household name is missing");
    if (!members.length) errors.push("No members");
    if (!Number.isInteger(plusOnes) || plusOnes < 0 || plusOnes > 10) errors.push("Plus-ones must be a number from 0 to 10");
    if (household && seen.has(household.toLowerCase())) errors.push("Appears twice in this file");
    seen.add(household.toLowerCase());
    if (!eventIds.length && !errors.length) warnings.push("Not invited to any event");
    const prev = byName.get(household.toLowerCase());
    out.rows.push({ line: i + 2, action: errors.length ? "error" : prev ? "update" : "add", errors, warnings, data: { household, members, tags, eventIds, plusOnes: errors.length ? 0 : plusOnes }, existingCode: prev?.code });
  });
  return out;
}

/** Apply good import rows to a household list. Existing households keep their code. */
export function applyImport(households, rows) {
  const taken = new Set(households.map((h) => h.code));
  const list = clone(households);
  for (const r of rows) {
    if (r.action === "error") continue;
    const d = r.data;
    if (r.action === "update") {
      const h = list.find((x) => x.code === r.existingCode);
      if (!h) continue;
      const keep = new Map(h.members.map((m) => [m.name.toLowerCase(), m]));
      let n = h.members.reduce((a, m) => Math.max(a, +String(m.id).replace(/\D/g, "") || 0), 0);
      h.members = d.members.map((name) => keep.get(name.toLowerCase()) || { id: `m${++n}`, name });
      h.tags = d.tags; h.eventIds = d.eventIds; h.plusOnes = d.plusOnes;
    } else {
      list.push(makeHousehold({ id: slug(d.household) + "-" + Math.random().toString(36).slice(2, 6), household: d.household, members: d.members, tags: d.tags, eventIds: d.eventIds, plusOnes: d.plusOnes }, taken));
    }
  }
  return list;
}

export function exportHouseholdsCsv(households, events, linkFor) {
  const evName = (id) => id;
  return toCsv([
    ["household", "members", "tags", "events", "plusOnes", "code", "link"],
    ...households.map((h) => [h.household, h.members.map((m) => m.name).join("; "), (h.tags || []).join("; "), (h.eventIds || []).filter((id) => events.some((e) => e.id === id)).map(evName).join("; "), h.plusOnes || 0, h.code, linkFor(h)]),
  ]);
}

/* ---------- RSVP summary ---------- */
const j = (s) => { try { return JSON.parse(s); } catch { return {}; } };

/**
 * Turn the Apps Script summary into dashboard numbers.
 * pending = invited named members who have no response for that event.
 */
export function analyseSummary(summary, households, events) {
  const responses = summary.responses || [];
  const hsheet = summary.households || [];
  const byEvent = {};
  for (const e of events) byEvent[e.id] = { yes: 0, no: 0, pending: 0, invited: 0 };
  const answered = new Set(responses.map((r) => `${r.code}|${r.memberId}|${r.eventId}`));
  for (const r of responses) {
    const c = byEvent[r.eventId];
    if (!c) continue;
    if (r.attending === "yes") c.yes++; else if (r.attending === "no") c.no++;
  }
  for (const h of households) for (const id of h.eventIds || []) {
    const c = byEvent[id];
    if (!c) continue;
    for (const m of h.members) { c.invited++; if (!answered.has(`${h.code}|${m.id}|${id}`)) c.pending++; }
  }
  // Meals and dietary: each person once, if they said yes to anything.
  const people = new Map();
  for (const r of responses) {
    const k = `${r.code}|${r.memberId}`;
    const p = people.get(k) || { yes: false, meal: "", dietary: "" };
    if (r.attending === "yes") p.yes = true;
    if (r.meal) p.meal = r.meal;
    if (r.dietary) p.dietary = r.dietary;
    people.set(k, p);
  }
  const meals = {}, dietary = {};
  let attending = 0;
  for (const p of people.values()) {
    if (!p.yes) continue;
    attending++;
    if (p.meal) meals[p.meal] = (meals[p.meal] || 0) + 1;
    for (const d of String(p.dietary).split(/[;,]/).map((x) => x.trim()).filter(Boolean)) dietary[d] = (dietary[d] || 0) + 1;
  }
  const repliedCodes = new Set([...responses.map((r) => r.code), ...hsheet.map((h) => h.code)]);
  const notReplied = households.filter((h) => !repliedCodes.has(h.code));
  const extras = hsheet.map((h) => ({ ...h, household: h.household || households.find((x) => x.code === h.code)?.household || h.code, shuttleSeats: j(h.shuttle) }));
  const hotel = { need: [], booked: [], local: [] };
  for (const x of extras) if (hotel[x.hotel]) hotel[x.hotel].push(x);
  const travel = extras.filter((x) => x.arrival || x.departure || x.flight || x.flightTime).sort((a, b) => String(a.arrival).localeCompare(String(b.arrival)));
  return { attending, byEvent, meals, dietary, notReplied, hotel, travel, extras, replied: repliedCodes.size, total: households.length };
}

export function exportResponsesCsv(summary, households, events) {
  const a = analyseSummary(summary, households, events);
  const resp = summary.responses || [];
  const head = ["household", "replied", ...events.map((e) => e.id), "meals", "dietary", "hotel", "arrival", "departure", "flight", "flightTime", "phone", "song", "message"];
  const rows = households.map((h) => {
    const rs = resp.filter((r) => r.code === h.code);
    const x = a.extras.find((e) => e.code === h.code) || {};
    const yes = (id) => { const mine = rs.filter((r) => r.eventId === id); return mine.length ? `${mine.filter((r) => r.attending === "yes").length}/${mine.length}` : ""; };
    const meals = [...new Set(rs.filter((r) => r.attending === "yes" && r.meal).map((r) => `${r.name}: ${r.meal}`))].join("; ");
    const diet = [...new Set(rs.filter((r) => r.dietary).map((r) => `${r.name}: ${r.dietary}`))].join("; ");
    return [h.household, rs.length || x.code ? "yes" : "no", ...events.map((e) => yes(e.id)), meals, diet, x.hotel || "", x.arrival || "", x.departure || "", x.flight || "", x.flightTime || "", x.phone || "", x.song || "", x.message || ""];
  });
  return toCsv([head, ...rows]);
}

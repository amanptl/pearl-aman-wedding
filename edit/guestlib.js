// Pure helpers for the guest manager (no DOM, so they can be unit-tested in Node).
import { makeHousehold, seatsOf, eventSeatsOf, syncEventSeats, clampEventSeats, MAX_SEATS } from "../src/lib/guestfiles.js";

export const isPrivate = (e) => e?.visibility === "private";
const clone = (x) => structuredClone(x);

/** Presets are stored in the admin bundle. "*" in eventIds means "every event" (so new events are included automatically). */
export const DEFAULT_PRESETS = [
  { id: "close-family", name: "Close family", tag: "close-family", eventIds: ["*"] },
  { id: "friends", name: "Friends", tag: "friends", eventIds: ["vidhi", "wedding"] },
  { id: "colleagues", name: "Colleagues", tag: "colleagues", eventIds: ["wedding"] },
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
  syncEventSeats(g);
  g.privateEvents = events.filter((e) => isPrivate(e) && (g.eventIds || []).includes(e.id)).map(clone);
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
 * Parse "mehndi:4; wedding:2" into { eventSeats, eventIds }. Unknown ids become errors.
 * A plain list of ids (no colon counts) returns null so the caller falls back to guests + events.
 */
export function parseEventSeatsCell(raw, knownIds) {
  const parts = splitList(raw);
  if (!parts.length) return { eventSeats: {}, eventIds: [], errors: [] };
  if (!parts.some((p) => p.includes(":"))) return null;
  const eventSeats = {};
  const errors = [];
  for (const part of parts) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(\d+)\s*$/.exec(part);
    if (!m) { errors.push(`Bad event count "${part}" (use id:number)`); continue; }
    const id = m[1], n = Number(m[2]);
    if (!knownIds.has(id)) { errors.push(`Unknown event "${id}"`); continue; }
    if (!Number.isInteger(n) || n < 0 || n > MAX_SEATS) { errors.push(`Guests for ${id} must be 0 to ${MAX_SEATS}`); continue; }
    if (n > 0) eventSeats[id] = n;
  }
  return { eventSeats, eventIds: Object.keys(eventSeats), errors };
}

/**
 * Turn parsed CSV into import rows. Columns: household, guests (how many may come), members (optional names, ; separated),
 * tags, events (ids, a preset name, or "mehndi:4; wedding:2"). Older files with plusOnes instead of guests get names + plus-ones.
 * @returns {{headerErrors:string[], rows:{line:number, action:"add"|"update"|"error", errors:string[], warnings:string[], data:object}[]}}
 */
export function importRows(csvRows, { events, presets, existing }) {
  const out = { headerErrors: [], rows: [] };
  if (!csvRows.length) { out.headerErrors.push("The file is empty."); return out; }
  const head = csvRows[0].map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ci = { household: col("household", "name", "family"), members: col("members", "names", "people"), seats: col("guests", "seats", "count", "invited"), tags: col("tags", "tag", "group"), events: col("events", "event", "invitedto"), plusOnes: col("plusones", "plusone", "plus1") };
  if (ci.household < 0) out.headerErrors.push('Missing a "household" column.');
  if (ci.seats < 0 && ci.members < 0 && ci.events < 0) out.headerErrors.push('Missing a "guests" or "events" column (how many people the household may bring).');
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
    let eventSeats = null;
    const evRaw = get("events");
    const perEvent = parseEventSeatsCell(evRaw, ids);
    if (perEvent) {
      errors.push(...perEvent.errors);
      eventIds = perEvent.eventIds;
      eventSeats = perEvent.eventSeats;
    } else {
      const preset = presets.find((p) => p.name.toLowerCase() === evRaw.toLowerCase() || p.id === evRaw.toLowerCase());
      if (preset) { eventIds = presetEventIds(preset, events); if (!tags.includes(preset.tag) && preset.tag) tags.push(preset.tag); }
      else if (evRaw.toLowerCase() === "all") eventIds = [...ids];
      else for (const id of splitList(evRaw)) { if (ids.has(id)) eventIds.push(id); else errors.push(`Unknown event "${id}"`); }
    }
    const po = get("plusOnes");
    const plusOnes = po === "" ? 0 : Number(po);
    const sv = get("seats");
    let seats;
    if (eventSeats) {
      seats = Math.max(0, ...Object.values(eventSeats));
      if (!seats) seats = 1;
    } else {
      seats = sv === "" ? members.length + (Number.isInteger(plusOnes) ? plusOnes : 0) : Number(sv);
    }
    if (!household) errors.push("Household name is missing");
    if (!Number.isInteger(plusOnes) || plusOnes < 0 || plusOnes > 10) errors.push("Plus-ones must be a number from 0 to 10");
    else if (!eventSeats && (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS)) errors.push(sv === "" ? "Add how many guests (a guests column), or their names" : `Guests must be a number from 1 to ${MAX_SEATS}`);
    if (household && seen.has(household.toLowerCase())) errors.push("Appears twice in this file");
    seen.add(household.toLowerCase());
    if (!eventIds.length && !errors.length) warnings.push("Not invited to any event");
    const prev = byName.get(household.toLowerCase());
    const data = { household, members, tags, eventIds, seats: Number.isInteger(seats) && seats > 0 ? Math.min(seats, MAX_SEATS) : 1 };
    if (eventSeats) data.eventSeats = eventSeats;
    else data.eventSeats = Object.fromEntries(eventIds.map((id) => [id, data.seats]));
    out.rows.push({ line: i + 2, action: errors.length ? "error" : prev ? "update" : "add", errors, warnings, data, existingCode: prev?.code });
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
      h.tags = d.tags;
      h.eventSeats = { ...(d.eventSeats || Object.fromEntries((d.eventIds || []).map((id) => [id, d.seats]))) };
      syncEventSeats(h);
    } else {
      list.push(makeHousehold({ id: slug(d.household) + "-" + Math.random().toString(36).slice(2, 6), household: d.household, members: d.members, tags: d.tags, eventIds: d.eventIds, seats: d.seats, eventSeats: d.eventSeats }, taken));
    }
  }
  return list;
}

export function exportHouseholdsCsv(households, events, linkFor) {
  const evCell = (h) => (h.eventIds || []).filter((id) => events.some((e) => e.id === id)).map((id) => `${id}:${eventSeatsOf(h, id)}`).join("; ");
  return toCsv([
    ["household", "guests", "members", "tags", "events", "code", "link"],
    ...households.map((h) => [h.household, seatsOf(h), h.members.map((m) => m.name).join("; "), (h.tags || []).join("; "), evCell(h), h.code, linkFor(h)]),
  ]);
}

/* ---------- Excel template / sheet adapter ---------- */
const FIXED_HEADERS = new Set(["household", "name", "family", "members", "names", "people", "guests", "seats", "count", "invited", "tags", "tag", "group", "events", "event", "invitedto", "plusones", "plusone", "plus1", "code", "link"]);
const normHeader = (h) => String(h ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
const cellText = (v) => (v == null || v === "" ? "" : String(v).trim());
const isBlankRow = (r) => !(r || []).some((c) => cellText(c) !== "");

/** Map an event header (name or id) to the event id, or null. */
export function matchEventHeader(header, events) {
  const raw = String(header ?? "").trim();
  if (!raw) return null;
  const n = normHeader(raw);
  const byId = events.find((e) => normHeader(e.id) === n);
  if (byId) return byId.id;
  const byName = events.find((e) => normHeader(e.name || "") === n);
  return byName ? byName.id : null;
}

/**
 * Households sheet for the Excel template: one column per event (by display name), or the
 * classic CSV columns when the draft has no events yet.
 * @returns {string[][]}
 */
export function householdsTemplateGrid(events, { examples = true } = {}) {
  const evs = events || [];
  if (!evs.length) {
    const head = ["household", "guests", "members", "tags", "events"];
    if (!examples) return [head];
    return [head, ["Sharma Family", "4", "Raj Sharma; Priya Sharma", "close-family", "all"], ["Maria Garcia", "2", "", "friends", "Friends"]];
  }
  const head = ["household", "members", "tags", ...evs.map((e) => e.name || e.id)];
  if (!examples) return [head];
  const all = evs.map(() => "4");
  const weddingOnly = evs.map((e) => (/wedding/i.test(e.id) || /wedding/i.test(e.name || "") ? "2" : "0"));
  return [
    head,
    ["Sharma Family", "Raj Sharma; Priya Sharma", "close-family", ...all],
    ["Maria Garcia", "", "friends", ...weddingOnly],
  ];
}

/**
 * Short "How to fill" sheet as a 2D array (one tip per row).
 * @returns {string[][]}
 */
export function householdsGuideGrid(events, presets) {
  const evs = events || [];
  const groups = (presets || DEFAULT_PRESETS).map((p) => p.name).filter(Boolean);
  const rows = [
    ["How to fill the Households sheet"],
    [""],
    ["Each row is one invitation (one household)."],
    ["household — required. Matching an existing name keeps that household's personal link."],
    ["members — optional names, separated with ; (used for name lookup on the site)."],
    ["tags — optional groups, separated with ; (for example close-family or friends)."],
  ];
  if (evs.length) {
    rows.push(["Each event column — how many people from that household are invited. Blank or 0 means not invited."]);
    rows.push([`Event columns in this file: ${evs.map((e) => e.name || e.id).join(", ")}.`]);
  } else {
    rows.push(["guests — how many people may come."]);
    rows.push(['events — event ids separated with ;, "all", or a group name (for example Friends).']);
  }
  if (groups.length) rows.push([`Group names you can use: ${groups.join(", ")}.`]);
  rows.push([""]);
  rows.push(["Delete the example rows before you import, or they will be added as households."]);
  rows.push(["Re-download this template after you add or rename events so the columns stay up to date."]);
  rows.push(["Save as .xlsx, then use Import CSV / Excel on the Guests tab and choose the file."]);
  return rows;
}

/**
 * Rewrite a sheet (2D array) into CSV-style rows for importRows.
 * Event name/id columns become an "events" cell ("mehndi:4; wedding:2").
 * Classic header rows pass through. Blank data rows are dropped.
 * @returns {{headerErrors:string[], rows:string[][]}}
 */
export function sheetToImportRows(grid, { events = [] } = {}) {
  const out = { headerErrors: [], rows: [] };
  const src = (grid || []).filter((r) => !isBlankRow(r));
  if (!src.length) { out.headerErrors.push("The file is empty."); return out; }
  const head = src[0].map((h) => cellText(h));
  const norm = head.map(normHeader);
  const hhIdx = norm.findIndex((h) => ["household", "name", "family"].includes(h));
  if (hhIdx < 0) { out.headerErrors.push('Missing a "household" column.'); return out; }

  const eventCols = [];
  for (let i = 0; i < head.length; i++) {
    if (FIXED_HEADERS.has(norm[i])) continue;
    const id = matchEventHeader(head[i], events);
    if (id) eventCols.push({ i, id });
  }

  if (!eventCols.length) {
    out.rows = src;
    return out;
  }

  const col = (...names) => norm.findIndex((h) => names.includes(h));
  const membersIdx = col("members", "names", "people");
  const tagsIdx = col("tags", "tag", "group");
  const guestsIdx = col("guests", "seats", "count", "invited");
  const outHead = ["household", "guests", "members", "tags", "events"];
  out.rows = [outHead];
  for (const r of src.slice(1)) {
    if (isBlankRow(r)) continue;
    const parts = [];
    for (const { i, id } of eventCols) {
      const raw = cellText(r[i]);
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) { parts.push(`${id}:${raw}`); continue; } // importRows will reject bad counts
      if (n > 0) parts.push(`${id}:${n}`);
    }
    const guests = guestsIdx >= 0 ? cellText(r[guestsIdx]) : "";
    out.rows.push([
      cellText(r[hhIdx]),
      guests,
      membersIdx >= 0 ? cellText(r[membersIdx]) : "",
      tagsIdx >= 0 ? cellText(r[tagsIdx]) : "",
      parts.join("; "),
    ]);
  }
  return out;
}

/* ---------- RSVP summary ---------- */
const j = (s) => { try { return JSON.parse(s); } catch { return {}; } };

/**
 * Turn the Apps Script summary (one Responses row per household and event: invited, attending) into dashboard numbers.
 * Per event: coming (people), declined (seats of replies that aren't coming), pending (seats of invited households
 * with no reply), invited (all seats invited). Dietary counts come from the Households rows.
 */
export function analyseSummary(summary, households, events) {
  const responses = summary.responses || [];
  const hsheet = summary.households || [];
  const byEvent = {};
  for (const e of events) byEvent[e.id] = { coming: 0, declined: 0, pending: 0, invited: 0, households: 0 };
  const reply = new Map(responses.map((r) => [`${r.code}|${r.eventId}`, r]));
  for (const h of households) for (const id of h.eventIds || []) {
    const c = byEvent[id];
    if (!c) continue;
    const s = eventSeatsOf(h, id) || seatsOf(h);
    c.invited += s;
    const r = reply.get(`${h.code}|${id}`);
    if (!r) { c.pending += s; continue; }
    const invited = Math.min(s, Math.max(0, Number(r.invited) || s));
    const n = Math.min(invited, Math.max(0, Number(r.attending) || 0));
    c.households++;
    c.coming += n;
    c.declined += invited - n;
  }
  const dietary = {};
  for (const x of hsheet) for (const part of String(x.dietary || "").split(";")) {
    const m = /^\s*(.+?):\s*(\d+)\s*$/.exec(part);
    if (m) dietary[m[1]] = (dietary[m[1]] || 0) + Number(m[2]);
  }
  const attending = Math.max(0, ...Object.values(byEvent).map((c) => c.coming));
  const repliedCodes = new Set([...responses.map((r) => r.code), ...hsheet.map((h) => h.code)]);
  const notReplied = households.filter((h) => !repliedCodes.has(h.code));
  const extras = hsheet.map((h) => ({ ...h, household: h.household || households.find((x) => x.code === h.code)?.household || h.code, shuttleSeats: j(h.shuttle) }));
  const hotel = { need: [], booked: [], local: [] };
  for (const x of extras) if (hotel[x.hotel]) hotel[x.hotel].push(x);
  const travel = extras.filter((x) => x.arrival || x.departure || x.flight || x.flightTime).sort((a, b) => String(a.arrival).localeCompare(String(b.arrival)));
  return { attending, byEvent, dietary, notReplied, hotel, travel, extras, replied: repliedCodes.size, total: households.length };
}

export function exportResponsesCsv(summary, households, events) {
  const a = analyseSummary(summary, households, events);
  const resp = summary.responses || [];
  const head = ["household", "guests", "replied", ...events.map((e) => e.id), "names", "dietary", "dietNote", "hotel", "arrival", "departure", "flight", "flightTime", "phone", "song", "message"];
  const rows = households.map((h) => {
    const rs = resp.filter((r) => r.code === h.code);
    const x = a.extras.find((e) => e.code === h.code) || {};
    const count = (id) => { const r = rs.find((q) => q.eventId === id); return r ? String(Number(r.attending) || 0) : (h.eventIds || []).includes(id) ? "" : "-"; };
    return [h.household, seatsOf(h), rs.length || x.code ? "yes" : "no", ...events.map((e) => count(e.id)), x.names || "", x.dietary || "", x.dietNote || "", x.hotel || "", x.arrival || "", x.departure || "", x.flight || "", x.flightTime || "", x.phone || "", x.song || "", x.message || ""];
  });
  return toCsv([head, ...rows]);
}

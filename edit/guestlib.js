// Pure helpers for the guest manager (no DOM, so they can be unit-tested in Node).
import { makeHousehold, seatsOf, eventSeatsOf, syncEventSeats, clampEventSeats, MAX_SEATS, rsvpByFor, deadlineWords, isHeld, waveOf } from "../src/lib/guestfiles.js";
export { deadlineWords };

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

export function waMessage(template, { household, link, content, waves }) {
  const site = content?.site || {};
  const couple = site.couple ? `${site.couple.first} & ${site.couple.second}` : site.title || "";
  const dl = rsvpByFor(household, waves)?.text || content?.rsvp?.deadlineText || content?.rsvp?.deadline || "";
  return String(template || DEFAULT_WA_TEMPLATE)
    .replaceAll("{greeting}", greetingName(household))
    .replaceAll("{household}", household.household)
    .replaceAll("{link}", link)
    .replaceAll("{couple}", couple)
    .replaceAll("{deadline}", dl ? ` by ${dl}` : "");
}

/** The Guest object a household's phone would receive (CONTRACTS section 6), built locally for "Preview as". */
export function makeGuestFor(household, events, waves) {
  const g = clone(household);
  delete g.id;
  delete g.wave;
  delete g.side;
  const by = rsvpByFor(household, waves);
  if (by) g.rsvpBy = by;
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

/* ---------- Sides (whose list a household is on) ----------
 * The bride's and groom's families each keep their own spreadsheet. A household's `side` is a short label, usually a
 * partner's first name ("Pearl"); "Pearl's side", "pearl", "PEARL SIDE" all mean the same side. */
export const sideKey = (s) => String(s || "").toLowerCase().replace(/['’]s\b/g, "").replace(/\b(side|family|list)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Known sides: the couple's first names first, then any other side already in use. */
export function knownSides(content, households = []) {
  const c = content?.site?.couple || {};
  const out = [];
  for (const s of [c.first, c.second, ...households.map((h) => h.side)]) if (s && !out.some((x) => sideKey(x) === sideKey(s))) out.push(String(s).trim());
  return out;
}
/** "pearl's side" -> "Pearl" when Pearl is known; otherwise the text tidied up (first letters capitalised). */
export function canonSide(raw, known = []) {
  const k = sideKey(raw);
  if (!k) return "";
  return known.find((s) => sideKey(s) === k) || k.replace(/\b\w/g, (m) => m.toUpperCase());
}
export const sideLabel = (s) => (s ? `${s}'s side` : "No side");

const NO_WAVE = new Set(["none", "nowave", "-", "—", "no"]);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Turn parsed CSV into import rows. Columns: household, guests (how many may come), members (optional names, ; separated),
 * side, wave, tags, events (ids, a preset name, or "mehndi:4; wedding:2"), code. Older files with plusOnes instead of guests
 * get names + plus-ones.
 *
 * Matching an existing household: by `code` first (so a downloaded sheet can rename households), then by name, preferring
 * the same side. A name that only exists on the other side's list is a problem row, so the two families never overwrite
 * each other or add the same household twice.
 *
 * Options: `side` is whose list the file is (used for rows with no side cell, and for "replace"); `mode` "merge" (add and
 * update; everything else stays) or "replace" (also remove that side's households that aren't in the file);
 * `defaultWave` is the wave id new households go to when their wave cell is empty.
 *
 * @returns {{headerErrors:string[], rows:{line:number, action:"add"|"update"|"same"|"error", errors:string[], warnings:string[], changes:string[], data:object, existingCode?:string}[], removals:object[]}}
 */
export function importRows(csvRows, { events, presets = [], existing = [], waves = [], side = "", mode = "merge", defaultWave = "", sides } = {}) {
  const out = { headerErrors: [], rows: [], removals: [] };
  if (!csvRows.length) { out.headerErrors.push("The file is empty."); return out; }
  const head = csvRows[0].map((h) => String(h).trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ci = { household: col("household", "name", "family"), members: col("members", "names", "people"), seats: col("guests", "seats", "count", "invited"), tags: col("tags", "tag", "group", "groups"), events: col("events", "event", "invitedto"), plusOnes: col("plusones", "plusone", "plus1"), side: col("side", "list", "whoselist"), wave: col("wave", "round"), code: col("code", "invitecode") };
  if (ci.household < 0) out.headerErrors.push('Missing a "household" column.');
  if (ci.seats < 0 && ci.members < 0 && ci.events < 0) out.headerErrors.push('Missing a "guests" or "events" column (how many people the household may bring).');
  if (out.headerErrors.length) return out;
  const ids = new Set(events.map((e) => e.id));
  const evName = (id) => events.find((e) => e.id === id)?.name || id;
  const known = sides || knownSides(null, existing);
  const fileSide = canonSide(side, known);
  const byCode = new Map(existing.map((h) => [String(h.code).toUpperCase(), h]));
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const waveByName = (raw) => waves.find((w) => norm(w.name) === norm(raw) || w.id === raw.trim());
  const waveName = (id) => waves.find((w) => w.id === id)?.name || "no wave";
  const seen = new Set();
  const matched = new Map(); // code -> first line that speaks for it (even a problem row, so "replace" never removes it)

  csvRows.slice(1).forEach((r, i) => {
    const get = (k) => (ci[k] >= 0 ? String(r[ci[k]] ?? "").trim() : "");
    const errors = [], warnings = [], changes = [];
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

    // Which existing household is this row?
    const codeRaw = get("code").toUpperCase();
    const sideCell = canonSide(get("side"), known);
    let prev = null;
    if (codeRaw) {
      prev = byCode.get(codeRaw) || null;
      if (!prev) errors.push(`No household has the code ${codeRaw}. Clear the code cell to add it as a new household.`);
    } else if (household) {
      const same = existing.filter((h) => norm(h.household) === norm(household));
      const want = sideCell || fileSide;
      prev = same.find((h) => sideKey(h.side) === sideKey(want)) || same.find((h) => !h.side) || null;
      const other = same.find((h) => h !== prev && h.side);
      if (!prev && other) errors.push(`Already on ${sideLabel(other.side)} list. Change it there, or give this row a different name.`);
    }
    if (prev && matched.has(prev.code)) errors.push(`Same household as row ${matched.get(prev.code)}`);
    else if (prev) matched.set(prev.code, i + 2);
    const rowSide = sideCell || (prev ? prev.side || fileSide : fileSide) || "";

    // Wave: a name from Waves, "none" to clear, blank = keep (existing) or the import's default (new).
    const wRaw = get("wave");
    let wave = prev ? prev.wave || "" : defaultWave || "";
    if (wRaw) {
      if (NO_WAVE.has(norm(wRaw).replace(/\s+/g, ""))) wave = "";
      else {
        const w = waveByName(wRaw);
        if (w) wave = w.id;
        else errors.push(waves.length ? `No wave called "${wRaw}" (waves: ${waves.map((x) => x.name).join(", ")})` : `No wave called "${wRaw}". Add it under Waves first.`);
      }
    }

    const key = codeRaw || `${sideKey(rowSide)}|${norm(household)}`;
    if (household && seen.has(key)) errors.push("Appears twice in this file");
    seen.add(key);
    if (!eventIds.length && !errors.length) warnings.push("Not invited to any event");
    const data = { household, members, tags, eventIds, seats: Number.isInteger(seats) && seats > 0 ? Math.min(seats, MAX_SEATS) : 1, side: rowSide, wave };
    if (eventSeats) data.eventSeats = eventSeats;
    else data.eventSeats = Object.fromEntries(eventIds.map((id) => [id, data.seats]));

    if (prev && !errors.length) {
      if (prev.household !== household) changes.push(`renamed from ${prev.household}`);
      const before = (prev.members || []).map((m) => m.name);
      const added = members.filter((n) => !before.some((b) => b.toLowerCase() === n.toLowerCase()));
      const gone = before.filter((b) => !members.some((n) => n.toLowerCase() === b.toLowerCase()));
      if (added.length) changes.push(`+ ${added.join(", ")}`);
      if (gone.length) changes.push(`− ${gone.join(", ")}`);
      if (!sameList([...(prev.tags || [])].sort(), [...tags].sort())) changes.push(`groups: ${tags.join(", ") || "none"}`);
      for (const id of new Set([...Object.keys(data.eventSeats), ...(prev.eventIds || [])])) {
        const a = eventSeatsOf(prev, id), b = data.eventSeats[id] || 0;
        if (a !== b) changes.push(`${evName(id)} ${a} → ${b}`);
      }
      if (sideKey(prev.side) !== sideKey(rowSide)) changes.push(rowSide ? `moved to ${sideLabel(rowSide)}` : "no side");
      if ((prev.wave || "") !== wave) changes.push(`wave: ${waveName(wave)}`);
    }
    out.rows.push({ line: i + 2, action: errors.length ? "error" : prev ? (changes.length ? "update" : "same") : "add", errors, warnings, changes, data, existingCode: prev?.code });
  });

  if (mode === "replace" && fileSide) {
    out.removals = existing.filter((h) => sideKey(h.side) === sideKey(fileSide) && !matched.has(h.code))
      .map((h) => ({ code: h.code, household: h.household, side: h.side, live: !isHeld(h, waves) }));
  }
  return out;
}

/** Apply good import rows (and removals) to a household list. Existing households keep their code, so links never change. */
export function applyImport(households, rows, { removals = [] } = {}) {
  const taken = new Set(households.map((h) => h.code));
  const drop = new Set(removals.map((r) => r.code));
  const list = clone(households).filter((h) => !drop.has(h.code));
  const setOpt = (h, k, v) => { if (v) h[k] = v; else delete h[k]; };
  for (const r of rows) {
    if (r.action === "error" || r.action === "same") continue;
    const d = r.data;
    if (r.action === "update") {
      const h = list.find((x) => x.code === r.existingCode);
      if (!h) continue;
      if (d.household && d.household !== h.household) {
        if (!h.greeting || h.greeting === `Dear ${h.household}`) h.greeting = `Dear ${d.household}`;
        h.household = d.household;
      }
      const keep = new Map(h.members.map((m) => [m.name.toLowerCase(), m]));
      let n = h.members.reduce((a, m) => Math.max(a, +String(m.id).replace(/\D/g, "") || 0), 0);
      h.members = d.members.map((name) => keep.get(name.toLowerCase()) || { id: `m${++n}`, name });
      h.tags = d.tags;
      h.eventSeats = { ...(d.eventSeats || Object.fromEntries((d.eventIds || []).map((id) => [id, d.seats]))) };
      syncEventSeats(h);
      if ("side" in d) setOpt(h, "side", d.side);
      if ("wave" in d) setOpt(h, "wave", d.wave);
    } else {
      list.push(makeHousehold({ id: slug(d.household) + "-" + Math.random().toString(36).slice(2, 6), household: d.household, members: d.members, tags: d.tags, eventIds: d.eventIds, seats: d.seats, eventSeats: d.eventSeats, side: d.side || undefined, wave: d.wave || undefined }, taken));
    }
  }
  return list;
}

const waveNameOf = (h, waves) => (waves || []).find((w) => w.id === h.wave)?.name || "";

export function exportHouseholdsCsv(households, events, linkFor, waves = []) {
  const evCell = (h) => (h.eventIds || []).filter((id) => events.some((e) => e.id === id)).map((id) => `${id}:${eventSeatsOf(h, id)}`).join("; ");
  return toCsv([
    ["household", "guests", "members", "tags", "events", "code", "link", "side", "wave"],
    ...households.map((h) => [h.household, seatsOf(h), h.members.map((m) => m.name).join("; "), (h.tags || []).join("; "), evCell(h), h.code, linkFor(h), h.side || "", waveNameOf(h, waves)]),
  ]);
}

/* ---------- Excel template / sheet adapter ---------- */
const FIXED_HEADERS = new Set(["household", "name", "family", "members", "names", "people", "guests", "seats", "count", "invited", "tags", "tag", "group", "groups", "events", "event", "invitedto", "plusones", "plusone", "plus1", "code", "invitecode", "link", "personallink", "side", "list", "whoselist", "wave", "round"]);
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
 * The Households sheet: one column per event (by display name), or the classic CSV columns when the draft has no events
 * yet. Pass `households` to get a filled-in list (a side's own sheet to edit and upload again); otherwise two example rows.
 * The code column ties each row to its household (and its link), so renames and edits land on the right invitation.
 * @returns {string[][]}
 */
export function householdsTemplateGrid(events, { examples = true, households = null, waves = [], linkFor = null, sides = [] } = {}) {
  const evs = events || [];
  if (!evs.length) {
    const head = ["household", "guests", "members", "tags", "events"];
    if (!examples) return [head];
    return [head, ["Sharma Family", "4", "Raj Sharma; Priya Sharma", "close-family", "all"], ["Maria Garcia", "2", "", "friends", "Friends"]];
  }
  const head = ["household", "members", "side", "wave", "tags", ...evs.map((e) => e.name || e.id), "code", "personal link"];
  if (households) {
    return [head, ...households.map((h) => [h.household, (h.members || []).map((m) => m.name).join("; "), h.side || "", waveNameOf(h, waves), (h.tags || []).join("; "),
      ...evs.map((e) => String(eventSeatsOf(h, e.id))), h.code, linkFor ? linkFor(h) : ""])];
  }
  if (!examples) return [head];
  const [s1 = "", s2 = ""] = sides;
  const all = evs.map(() => "4");
  const weddingOnly = evs.map((e) => (/wedding/i.test(e.id) || /wedding/i.test(e.name || "") ? "2" : "0"));
  return [
    head,
    ["Sharma Family", "Raj Sharma; Priya Sharma", s1, "", "close-family", ...all, "", ""],
    ["Maria Garcia", "", s2 || s1, "", "friends", ...weddingOnly, "", ""],
  ];
}

/**
 * Short "How to fill" sheet as a 2D array (one tip per row).
 * @returns {string[][]}
 */
export function householdsGuideGrid(events, presets, { waves = [], sides = [] } = {}) {
  const evs = events || [];
  const groups = (presets || DEFAULT_PRESETS).map((p) => p.name).filter(Boolean);
  const rows = [
    ["How to fill the Households sheet"],
    [""],
    ["Each row is one invitation (one household, with one personal link)."],
    ["household: required. The name on the invitation, for example Sharma Family."],
    ["members: optional names, separated with ; (used for name lookup on the site)."],
    [`side: whose list the household is on${sides.length ? ` (${sides.join(" or ")})` : ""}. Leave it blank and the side you pick when uploading is used.`],
    [waves.length ? `wave: which round of invitations (${waves.map((w) => w.name).join(", ")}). Leave it blank to keep it as it is, or write none.` : "wave: leave blank for now (add waves on the Guests tab to send invitations in rounds)."],
    ["tags: optional groups, separated with ; (for example close-family or friends)."],
  ];
  if (evs.length) {
    rows.push(["Each event column: how many people from that household are invited. Blank or 0 means not invited."]);
    rows.push([`Event columns in this file: ${evs.map((e) => e.name || e.id).join(", ")}.`]);
  } else {
    rows.push(["guests: how many people may come."]);
    rows.push(['events: event ids separated with ;, "all", or a group name (for example Friends).']);
  }
  if (groups.length) rows.push([`Group names you can use: ${groups.join(", ")}.`]);
  rows.push([""]);
  rows.push(["code: leave it as it is. It keeps each row tied to its invitation, so you can rename a household without changing its link."]);
  rows.push(["New households: add a row and leave the code blank. They get their own link when you import."]);
  rows.push(["personal link: for your reference only. It is ignored when you upload."]);
  rows.push([""]);
  rows.push(["Uploading: Guests tab, Import CSV / Excel. Pick whose list it is, then either add and update, or replace that side's whole list."]);
  rows.push(["Nothing changes until you press Import, and nothing goes live until you Publish."]);
  rows.push(["If this file came from Blank template, delete the two example rows first."]);
  return rows;
}

/**
 * Rewrite a sheet (2D array) into CSV-style rows for importRows.
 * Event name/id columns become an "events" cell ("mehndi:4; wedding:2"); side, wave and code pass through.
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
    out.rows = src.map((r) => r.map(cellText));
    return out;
  }

  const col = (...names) => norm.findIndex((h) => names.includes(h));
  const idx = { members: col("members", "names", "people"), tags: col("tags", "tag", "group", "groups"), guests: col("guests", "seats", "count", "invited"), side: col("side", "list", "whoselist"), wave: col("wave", "round"), code: col("code", "invitecode") };
  const at = (r, k) => (idx[k] >= 0 ? cellText(r[idx[k]]) : "");
  const outHead = ["household", "guests", "members", "tags", "events", "side", "wave", "code"];
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
    out.rows.push([cellText(r[hhIdx]), at(r, "guests"), at(r, "members"), at(r, "tags"), parts.join("; "), at(r, "side"), at(r, "wave"), at(r, "code")]);
  }
  return out;
}

/* ---------- RSVP summary ---------- */
/**
 * Turn the Apps Script summary (one Responses row per household and event: invited, attending) into dashboard numbers.
 * Per event: coming (people), declined (seats of replies that aren't coming), pending (seats of invited households
 * with no reply), invited (all seats invited). Names and notes come from the Households rows.
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
  const attending = Math.max(0, ...Object.values(byEvent).map((c) => c.coming));
  const repliedCodes = new Set([...responses.map((r) => r.code), ...hsheet.map((h) => h.code)]);
  const notReplied = households.filter((h) => !repliedCodes.has(h.code));
  const replies = hsheet.map((h) => ({ ...h, household: h.household || households.find((x) => x.code === h.code)?.household || h.code }));
  return { attending, byEvent, notReplied, replies, replied: repliedCodes.size, total: households.length };
}

/**
 * One entry per household on the guest list for the Responses view. `invited` and `coming` are per event id;
 * `coming[id]` is set only when the household answered for that event. `live` is false while the household's wave
 * hasn't been sent (its link doesn't work yet). `side` is the canonical side ("" when none).
 */
export function replyRows(summary, households, events, { waves = [], sides = [] } = {}) {
  const sheet = new Map((summary?.households || []).map((x) => [x.code, x]));
  const byCode = new Map();
  for (const r of summary?.responses || []) {
    if (!byCode.has(r.code)) byCode.set(r.code, new Map());
    byCode.get(r.code).set(r.eventId, r);
  }
  return households.map((h) => {
    const rs = byCode.get(h.code), row = sheet.get(h.code);
    const invited = {}, coming = {};
    for (const e of events) {
      const s = eventSeatsOf(h, e.id);
      if (!s) continue;
      invited[e.id] = s;
      const r = rs?.get(e.id);
      if (r) coming[e.id] = Math.min(s, Math.max(0, Math.round(Number(r.attending)) || 0));
    }
    const w = waveOf(h, waves);
    const stamps = [row?.submittedAt, ...[...(rs?.values() || [])].map((r) => r.updatedAt)].map((t) => Date.parse(t)).filter((t) => !Number.isNaN(t));
    return {
      code: h.code, household: h.household || row?.household || h.code, hh: h,
      side: canonSide(h.side, sides), wave: w?.id || "", live: !w || !!w.sent,
      replied: !!(rs || row), invited, coming, seats: seatsOf(h),
      message: String(row?.message || "").trim(),
      repliedAt: stamps.length ? Math.max(...stamps) : null,
    };
  });
}

/** Guests per event across reply rows that are live: invited, coming, declined (answered, not coming) and waiting. */
export function tallyEvents(rows, events) {
  const out = {};
  for (const e of events) out[e.id] = { invited: 0, coming: 0, declined: 0, waiting: 0 };
  for (const r of rows) {
    if (!r.live) continue;
    for (const [id, s] of Object.entries(r.invited)) {
      const c = out[id];
      if (!c) continue;
      c.invited += s;
      if (id in r.coming) { c.coming += r.coming[id]; c.declined += s - r.coming[id]; } else c.waiting += s;
    }
  }
  return out;
}

/** Whole days from `today` (a Date) to a "YYYY-MM-DD" date; negative once it has passed; null without a date. */
export function daysUntil(date, today = new Date()) {
  const [y, m, d] = String(date || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((new Date(y, m - 1, d) - t0) / 864e5);
}

export function exportResponsesCsv(summary, households, events, { waves = [] } = {}) {
  const a = analyseSummary(summary, households, events);
  const resp = summary.responses || [];
  const head = ["household", "guests", "side", "wave", "replied", ...events.map((e) => e.id), "names", "message"];
  const rows = households.map((h) => {
    const rs = resp.filter((r) => r.code === h.code);
    const x = a.replies.find((e) => e.code === h.code) || {};
    const count = (id) => { const r = rs.find((q) => q.eventId === id); return r ? String(Number(r.attending) || 0) : (h.eventIds || []).includes(id) ? "" : "-"; };
    return [h.household, seatsOf(h), h.side || "", waveOf(h, waves)?.name || "", rs.length || x.code ? "yes" : "no", ...events.map((e) => count(e.id)), x.names || "", x.message || ""];
  });
  return toCsv([head, ...rows]);
}

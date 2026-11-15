// Run: node apps-script/test-harness.mjs
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "Code.gs"), "utf8");

let reads = 0; // getRange().getValues() calls, to catch accidental per-row reads
function makeSheet() {
  const rows = [];
  let frozen = 0;
  const sheet = {
    rows,
    formats: [],
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => { reads++; return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? "")); },
        setValues: (vals) => vals.forEach((v, i) => { const row = (rows[r - 1 + i] ||= []); v.forEach((x, j) => { row[c - 1 + j] = x; }); }),
        setNumberFormat: (f) => { sheet.formats.push(f); },
      };
    },
    deleteRow: (n) => rows.splice(n - 1, 1),
    setFrozenRows: (n) => { frozen = n; },
    get frozen() { return frozen; },
  };
  return sheet;
}
let sheets = {};
let props = { ADMIN_KEY: "secret" };
let lockFails = false;
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet()) }) },
  LockService: { getScriptLock: () => ({ waitLock() { if (lockFails) throw new Error("Lock timeout"); }, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ t, setMimeType(m) { this.m = m; return this; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const reset = () => { sheets = {}; props = { ADMIN_KEY: "secret" }; lockFails = false; };
const raw = (text) => JSON.parse(ctx.doPost({ parameter: { payload: text } }).t);
const post = (P) => raw(JSON.stringify(P));
const get = (p) => JSON.parse(ctx.doGet({ parameter: p }).t);
// Household-level payload (v2): how many are coming to each event, food counts, optional names.
const mk = (counts, extras = {}) => ({
  v: 2, code: "ABCDE23456", household: "Test Fam", seats: 4, submittedAt: "2027-01-01T00:00:00Z",
  counts, names: "Raj, Priya", diet: { Jain: 1, "Nut allergy": 2 }, dietNote: "no onion",
  extras: { hotel: "need", shuttle: { wedding: 2 }, phone: "=1+1", ...extras },
});
const H = { invited: 2, names: 3, dietary: 4, dietNote: 5, hotel: 6, shuttle: 12, phone: 13, message: 15 }; // Households columns
const R = { eventId: 2, invited: 3, attending: 4 }; // Responses columns

/* ---------- basics (upsert, delete, get, summary) ---------- */
assert.equal(ctx.doGet({ parameter: {} }).t, "ok");
assert.equal(post({ ...mk({ wedding: 2 }), code: "bad" }).ok, false);
assert.equal(post(mk({})).ok, false, "no events");
assert.equal(post({ ...mk({ wedding: 2 }), seats: 0 }).ok, false, "no seats");

assert.equal(post(mk({ mehndi: 3, haldi: 2, wedding: 4 })).ok, true);
assert.equal(sheets.Responses.rows.length, 1 + 3, "one row per household and event");
assert.equal(sheets.Responses.frozen, 1);
assert.deepEqual(sheets.Responses.rows[0], ["code", "household", "eventId", "invited", "attending", "updatedAt"]);
assert.equal(sheets.Responses.rows.find((r) => r[R.eventId] === "wedding")[R.attending], 4);

// resubmit: replaced, not duplicated; an event dropped from the payload is deleted; changed value updated
assert.equal(post(mk({ mehndi: 1, wedding: 0 })).ok, true);
assert.equal(sheets.Responses.rows.length, 1 + 2, "rows replaced, haldi deleted");
assert.ok(!sheets.Responses.rows.some((r) => r[R.eventId] === "haldi"));
assert.equal(sheets.Responses.rows.find((r) => r[R.eventId] === "mehndi")[R.attending], 1);
assert.equal(sheets.Households.rows.length, 2, "one household row");
const hrow = sheets.Households.rows[1];
assert.equal(hrow[H.phone], "'=1+1", "formula injection neutralised");
assert.equal(hrow[H.invited], 4);
assert.equal(hrow[H.names], "Raj, Priya");
assert.equal(hrow[H.dietary], "Jain: 1; Nut allergy: 1", "food counts capped at the most coming to one event (1 here)");
assert.equal(hrow[H.dietNote], "no onion");
assert.equal(sheets.History.rows.length, 1 + 2);

// counts above the household's seats are capped
post({ ...mk({ wedding: 9 }), seats: 3 });
assert.equal(sheets.Responses.rows.find((r) => r[R.eventId] === "wedding")[R.attending], 3);

// another household is untouched
post({ ...mk({ mehndi: 2, wedding: 2 }), code: "ZZZZZ99999" });
post(mk({ mehndi: 3, wedding: 4 }));
assert.equal(sheets.Responses.rows.filter((r) => r[0] === "ABCDE23456").length, 2);
assert.equal(sheets.Responses.rows.filter((r) => r[0] === "ZZZZZ99999").length, 2);

const g = get({ action: "get", code: "abcde23456" });
assert.equal(g.ok, true);
assert.deepEqual(g.P.counts, { mehndi: 3, wedding: 4 });
assert.equal(g.P.v, 2);
assert.equal(get({ action: "get", code: "NOPE" }).P, null);
assert.equal(get({ action: "get", code: "QQQQQ22222" }).P, null);

assert.equal(get({ action: "summary", key: "wrong" }).ok, false);
const s = get({ action: "summary", key: "secret" });
assert.equal(s.ok, true);
assert.equal(s.households.length, 2);
assert.equal(s.responses.length, 4);
assert.deepEqual(s.counts.mehndi, { coming: 5, invited: 8, households: 2, declined: 0 });
assert.deepEqual(s.dietary, { Jain: 2, "Nut allergy": 4 });
assert.equal(s.households.find((h) => h.code === "ABCDE23456").phone, "=1+1", "summary hands the editor the guest's real text back");

/* ---------- edge cases ---------- */
// sheets are created as plain text so dates, times and phone numbers are not coerced
reset();
post(mk({ wedding: 1 }));
for (const n of ["Responses", "Households", "History"]) assert.deepEqual(sheets[n].formats, ["@"], `${n} is plain text`);

// formula injection in every free-text field (event ids are checked and prefixed, food labels and text prefixed)
const evil = (v) => ({
  v: 2, code: "ABCDE23456", household: v + "H", seats: 2, submittedAt: "2027-01-01T00:00:00Z",
  counts: { wedding: 2, "-x": 1 }, names: v + "N", diet: { [v + "D"]: 1 }, dietNote: v + "DN",
  extras: { hotel: v, arrival: v, departure: v, flight: v, flightTime: v, address: v, shuttle: {}, phone: v, song: v, message: v },
});
for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
  reset();
  const v = lead + "HYPERLINK(1)"; // short enough for the 20-character fields
  assert.equal(post(evil(v)).ok, true, "accepted, but neutralised: " + JSON.stringify(lead));
  const cells = [...sheets.Responses.rows.slice(1), ...sheets.Households.rows.slice(1)].flat().filter((c) => typeof c === "string");
  const dangerous = cells.filter((c) => /^[=+\-@\t\r]/.test(c));
  assert.deepEqual(dangerous, [], "no cell starts with a formula character for " + JSON.stringify(lead));
  const sum = get({ action: "summary", key: "secret" });
  assert.equal(sum.households[0].message, v, "round trips for the editor");
  assert.equal(sum.households[0].names, v + "N");
  assert.ok(sum.responses.some((r) => r.eventId === "-x"), "event id starting with - round trips");
  post(evil(v)); // re-submitting matches the prefixed event id instead of appending a duplicate row
  assert.equal(sheets.Responses.rows.length, 1 + 2);
}
reset();
assert.equal(post({ ...evil("x"), counts: { "=cmd|' /C calc'!A0": 1 } }).ok, false, "formula in eventId rejected");
assert.equal(sheets.Responses?.rows.length ?? 0, 0, "nothing written when rejected");

// a leading apostrophe that was not ours is left alone
reset();
post(evil("'quoted"));
assert.equal(get({ action: "summary", key: "secret" }).households[0].message, "'quoted");

// validation limits
reset();
const base = mk({ wedding: 2 });
assert.equal(raw("not json").ok, false);
assert.equal(raw("").ok, false);
assert.equal(raw("null").ok, false);
assert.equal(raw("[]").ok, false);
assert.equal(ctx.doPost({}).t.includes('"ok":false'), true);
assert.equal(ctx.doPost({ parameter: {} }).t.includes('"ok":false'), true);
assert.equal(post({ ...base, seats: 51 }).ok, false, "too many seats");
assert.equal(post({ ...base, seats: 2.5 }).ok, false, "fractional seats");
assert.equal(post({ ...base, counts: { wedding: -1 } }).ok, false, "negative count");
assert.equal(post({ ...base, counts: { wedding: 1.5 } }).ok, false, "fractional count");
assert.equal(post({ ...base, counts: { wedding: "lots" } }).ok, false, "non-numeric count");
assert.equal(post({ ...base, counts: [2] }).ok, false, "counts must be an object");
assert.equal(post({ ...base, counts: Object.fromEntries(Array.from({ length: 31 }, (_, i) => ["e" + i, 1])) }).ok, false, "too many events");
assert.equal(post({ ...base, diet: Object.fromEntries(Array.from({ length: 31 }, (_, i) => ["d" + i, 1])) }).ok, false, "too many food labels");
assert.equal(post({ ...base, names: "x".repeat(1001) }).ok, false, "names too long");
assert.equal(post({ ...base, extras: { message: "x".repeat(2001) } }).ok, false, "message too long");
assert.equal(raw(JSON.stringify(base) + " ".repeat(60001)).ok, false, "payload over 60 KB");
assert.equal(sheets.Responses?.rows.length ?? 0, 0, "invalid submissions never write");
assert.equal(post({ ...base, extras: { shuttle: { wedding: 9999, haldi: -1, sangeet: "abc", mehndi: 3.7 } } }).ok, true);
assert.equal(sheets.Households.rows[1][H.shuttle], '{"mehndi":3}', "shuttle seats clamped and floored");
// food labels can't smuggle the separators the summary parses
reset();
post({ ...base, diet: { "Veg; Jain: 9": 1 } });
assert.deepEqual(get({ action: "summary", key: "secret" }).dietary, { "Veg  Jain  9": 1 });

// the largest legal submission still fits in one Sheets cell (limit 50,000 characters) in History
reset();
const big = {
  v: 2, code: "ABCDE23456", household: "H".repeat(120), seats: 50, submittedAt: "2027-01-01T00:00:00Z",
  counts: Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["e" + String(i).padStart(2, "0").repeat(19), 50])),
  names: "N".repeat(1000), diet: Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["D" + String(i).padStart(2, "0").repeat(29), 50])), dietNote: "X".repeat(500),
  extras: { hotel: "need", arrival: "2027-07-22", departure: "2027-07-26", flight: "F".repeat(80), flightTime: "14:05", address: "A".repeat(2000), shuttle: {}, phone: "1".repeat(40), song: "S".repeat(200), message: "M".repeat(2000) },
};
assert.equal(post(big).ok, true);
assert.ok(sheets.History.rows[1][2].length < 50000, "history cell " + sheets.History.rows[1][2].length);
assert.ok(JSON.stringify(big).length < 60000);
assert.equal(Object.keys(get({ action: "get", code: "ABCDE23456" }).P.counts).length, 30);

// lock contention: waitLock throws, the client still gets JSON and nothing is written
reset();
lockFails = true;
const busy = post(mk({ wedding: 1 }));
assert.equal(busy.ok, false);
assert.match(busy.error, /Busy/);
assert.equal(sheets.Responses, undefined);
lockFails = false;

// summary without ADMIN_KEY configured is closed, even for an empty key
reset();
delete props.ADMIN_KEY;
assert.equal(get({ action: "summary", key: "" }).ok, false);
assert.equal(get({ action: "summary" }).ok, false);
assert.equal(get({ action: "summary", key: "undefined" }).ok, false);

// get never returns another household's data, and picks the latest of several submissions
reset();
post(mk({ wedding: 2 }));
post(mk({ wedding: 0 }));
post({ ...mk({ wedding: 3 }), code: "ZZZZZ99999" });
assert.equal(get({ action: "get", code: "ABCDE23456" }).P.counts.wedding, 0);
assert.equal(get({ action: "get", code: "ZZZZZ99999" }).P.counts.wedding, 3);
assert.equal(get({ action: "get" }).ok, false);
assert.equal(get({ action: "get", code: "ABCDE23456'; DROP" }).P, null);

// scale: 100 households x 5 events; submit all twice (re-submits replace), then summary and get stay a handful of reads
reset();
const L = (n) => String.fromCharCode(65 + n);
const codes = Array.from({ length: 100 }, (_, i) => "ABCDE" + L(Math.floor(i / 10)) + L(i % 10) + "222");
const events = ["mehndi", "haldi", "sangeet", "wedding", "reception"];
for (let pass = 0; pass < 2; pass++) {
  for (const code of codes) {
    const r = post({ v: 2, code, household: "HH " + code, seats: 4, submittedAt: "2027-01-01T00:00:00Z", counts: Object.fromEntries(events.map((e) => [e, pass ? 0 : 4])), names: "", diet: { Veg: 2 }, dietNote: "", extras: { hotel: "need", shuttle: {} } });
    assert.equal(r.ok, true);
  }
}
assert.equal(sheets.Responses.rows.length, 1 + 100 * 5, "no duplicates after re-submitting");
assert.equal(sheets.Households.rows.length, 1 + 100);
assert.equal(sheets.History.rows.length, 1 + 200);
const before = reads;
const one = get({ action: "get", code: codes[99] });
assert.equal(one.ok, true);
assert.ok(reads - before <= 3, `get reads the History code column once, not per row (${reads - before} reads)`);
const all = get({ action: "summary", key: "secret" });
assert.equal(all.responses.length, 500);
assert.equal(all.households.length, 100);
assert.deepEqual(all.counts.wedding, { coming: 0, invited: 400, households: 100, declined: 100 });
assert.deepEqual(all.dietary, {}, "food counts are dropped when nobody is coming");

console.log("apps-script harness: all assertions passed");

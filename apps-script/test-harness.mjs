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
const mk = (members, resp, extras = {}) => ({
  code: "ABCDE23456", household: "Test Fam", submittedAt: "2027-01-01T00:00:00Z",
  members: members.map((id) => ({ id, name: "N " + id, meal: "Vegan", dietary: "Nut allergy" })),
  responses: members.flatMap((id) => ["mehndi", "wedding"].map((e) => ({ memberId: id, eventId: e, attending: resp(id, e) }))),
  extras: { hotel: "need", shuttle: { wedding: 2 }, phone: "=1+1", ...extras },
});

/* ---------- basics (upsert, delete, get, summary) ---------- */
assert.equal(ctx.doGet({ parameter: {} }).t, "ok");
assert.equal(post({ ...mk(["m1"], () => "yes"), code: "bad" }).ok, false);
assert.equal(post({ ...mk(["m1"], () => "yes"), members: [] }).ok, false);

assert.equal(post(mk(["m1", "m2", "p1"], () => "yes")).ok, true);
assert.equal(sheets.Responses.rows.length, 1 + 6);
assert.equal(sheets.Responses.frozen, 1);

// resubmit: replaced, not duplicated; removed member deleted; changed value updated
assert.equal(post(mk(["m1", "m2"], (id, e) => (id === "m2" && e === "wedding" ? "no" : "yes"))).ok, true);
assert.equal(sheets.Responses.rows.length, 1 + 4, "rows replaced, p1 deleted");
assert.ok(!sheets.Responses.rows.some((r) => r[2] === "p1"));
assert.equal(sheets.Responses.rows.find((r) => r[2] === "m2" && r[4] === "wedding")[5], "no");
assert.equal(sheets.Households.rows.length, 2, "one household row");
assert.equal(sheets.Households.rows[1][9], "'=1+1", "formula injection neutralised");
assert.equal(sheets.History.rows.length, 1 + 2);

// another household is untouched
post({ ...mk(["m1"], () => "yes"), code: "ZZZZZ99999" });
post(mk(["m1", "m2"], () => "yes"));
assert.equal(sheets.Responses.rows.filter((r) => r[0] === "ABCDE23456").length, 4);
assert.equal(sheets.Responses.rows.filter((r) => r[0] === "ZZZZZ99999").length, 2);

const g = get({ action: "get", code: "abcde23456" });
assert.equal(g.ok, true);
assert.equal(g.P.members.length, 2);
assert.ok(g.P.responses.every((r) => r.attending === "yes"));
assert.equal(get({ action: "get", code: "NOPE" }).P, null);
assert.equal(get({ action: "get", code: "QQQQQ22222" }).P, null);

assert.equal(get({ action: "summary", key: "wrong" }).ok, false);
const s = get({ action: "summary", key: "secret" });
assert.equal(s.ok, true);
assert.equal(s.households.length, 2);
assert.equal(s.responses.length, 6);
assert.equal(s.counts.mehndi.yes, 3);
assert.equal(s.dietary["Nut allergy"], 6);
assert.equal(s.households.find((h) => h.code === "ABCDE23456").phone, "=1+1", "summary hands the editor the guest's real text back");

/* ---------- edge cases ---------- */
// sheets are created as plain text so dates, times and phone numbers are not coerced
reset();
post(mk(["m1"], () => "yes"));
for (const n of ["Responses", "Households", "History"]) assert.deepEqual(sheets[n].formats, ["@"], `${n} is plain text`);

// formula injection in every free-text field, including ones that are not names (eventId is rejected, the rest are prefixed)
reset();
const evil = (v) => ({
  code: "ABCDE23456", household: v + "H", submittedAt: "2027-01-01T00:00:00Z",
  members: [{ id: "m1", name: v + "N", meal: v + "M", dietary: v + "D" }],
  responses: [{ memberId: "m1", eventId: "wedding", attending: "yes" }],
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
  assert.equal(sum.responses[0].dietary, v + "D");
}
reset();
assert.equal(post({ ...evil("x"), responses: [{ memberId: "m1", eventId: "=cmd|' /C calc'!A0", attending: "yes" }] }).ok, false, "formula in eventId rejected");
assert.equal(sheets.Responses?.rows.length ?? 0, 0, "nothing written when rejected");

// a leading apostrophe that was not ours is left alone
reset();
post({ ...evil("'quoted"), });
assert.equal(get({ action: "summary", key: "secret" }).households[0].message, "'quoted");

// validation limits
reset();
const base = mk(["m1"], () => "yes");
assert.equal(raw("not json").ok, false);
assert.equal(raw("").ok, false);
assert.equal(raw("null").ok, false);
assert.equal(raw("[]").ok, false);
assert.equal(ctx.doPost({}).t.includes('"ok":false'), true);
assert.equal(ctx.doPost({ parameter: {} }).t.includes('"ok":false'), true);
assert.equal(post({ ...base, members: Array.from({ length: 13 }, (_, i) => ({ id: "m" + (i + 1), name: "x" })) }).ok, false, "13 members");
assert.equal(post({ ...base, members: [{ id: "x1", name: "x" }] }).ok, false, "bad member id");
assert.equal(post({ ...base, responses: [{ memberId: "m9", eventId: "wedding", attending: "yes" }] }).ok, false, "unknown member");
assert.equal(post({ ...base, responses: [{ memberId: "m1", eventId: "wedding", attending: "maybe" }] }).ok, false, "bad attending");
assert.equal(post({ ...base, members: [{ id: "m1", name: "x".repeat(121) }] }).ok, false, "name too long");
assert.equal(post({ ...base, extras: { message: "x".repeat(2001) } }).ok, false, "message too long");
assert.equal(post({ ...base, responses: Array.from({ length: 121 }, () => ({ memberId: "m1", eventId: "wedding", attending: "yes" })) }).ok, false, "too many responses");
assert.equal(raw(JSON.stringify(base) + " ".repeat(60001)).ok, false, "payload over 60 KB");
assert.equal(sheets.Responses?.rows.length ?? 0, 0, "invalid submissions never write");
assert.equal(post({ ...base, extras: { shuttle: { wedding: 9999, haldi: -1, sangeet: "abc", mehndi: 3.7 } } }).ok, true);
assert.equal(sheets.Households.rows[1][8], '{"mehndi":3}', "shuttle seats clamped and floored");

// duplicates inside one payload: the last answer wins and no duplicate rows
reset();
post({ ...base, responses: [{ memberId: "m1", eventId: "wedding", attending: "yes" }, { memberId: "m1", eventId: "wedding", attending: "no" }] });
assert.equal(sheets.Responses.rows.length, 2);
assert.equal(sheets.Responses.rows[1][5], "no");

// the largest legal submission still fits in one Sheets cell (limit 50,000 characters) in History
reset();
const big = {
  code: "ABCDE23456", household: "H".repeat(120), submittedAt: "2027-01-01T00:00:00Z",
  members: Array.from({ length: 12 }, (_, i) => ({ id: "m" + (i + 1), name: "N".repeat(120), meal: "M".repeat(500), dietary: "D".repeat(500) })),
  responses: Array.from({ length: 120 }, (_, i) => ({ memberId: "m" + ((i % 12) + 1), eventId: "e" + String(i % 10).repeat(30), attending: "yes" })),
  extras: { hotel: "need", arrival: "2027-07-22", departure: "2027-07-26", flight: "F".repeat(80), flightTime: "14:05", address: "A".repeat(2000), shuttle: {}, phone: "1".repeat(40), song: "S".repeat(200), message: "M".repeat(2000) },
};
assert.equal(post(big).ok, true);
assert.ok(sheets.History.rows[1][2].length < 50000, "history cell " + sheets.History.rows[1][2].length);
assert.ok(JSON.stringify(big).length < 60000);
assert.equal(get({ action: "get", code: "ABCDE23456" }).P.members.length, 12);

// lock contention: waitLock throws, the client still gets JSON and nothing is written
reset();
lockFails = true;
const busy = post(mk(["m1"], () => "yes"));
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
post(mk(["m1", "m2"], () => "yes"));
post(mk(["m1"], () => "no"));
post({ ...mk(["m1", "m2", "m3"], () => "yes"), code: "ZZZZZ99999" });
const latest = get({ action: "get", code: "ABCDE23456" }).P;
assert.equal(latest.members.length, 1);
assert.equal(latest.responses[0].attending, "no");
assert.equal(get({ action: "get", code: "ZZZZZ99999" }).P.members.length, 3);
assert.equal(get({ action: "get" }).ok, false);
assert.equal(get({ action: "get", code: "ABCDE23456'; DROP" }).P, null);

// scale: 100 households x 4 members x 5 events; submit all twice (re-submits replace), then summary and get stay a handful of reads
reset();
const L = (n) => String.fromCharCode(65 + n);
const codes = Array.from({ length: 100 }, (_, i) => "ABCDE" + L(Math.floor(i / 10)) + L(i % 10) + "222");
const events = ["mehndi", "haldi", "sangeet", "wedding", "reception"];
for (let pass = 0; pass < 2; pass++) {
  for (const code of codes) {
    const members = ["m1", "m2", "m3", "m4"];
    const r = post({ code, household: "HH " + code, submittedAt: "2027-01-01T00:00:00Z", members: members.map((id) => ({ id, name: "Guest " + id, meal: "Veg", dietary: "" })), responses: members.flatMap((id) => events.map((e) => ({ memberId: id, eventId: e, attending: pass ? "no" : "yes" }))), extras: { hotel: "need", shuttle: {} } });
    assert.equal(r.ok, true);
  }
}
assert.equal(sheets.Responses.rows.length, 1 + 100 * 4 * 5, "no duplicates after re-submitting");
assert.equal(sheets.Households.rows.length, 1 + 100);
assert.equal(sheets.History.rows.length, 1 + 200);
const before = reads;
const one = get({ action: "get", code: codes[99] });
assert.equal(one.ok, true);
assert.ok(reads - before <= 3, `get reads the History code column once, not per row (${reads - before} reads)`);
const all = get({ action: "summary", key: "secret" });
assert.equal(all.responses.length, 2000);
assert.equal(all.households.length, 100);
assert.equal(all.counts.wedding.no, 400);

console.log("apps-script harness: all assertions passed");

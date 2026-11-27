import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv, importRows, applyImport, DEFAULT_PRESETS, presetEventIds, waMessage, personalLink, analyseSummary, replyRows, tallyEvents, daysUntil, exportResponsesCsv, makeGuestFor, greetingName, householdsTemplateGrid, householdsGuideGrid, sheetToImportRows, matchEventHeader } from "../../edit/guestlib.js";
import { buildGuestFiles, openAdmin } from "../../src/lib/guestfiles.js";

const events = [{ id: "mehndi", name: "Mehndi", visibility: "private" }, { id: "sangeet", name: "Sangeet", visibility: "private" }, { id: "wedding", name: "Wedding", visibility: "public" }, { id: "reception", name: "Reception", visibility: "public" }];
const hh = (o) => ({ code: "AAAAAAAAAA", household: "X", greeting: "Dear X", members: [{ id: "m1", name: "A" }], plusOnes: 0, eventIds: [], tags: [], ...o });

test("parseCsv handles quotes, commas, CRLF and semicolon-delimited files", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n'), [["a", "b"], ["x, y", 'he said "hi"']]);
  assert.deepEqual(parseCsv("household;members\nSharma;Raj; Priya"), [["household", "members"], ["Sharma", "Raj", " Priya"]]);
  assert.equal(toCsv([["a", 'b"c', "d,e"]]), 'a,"b""c","d,e"\r\n');
});

test("importRows: presets by name, unknown events, existing households update and keep their code", () => {
  const rows = parseCsv("household,members,tags,events,plusOnes\nKim Family,Joon Kim; Ha Kim,,Friends,1\nBad,,x,nope,0\nSharma,Raj; New Person,,wedding;reception,0\nLee,Lee,,all,abc");
  const existing = [hh({ code: "SHARMAXXXX", household: "Sharma", members: [{ id: "m1", name: "Raj" }] })];
  const r = importRows(rows, { events, presets: DEFAULT_PRESETS, existing });
  assert.deepEqual(r.rows.map((x) => x.action), ["add", "error", "update", "error"]);
  assert.deepEqual(r.rows[0].data.eventIds, ["wedding"]);
  assert.ok(r.rows[0].data.tags.includes("friends"));
  assert.match(r.rows[1].errors.join(), /Unknown event "nope"/);
  assert.match(r.rows[3].errors.join(), /Plus-ones/);
  const out = applyImport(existing, r.rows);
  assert.equal(out.length, 2);
  const sharma = out.find((x) => x.household === "Sharma");
  assert.equal(sharma.code, "SHARMAXXXX");
  assert.deepEqual(sharma.members.map((m) => m.id), ["m1", "m2"]);
  assert.match(out.find((x) => x.household === "Kim Family").code, /^[A-HJKMNP-Z2-9]{10}$/);
});

test("importRows rejects a file without the required columns", () => {
  assert.match(importRows(parseCsv("foo,bar\n1,2"), { events, presets: [], existing: [] }).headerErrors.join(), /household/);
});

test("presets: * means every event; unknown ids are dropped", () => {
  assert.deepEqual(presetEventIds({ eventIds: ["*"] }, events), ["mehndi", "sangeet", "wedding", "reception"]);
  assert.deepEqual(presetEventIds({ eventIds: ["wedding", "gone"] }, events), ["wedding"]);
});

test("whatsapp message and links", () => {
  const content = { site: { couple: { first: "Pearl", second: "Aman" } }, rsvp: { deadlineText: "June 1st" } };
  const m = waMessage("Dear {greeting}: {link} {couple}{deadline}", { household: hh({ greeting: "Dear Sharma Family" }), link: "https://x.test/?i=ABC", content });
  assert.equal(m, "Dear Sharma Family: https://x.test/?i=ABC Pearl & Aman by June 1st");
  assert.equal(greetingName({ greeting: "Hi Raj", household: "R" }), "Hi Raj");
  assert.equal(personalLink({ siteUrl: "https://a.github.io/w" }, "CODE1"), "https://a.github.io/w/?i=CODE1");
  assert.equal(personalLink({}, "CODE1", "https://a.github.io/w/edit/"), "https://a.github.io/w/?i=CODE1");
});

test("makeGuestFor copies only the private events the household is invited to", () => {
  const g = makeGuestFor(hh({ id: "x", eventIds: ["sangeet", "wedding"] }), events);
  assert.deepEqual(g.privateEvents.map((e) => e.id), ["sangeet"]);
  assert.equal(g.id, undefined);
});

test("analyseSummary: headcounts per event against invited seats, awaiting = seats with no reply, replies from households", () => {
  const hs = [
    hh({ code: "C1", household: "One", seats: 4, eventIds: ["wedding", "reception"] }),
    hh({ code: "C2", household: "Two", seats: 2, eventIds: ["wedding"] }),
    hh({ code: "C3", household: "Three", members: [{ id: "m1", name: "a" }, { id: "m2", name: "b" }], plusOnes: 1, eventIds: ["wedding"] }), // older record: 3 seats
  ];
  const s = {
    households: [
      { code: "C1", names: "A, B, C", phone: "416 555 0100", message: "Can't wait" },
      { code: "C3", names: "", phone: "", message: "" },
    ],
    responses: [
      { code: "C1", eventId: "wedding", invited: "4", attending: "3" },
      { code: "C1", eventId: "reception", invited: "4", attending: "0" },
      { code: "C3", eventId: "wedding", invited: "3", attending: "9" }, // never more than the seats
    ],
  };
  const a = analyseSummary(s, hs, events);
  assert.deepEqual(a.byEvent.wedding, { coming: 6, declined: 1, pending: 2, invited: 9, households: 2 });
  assert.deepEqual(a.byEvent.reception, { coming: 0, declined: 4, pending: 0, invited: 4, households: 1 });
  assert.deepEqual(a.notReplied.map((h) => h.code), ["C2"]);
  assert.deepEqual(a.replies.map((x) => [x.household, x.phone]), [["One", "416 555 0100"], ["Three", ""]], "household names filled in from the guest list");
  assert.equal(a.attending, 6, "the biggest event's headcount");
});

test("replyRows + tallyEvents: per-household replies with side and wave; unsent waves stay out of event totals", () => {
  const waves = [{ id: "w1", name: "Family", sent: true }, { id: "w2", name: "Friends", sent: false }];
  const hs = [
    hh({ code: "C1", household: "One", side: "pearl's side", wave: "w1", eventIds: ["wedding", "reception"], eventSeats: { wedding: 4, reception: 4 } }),
    hh({ code: "C2", household: "Two", side: "Aman", wave: "w1", eventIds: ["wedding"], eventSeats: { wedding: 2 } }),
    hh({ code: "C3", household: "Three", side: "", wave: "w2", eventIds: ["wedding"], eventSeats: { wedding: 3 } }),
    hh({ code: "C4", household: "Four", eventIds: ["wedding"], eventSeats: { wedding: 2 } }),
  ];
  const s = {
    households: [{ code: "C1", message: "  See you there ", submittedAt: "2026-11-20T10:00:00Z" }],
    responses: [
      { code: "C1", eventId: "wedding", invited: "4", attending: "9", updatedAt: "2026-11-21T10:00:00Z" }, // never more than invited
      { code: "C1", eventId: "reception", invited: "4", attending: "1" },
      { code: "C4", eventId: "wedding", invited: "2", attending: "0" },
    ],
  };
  const rows = replyRows(s, hs, events, { waves, sides: ["Pearl", "Aman"] });
  assert.deepEqual(rows.map((r) => [r.code, r.side, r.wave, r.live, r.replied]), [
    ["C1", "Pearl", "w1", true, true], ["C2", "Aman", "w1", true, false], ["C3", "", "w2", false, false], ["C4", "", "", true, true]]);
  assert.deepEqual(rows[0].coming, { wedding: 4, reception: 1 });
  assert.equal(rows[0].message, "See you there");
  assert.equal(rows[0].repliedAt, Date.parse("2026-11-21T10:00:00Z"), "the latest timestamp wins");
  assert.equal(rows[1].repliedAt, null);
  const t = tallyEvents(rows, events);
  assert.deepEqual(t.wedding, { invited: 8, coming: 4, declined: 2, waiting: 2 }, "C3 is in an unsent wave");
  assert.deepEqual(t.reception, { invited: 4, coming: 1, declined: 3, waiting: 0 });
  assert.deepEqual(t.mehndi, { invited: 0, coming: 0, declined: 0, waiting: 0 });
  const csv = exportResponsesCsv(s, hs, events, { waves }).split(/\r?\n/);
  assert.equal(csv[0], "household,guests,side,wave,replied,mehndi,sangeet,wedding,reception,names,message");
  assert.match(csv[3], /^Three,3,,Friends,no,/);
});

test("daysUntil counts whole local days, negative once passed", () => {
  const today = new Date(2026, 10, 26, 18, 30);
  assert.equal(daysUntil("2026-11-26", today), 0);
  assert.equal(daysUntil("2027-01-31", today), 66);
  assert.equal(daysUntil("2026-11-20", today), -6);
  assert.equal(daysUntil("", today), null);
});

test("importRows: a guests column sets seats; names are optional; plusOnes files still work", () => {
  const r = importRows(parseCsv("household,guests,members,events\nPatel Family,5,,all\nKim,0,,all\nLee,x,,all"), { events, presets: [], existing: [] });
  assert.deepEqual(r.rows.map((x) => x.action), ["add", "error", "error"]);
  assert.equal(r.rows[0].data.seats, 5);
  assert.deepEqual(r.rows[0].data.eventSeats.wedding, 5);
  assert.match(r.rows[1].errors.join(), /Guests must be/);
  const old = importRows(parseCsv("household,members,events,plusOnes\nShah,Ravi Shah; Mina Shah,all,1"), { events, presets: [], existing: [] });
  assert.equal(old.rows[0].data.seats, 3);
  assert.equal(applyImport([], r.rows)[0].seats, 5);
  const per = importRows(parseCsv("household,events\nDesai,mehndi:4; wedding:2"), { events, presets: [], existing: [] });
  assert.equal(per.rows[0].action, "add");
  assert.deepEqual(per.rows[0].data.eventSeats, { mehndi: 4, wedding: 2 });
  assert.equal(per.rows[0].data.seats, 4);
  const applied = applyImport([], per.rows)[0];
  assert.deepEqual(applied.eventSeats, { mehndi: 4, wedding: 2 });
  assert.deepEqual(applied.eventIds, ["mehndi", "wedding"]);
});

test("Excel template grid uses event name columns, or classic CSV columns when there are no events", () => {
  const withEvents = householdsTemplateGrid([{ id: "mehendi", name: "Mehendi" }, { id: "wedding", name: "Wedding Ceremony" }]);
  assert.deepEqual(withEvents[0], ["household", "members", "side", "wave", "tags", "Mehendi", "Wedding Ceremony", "code", "personal link"]);
  assert.equal(withEvents[1][0], "Sharma Family");
  assert.deepEqual(withEvents[1].slice(5, 7), ["4", "4"]);
  assert.deepEqual(withEvents[2].slice(5, 7), ["0", "2"]);
  const bare = householdsTemplateGrid([{ id: "wedding", name: "Wedding" }], { examples: false });
  assert.deepEqual(bare, [["household", "members", "side", "wave", "tags", "Wedding", "code", "personal link"]]);
  assert.deepEqual(householdsTemplateGrid([])[0], ["household", "guests", "members", "tags", "events"]);
  const guide = householdsGuideGrid([{ id: "wedding", name: "Wedding" }], DEFAULT_PRESETS);
  assert.match(guide.map((r) => r[0]).join("\n"), /Wedding/);
  assert.match(guide.map((r) => r[0]).join("\n"), /Close family/);
});

test("sheetToImportRows: event name columns become per-event counts; classic headers pass through; blank rows drop", () => {
  assert.equal(matchEventHeader("Mehendi", [{ id: "mehendi", name: "Mehendi" }]), "mehendi");
  assert.equal(matchEventHeader("mehendi", [{ id: "mehendi", name: "Mehendi" }]), "mehendi");
  assert.equal(matchEventHeader("Unknown", events), null);

  const adapted = sheetToImportRows([
    ["household", "members", "tags", "Mehndi", "Wedding", ""],
    ["Patel Family", "A Patel; B Patel", "close-family", "4", "2", ""],
    ["", "", "", "", "", ""],
    ["Lee", "", "friends", "0", "1"],
  ], { events });
  assert.deepEqual(adapted.headerErrors, []);
  assert.deepEqual(adapted.rows[0], ["household", "guests", "members", "tags", "events", "side", "wave", "code"]);
  assert.deepEqual(adapted.rows[1], ["Patel Family", "", "A Patel; B Patel", "close-family", "mehndi:4; wedding:2", "", "", ""]);
  assert.deepEqual(adapted.rows[2], ["Lee", "", "", "friends", "wedding:1", "", "", ""]);
  assert.equal(adapted.rows.length, 3);

  const imported = importRows(adapted.rows, { events, presets: DEFAULT_PRESETS, existing: [] });
  assert.deepEqual(imported.rows.map((r) => r.action), ["add", "add"]);
  assert.deepEqual(imported.rows[0].data.eventSeats, { mehndi: 4, wedding: 2 });
  assert.equal(imported.rows[0].data.seats, 4);

  const classic = [
    ["household", "guests", "members", "tags", "events"],
    ["Kim", "2", "", "friends", "Friends"],
    ["", "", "", "", ""],
  ];
  const pass = sheetToImportRows(classic, { events });
  assert.deepEqual(pass.rows, [["household", "guests", "members", "tags", "events"], ["Kim", "2", "", "friends", "Friends"]]);

  assert.match(sheetToImportRows([["foo", "bar"]], { events }).headerErrors.join(), /household/);
  assert.match(sheetToImportRows([], { events }).headerErrors.join(), /empty/);
});

test("admin bundle carries presets and message templates, and old bundles still open", async () => {
  const presets = [{ id: "p", name: "P", tag: "p", eventIds: ["*"] }];
  const files = await buildGuestFiles({ households: [{ household: "A", members: ["A One"] }], privateEvents: [], passphrase: "pw", iter: 1000, presets, waTemplate: "Hi {greeting}", waReminder: "Hey" });
  const b = await openAdmin(files.adminJson, "pw");
  assert.deepEqual(b.presets, presets);
  assert.equal(b.waTemplate, "Hi {greeting}");
  assert.equal(b.waReminder, "Hey");
  const plain = await openAdmin((await buildGuestFiles({ households: [{ household: "A", members: ["A One"] }], passphrase: "pw", iter: 1000 })).adminJson, "pw");
  assert.equal(plain.presets, undefined);
});

test("waves: the {deadline} token and the preview guest use the household's wave date", () => {
  const waves = [{ id: "w2", name: "Second round", deadline: "2027-03-15", sent: false }];
  const content = { site: { couple: { first: "Pearl", second: "Aman" } }, rsvp: { deadlineText: "June 1st" } };
  const inWave = hh({ greeting: "Dear Sharma Family", wave: "w2" });
  assert.equal(waMessage("{deadline}", { household: inWave, link: "", content, waves }), " by March 15th, 2027");
  assert.equal(waMessage("{deadline}", { household: hh({ wave: "gone" }), link: "", content, waves }), " by June 1st");
  const g = makeGuestFor(inWave, events, waves);
  assert.deepEqual(g.rsvpBy, { date: "2027-03-15", text: "March 15th, 2027" });
  assert.equal(g.wave, undefined);
});

/* ---------- sides, codes, replace and waves in the spreadsheet import ---------- */
const sides = ["Pearl", "Aman"];
const W = [{ id: "w1", name: "Close family", deadline: "2027-01-31", sent: true }, { id: "w2", name: "Second round", deadline: "2027-03-15", sent: false }];
const hx = (o) => hh({ members: [], greeting: `Dear ${o.household}`, ...o });
const list = () => [
  hx({ code: "PEARLSHRMA", household: "Sharma Family", side: "Pearl", wave: "w1", members: [{ id: "m1", name: "Raj" }], eventIds: ["wedding"], eventSeats: { wedding: 2 } }),
  hx({ code: "PEARLKAPOR", household: "Kapoor Family", side: "Pearl", eventIds: ["wedding"], eventSeats: { wedding: 2 } }),
  hx({ code: "PEARLHELDX", household: "Held Family", side: "Pearl", wave: "w2", eventIds: ["wedding"], eventSeats: { wedding: 1 } }),
  hx({ code: "AMANPATELX", household: "Patel Family", side: "Aman", eventIds: ["wedding"], eventSeats: { wedding: 4 } }),
];
const sheet = (rows) => sheetToImportRows([["household", "members", "side", "wave", "tags", "Wedding", "code", "personal link"], ...rows], { events }).rows;

test("sides: any spelling of a side lands on the known name", async () => {
  const { canonSide, sideKey, knownSides } = await import("../../edit/guestlib.js");
  assert.equal(canonSide("pearl's side", sides), "Pearl");
  assert.equal(canonSide("AMAN SIDE", sides), "Aman");
  assert.equal(canonSide("Nani’s family", sides), "Nani");
  assert.equal(sideKey(""), "");
  assert.deepEqual(knownSides({ site: { couple: { first: "Pearl", second: "Aman" } } }, [{ side: "pearl" }, { side: "Friends" }]), ["Pearl", "Aman", "Friends"]);
});

test("import: the code ties a row to its household (rename keeps the link); new rows take the file's side and default wave", () => {
  const r = importRows(sheet([
    ["Sharma Parivar", "Raj; Priya", "", "", "", "3", "PEARLSHRMA", "https://x/?i=PEARLSHRMA"],
    ["Mehta Family", "", "", "", "", "2", "", ""],
  ]), { events, existing: list(), waves: W, side: "pearl", defaultWave: "w2", sides });
  assert.deepEqual(r.rows.map((x) => x.action), ["update", "add"]);
  assert.deepEqual(r.rows[0].changes, ["renamed from Sharma Family", "+ Priya", "Wedding 2 → 3"]);
  assert.equal(r.rows[0].data.wave, "w1"); // blank wave keeps what it had
  assert.deepEqual([r.rows[1].data.side, r.rows[1].data.wave], ["Pearl", "w2"]);
  assert.deepEqual(r.removals, []); // merge never removes
  const out = applyImport(list(), r.rows);
  const sh = out.find((x) => x.code === "PEARLSHRMA");
  assert.equal(sh.household, "Sharma Parivar");
  assert.equal(sh.greeting, "Dear Sharma Parivar");
  assert.deepEqual(sh.members.map((m) => m.id), ["m1", "m2"]);
  const mehta = out.find((x) => x.household === "Mehta Family");
  assert.deepEqual([mehta.side, mehta.wave], ["Pearl", "w2"]);
});

test("import: the other side's household is never overwritten or duplicated by name", () => {
  const r = importRows(sheet([["Patel Family", "", "", "", "", "2", "", ""]]), { events, existing: list(), waves: W, side: "Pearl", sides });
  assert.equal(r.rows[0].action, "error");
  assert.match(r.rows[0].errors.join(), /Already on Aman's side list/);
  const mine = importRows(sheet([["Patel Family", "", "Aman", "", "", "4", "", ""]]), { events, existing: list(), waves: W, side: "Pearl", sides });
  assert.equal(mine.rows[0].action, "same"); // the side cell says it's Aman's, and nothing changed
});

test("import: replace removes only that side's households missing from the file, and flags live links", () => {
  const r = importRows(sheet([
    ["Sharma Family", "Raj", "", "", "", "2", "PEARLSHRMA", ""],
    ["Bad", "", "", "Nope", "", "2", "PEARLKAPOR", ""],
  ]), { events, existing: list(), waves: W, side: "Pearl", mode: "replace", sides });
  assert.deepEqual(r.rows.map((x) => x.action), ["same", "error"]);
  assert.match(r.rows[1].errors.join(), /No wave called "Nope" \(waves: Close family, Second round\)/);
  // Kapoor is on a problem row, so it stays; Patel is Aman's, so it stays; Held is removed (and its link was never live)
  assert.deepEqual(r.removals, [{ code: "PEARLHELDX", household: "Held Family", side: "Pearl", live: false }]);
  const out = applyImport(list(), r.rows, { removals: r.removals });
  assert.deepEqual(out.map((x) => x.code), ["PEARLSHRMA", "PEARLKAPOR", "AMANPATELX"]);
  const live = importRows(sheet([]), { events, existing: list(), waves: W, side: "Aman", mode: "replace", sides });
  assert.deepEqual(live.removals.map((x) => [x.code, x.live]), [["AMANPATELX", true]]);
});

test("import: unknown code, duplicate rows, wave none, and the filled-in sheet round-trips", () => {
  const r = importRows(sheet([
    ["Ghost", "", "", "", "", "1", "ZZZZZZZZZZ", ""],
    ["Kapoor Family", "", "", "none", "", "2", "PEARLKAPOR", ""],
    ["Kapoor Family", "", "", "", "", "2", "PEARLKAPOR", ""],
    ["Held Family", "", "", "close family", "", "1", "", ""],
  ]), { events, existing: list(), waves: W, side: "Pearl", sides });
  assert.match(r.rows[0].errors.join(), /No household has the code ZZZZZZZZZZ/);
  assert.equal(r.rows[1].action, "same");
  assert.match(r.rows[2].errors.join(), /twice|Same household as row 3/);
  const two = importRows(sheet([["Kapoor Family", "", "", "", "", "3", "PEARLKAPOR", ""], ["kapoor family", "", "", "", "", "1", "", ""]]), { events, existing: list(), waves: W, side: "Pearl", sides });
  assert.deepEqual(two.rows.map((x) => x.action), ["update", "error"]);
  assert.match(two.rows[1].errors.join(), /Same household as row 2/);
  assert.deepEqual(r.rows[3].changes, ["wave: Close family"]);
  const grid = householdsTemplateGrid(events, { households: list().slice(0, 2), waves: W, linkFor: (h) => `L/${h.code}` });
  assert.deepEqual(grid[1], ["Sharma Family", "Raj", "Pearl", "Close family", "", "0", "0", "2", "0", "PEARLSHRMA", "L/PEARLSHRMA"]);
  const back = importRows(sheetToImportRows(grid, { events }).rows, { events, existing: list(), waves: W, side: "Pearl", sides });
  assert.deepEqual(back.rows.map((x) => x.action), ["same", "same"]);
});

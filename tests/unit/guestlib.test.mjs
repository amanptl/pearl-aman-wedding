import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv, importRows, applyImport, DEFAULT_PRESETS, presetEventIds, waMessage, personalLink, analyseSummary, makeGuestFor, greetingName, householdsTemplateGrid, householdsGuideGrid, sheetToImportRows, matchEventHeader } from "../../edit/guestlib.js";
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

test("analyseSummary: headcounts per event against invited seats, awaiting = seats with no reply, food from households", () => {
  const hs = [
    hh({ code: "C1", household: "One", seats: 4, eventIds: ["wedding", "reception"] }),
    hh({ code: "C2", household: "Two", seats: 2, eventIds: ["wedding"] }),
    hh({ code: "C3", household: "Three", members: [{ id: "m1", name: "a" }, { id: "m2", name: "b" }], plusOnes: 1, eventIds: ["wedding"] }), // older record: 3 seats
  ];
  const s = {
    households: [
      { code: "C1", hotel: "need", arrival: "2027-07-22", flight: "AC1", shuttle: "{}", names: "A, B, C", dietary: "Vegetarian: 3; Jain: 1", dietNote: "one nut allergy" },
      { code: "C3", hotel: "", shuttle: "{}", dietary: "Vegetarian: 2" },
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
  assert.deepEqual(a.dietary, { Vegetarian: 5, Jain: 1 });
  assert.deepEqual(a.notReplied.map((h) => h.code), ["C2"]);
  assert.equal(a.hotel.need.length, 1);
  assert.equal(a.attending, 6, "the biggest event's headcount");
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
  assert.deepEqual(withEvents[0], ["household", "members", "tags", "Mehendi", "Wedding Ceremony"]);
  assert.equal(withEvents[1][0], "Sharma Family");
  assert.deepEqual(withEvents[1].slice(3), ["4", "4"]);
  assert.deepEqual(withEvents[2].slice(3), ["0", "2"]);
  const bare = householdsTemplateGrid([{ id: "wedding", name: "Wedding" }], { examples: false });
  assert.deepEqual(bare, [["household", "members", "tags", "Wedding"]]);
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
  assert.deepEqual(adapted.rows[0], ["household", "guests", "members", "tags", "events"]);
  assert.deepEqual(adapted.rows[1], ["Patel Family", "", "A Patel; B Patel", "close-family", "mehndi:4; wedding:2"]);
  assert.deepEqual(adapted.rows[2], ["Lee", "", "", "friends", "wedding:1"]);
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

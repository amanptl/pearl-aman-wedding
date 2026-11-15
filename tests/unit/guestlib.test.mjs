import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv, importRows, applyImport, DEFAULT_PRESETS, presetEventIds, waMessage, personalLink, analyseSummary, makeGuestFor, greetingName } from "../../edit/guestlib.js";
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
  assert.deepEqual(r.rows[0].data.eventIds, ["sangeet", "wedding", "reception"]);
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

test("analyseSummary: pending = invited members without an answer, replied households, meals once per person", () => {
  const hs = [hh({ code: "C1", household: "One", members: [{ id: "m1", name: "a" }, { id: "m2", name: "b" }], eventIds: ["wedding", "reception"] }), hh({ code: "C2", household: "Two", eventIds: ["wedding"] })];
  const s = {
    households: [{ code: "C1", hotel: "need", arrival: "2027-07-22", flight: "AC1", shuttle: "{}" }],
    responses: [
      { code: "C1", memberId: "m1", eventId: "wedding", attending: "yes", meal: "Veg", dietary: "Nut; Gluten" },
      { code: "C1", memberId: "m1", eventId: "reception", attending: "yes", meal: "Veg", dietary: "Nut; Gluten" },
      { code: "C1", memberId: "m2", eventId: "wedding", attending: "no", meal: "", dietary: "" },
    ],
  };
  const a = analyseSummary(s, hs, events);
  assert.deepEqual(a.byEvent.wedding, { yes: 1, no: 1, pending: 1, invited: 3 });
  assert.deepEqual(a.byEvent.reception, { yes: 1, no: 0, pending: 1, invited: 2 });
  assert.deepEqual(a.meals, { Veg: 1 });
  assert.deepEqual(a.dietary, { Nut: 1, Gluten: 1 });
  assert.deepEqual(a.notReplied.map((h) => h.code), ["C2"]);
  assert.equal(a.hotel.need.length, 1);
  assert.equal(a.attending, 1);
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

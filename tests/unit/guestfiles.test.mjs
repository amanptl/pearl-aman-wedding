import test from "node:test";
import assert from "node:assert/strict";
import { buildGuestFiles, openAdmin, nameVariants, reuseCodes } from "../../src/lib/guestfiles.js";
import { sha256Hex, deriveKey, decryptJSON, normName, randomCode, CODE_ALPHABET } from "../../src/lib/crypto.js";

const ITER = 1000;
const events = [
  { id: "mehndi", name: "Mehndi", venue: { name: "Maple Grove Tent" } },
  { id: "sangeet", name: "Sangeet", venue: { name: "Lakeview Ballroom" } },
];
const hh = () => [
  { id: "a", household: "Sharma Family", members: ["Raj Sharma", "Priya Sharma", "Anika Kumar Sharma"], eventIds: ["mehndi", "sangeet", "wedding"], tags: ["close-family"] },
  { id: "b", household: "Zed Household", members: ["Zed Quillfeather", "Guest", ""], eventIds: ["wedding"] },
  { id: "c", household: "Other Sharmas", members: ["Raj Sharma"], eventIds: ["sangeet"] },
];
const build = (households = hh(), extra = {}) => buildGuestFiles({ households, privateEvents: events, passphrase: "pw", iter: ITER, ...extra });

async function lookup(g, nn) {
  const rec = g.names[await sha256Hex(nn)];
  if (!rec) return null;
  return decryptJSON(await deriveKey(nn, g.kdf.salt, g.kdf.iter), rec);
}

test("round trip: admin bundle and household record", async () => {
  const { guestsJson, adminJson } = await build();
  const admin = await openAdmin(adminJson, "pw");
  assert.equal(admin.households.length, 3);
  assert.equal(admin.privateEvents.length, 2);
  assert.ok(admin.rsvpAdminKey.length >= 16);
  const h = admin.households[0];
  const g = await decryptJSON(await deriveKey(h.code, guestsJson.kdf.salt, guestsJson.kdf.iter), guestsJson.records[await sha256Hex(h.code)]);
  assert.equal(g.household, "Sharma Family");
  assert.deepEqual(g.privateEvents.map((e) => e.id), ["mehndi", "sangeet"]);
  assert.equal(g.members[0].id, "m1");
});

test("wrong passphrase rejects clearly", async () => {
  const { adminJson } = await build();
  await assert.rejects(openAdmin(adminJson, "nope"), { message: "Wrong passphrase" });
});

test("codes stay stable across re-runs and are well-formed", async () => {
  const first = await openAdmin((await build()).adminJson, "pw");
  const again = reuseCodes(hh(), first.households);
  const second = await openAdmin((await build(again, { rsvpAdminKey: first.rsvpAdminKey })).adminJson, "pw");
  assert.deepEqual(second.households.map((h) => h.code), first.households.map((h) => h.code));
  assert.equal(second.rsvpAdminKey, first.rsvpAdminKey);
  for (const h of first.households) assert.match(h.code, new RegExp(`^[${CODE_ALPHABET}]{10}$`));
  assert.equal(new Set(first.households.map((h) => h.code)).size, 3);
  assert.equal(randomCode(25).length, 25);
});

test("name variants", async () => {
  assert.deepEqual(nameVariants("Anika Kumar Sharma").sort(), ["anika kumar sharma", "anika sharma", "sharma anika"]);
  assert.deepEqual(nameVariants("José  Núñez"), ["jose nunez", "nunez jose"]);
  assert.deepEqual(nameVariants("Guest"), []);
  assert.deepEqual(nameVariants("  "), []);
  const { guestsJson } = await build();
  assert.ok(await lookup(guestsJson, "zed quillfeather"));
  assert.ok(await lookup(guestsJson, "quillfeather zed"));
  assert.ok(await lookup(guestsJson, "anika kumar sharma"));
  assert.equal(await lookup(guestsJson, "guest"), null);
  assert.equal(normName("O'Brien-Smith"), "obriensmith");
});

test("collisions produce a codes list", async () => {
  const { guestsJson, adminJson } = await build();
  const admin = await openAdmin(adminJson, "pw");
  const r = await lookup(guestsJson, "raj sharma");
  assert.deepEqual([...r.codes].sort(), [admin.households[0].code, admin.households[2].code].sort());
  const solo = await lookup(guestsJson, "priya sharma");
  assert.equal(solo.code, admin.households[0].code);
});

test("guests.json leaks no plaintext names or private event strings", async () => {
  const { guestsJson } = await build();
  const text = JSON.stringify(guestsJson).toLowerCase();
  for (const s of ["sharma", "priya", "quillfeather", "mehndi", "sangeet", "maple grove", "lakeview", "household", "anika"]) {
    assert.ok(!text.includes(s), `found ${s}`);
  }
  assert.deepEqual(Object.keys(guestsJson).sort(), ["kdf", "names", "records", "v"]);
});

test("nameLookup: false publishes no name index (a known name can't be turned into a code)", async () => {
  const { guestsJson } = await build(hh(), { nameLookup: false });
  assert.deepEqual(guestsJson.names, {});
  assert.ok(Object.keys(guestsJson.records).length > 0);
});

test("seats: explicit seats win; older records count names + plus-ones; always 1..MAX_SEATS", async () => {
  const { seatsOf, makeHousehold, eventSeatsOf, syncEventSeats, MAX_SEATS } = await import("../../src/lib/guestfiles.js");
  assert.equal(seatsOf({ seats: 6, members: [{ name: "a" }] }), 6);
  assert.equal(seatsOf({ members: [{ name: "a" }, { name: "b" }, { name: "" }], plusOnes: 1 }), 3);
  assert.equal(seatsOf({ members: [] }), 1);
  assert.equal(seatsOf({ seats: 999 }), MAX_SEATS);
  assert.equal(makeHousehold({ household: "No names", seats: 4 }).seats, 4);
  assert.equal(makeHousehold({ household: "Old", members: ["a", "b"], plusOnes: 2 }).seats, 4);
  assert.equal(makeHousehold({ household: "Old" }).plusOnes, undefined);
  const per = makeHousehold({ household: "Mixed", eventSeats: { mehndi: 4, wedding: 2 } });
  assert.deepEqual(per.eventSeats, { mehndi: 4, wedding: 2 });
  assert.deepEqual(per.eventIds, ["mehndi", "wedding"]);
  assert.equal(per.seats, 4);
  assert.equal(eventSeatsOf(per, "mehndi"), 4);
  assert.equal(eventSeatsOf(per, "wedding"), 2);
  assert.equal(eventSeatsOf(per, "reception"), 0);
  const old = syncEventSeats({ seats: 3, eventIds: ["wedding", "reception"], members: [] });
  assert.deepEqual(old.eventSeats, { wedding: 3, reception: 3 });
  assert.equal(eventSeatsOf({ seats: 2, eventIds: ["wedding"] }, "wedding"), 2);
});

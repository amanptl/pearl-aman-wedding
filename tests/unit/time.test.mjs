import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { toInstant, formatTime, formatRange, formatDate, nowNext, tzLabel, daysUntil } from "../../src/lib/time.js";

const iso = (d) => d.toISOString();
const cwd = new URL("../..", import.meta.url);

test("toInstant: summer EDT and winter EST", () => {
  assert.equal(iso(toInstant("2027-07-25T16:00", "America/Toronto")), "2027-07-25T20:00:00.000Z");
  assert.equal(iso(toInstant("2027-01-15T16:00", "America/Toronto")), "2027-01-15T21:00:00.000Z");
});
test("toInstant: spring-forward gap resolves forward", () => {
  assert.equal(iso(toInstant("2027-03-14T02:30", "America/Toronto")), "2027-03-14T07:30:00.000Z"); // = 03:30 EDT
  assert.equal(iso(toInstant("2027-03-14T01:59", "America/Toronto")), "2027-03-14T06:59:00.000Z");
  assert.equal(iso(toInstant("2027-03-14T03:00", "America/Toronto")), "2027-03-14T07:00:00.000Z");
});
test("toInstant: ambiguous fall-back resolves to the earlier instant", () => {
  assert.equal(iso(toInstant("2027-11-07T01:30", "America/Toronto")), "2027-11-07T05:30:00.000Z"); // EDT
  assert.equal(iso(toInstant("2027-11-07T02:30", "America/Toronto")), "2027-11-07T07:30:00.000Z"); // EST
});
test("toInstant: other zones and date-only", () => {
  assert.equal(iso(toInstant("2027-07-25T12:00", "Asia/Kolkata")), "2027-07-25T06:30:00.000Z");
  assert.equal(iso(toInstant("2027-07-25", "UTC")), "2027-07-25T00:00:00.000Z");
  assert.ok(Number.isNaN(toInstant("nope").getTime()));
});
test("formatTime / formatRange", () => {
  assert.equal(formatTime("2027-07-23T18:00"), "6:00 PM");
  assert.equal(formatTime("2027-07-23T00:05"), "12:05 AM");
  assert.equal(formatRange("2027-07-23T18:00", "2027-07-23T23:00"), "6:00 – 11:00 PM");
  assert.equal(formatRange("2027-07-23T10:00", "2027-07-23T13:00"), "10:00 AM – 1:00 PM");
  assert.equal(formatRange("2027-07-23T18:00", "2027-07-24T01:00"), "6:00 PM – 1:00 AM");
  assert.equal(formatRange("2027-07-23T18:00", null), "6:00 PM");
});
test("formatDate styles", () => {
  assert.equal(formatDate("2027-07-23T12:00"), "Friday, July 23");
  assert.equal(formatDate("2027-07-23T12:00", "America/Toronto", "short"), "Fri, Jul 23");
  assert.equal(formatDate("2027-07-23T12:00", "America/Toronto", "full"), "Friday, July 23, 2027");
});
test("tzLabel", () => {
  assert.equal(tzLabel("America/Toronto", "2027-07-25T16:00"), "Toronto time (EDT)");
  assert.equal(tzLabel("America/Toronto", "2027-01-25T16:00"), "Toronto time (EST)");
  assert.match(tzLabel("America/Toronto"), /^Toronto time \(E[SD]T\)$/);
});
test("nowNext", () => {
  const ev = [
    { id: "a", start: "2027-07-23T17:00", end: "2027-07-23T21:00" },
    { id: "b", start: "2027-07-24T18:00", end: "2027-07-24T23:00" },
  ];
  const at = (s) => toInstant(s, "America/Toronto");
  const before = nowNext(ev, at("2027-07-23T12:00"));
  assert.equal(before.current, null);
  assert.equal(before.next.id, "a");
  const during = nowNext(ev, at("2027-07-23T18:00"));
  assert.equal(during.current.id, "a");
  assert.equal(during.next.id, "b");
  assert.equal(nowNext(ev, at("2027-07-23T21:00")).current, null);
  assert.equal(nowNext(ev, at("2027-07-25T00:00")).next, null);
});
test("daysUntil", () => {
  assert.equal(daysUntil("2027-07-25", toInstant("2027-07-20T12:00"), "America/Toronto"), 4);
});

// groupByDay must not depend on the device time zone.
const probe = `
import { groupByDay } from "./src/lib/time.js";
const ev=[{id:"c",start:"2027-07-24T00:30"},{id:"a",start:"2027-07-23T23:30"},{id:"b",start:"2027-07-23T09:00"}];
console.log(JSON.stringify(groupByDay(ev,"America/Toronto").map(d=>[d.key,d.label,d.events.map(e=>e.id)])));`;
for (const TZ of ["Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"]) {
  test(`groupByDay uses venue-local dates (device TZ=${TZ})`, () => {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], { env: { ...process.env, TZ }, cwd }).toString();
    assert.deepEqual(JSON.parse(out), [
      ["2027-07-23", "Friday, July 23", ["b", "a"]],
      ["2027-07-24", "Saturday, July 24", ["c"]],
    ]);
  });
}
test("formatTime/toInstant independent of device TZ", () => {
  const p = `import {formatTime,toInstant} from "./src/lib/time.js";console.log(formatTime("2027-07-23T18:00","America/Toronto"),toInstant("2027-03-14T02:30","America/Toronto").toISOString())`;
  for (const TZ of ["Asia/Kolkata", "America/Los_Angeles"]) {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", p], { env: { ...process.env, TZ }, cwd }).toString().trim();
    assert.equal(out, "6:00 PM 2027-03-14T07:30:00.000Z");
  }
});

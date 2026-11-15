import test from "node:test";
import assert from "node:assert/strict";
import { icsForEvents, foldLine, googleCalUrl, outlookCalUrl } from "../../src/lib/calendar.js";

const site = { title: "Pearl & Aman", timezone: "America/Toronto", siteUrl: "https://example.com/wedding/" };
const ev = [
  { id: "mehndi", name: "Mehndi", start: "2027-07-23T17:00", end: "2027-07-23T21:00", venue: { name: "Home, Oakville", address: "1 Maple; Dr", lat: 43.4, lng: -79.6 }, description: "Henna, chai\nand music; bring \\ stuff", dressCode: { title: "Colourful" } },
  { id: "wedding", name: "Wedding", start: "2027-07-25T16:00", venue: { name: "Hall" } },
];
const ics = icsForEvents(ev, site);
const unfolded = ics.replace(/\r\n /g, "");

test("CRLF everywhere, trailing CRLF", () => {
  assert.ok(ics.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(ics));
});
test("lines <= 75 octets", () => {
  for (const l of ics.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75, l);
});
test("header properties", () => {
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:.+\r\n/);
  assert.ok(ics.includes("METHOD:PUBLISH\r\n"));
  assert.ok(unfolded.includes("X-WR-CALNAME:Pearl & Aman's Wedding"));
});
test("stable UIDs, UTC times, DTSTAMP", () => {
  assert.ok(ics.includes("UID:mehndi@pearl-aman"));
  assert.ok(ics.includes("DTSTART:20270723T210000Z"));
  assert.ok(ics.includes("DTEND:20270724T010000Z"));
  assert.ok(ics.includes("DTSTART:20270725T200000Z"));
  assert.ok(ics.includes("DTEND:20270725T220000Z")); // default 2h
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
});
test("escaping", () => {
  assert.ok(unfolded.includes("LOCATION:Home\\, Oakville\\, 1 Maple\\; Dr"));
  assert.ok(unfolded.includes("Henna\\, chai\\nand music\\; bring \\\\ stuff"));
});
test("description includes dress code and site url; URL deep link", () => {
  assert.ok(unfolded.includes("Dress code: Colourful"));
  assert.ok(unfolded.includes("\\nhttps://example.com/wedding/"));
  assert.ok(unfolded.includes("URL:https://example.com/wedding/#schedule/mehndi"));
});
test("alarms: 1 day for first event, 2 hours after", () => {
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  assert.ok(blocks[0].includes("TRIGGER:-P1D"));
  assert.ok(blocks[1].includes("TRIGGER:-PT2H"));
});
test("foldLine is UTF-8 safe", () => {
  const long = "SUMMARY:" + "\u00e9\u20ac\u{1F600}".repeat(40);
  const folded = foldLine(long);
  for (const l of folded.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75);
  assert.equal(folded.replace(/\r\n /g, ""), long);
  assert.equal(foldLine("short"), "short");
});
test("googleCalUrl", () => {
  const u = new URL(googleCalUrl(ev[0], site));
  assert.equal(u.searchParams.get("dates"), "20270723T210000Z/20270724T010000Z");
  assert.equal(u.searchParams.get("ctz"), "America/Toronto");
  assert.equal(u.searchParams.get("action"), "TEMPLATE");
  assert.match(u.searchParams.get("details"), /example\.com/);
});
test("outlookCalUrl", () => {
  const u = new URL(outlookCalUrl(ev[0], site));
  assert.equal(u.host, "outlook.live.com");
  assert.equal(u.searchParams.get("startdt"), "2027-07-23T21:00:00Z");
  assert.equal(u.searchParams.get("enddt"), "2027-07-24T01:00:00Z");
  assert.equal(u.searchParams.get("rru"), "addevent");
});

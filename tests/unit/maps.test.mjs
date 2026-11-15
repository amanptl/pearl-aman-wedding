import test from "node:test";
import assert from "node:assert/strict";
import { directionsUrl, mapEmbedUrl, driveEstimate, telUrl, whatsappUrl, mapsLinkToLatLng } from "../../src/lib/maps.js";

const setUA = (userAgent, maxTouchPoints = 0) => Object.defineProperty(globalThis, "navigator", { value: { userAgent, maxTouchPoints }, configurable: true });
const place = { name: "Hall", address: "1 Main St, Oakville", lat: 43.5, lng: -79.7 };
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

test("Apple Maps on iPhone, iPadOS-as-Mac, macOS Safari", () => {
  setUA(IPHONE);
  assert.equal(directionsUrl(place), "https://maps.apple.com/?daddr=43.5%2C-79.7&q=Hall&dirflg=d");
  setUA(MAC_SAFARI, 5); // iPadOS desktop UA
  assert.ok(directionsUrl(place).startsWith("https://maps.apple.com/"));
  setUA(MAC_SAFARI, 0);
  assert.ok(directionsUrl(place).startsWith("https://maps.apple.com/"));
});
test("Google Maps elsewhere", () => {
  for (const ua of [MAC_CHROME, ANDROID]) {
    setUA(ua);
    assert.equal(directionsUrl(place), "https://www.google.com/maps/dir/?api=1&destination=43.5%2C-79.7");
  }
});
test("address fallback and origin", () => {
  setUA(ANDROID);
  assert.equal(directionsUrl({ address: "1 Main St" }), "https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St");
  assert.ok(directionsUrl(place, { origin: "Toronto, ON" }).endsWith("&origin=Toronto%2C%20ON"));
  assert.ok(directionsUrl(place, { origin: { lat: 1, lng: 2 } }).endsWith("&origin=1%2C2"));
  setUA(IPHONE);
  assert.ok(directionsUrl(place, { origin: "A" }).includes("&saddr=A"));
});
test("mapEmbedUrl", () => {
  assert.equal(mapEmbedUrl(place), "https://www.google.com/maps?q=43.5%2C-79.7&output=embed");
  assert.equal(mapEmbedUrl({ address: "1 Main St" }), "https://www.google.com/maps?q=1%20Main%20St&output=embed");
});
test("driveEstimate", () => {
  assert.ok(Number.isNaN(driveEstimate({}, place)));
  const m = driveEstimate({ lat: 43.65, lng: -79.38 }, { lat: 43.4675, lng: -79.6877 });
  assert.ok(m >= 25 && m <= 50 && m % 5 === 0, String(m));
  assert.equal(driveEstimate(place, place), 5);
});
test("telUrl / whatsappUrl", () => {
  assert.equal(telUrl("+1 (416) 555-0142"), "tel:+14165550142");
  assert.equal(whatsappUrl("+1 (416) 555-0142"), "https://wa.me/14165550142");
  assert.equal(whatsappUrl("+1 416 555 0142", "Hi there & hello"), "https://wa.me/14165550142?text=Hi%20there%20%26%20hello");
});
test("mapsLinkToLatLng", () => {
  const want = { lat: 43.4675, lng: -79.6877 };
  assert.deepEqual(mapsLinkToLatLng("https://www.google.com/maps/place/Oakville/@43.4675,-79.6877,15z/data=!3m1"), want);
  assert.deepEqual(mapsLinkToLatLng("https://www.google.com/maps?q=43.4675,-79.6877"), want);
  assert.deepEqual(mapsLinkToLatLng("https://maps.apple.com/?ll=43.4675%2C-79.6877&q=Hall"), want);
  assert.deepEqual(mapsLinkToLatLng("https://www.google.com/maps/place/X/@10,10,15z/data=!4m5!3m4!1s0x0:0x0!8m2!3d43.4675!4d-79.6877"), want);
  assert.deepEqual(mapsLinkToLatLng("https://www.google.com/maps/dir/?api=1&destination=43.4675,-79.6877"), want);
  assert.equal(mapsLinkToLatLng("https://example.com"), null);
  assert.equal(mapsLinkToLatLng(""), null);
  assert.equal(mapsLinkToLatLng("https://x/?q=999,999"), null);
});

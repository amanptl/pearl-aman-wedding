// Parse coordinates out of a Google Maps (or Apple Maps) link. Uses src/lib/maps.js mapsLinkToLatLng when present.
import * as maps from "../src/lib/maps.js";

const ok = (lat, lng) => (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: +lat.toFixed(6), lng: +lng.toFixed(6) } : null);

export function parseMapsLink(url) {
  if (typeof maps.mapsLinkToLatLng === "function") {
    try { const r = maps.mapsLinkToLatLng(url); if (r && Number.isFinite(r.lat) && Number.isFinite(r.lng)) return { lat: r.lat, lng: r.lng }; } catch {}
  }
  const s = decodeURIComponent(String(url));
  let m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/); // exact place pin
  if (m) return ok(+m[1], +m[2]);
  m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]);
  m = s.match(/[?&](?:q|ll|query|center|destination|daddr|sll)=(-?\d+(?:\.\d+)?)[,+ ](-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]);
  m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return ok(+m[1], +m[2]);
  return null;
}

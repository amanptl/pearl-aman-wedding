// Map links and distance estimates. STUB: working implementation; owner: utilities agent.

/** @typedef {{address?:string, lat?:number, lng?:number, mapsQuery?:string, name?:string}} Place */

const isApple = () => {
  const ua = navigator.userAgent || "";
  const iosLike = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const macSafari = /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
  return iosLike || macSafari;
};
const hasCoords = (p) => typeof p?.lat === "number" && typeof p?.lng === "number";
const query = (p) => (p?.address || p?.mapsQuery || p?.name || (hasCoords(p) ? `${p.lat},${p.lng}` : ""));

/**
 * Directions link: Apple Maps on iOS / iPadOS / macOS Safari, Google Maps otherwise.
 * Prefers lat,lng (plus a name label) when available.
 * @param {Place} place
 * @param {{origin?: Place|string}} [opts] optional starting point (place, "lat,lng" or address string)
 * @returns {string}
 */
export function directionsUrl(place, { origin } = {}) {
  const dest = hasCoords(place) ? `${place.lat},${place.lng}` : query(place);
  const org = origin == null ? "" : typeof origin === "string" ? origin : hasCoords(origin) ? `${origin.lat},${origin.lng}` : query(origin);
  if (isApple()) {
    let u = `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}`;
    if (org) u += `&saddr=${encodeURIComponent(org)}`;
    if (hasCoords(place) && place.name) u += `&q=${encodeURIComponent(place.name)}`;
    return u + "&dirflg=d";
  }
  let u = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  if (org) u += `&origin=${encodeURIComponent(org)}`;
  return u;
}

/** Key-less embeddable map URL for an <iframe>. @param {Place} place @returns {string} */
export function mapEmbedUrl(place) {
  const q = hasCoords(place) ? `${place.lat},${place.lng}` : query(place);
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
}

/**
 * Rough drive time: haversine distance x 1.35 road factor at 55 km/h, rounded to the nearest 5 minutes (min 5).
 * @param {{lat:number,lng:number}} a @param {{lat:number,lng:number}} b @returns {number} minutes
 */
export function driveEstimate(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return NaN;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h)) * 1.35;
  return Math.max(5, Math.round(((km / 55) * 60) / 5) * 5);
}

/** @returns {string} tel: link, digits and leading + only */
export function telUrl(phone) {
  return "tel:" + String(phone || "").replace(/[^\d+]/g, "");
}

/** @returns {string} wa.me link with optional prefilled text */
export function whatsappUrl(phone, text = "") {
  const digits = String(phone || "").replace(/\D/g, "");
  return `https://wa.me/${digits}` + (text ? `?text=${encodeURIComponent(text)}` : "");
}

/**
 * Parse a pasted Google / Apple Maps URL into coordinates (for the editor).
 * Supports !3d..!4d.. (place pin), @lat,lng, q= / ll= / daddr= / destination= / center= lat,lng.
 * @param {string} url @returns {{lat:number,lng:number}|null}
 */
export function mapsLinkToLatLng(url) {
  const s = String(url || "");
  let decoded = s;
  try { decoded = decodeURIComponent(s); } catch { /* keep raw */ }
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const pats = [
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`[?&](?:q|ll|daddr|destination|center|sll|saddr)=\\s*\\+?${num}\\s*,\\s*${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`/(?:place|dir)/[^/]*/${num},${num}`),
  ];
  for (const re of pats) {
    const m = decoded.match(re);
    if (!m) continue;
    const lat = +m[1], lng = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

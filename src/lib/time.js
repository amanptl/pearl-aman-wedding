// Venue-time helpers. Local ISO strings ("2027-07-23T18:00") are wall-clock times at the venue's time zone.
// STUB: working implementation; owner: utilities agent. Keep signatures stable.

const DEFAULT_TZ = "America/Toronto";
const dtfCache = new Map();
const dtf = (tz, opts, key) => {
  const k = tz + key;
  if (!dtfCache.has(k)) dtfCache.set(k, new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }));
  return dtfCache.get(k);
};
const fixSpaces = (s) => s.replace(/[  ]/g, " ");

/** Offset (ms) of tz from UTC at the given instant. */
function offsetMs(date, tz) {
  const parts = dtf(tz, { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }, "off").formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, +x.value]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Convert a local ISO string at a time zone to the real instant (handles DST).
 * @param {string} isoLocal "2027-07-23T18:00" (or date only)
 * @param {string} [tz] IANA zone, default America/Toronto
 * @returns {Date}
 */
export function toInstant(isoLocal, tz = DEFAULT_TZ) {
  const m = String(isoLocal).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return new Date(NaN);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const DAY = 864e5;
  const before = offsetMs(new Date(guess - DAY), tz);
  const after = offsetMs(new Date(guess + DAY), tz);
  const valid = [...new Set([before, after])].map((o) => guess - o).filter((t) => guess - t === offsetMs(new Date(t), tz));
  // Ambiguous (fall back): earlier instant. Gap (spring forward): apply the pre-gap offset, which lands after the gap.
  const t = valid.length ? Math.min(...valid) : guess - before;
  return new Date(t);
}

/** "Toronto time (EDT)": zone city plus the abbreviation in force at isoLocal (default: now). */
export function tzLabel(tz = DEFAULT_TZ, isoLocal) {
  const city = String(tz).split("/").pop().replace(/_/g, " ");
  let abbr = "";
  try {
    const d = isoLocal ? toInstant(isoLocal, tz) : new Date();
    abbr = dtf(tz, { timeZoneName: "short" }, "abbr").formatToParts(d).find((x) => x.type === "timeZoneName")?.value || "";
  } catch { /* ignore */ }
  return `${city} time${abbr ? ` (${abbr})` : ""}`;
}

/**
 * @param {string} isoLocal
 * @param {string} tz
 * @param {"long"|"short"|"full"} [style] long: "Friday, July 23"; short: "Fri, Jul 23"; full: "Friday, July 23, 2027"
 * @returns {string}
 */
export function formatDate(isoLocal, tz = DEFAULT_TZ, style = "long") {
  const d = toInstant(isoLocal, tz);
  const o = style === "short" ? { weekday: "short", month: "short", day: "numeric" } : style === "full" ? { weekday: "long", month: "long", day: "numeric", year: "numeric" } : { weekday: "long", month: "long", day: "numeric" };
  return fixSpaces(dtf(tz, o, "d" + style).format(d));
}

/** @returns {string} e.g. "6:00 PM" */
export function formatTime(isoLocal, tz = DEFAULT_TZ) {
  return fixSpaces(dtf(tz, { hour: "numeric", minute: "2-digit" }, "t").format(toInstant(isoLocal, tz)));
}

/** @returns {string} "6:00 – 9:00 PM" (shared meridiem collapsed) or "6:00 PM – 1:00 AM"; start only when no end */
export function formatRange(start, end, tz = DEFAULT_TZ) {
  const a = formatTime(start, tz);
  if (!end) return a;
  const b = formatTime(end, tz);
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  const [at, ap] = a.split(" ");
  const [, bp] = b.split(" ");
  const left = ap === bp ? at : a;
  return `${sameDay ? left : a} – ${b}`;
}

/**
 * Group events by local calendar day, each day sorted by start.
 * @param {{start:string}[]} events
 * @param {string} tz
 * @returns {{key:string, label:string, events:object[]}[]} key "2027-07-23", label "Friday, July 23"
 */
export function groupByDay(events, tz = DEFAULT_TZ) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const days = [];
  for (const e of sorted) {
    const key = e.start.slice(0, 10);
    let day = days.find((d) => d.key === key);
    if (!day) days.push((day = { key, label: formatDate(key + "T12:00", e.timezone || tz, "long"), events: [] }));
    day.events.push(e);
  }
  return days;
}

/**
 * Which event is happening now, and which is next.
 * @param {{start:string,end?:string,timezone?:string}[]} events
 * @param {Date} now
 * @param {string} [tz] default zone for events without their own
 * @returns {{current: object|null, next: object|null}}
 */
export function nowNext(events, now, tz = DEFAULT_TZ) {
  const t = now.getTime();
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  let current = null, next = null;
  for (const e of sorted) {
    const z = e.timezone || tz;
    const s = toInstant(e.start, z).getTime();
    const en = e.end ? toInstant(e.end, z).getTime() : s + 2 * 36e5;
    if (s <= t && t < en) current = current || e;
    else if (s > t && !next) next = e;
  }
  return { current, next };
}

/** True when the viewer's device is in a different UTC offset than the venue zone right now. */
export function guestTzDiffers(tz = DEFAULT_TZ) {
  try {
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (mine === tz) return false;
    const now = new Date();
    return offsetMs(now, mine) !== offsetMs(now, tz);
  } catch {
    return false;
  }
}

/**
 * Whole days from now until isoDate (floor; 0 on the day, negative after).
 * @param {string} isoDate "2027-07-25" or local ISO date-time
 * @param {Date} now
 * @param {string} [tz]
 * @returns {number}
 */
export function daysUntil(isoDate, now, tz = DEFAULT_TZ) {
  return Math.floor((toInstant(isoDate, tz).getTime() - now.getTime()) / 864e5);
}

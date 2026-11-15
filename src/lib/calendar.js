// Calendar export: RFC 5545 ICS, download helper, Google / Outlook deeplinks. Owner: utilities agent.
import { toInstant } from "./time.js";

const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsEsc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
const enc = new TextEncoder();

/** Fold one content line at 75 octets (CRLF + single space continuation), never splitting a UTF-8 sequence. */
export function foldLine(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "", n = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > limit) { out.push(cur); cur = ""; n = 0; limit = 74; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const tzOf = (e, site) => e.timezone || site?.timezone || "America/Toronto";
const times = (e, site) => {
  const tz = tzOf(e, site);
  const s = toInstant(e.start, tz);
  const en = e.end ? toInstant(e.end, tz) : new Date(s.getTime() + 2 * 36e5);
  return [s, en];
};
const where = (e) => [e.venue?.name, e.venue?.address].filter(Boolean).join(", ");
const baseUrl = (site) => {
  let u = site?.siteUrl || "";
  if (!u && typeof location !== "undefined" && /^https?:/.test(location.protocol)) u = location.origin + location.pathname;
  return u;
};
const eventUrl = (e, site) => { const u = baseUrl(site); return u ? `${u.replace(/#.*$/, "")}#schedule/${e.id}` : ""; };
const description = (e, site) => [e.description, e.dressCode?.title && `Dress code: ${e.dressCode.title}`, baseUrl(site)].filter(Boolean).join("\n");
const summary = (e, site) => `${e.name} \u2013 ${site?.title || "Wedding"}`;

/**
 * Build an .ics file.
 * @param {object[]} events content events
 * @param {{title?:string, timezone?:string, siteUrl?:string}} site content.site
 * @returns {string} CRLF-separated iCalendar text (times in UTC)
 */
export function icsForEvents(events, site = {}) {
  const stamp = utc(new Date());
  const firstStart = Math.min(...events.map((e) => times(e, site)[0].getTime()));
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pearl and Aman//Wedding Site//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEsc("Pearl & Aman's Wedding")}`,
  ];
  for (const e of events) {
    const [s, en] = times(e, site);
    lines.push("BEGIN:VEVENT", `UID:${e.id}@pearl-aman`, `DTSTAMP:${stamp}`, `DTSTART:${utc(s)}`, `DTEND:${utc(en)}`);
    lines.push(`SUMMARY:${icsEsc(summary(e, site))}`);
    if (where(e)) lines.push(`LOCATION:${icsEsc(where(e))}`);
    if (typeof e.venue?.lat === "number" && typeof e.venue?.lng === "number") lines.push(`GEO:${e.venue.lat};${e.venue.lng}`);
    const desc = description(e, site);
    if (desc) lines.push(`DESCRIPTION:${icsEsc(desc)}`);
    const url = eventUrl(e, site);
    if (url) lines.push(`URL:${url}`);
    const first = s.getTime() === firstStart;
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(summary(e, site))}`, `TRIGGER:${first ? "-P1D" : "-PT2H"}`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/**
 * Trigger a download of an .ics file (Blob + anchor). Where the download attribute is unsupported (older iOS Safari)
 * it navigates to the blob/data URL so iOS offers to open it in Calendar.
 * @param {object[]} events @param {object} site @param {string} [filename]
 */
export function downloadIcs(events, site, filename = "wedding.ics") {
  const text = icsForEvents(events, site);
  const safe = String(filename).replace(/[^\w.\-]+/g, "-");
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  if (!("download" in a)) {
    try { location.href = URL.createObjectURL(blob); }
    catch { location.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(text); }
    return;
  }
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = safe;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** @returns {string} Google Calendar "add event" URL @param {object} event @param {object} site */
export function googleCalUrl(event, site = {}) {
  const [s, en] = times(event, site);
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: summary(event, site),
    dates: `${utc(s)}/${utc(en)}`,
    ctz: tzOf(event, site),
    details: description(event, site),
    location: where(event),
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/** @returns {string} Outlook.com "add event" deeplink @param {object} event @param {object} site */
export function outlookCalUrl(event, site = {}) {
  const [s, en] = times(event, site);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const p = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: summary(event, site),
    startdt: iso(s),
    enddt: iso(en),
    body: description(event, site),
    location: where(event),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`;
}

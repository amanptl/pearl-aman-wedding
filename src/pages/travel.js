import { html, raw, editAttrs, listAttrs, itemAttrs, imgTag, showField } from "../lib/dom.js";
import { formatDate, formatTime, daysUntil } from "../lib/time.js";
import { directionsUrl, driveEstimate, telUrl, whatsappUrl } from "../lib/maps.js";
import { copyText } from "../lib/ui.js";
import * as icon from "../lib/icons.js";

const SEGMENTS = [
  { id: "stay", label: "Where to Stay" },
  { id: "getting-here", label: "Getting Here" },
  { id: "around", label: "Around Town" },
];

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Distinct venues for the viewer's events; events that share a venue are grouped. */
function venueGroups(events) {
  const groups = [];
  for (const e of events) {
    const v = e.venue;
    if (!v || !(v.name || v.address)) continue;
    const key = (v.address || v.name || "").trim().toLowerCase();
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, venue: v, events: [] }));
    g.events.push(e);
  }
  return groups;
}

function joinNames(names) {
  const n = [...new Set(names)];
  if (n.length <= 2) return n.join(" & ");
  return n.slice(0, -1).join(", ") + " & " + n[n.length - 1];
}

function driveList(h, groups) {
  const rows = [];
  for (const g of groups) {
    const override = g.events.map((e) => h.driveMinutes?.[e.id]).find((m) => Number.isFinite(+m) && m !== null && m !== "");
    const min = override != null ? +override : driveEstimate(h, g.venue);
    if (Number.isFinite(min)) rows.push({ min, name: joinNames(g.events.map((e) => e.name)) });
  }
  return rows;
}

function drives(rows) {
  if (!rows.length) return "";
  const li = (r) => html`<li>${icon.car()}<span>~${r.min} min to ${r.name}</span></li>`;
  const head = rows.slice(0, 3), rest = rows.slice(3);
  return html`<div class="drives">
    <ul class="drives-list" aria-label="Drive times">${head.map(li)}</ul>
    ${rest.length ? html`<details class="drives-more"><summary>${rest.length} more venue${rest.length > 1 ? "s" : ""}</summary><ul class="drives-list">${rest.map(li)}</ul></details>` : ""}
  </div>`;
}

function deadline(h, ctx) {
  if (!h.bookBy) return "";
  const days = daysUntil(h.bookBy + "T23:59", ctx.now(), ctx.tz);
  const date = formatDate(h.bookBy + "T12:00", ctx.tz, "long");
  if (days < 0) {
    return html`<p class="deadline is-past">${icon.clock()}<span>Group rate has ended. Rooms may still be available.</span></p>`;
  }
  const left = days === 0 ? "last day" : days === 1 ? "1 day left" : `${days} days left`;
  return html`<p class="deadline${days < 14 ? " is-urgent" : ""}">${icon.clock()}<span>Book by <strong>${date}</strong> <span class="deadline-left">${left}</span></span></p>`;
}

function blockCard(h, i, ctx, groups) {
  const p = (f) => `hotels.${i}.${f}`;
  const photo = imgTag(h.photo, { path: p("photo"), sizes: "(min-width: 768px) 24rem, 100vw" });
  const book = safeUrl(h.bookingUrl);
  return html`
    <article class="hotel card" id="hotel-${h.id}" ${itemAttrs("hotels", i)}>
      ${String(photo) ? html`<div class="hotel-photo">${photo}</div>` : ""}
      <div class="hotel-body">
        <div class="hotel-badges cluster cluster--s">
          ${h.recommended ? html`<span class="badge">Our pick</span>` : ""}
          ${h.groupCode || h.rate ? html`<span class="badge badge--outline">Negotiated rate</span>` : ""}
        </div>
        <h3 class="hotel-name" ${editAttrs("text", p("name"), { placeholder: "Add hotel name" })}>${h.name}</h3>
        ${showField(h.rate) ? html`<p class="hotel-rate"><span class="rate" ${editAttrs("text", p("rate"), { placeholder: "Add rate" })}>${h.rate || ""}</span>${showField(h.rateNote) ? html` <span class="muted rate-note" ${editAttrs("text", p("rateNote"), { placeholder: "Add rate note" })}>${h.rateNote || ""}</span>` : ""}</p>` : ""}
        ${deadline(h, ctx)}
        ${showField(h.groupCode) ? html`<div class="code-row"><span class="code-label">Group code</span><span class="code-pill"><code class="code" ${editAttrs("text", p("groupCode"), { placeholder: "Add group code" })}>${h.groupCode || ""}</code>${h.groupCode ? html`<button class="btn btn--small code-copy" type="button" data-copy="${h.groupCode}" aria-label="Copy group code for ${h.name}">${icon.copy()}Copy</button>` : ""}</span></div>` : ""}
        ${(h.perks || []).length ? html`<ul class="perks cluster cluster--s" ${listAttrs(p("perks"))}>${h.perks.map((x, k) => html`<li class="chip" ${editAttrs("text", p(`perks.${k}`))}>${icon.check()}<span>${x}</span></li>`)}</ul>` : ""}
        ${drives(driveList(h, groups))}
        ${showField(h.notes) ? html`<p class="muted hotel-notes" ${editAttrs("multiline", p("notes"), { placeholder: "Add a note" })}>${h.notes || ""}</p>` : ""}
        <div class="hotel-actions">
          ${book ? html`<a class="btn btn--primary" href="${book}" target="_blank" rel="noopener" aria-label="Book now at ${h.name} (opens in a new tab)">Book now${icon.external()}</a>` : ""}
          <a class="btn btn--secondary" href="${directionsUrl(h)}" target="_blank" rel="noopener" aria-label="Directions to ${h.name}">${icon.directions()}Directions</a>
          ${h.phone ? html`<a class="btn btn--secondary" href="${telUrl(h.phone)}" aria-label="Call ${h.name}">${icon.phone()}Call</a>` : ""}
        </div>
      </div>
    </article>`;
}

function nearbyItem(h, i, groups) {
  const p = (f) => `hotels.${i}.${f}`;
  const first = drives(driveList(h, groups.slice(0, 1)));
  const site = safeUrl(h.bookingUrl);
  return html`
    <li class="nearby-item" ${itemAttrs("hotels", i)}>
      <div class="nearby-main">
        <h4 class="nearby-name" ${editAttrs("text", p("name"), { placeholder: "Add hotel name" })}>${h.name}</h4>
        ${showField(h.notes) ? html`<p class="muted" ${editAttrs("multiline", p("notes"), { placeholder: "Add a note" })}>${h.notes || ""}</p>` : showField(h.rateNote) ? html`<p class="muted" ${editAttrs("text", p("rateNote"))}>${h.rateNote || ""}</p>` : ""}
        ${first}
      </div>
      <div class="nearby-links">
        ${site ? html`<a class="btn btn--ghost" href="${site}" target="_blank" rel="noopener" aria-label="Website for ${h.name} (opens in a new tab)">Website${icon.external()}</a>` : ""}
        <a class="btn btn--ghost" href="${directionsUrl(h)}" target="_blank" rel="noopener" aria-label="Directions to ${h.name}">${icon.directions()}Directions</a>
      </div>
    </li>`;
}

const SHOW_STAY_HELP = false;
const SHOW_INTL_NOTE = false;

function stayHelp(c) {
  if (!SHOW_STAY_HELP) return "";
  const co = (c.site?.contacts || []).find((x) => x.phone && x.whatsapp) || (c.site?.contacts || []).find((x) => x.phone);
  if (!co) return "";
  const link = co.whatsapp
    ? html`<a class="btn btn--secondary" href="${whatsappUrl(co.phone, "Hi! I need help choosing a hotel for the wedding.")}" target="_blank" rel="noopener">${icon.whatsapp()}Message ${co.name} on WhatsApp</a>`
    : html`<a class="btn btn--secondary" href="${telUrl(co.phone)}">${icon.phone()}Call ${co.name}</a>`;
  return html`<div class="help card card--flat">
    <div class="help-text"><h3 class="help-title">Not sure where to stay?</h3><p class="muted">Tell us your dates and who is travelling, and we will point you to the right hotel.</p></div>
    ${link}
  </div>`;
}

/** Google Maps directions with an explicit origin (the maps lib only takes a destination). */
function fromAirportUrl(a, dest) {
  const origin = `${a.name || ""} ${a.code || ""} airport`.trim();
  const d = typeof dest.lat === "number" && typeof dest.lng === "number" ? `${dest.lat},${dest.lng}` : dest.address || dest.mapsQuery || dest.name || "";
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(d)}`;
}

/** Airport drives of 90+ minutes read better as hours (e.g. ~3 hours). */
function airportDriveLabel(min) {
  const m = +min;
  if (!Number.isFinite(m) || m <= 0) return "";
  if (m < 90) return `~${m} min drive to the hotels and venues`;
  const halfHours = Math.round(m / 30) / 2;
  const label = Number.isInteger(halfHours) ? String(halfHours) : halfHours.toFixed(1);
  return `~${label} hour${halfHours === 1 ? "" : "s"} drive to the hotels and venues`;
}

function shuttleTime(v, tz) {
  const s = String(v ?? "");
  return ISO.test(s) ? formatTime(s, tz) : s;
}

function aroundGroups(items) {
  const groups = [];
  items.forEach((a, i) => {
    const key = (a.category || "More").trim() || "More";
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, items: [] }));
    g.items.push({ a, i });
  });
  return groups;
}

export default {
  id: "travel",
  navLabel: "Travel",
  title: () => "Travel & Stay",
  isEmpty: (ctx) => {
    const c = ctx.content, t = c.travel || {};
    return !(c.hotels?.length || t.airports?.length || t.gettingAround?.length || t.shuttles?.length || t.aroundTown?.length || (SHOW_INTL_NOTE && t.international?.text));
  },
  render(root, ctx) {
    const c = ctx.content;
    const t = c.travel || {};
    const edit = ctx.mode === "edit";
    const hotels = (c.hotels || []).map((h, i) => ({ h, i }));
    const block = hotels.filter((x) => x.h.type === "block");
    const nearby = hotels.filter((x) => x.h.type !== "block");
    const groups = venueGroups(ctx.events);
    const evById = new Map(ctx.events.map((e) => [e.id, e]));
    const shuttles = (t.shuttles || []).map((s, i) => ({ s, i, e: evById.get(s.eventId) })).filter((x) => x.e);
    const airports = [...(t.airports || []).map((a, i) => ({ a, i }))].sort((x, y) => (y.a.primary ? 1 : 0) - (x.a.primary ? 1 : 0));
    const around = aroundGroups(t.aroundTown || []);
    const parking = groups.filter((g) => g.venue.parking);
    const firstBlock = block[0]?.h;
    const dest = firstBlock || groups[0]?.venue;
    const destName = firstBlock ? firstBlock.name : groups[0]?.venue.name;

    const has = {
      stay: hotels.length > 0,
      "getting-here": airports.length || (t.gettingAround || []).length || shuttles.length || parking.length || (SHOW_INTL_NOTE && t.international?.text),
      around: around.length > 0,
    };
    const segs = SEGMENTS.filter((s) => has[s.id] || edit);
    const stayBooked = block.some(({ h }) => h.groupCode || h.bookingUrl);
    const stayIntro = stayBooked
      ? "We've reserved rooms at special rates. Book early. Rates end on the dates shown."
      : "We're arranging a room block near the venues. Rates and booking details are coming soon.";

    root.innerHTML = html`
      <div class="section section--paper page-head">
        <div class="container container--narrow center stack">
          <h1 class="page-title">Travel &amp; Stay</h1>
          ${showField(t.intro) ? html`<p class="lede" ${editAttrs("multiline", "travel.intro", { placeholder: "Add an introduction" })}>${t.intro || ""}</p>` : ""}
        </div>
      </div>

      ${segs.length > 1 ? html`<nav class="seg-bar" aria-label="Travel sections"><div class="container"><div class="seg" role="group">
        ${segs.map((s, k) => html`<button type="button" class="seg-btn" data-seg="${s.id}" ${k === 0 ? raw('aria-current="true"') : ""}>${s.label}</button>`)}
      </div></div></nav>` : ""}

      ${segs.some((s) => s.id === "stay") ? html`
      <section class="section section--ivory trav-section" id="stay" aria-labelledby="stay-h">
        <div class="container stack stack--l">
          <header class="sec-head"><h2 class="display display--l" id="stay-h">Where to Stay</h2><p class="muted sec-intro">${stayIntro}</p></header>
          ${block.length || edit ? html`<div class="hotel-grid" ${listAttrs("hotels")}>${block.map(({ h, i }) => blockCard(h, i, ctx, groups))}</div>` : ""}
          ${nearby.length || (edit && !block.length) ? html`<div class="stack">
            <h3 class="sub-title">Other nearby options</h3>
            <ul class="nearby card card--flat" ${listAttrs("hotels")}>${nearby.map(({ h, i }) => nearbyItem(h, i, groups))}</ul>
          </div>` : ""}
          ${stayHelp(c)}
        </div>
      </section>` : ""}

      ${segs.some((s) => s.id === "getting-here") ? html`
      <section class="section section--ivory trav-section" id="getting-here" aria-labelledby="gh-h">
        <div class="container stack stack--xl">
          <header class="sec-head"><h2 class="display display--l" id="gh-h">Getting Here</h2></header>
          ${SHOW_INTL_NOTE && (t.international?.text || edit) ? html`<aside class="intl card" aria-labelledby="intl-h">
            <span class="intl-icon">${icon.info()}</span>
            <div class="stack stack--s"><h3 class="sub-title" id="intl-h" ${editAttrs("text", "travel.international.title", { placeholder: "Add a title" })}>${t.international?.title || ""}</h3>
            <p ${editAttrs("multiline", "travel.international.text", { placeholder: "Add a note for international guests" })}>${t.international?.text || ""}</p></div>
          </aside>` : ""}
          ${airports.length ? html`<div class="stack">
            <h3 class="sub-title">${icon.plane()}Airports</h3>
            <div class="card-grid" ${listAttrs("travel.airports")}>
              ${airports.map(({ a, i }) => html`<article class="card airport" ${itemAttrs("travel.airports", i)}>
                ${a.primary ? html`<span class="badge badge--gold">Closest major airport</span>` : ""}
                <p class="airport-code" ${editAttrs("text", `travel.airports.${i}.code`, { placeholder: "Code" })}>${a.code}</p>
                <h4 class="airport-name" ${editAttrs("text", `travel.airports.${i}.name`, { placeholder: "Airport name" })}>${a.name}</h4>
                ${a.driveMinutes ? html`<p class="airport-drive">${icon.car()}<span>${airportDriveLabel(a.driveMinutes)}</span></p>` : ""}
                ${showField(a.tips) ? html`<p class="muted" ${editAttrs("multiline", `travel.airports.${i}.tips`, { placeholder: "Add tips" })}>${a.tips || ""}</p>` : ""}
                ${dest ? html`<div class="card-actions"><a class="btn btn--secondary" href="${fromAirportUrl(a, dest)}" target="_blank" rel="noopener" aria-label="Directions from ${a.code} to ${destName} (opens in a new tab)">${icon.directions()}<span>To ${destName}</span></a></div>` : ""}
              </article>`)}
            </div>
          </div>` : ""}
          ${(t.gettingAround || []).length ? html`<div class="stack">
            <h3 class="sub-title">${icon.car()}Getting around</h3>
            <div class="card-grid" ${listAttrs("travel.gettingAround")}>
              ${t.gettingAround.map((g, i) => html`<article class="card" ${itemAttrs("travel.gettingAround", i)}>
                <h4 class="card-title" ${editAttrs("text", `travel.gettingAround.${i}.title`, { placeholder: "Title" })}>${g.title}</h4>
                <p class="muted" ${editAttrs("multiline", `travel.gettingAround.${i}.text`, { placeholder: "Details" })}>${g.text}</p>
              </article>`)}
            </div>
          </div>` : ""}
          ${shuttles.length ? html`<div class="stack">
            <h3 class="sub-title">${icon.bus()}Shuttles</h3>
            <div class="table-wrap card card--flat"><table class="shuttle-table">
              <caption class="visually-hidden">Shuttle timetable for your events</caption>
              <thead><tr><th scope="col">Event</th><th scope="col">From</th><th scope="col">Departs</th><th scope="col">Returns</th></tr></thead>
              <tbody ${listAttrs("travel.shuttles")}>
                ${shuttles.map(({ s, i, e }) => html`<tr ${itemAttrs("travel.shuttles", i)}>
                  <th scope="row" data-label="Event">${e.name}</th>
                  <td data-label="From" ${editAttrs("text", `travel.shuttles.${i}.from`)}>${s.from}</td>
                  <td data-label="Departs" ${editAttrs("text", `travel.shuttles.${i}.departs`)}>${shuttleTime(s.departs, e.timezone || ctx.tz)}</td>
                  <td data-label="Returns" ${editAttrs("text", `travel.shuttles.${i}.returns`)}>${shuttleTime(s.returns, e.timezone || ctx.tz)}</td>
                </tr>`)}
              </tbody>
            </table></div>
          </div>` : ""}
          ${parking.length ? html`<div class="stack">
            <h3 class="sub-title">${icon.car()}Parking</h3>
            <div class="card-grid">
              ${parking.map((g) => html`<article class="card">
                <h4 class="card-title">${g.venue.name}</h4>
                <p class="muted">${g.venue.parking}</p>
              </article>`)}
            </div>
          </div>` : ""}
        </div>
      </section>` : ""}

      ${segs.some((s) => s.id === "around") ? html`
      <section class="section section--ivory trav-section" id="around" aria-labelledby="around-h">
        <div class="container stack stack--l">
          <header class="sec-head"><h2 class="display display--l" id="around-h">Around Town</h2></header>
          ${around.map((g) => html`<div class="stack">
            <h3 class="sub-title">${g.key}</h3>
            <ul class="card-grid" ${listAttrs("travel.aroundTown")}>
              ${g.items.map(({ a, i }) => html`<li class="card place" ${itemAttrs("travel.aroundTown", i)}>
                ${edit ? html`<p class="eyebrow" ${editAttrs("text", `travel.aroundTown.${i}.category`, { placeholder: "Category" })}>${a.category}</p>` : ""}
                <h4 class="card-title" ${editAttrs("text", `travel.aroundTown.${i}.name`, { placeholder: "Add a name" })}>${a.name}</h4>
                <p class="muted" ${editAttrs("multiline", `travel.aroundTown.${i}.text`, { placeholder: "Add a description" })}>${a.text}</p>
                <div class="card-actions">
                  ${safeUrl(a.url) ? html`<a class="btn btn--secondary btn--small" href="${safeUrl(a.url)}" target="_blank" rel="noopener" aria-label="Website for ${a.name} (opens in a new tab)">Website${icon.external()}</a>` : ""}
                  ${a.address || a.name ? html`<a class="btn btn--secondary btn--small" href="${directionsUrl({ address: a.address, name: a.name })}" target="_blank" rel="noopener" aria-label="Directions to ${a.name}">${icon.directions()}Directions</a>` : ""}
                </div>
              </li>`)}
            </ul>
          </div>`)}
          ${edit && !around.length ? html`<ul class="card-grid" ${listAttrs("travel.aroundTown")}></ul>` : ""}
        </div>
      </section>` : ""}`;

    // Keep the highlighted segment in sync with scrolling.
    root._io?.disconnect();
    root._ioScroll && window.removeEventListener("scroll", root._ioScroll);
    const btns = [...root.querySelectorAll(".seg-btn")];
    const secs = btns.map((b) => root.querySelector("#" + b.dataset.seg)).filter(Boolean);
    if (btns.length && "IntersectionObserver" in window) {
      const setActive = (id) => btns.forEach((b) => (id === b.dataset.seg ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
      const update = () => {
        if (root.hidden) return;
        if (root._segLock) { setActive(root._segLock); return; } // a tab was just tapped: keep it while the page scrolls there
        const line = (parseFloat(getComputedStyle(root).getPropertyValue("--stick-top")) || 0) + 120;
        let active = secs[0];
        for (const s of secs) if (s.getBoundingClientRect().top <= line) active = s;
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = secs[secs.length - 1];
        setActive(active.id);
      };
      const io = new IntersectionObserver(update, { rootMargin: "-120px 0px -40% 0px", threshold: [0, 0.01, 0.5, 1] });
      secs.forEach((s) => io.observe(s));
      root._io = io;
      // The observer only fires when a section crosses a threshold, so reaching the very bottom of the page (where a
      // short last section can never reach the line) would go unnoticed; re-check on scroll as well, once per frame.
      let queued = false;
      root._ioScroll = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); } };
      window.addEventListener("scroll", root._ioScroll, { passive: true });
      root._segUpdate = update;
      update();
    }

    if (root.dataset.bound) return;
    root.dataset.bound = "1";
    const scrollTo = (id) => {
      const el = root.querySelector("#" + CSS.escape(id));
      if (!el) return false;
      el.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
      return true;
    };
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-copy]");
      if (b) { copyText(b.dataset.copy, "group code"); return; }
      const s = e.target.closest("[data-seg]");
      if (s && scrollTo(s.dataset.seg)) {
        root.querySelectorAll(".seg-btn").forEach((x) => (x === s ? x.setAttribute("aria-current", "true") : x.removeAttribute("aria-current")));
        history.replaceState(null, "", `#travel/${s.dataset.seg}`);
        // Hold the tapped tab until the smooth scroll settles, so sections passed on the way don't flash and a short
        // last section stays selected; then hand back to the scroll position.
        root._segLock = s.dataset.seg;
        clearTimeout(root._segLockTimer);
        const release = () => { clearTimeout(root._segLockTimer); window.removeEventListener("scrollend", release); root._segLock = null; root._segUpdate?.(); };
        window.addEventListener("scrollend", release);
        root._segLockTimer = setTimeout(release, 1200);
      }
    });
    root.addEventListener("subroute", (ev) => { scrollTo(ev.detail.sub); });
  },
};

import { html, editAttrs, listAttrs, itemAttrs, imgTag, multiline, showField, isEdit } from "../lib/dom.js";
import { formatRange, formatDate, groupByDay, nowNext, guestTzDiffers, toInstant } from "../lib/time.js";
import { directionsUrl } from "../lib/maps.js";
import { downloadIcs, googleCalUrl } from "../lib/calendar.js";
import { openSheet, copyText } from "../lib/ui.js";
import * as icon from "../lib/icons.js";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Rough human name for a hex colour, so swatches have an accessible name. */
function colourName(hex) {
  const m = String(hex).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return String(hex);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d + 6) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  if (l > 0.93) return "white";
  if (l < 0.1) return "black";
  if (s < 0.1) return l > 0.65 ? "light grey" : l > 0.35 ? "grey" : "charcoal";
  const base =
    hue < 15 || hue >= 345 ? "red" : hue < 40 ? "orange" : hue < 62 ? "gold" : hue < 75 ? "yellow" : hue < 165 ? "green" : hue < 200 ? "teal" : hue < 255 ? "blue" : hue < 290 ? "purple" : "pink";
  let name = base;
  if (base === "red" && l < 0.28) name = "burgundy";
  else if (base === "red" && hue >= 335 && l > 0.3) name = "crimson";
  else if (base === "orange" && l < 0.35) name = "brown";
  else if (base === "gold" && l < 0.3) name = "olive brown";
  else if (base === "yellow" && s < 0.5) name = "cream";
  else if (base === "green" && hue < 100 && s < 0.5) name = "olive";
  if (base === "gold" && l > 0.75) name = "pale yellow";
  if (name === base) name = l > 0.75 ? `light ${name}` : l < 0.28 ? `dark ${name}` : name;
  return name;
}

/** "Fri" + "Jul 23" parts for the day picker. */
function dayParts(key, tz) {
  const [wd, rest] = formatDate(key + "T12:00", tz, "short").split(", ");
  return { wd, date: rest || "" };
}

function eventCard(e, ctx, flags) {
  const i = ctx.content.events.findIndex((x) => x.id === e.id);
  const p = (f) => (i >= 0 ? `events.${i}.${f}` : `events.x.${f}`);
  const tz = e.timezone || ctx.tz;
  const v = e.venue || {};
  const dress = e.dressCode || {};
  const swatches = dress.swatches || [];
  const tips = dress.tips || [];
  const hasDress = showField(dress.title) || showField(dress.text) || swatches.length || tips.length;
  const hasVenue = v.name || v.address || isEdit();
  const canDirect = v.name || v.address || v.mapsQuery || typeof v.lat === "number";
  return html`
    <article class="event card" id="event-${e.id}" data-event="${e.id}" ${i >= 0 ? itemAttrs("events", i) : ""}>
      ${e.photo ? html`<div class="event-photo">${imgTag(e.photo, { path: p("photo"), sizes: "(min-width: 768px) 40rem, 100vw" })}</div>` : ""}
      <div class="event-body stack stack--s">
        <div class="event-top cluster cluster--s">
          <span class="event-time eyebrow">${icon.clock()}<span>${formatRange(e.start, e.end, tz)}</span></span>
          ${flags.current ? html`<span class="badge">Happening now</span>` : flags.next ? html`<span class="badge badge--gold">Up next</span>` : ""}
          ${e.visibility === "private" ? html`<span class="badge badge--outline">Invitation only</span>` : ""}
        </div>
        <div class="stack stack--s event-title">
          <h3 class="display display--m" ${editAttrs("text", p("name"), { placeholder: "Add event name" })}>${e.name}</h3>
          ${showField(e.subtitle) ? html`<p class="lede" ${editAttrs("text", p("subtitle"), { placeholder: "Add a tagline" })}>${e.subtitle}</p>` : ""}
        </div>
        ${hasVenue ? html`<p class="event-venue">${icon.mapPin()}<span><strong ${editAttrs("text", p("venue.name"), { placeholder: "Add venue name" })}>${v.name || ""}</strong>${showField(v.address) ? html`<br /><span class="muted" ${editAttrs("text", p("venue.address"), { placeholder: "Add address" })}>${v.address || ""}</span>` : ""}</span></p>` : ""}
        ${showField(e.description) ? html`<p ${editAttrs("multiline", p("description"), { placeholder: "Describe this event" })}>${multiline(e.description || "")}</p>` : ""}
        ${(e.notes || []).length ? html`<ul class="cluster cluster--s event-notes" ${listAttrs(p("notes"))}>${e.notes.map((n, k) => html`<li class="chip" ${editAttrs("text", p(`notes.${k}`))}>${icon.info()}<span>${n}</span></li>`)}</ul>` : ""}
        ${v.parking ? html`<p class="event-parking">${icon.car()}<span ${editAttrs("text", p("venue.parking"))}>${v.parking}</span></p>` : ""}
        ${e.shuttle ? html`<p class="event-shuttle">${icon.bus()}<span>A shuttle runs to and from this event. Check the <a href="#travel">Travel &amp; Stay</a> page for times.</span></p>` : ""}
        ${hasDress ? html`
          <div class="dress">
            <p class="dress-head">${icon.hanger()}<span><span class="dress-label">Dress code</span> <strong ${editAttrs("text", p("dressCode.title"), { placeholder: "Add dress code" })}>${dress.title || ""}</strong></span></p>
            ${swatches.length ? html`<ul class="swatches" aria-label="Suggested colours: ${swatches.map(colourName).join(", ")}">${swatches.map((c) => html`<li class="swatch" style="background:${c}" title="${colourName(c)}"><span class="visually-hidden">${colourName(c)}</span></li>`)}</ul>` : ""}
            ${showField(dress.text) || tips.length ? html`
              <details class="wear">
                <summary><span>What to wear</span>${icon.chevron()}</summary>
                <div class="wear-body stack stack--s">
                  ${showField(dress.text) ? html`<p ${editAttrs("multiline", p("dressCode.text"), { placeholder: "Describe the dress code" })}>${multiline(dress.text || "")}</p>` : ""}
                  ${tips.length ? html`<ul class="tips" ${listAttrs(p("dressCode.tips"))}>${tips.map((t, k) => html`<li ${editAttrs("text", p(`dressCode.tips.${k}`))}>${t}</li>`)}</ul>` : ""}
                </div>
              </details>` : ""}
          </div>` : ""}
        <div class="event-actions">
          ${canDirect ? html`<a class="btn btn--primary" href="${directionsUrl(v)}" target="_blank" rel="noopener">${icon.directions()}Directions<span class="visually-hidden"> to ${e.name} (opens in a new tab)</span></a>` : ""}
          <button class="btn btn--secondary" type="button" data-cal="${e.id}" aria-haspopup="dialog">${icon.calendarPlus()}Add to calendar<span class="visually-hidden"> for ${e.name}</span></button>
          ${v.address ? html`<button class="btn btn--secondary" type="button" data-copy="${v.address}">${icon.copy()}Copy address<span class="visually-hidden"> for ${e.name}</span></button>` : ""}
        </div>
      </div>
    </article>`;
}

/** Sheet content with the two calendar flavours. One event, or all of them. */
function calendarSheet(events, ctx, filename) {
  const site = ctx.content.site;
  const wrap = document.createElement("div");
  wrap.className = "cal-sheet stack";
  const multi = events.length > 1;
  wrap.innerHTML = html`
    <div class="stack stack--s">
      <p class="muted">${multi ? "Adds all of your events in one go." : "Adds this event to your calendar."}</p>
      <button class="btn btn--primary btn--block" type="button" data-ics>${icon.calendarPlus()}Apple / Outlook (.ics)</button>
    </div>
    <div class="stack stack--s">
      <h3 class="cal-h">Google Calendar</h3>
      ${multi ? html`<p class="muted">Google adds one event at a time. Tap each one you would like.</p>` : ""}
      <ul class="sheet-list cal-links">
        ${events.map((e) => html`<li><a href="${googleCalUrl(e, site)}" target="_blank" rel="noopener">${icon.calendarPlus()}<span><strong>${e.name}</strong>${multi ? html`<br /><span class="muted">${formatDate(e.start, e.timezone || ctx.tz, "short")}</span>` : ""}</span><span class="visually-hidden">(opens in a new tab)</span></a></li>`)}
      </ul>
    </div>`.toString();
  const dlg = openSheet(multi ? "Add all my events" : `Add ${events[0].name}`, wrap);
  wrap.querySelector("[data-ics]").addEventListener("click", () => {
    downloadIcs(events, site, filename);
    ctx.toast("Calendar file downloaded");
    dlg.close();
  });
}

export default {
  id: "schedule",
  navLabel: "Schedule",
  title: () => "Schedule",
  isEmpty: (ctx) => ctx.events.length === 0,
  render(root, ctx) {
    root._ctx = ctx;
    root._io?.disconnect();
    const days = groupByDay(ctx.events, ctx.tz);
    const { current, next } = nowNext(ctx.events, ctx.now(), ctx.tz);
    const tzNote = guestTzDiffers(ctx.tz);
    const intro = ctx.content.schedule?.intro ?? (ctx.events.length === 1 ? "Here are the details for the day." : "A weekend of celebration. Open an event for what to wear, directions and more.");
    let tzLabel = "";
    if (tzNote) {
      const city = ctx.tz.split("/").pop().replace(/_/g, " ");
      let abbr = "";
      try {
        const when = ctx.events[0] ? toInstant(ctx.events[0].start, ctx.tz) : new Date();
        abbr = new Intl.DateTimeFormat("en-US", { timeZone: ctx.tz, timeZoneName: "short" }).formatToParts(when).find((x) => x.type === "timeZoneName")?.value || "";
      } catch { /* ignore */ }
      tzLabel = `Times shown in ${city} time${abbr ? ` (${abbr})` : ""}`;
    }

    root.innerHTML = html`
      <div class="section section--paper page-head">
        <div class="container container--narrow center stack">
          <h1 class="page-title">Schedule</h1>
          ${ctx.events.length ? html`
            ${intro || isEdit() ? html`<p class="lede" ${editAttrs("multiline", "schedule.intro", { placeholder: "Add a short introduction" })}>${multiline(intro)}</p>` : ""}
            <div class="cluster cluster--center"><button class="btn btn--light" type="button" data-cal-all aria-haspopup="dialog">${icon.calendarPlus()}Add all my events to calendar</button></div>
            ${tzNote ? html`<p class="tz-note"><span class="chip">${icon.clock()}<span>${tzLabel}</span></span></p>` : ""}` : ""}
        </div>
      </div>
      ${days.length >= 2 ? html`
        <nav class="daynav" aria-label="Jump to a day">
          <ul class="daynav-list">
            ${days.map((d, k) => { const { wd, date } = dayParts(d.key, ctx.tz); return html`<li><button type="button" class="daynav-btn" data-day="${d.key}" ${k === 0 ? html`aria-current="true"` : ""}><span class="dn-wd">${wd}</span><span class="dn-date">${date}</span></button></li>`; })}
          </ul>
        </nav>` : ""}
      <div class="section section--ivory schedule-body">
        <div class="container container--narrow stack stack--xl" ${listAttrs("events", { sort: "auto" })}>
          ${days.length ? days.map((d) => html`
            <section class="day stack" id="day-${d.key}" data-day-section="${d.key}" aria-labelledby="day-h-${d.key}">
              <h2 class="display display--l day-title" id="day-h-${d.key}">${d.label}</h2>
              ${d.events.map((e) => eventCard(e, ctx, { current: current?.id === e.id, next: next?.id === e.id }))}
            </section>`) : html`
            <div class="card empty center stack stack--s">
              <p class="display display--m">Details are on their way</p>
              <p class="muted">We are still putting the schedule together. Please check back soon, or message us if you have a question.</p>
            </div>`}
        </div>
      </div>`;

    // Keep the day picker in step with scrolling.
    const nav = root.querySelector(".daynav");
    if (nav && "IntersectionObserver" in window) {
      const setActive = (key) => {
        let activeBtn = null;
        nav.querySelectorAll("[data-day]").forEach((b) => {
          const on = b.dataset.day === key;
          if (on) { b.setAttribute("aria-current", "true"); activeBtn = b; } else b.removeAttribute("aria-current");
        });
        const list = nav.querySelector(".daynav-list");
        if (activeBtn && list.scrollWidth > list.clientWidth) {
          const target = activeBtn.offsetLeft - (list.clientWidth - activeBtn.offsetWidth) / 2;
          list.scrollTo({ left: Math.max(0, target), behavior: reduced() ? "auto" : "smooth" });
        }
      };
      const io = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) setActive(en.target.dataset.daySection);
      }, { rootMargin: "-25% 0px -65% 0px" });
      root.querySelectorAll("[data-day-section]").forEach((s) => io.observe(s));
      root._io = io;
    }

    if (root.dataset.bound) return;
    root.dataset.bound = "1";
    root.addEventListener("click", (ev) => {
      const c = root._ctx;
      const one = ev.target.closest("[data-cal]");
      const all = ev.target.closest("[data-cal-all]");
      const day = ev.target.closest("[data-day]");
      const copy = ev.target.closest("[data-copy]");
      if (one) {
        const e = c.events.find((x) => x.id === one.dataset.cal);
        if (e) calendarSheet([e], c, `${e.id}.ics`);
      } else if (all) {
        calendarSheet(c.events, c, "pearl-and-aman-wedding.ics");
      } else if (copy) {
        copyText(copy.dataset.copy, "address");
      } else if (day) {
        const sec = root.querySelector(`[data-day-section="${CSS.escape(day.dataset.day)}"]`);
        sec?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
      }
    });
    root.addEventListener("subroute", (ev) => {
      const el = root.querySelector(`#event-${CSS.escape(ev.detail.sub)}`);
      if (!el) return;
      const go = () => el.classList.contains("is-target") && el.scrollIntoView({ block: "start", behavior: "auto" });
      el.classList.add("is-target");
      go();
      // Web fonts and images can shift the layout after the first jump; settle once more.
      document.fonts?.ready.then(go);
      setTimeout(go, 400);
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove("is-target"), 2400);
    });
  },
};

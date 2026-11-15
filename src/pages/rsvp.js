import { html, raw, editAttrs, listAttrs, setPath } from "../lib/dom.js";
import { renderLookup } from "./_lookup.js";
import { formatDate, formatTime, toInstant } from "../lib/time.js";
import { downloadIcs, googleCalUrl } from "../lib/calendar.js";
import { seatsOf } from "../lib/guestfiles.js";

/*
 * RSVP by household headcount: for each invited event the family says how many of them are coming (0 up to the
 * household's seats), plus optional names, food preferences as counts, and the household questions (hotel, travel…).
 * Payload v2: { v:2, code, household, seats, submittedAt, counts:{eventId:n}, names, diet:{label:n}, dietNote, extras }.
 */

/* ---------- storage helpers (always guarded) ---------- */
const KEY = (code) => `pa.rsvp.v1.${code}`; // the last reply sent (also read by the home page); v1 or v2 payloads
const DRAFT = (code) => `pa.rsvp.draft.v2.${code}`;
const read = (area, k) => { try { return JSON.parse(window[area].getItem(k)); } catch { return null; } };
const write = (area, k, v) => { try { window[area].setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const drop = (area, k) => { try { window[area].removeItem(k); } catch { /* ignore */ } };

const UI = new WeakMap();
const STEP_NAMES = ["Who's coming", "Details", "Review"];
const HOTEL = [["need", "Yes, we'd like a room"], ["booked", "We've already booked"], ["local", "No, we're local"]];

const blank = () => ({
  phase: "form", step: 1, counts: {}, names: "", diet: {}, dietNote: "", replied: null,
  x: { hotel: "", arrival: "", departure: "", flight: "", flightTime: "", address: "", phone: "", song: "", message: "", shuttle: {} },
});

/* ---------- derived data ---------- */
const rsvpEvents = (ctx) => ctx.events.filter((e) => e.rsvp !== false);
/** Food preferences asked as counts: the meal options then the dietary options, without "Other" (that's the notes box). */
const foodOptions = (ctx) => [...new Set([...(ctx.content.rsvp?.mealOptions || []), ...(ctx.content.rsvp?.dietaryOptions || [])])].filter((o) => o && !/^other$/i.test(o));
const evTz = (e, ctx) => e.timezone || ctx.tz;
const when = (e, ctx) => `${formatDate(e.start, evTz(e, ctx), "long")} · ${formatTime(e.start, evTz(e, ctx))}`;
const seats = (ctx) => seatsOf(ctx.guest);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const countAt = (st, eid) => (Number.isInteger(st.counts[eid]) ? st.counts[eid] : 0);
const answered = (st, eid) => Number.isInteger(st.counts[eid]);
/** The most people coming to any one event: the cap for food and shuttle counts. */
const most = (st, ctx) => Math.max(0, ...rsvpEvents(ctx).map((e) => countAt(st, e.id)));
const dietTotal = (st) => Object.values(st.diet).reduce((a, n) => a + (+n || 0), 0);
const comingLabel = (n, ctx) => (n === 0 ? (seats(ctx) === 1 ? "Not coming" : "None of us") : seats(ctx) === 1 ? "Coming" : plural(n, "guest"));

function buildPayload(st, ctx) {
  const evs = rsvpEvents(ctx);
  const cap = seats(ctx);
  const counts = Object.fromEntries(evs.map((e) => [e.id, Math.min(cap, countAt(st, e.id))]));
  const any = Object.values(counts).some((n) => n > 0);
  const top = Math.max(0, ...Object.values(counts));
  const x = st.x;
  const shuttle = {};
  if (any) for (const e of evs) { const n = Math.min(+x.shuttle?.[e.id] || 0, counts[e.id]); if (e.shuttle && n > 0) shuttle[e.id] = n; }
  const diet = {};
  if (any) for (const o of foodOptions(ctx)) { const n = Math.min(+st.diet[o] || 0, top); if (n > 0) diet[o] = n; }
  return {
    v: 2,
    code: ctx.guest.code,
    household: ctx.guest.household,
    seats: cap,
    submittedAt: ctx.now().toISOString(),
    counts,
    names: any ? (st.names || "").trim() : "",
    diet,
    dietNote: any ? (st.dietNote || "").trim() : "",
    extras: any
      ? { hotel: x.hotel || "", arrival: x.arrival || "", departure: x.departure || "", flight: x.flight || "", flightTime: x.flightTime || "", address: x.address || "", shuttle, phone: x.phone || "", song: x.song || "", message: x.message || "" }
      : { hotel: "", arrival: "", departure: "", flight: "", flightTime: "", address: "", shuttle: {}, phone: "", song: "", message: x.message || "" },
  };
}

/** State from a saved reply. Also reads the older per-person replies (v1): counts are the yeses, names the people saying yes. */
function fromPayload(P, ctx) {
  const st = blank();
  if (P.v === 2 || P.counts) {
    for (const [id, n] of Object.entries(P.counts || {})) if (Number.isInteger(n)) st.counts[id] = n;
    st.names = P.names || "";
    st.diet = { ...(P.diet || {}) };
    st.dietNote = P.dietNote || "";
  } else {
    const yes = new Set();
    for (const r of P.responses || []) {
      st.counts[r.eventId] = (st.counts[r.eventId] || 0) + (r.attending === "yes" ? 1 : 0);
      if (r.attending === "yes") yes.add(r.memberId);
    }
    const people = (P.members || []).filter((m) => yes.has(m.id));
    st.names = people.map((m) => m.name).filter(Boolean).join(", ");
    const opts = foodOptions(ctx), notes = [];
    for (const m of people) for (const part of [m.meal, ...String(m.dietary || "").split(";")].map((v) => String(v || "").trim()).filter(Boolean)) {
      if (opts.includes(part)) st.diet[part] = (st.diet[part] || 0) + 1; else notes.push(`${m.name}: ${part}`);
    }
    st.dietNote = notes.join("; ");
  }
  Object.assign(st.x, P.extras || {});
  st.x.shuttle = { ...(P.extras?.shuttle || {}) };
  st.replied = P.submittedAt || null;
  return st;
}

const fmtDay = (iso, ctx) => {
  try { return new Date(iso).toLocaleDateString("en-US", { timeZone: ctx.tz, month: "long", day: "numeric", year: "numeric" }); } catch { return ""; }
};
const deadlinePassed = (ctx) => {
  const d = ctx.content.rsvp?.deadline;
  if (!d || ctx.mode === "edit") return false;
  const t = toInstant(`${d}T23:59:59`, ctx.tz);
  return !isNaN(t) && ctx.now() > t;
};
const shiftDate = (isoDay, days) => {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/* ---------- small view pieces ---------- */
const telHref = (p) => "tel:" + String(p || "").replace(/[^\d+]/g, "");
function contactsHtml(ctx) {
  const cs = (ctx.content.site?.contacts || []).filter((c) => c.phone);
  if (!cs.length) return "";
  return html`<ul class="rv-contacts">${cs.map((c) => html`<li><span>${c.name}${c.role ? html` <span class="rv-muted">(${c.role})</span>` : ""}</span> <a href="${telHref(c.phone)}">${c.phone}</a></li>`)}</ul>`;
}

function summaryHtml(st, ctx) {
  return html`<ul class="rv-sum" data-summary>
    ${rsvpEvents(ctx).map((e) => {
      const n = countAt(st, e.id);
      return html`<li class="rv-sum-ev" data-sum-event="${e.id}">
        <p class="rv-sum-name">${e.name} <span class="rv-muted">${when(e, ctx)}</span></p>
        <p class="rv-sum-who"><span class="rv-pill ${n > 0 ? "is-yes" : "is-no"}">${comingLabel(n, ctx)} <span aria-hidden="true">${n > 0 ? "✓" : "✗"}</span></span></p>
      </li>`;
    })}
  </ul>`;
}

function stepper(act, key, n, max, label) {
  return html`<span class="rv-step-ctl">
    <button type="button" class="rv-round" data-act="${act}-" data-k="${key}" aria-label="Fewer: ${label}" ${n <= 0 ? "disabled" : ""}>−</button>
    <output class="rv-num" data-num="${act}:${key}" aria-live="polite">${n}</output>
    <button type="button" class="rv-round" data-act="${act}+" data-k="${key}" data-max="${max}" aria-label="More: ${label}" ${n >= max ? "disabled" : ""}>+</button>
  </span>`;
}

function detailsSummary(st, ctx) {
  const q = ctx.content.rsvp?.questions || {};
  const rows = [];
  const x = st.x;
  const any = most(st, ctx) > 0;
  if (any) {
    if ((st.names || "").trim()) rows.push(["Names", st.names.trim()]);
    const top = most(st, ctx);
    const food = foodOptions(ctx).filter((o) => +st.diet[o] > 0).map((o) => `${o}: ${Math.min(+st.diet[o], top)}`);
    if (food.length) rows.push(["Food", food.join(", ")]);
    if ((st.dietNote || "").trim()) rows.push(["Allergies and notes", st.dietNote.trim()]);
    if (q.hotel && x.hotel) rows.push(["Hotel", HOTEL.find((h) => h[0] === x.hotel)?.[1] || x.hotel]);
    if (q.travelDates && (x.arrival || x.departure)) rows.push(["Travel dates", [x.arrival && `Arrive ${x.arrival}`, x.departure && `Leave ${x.departure}`].filter(Boolean).join(", ")]);
    if (q.flight && (x.flight || x.flightTime)) rows.push(["Flight", [x.flight, x.flightTime].filter(Boolean).join(" at ")]);
    const sh = Object.entries(x.shuttle || {}).filter(([id, n]) => n > 0 && rsvpEvents(ctx).some((e) => e.id === id && e.shuttle) && countAt(st, id) > 0);
    if (q.shuttle && sh.length) rows.push(["Shuttle seats", sh.map(([id, n]) => `${rsvpEvents(ctx).find((e) => e.id === id).name}: ${Math.min(n, countAt(st, id))}`).join(", ")]);
    if (q.phone && x.phone) rows.push(["Phone", x.phone]);
    if (q.address && x.address) rows.push(["Mailing address", x.address]);
    if (q.song && x.song) rows.push(["Song", x.song]);
  }
  if (x.message) rows.push(["Your note", x.message]);
  if (!rows.length) return "";
  return html`<dl class="rv-dl">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

/* ---------- steps ---------- */
function stepHead(n, title, help) {
  return html`<legend class="rv-legend"><span class="rv-count">Step ${n} of 3</span><h2 tabindex="-1" data-step-heading>${title}</h2></legend>${help ? html`<p class="rv-help">${help}</p>` : ""}`;
}

function step1(st, ctx) {
  const evs = rsvpEvents(ctx);
  const cap = seats(ctx);
  const one = cap === 1;
  const known = (ctx.guest.members || []).map((m) => m.name).filter(Boolean);
  const anyComing = evs.some((e) => countAt(st, e.id) > 0);
  return html`<fieldset class="rv-step" data-step="1">
    ${stepHead(1, "Who's coming?", one
      ? "For each event, let us know if you can join us. You can change it any time before the deadline."
      : html`Your invitation is for up to ${plural(cap, "guest")}. For each event, tap how many of you will join us. You can change it any time before the deadline.`)}
    <div class="rv-quick" role="group" aria-label="Quick answers">
      <button type="button" class="btn btn--secondary btn--small" data-act="all">${one ? "Coming to all events ✓" : `All ${cap} of us, every event ✓`}</button>
      <button type="button" class="btn btn--secondary btn--small" data-act="clear">Clear</button>
    </div>
    ${evs.map((e) => {
      const v = st.counts[e.id];
      const opts = Array.from({ length: cap + 1 }, (_, n) => n);
      return html`<section class="rv-card rv-ev" aria-labelledby="evh-${e.id}" data-ev="${e.id}">
        <header class="rv-ev-head"><h3 id="evh-${e.id}">${e.name}</h3><p class="rv-when">${when(e, ctx)}</p></header>
        <div class="rv-howmany" role="radiogroup" aria-labelledby="evh-${e.id} hm-${e.id}" aria-describedby="er-${e.id}">
          <p class="rv-howmany-q" id="hm-${e.id}">${one ? "Will you join us?" : "How many of you will join us?"}</p>
          <div class="rv-seg rv-seg--counts ${one ? "" : "is-many"}">
            ${opts.map((n) => html`<label class="rv-segopt ${n === 0 ? "is-no" : "is-yes"}"><input type="radio" name="n__${e.id}" value="${n}" data-count="${e.id}" ${v === n ? "checked" : ""} /><span>${n === 0
              ? html`<span aria-hidden="true">✗ </span>${one ? "Regretfully declines" : "None of us"}`
              : one ? html`<span aria-hidden="true">✓ </span>Joyfully accepts` : html`${n}<span class="visually-hidden"> ${n === 1 ? "guest" : "guests"}</span>`}</span></label>`)}
          </div>
          <p class="rv-err" id="er-${e.id}" hidden></p>
        </div>
      </section>`;
    })}
    ${one ? "" : html`<div class="rv-card rv-names" data-names-card ${anyComing ? "" : "hidden"}>
      <div class="rv-field"><label for="x-names">Names of those coming <span class="rv-muted">(optional)</span></label>
        <textarea id="x-names" data-f="names" rows="2" maxlength="600" autocomplete="off" aria-describedby="x-names-h" placeholder="${known.length ? `e.g. ${known.slice(0, 3).join(", ")}` : "e.g. Raj Sharma, Priya Sharma"}">${st.names}</textarea>
        <p class="rv-help" id="x-names-h">It helps us with name cards and seating.</p></div>
    </div>`}
  </fieldset>`;
}

function optRadio(name, value, label, checked, f, path) {
  return html`<label class="rv-opt"><input type="radio" name="${name}" value="${value}" data-f="${f}" ${checked ? "checked" : ""} /><span ${path ? editAttrs("text", path) : ""}>${label}</span></label>`;
}

function step2(st, ctx) {
  const r = ctx.content.rsvp || {};
  const q = r.questions || {};
  const top = most(st, ctx);
  if (!top) {
    return html`<fieldset class="rv-step" data-step="2">
      ${stepHead(2, "Send your wishes", "We're sorry you can't make it, and we'll be thinking of you. A note is always welcome.")}
      <div class="rv-card"><div class="rv-field"><label for="x-message">A note for the couple (optional)</label>
        <textarea id="x-message" data-f="x.message" rows="4" maxlength="1000">${st.x.message}</textarea></div></div>
    </fieldset>`;
  }
  const food = foodOptions(ctx);
  const evs = rsvpEvents(ctx);
  const all = evs.map((e) => e.start.slice(0, 10)).sort();
  const lo = all.length ? shiftDate(all[0], -10) : "";
  const hi = all.length ? shiftDate(all[all.length - 1], 10) : "";
  const shuttleEvs = evs.filter((e) => e.shuttle && countAt(st, e.id) > 0);
  const x = st.x;
  const extras = [];
  if (q.hotel) extras.push(html`<fieldset class="rv-sub"><legend>${q.hotel}</legend><div class="rv-opts">${HOTEL.map(([v, l]) => optRadio("x-hotel", v, l, x.hotel === v, "x.hotel"))}</div></fieldset>`);
  if (q.travelDates) extras.push(html`<fieldset class="rv-sub"><legend>${q.travelDates}</legend><div class="rv-two">
    <div class="rv-field"><label for="x-arrival">Arriving</label><input id="x-arrival" type="date" data-f="x.arrival" value="${x.arrival}" min="${lo}" max="${hi}" /></div>
    <div class="rv-field"><label for="x-departure">Departing</label><input id="x-departure" type="date" data-f="x.departure" value="${x.departure}" min="${x.arrival || lo}" max="${hi}" /></div></div></fieldset>`);
  if (q.flight) extras.push(html`<fieldset class="rv-sub"><legend>${q.flight}</legend><div class="rv-two">
    <div class="rv-field"><label for="x-flight">Arrival flight number</label><input id="x-flight" data-f="x.flight" value="${x.flight}" autocomplete="off" maxlength="40" placeholder="e.g. AC 123" /></div>
    <div class="rv-field"><label for="x-flightTime">Arrival time</label><input id="x-flightTime" type="time" data-f="x.flightTime" value="${x.flightTime}" /></div></div></fieldset>`);
  if (q.shuttle && shuttleEvs.length) extras.push(html`<fieldset class="rv-sub"><legend>${q.shuttle}</legend>
    ${shuttleEvs.map((e) => {
      const mx = countAt(st, e.id);
      const n = Math.min(+x.shuttle?.[e.id] || 0, mx);
      return html`<div class="rv-shuttle" role="group" aria-labelledby="sh-${e.id}">
        <span id="sh-${e.id}" class="rv-shuttle-name">${e.name} <span class="rv-muted">(up to ${mx})</span></span>
        ${stepper("seat", e.id, n, mx, `shuttle seats for ${e.name}`)}</div>`;
    })}</fieldset>`);
  if (q.phone) extras.push(html`<div class="rv-field"><label for="x-phone">${q.phone}</label><input id="x-phone" type="tel" inputmode="tel" autocomplete="tel" data-f="x.phone" value="${x.phone}" maxlength="30" /></div>`);
  if (q.address) extras.push(html`<div class="rv-field"><label for="x-address">${q.address}</label><textarea id="x-address" rows="3" autocomplete="street-address" data-f="x.address" maxlength="300">${x.address}</textarea></div>`);
  if (q.song) extras.push(html`<div class="rv-field"><label for="x-song">${q.song}</label><input id="x-song" data-f="x.song" value="${x.song}" autocomplete="off" maxlength="120" /></div>`);
  const one = top === 1;
  return html`<fieldset class="rv-step" data-step="2">
    ${stepHead(2, "A few details", "Just so we can look after everyone. Everything here is optional.")}
    <section class="rv-card rv-food" aria-labelledby="food-h">
      <h3 id="food-h">Food</h3>
      ${food.length ? html`<fieldset class="rv-sub"><legend>${one ? "Do any of these apply to you?" : `How many of you are…`}</legend>
        <p class="rv-help">${one ? "Tap + for each one that applies." : `Leave at 0 if none. Up to ${top}, the most of you coming to one event.`}</p>
        <div class="rv-diet">
          ${food.map((o, i) => {
            const n = Math.min(+st.diet[o] || 0, top);
            const mi = (r.mealOptions || []).indexOf(o), di = (r.dietaryOptions || []).indexOf(o);
            return html`<div class="rv-shuttle" role="group" aria-labelledby="dt-${i}">
              <span id="dt-${i}" class="rv-shuttle-name" ${editAttrs("text", mi >= 0 ? `rsvp.mealOptions.${mi}` : `rsvp.dietaryOptions.${di}`)}>${o}</span>
              ${stepper("diet", i, n, top, o)}</div>`;
          })}
        </div></fieldset>` : ""}
      <div class="rv-field"><label for="x-dietNote">Allergies or anything else about food <span class="rv-muted">(optional)</span></label>
        <input id="x-dietNote" data-f="dietNote" value="${st.dietNote}" autocomplete="off" maxlength="300" placeholder="e.g. one child with a peanut allergy, no onion or garlic" /></div>
    </section>
    ${extras.length ? html`<section class="rv-card rv-extras" aria-labelledby="hh-h"><h3 id="hh-h">For your household</h3>${extras}</section>` : ""}
    <div class="rv-card"><div class="rv-field"><label for="x-message">A note for the couple (optional)</label>
      <textarea id="x-message" data-f="x.message" rows="3" maxlength="1000">${x.message}</textarea></div></div>
  </fieldset>`;
}

function step3(st, ctx, err) {
  const goto = (n, label) => html`<button type="button" class="btn btn--ghost btn--small" data-act="goto" data-step="${n}">${label}</button>`;
  return html`<fieldset class="rv-step" data-step="3">
    ${stepHead(3, "Review and send", "Please check everything. You can edit any part before sending.")}
    <section class="rv-card" aria-labelledby="rv-s1"><div class="rv-cardhead"><h3 id="rv-s1">Who's coming</h3>${goto(1, html`Edit<span class="visually-hidden"> who's coming</span>`)}</div>${summaryHtml(st, ctx)}</section>
    <section class="rv-card" aria-labelledby="rv-s2"><div class="rv-cardhead"><h3 id="rv-s2">Details</h3>${goto(2, html`Edit<span class="visually-hidden"> details</span>`)}</div>
      ${detailsSummary(st, ctx) || html`<p class="rv-muted">Nothing added.</p>`}</section>
    <p class="rv-err rv-send-err" data-send-err role="alert" ${err ? "" : "hidden"}>${err || ""}</p>
  </fieldset>`;
}

/* ---------- views ---------- */
function formView(ui, ctx) {
  const st = ui.st;
  const fn = st.step === 1 ? step1 : st.step === 2 ? step2 : step3;
  const stepper = html`<ol class="rv-steps" aria-label="Progress">${STEP_NAMES.map((n, i) => html`<li ${st.step === i + 1 ? raw('aria-current="step"') : ""} class="${st.step === i + 1 ? "is-current" : st.step > i + 1 ? "is-done" : ""}"><span class="rv-dot" aria-hidden="true">${st.step > i + 1 ? "✓" : i + 1}</span><span class="rv-steplabel">${n}${st.step === i + 1 ? html`<span class="visually-hidden"> (current step)</span>` : ""}</span></li>`)}</ol>`;
  const banner = st.replied ? html`<p class="rv-note" data-replied><strong>You replied on ${fmtDay(st.replied, ctx)}.</strong> You can update it any time before ${ctx.content.rsvp?.deadlineText || "the deadline"}.</p>` : "";
  const last = st.step === 3;
  return html`${banner}${stepper}<form class="rv-form" novalidate data-form>
    ${fn(st, ctx, ui.sendErr)}
    <div class="rv-nav">
      ${st.step > 1 ? html`<button type="button" class="btn btn--secondary" data-act="back">Back</button>` : ""}
      ${last ? html`<button type="submit" class="btn btn--primary rv-primary" data-act="send">Send RSVP</button>` : html`<button type="button" class="btn btn--primary rv-primary" data-act="next">Continue</button>`}
    </div></form>`;
}

function passedView(ui, ctx) {
  const st = ui.st;
  const has = rsvpEvents(ctx).some((e) => answered(st, e.id));
  return html`<div class="rv-card rv-passed" data-passed>
      <h2 tabindex="-1" data-step-heading>The RSVP deadline has passed</h2>
      <p>The RSVP deadline has passed — please message us and we'll do our best to help.</p>
      ${contactsHtml(ctx)}
    </div>
    ${has ? html`<div class="rv-card"><h3>What we have for you${st.replied ? html` <span class="rv-muted">(sent ${fmtDay(st.replied, ctx)})</span>` : ""}</h3>${summaryHtml(st, ctx)}${detailsSummary(st, ctx)}</div>` : ""}`;
}

function doneView(ui, ctx) {
  const st = ui.st;
  const evs = rsvpEvents(ctx).filter((e) => countAt(st, e.id) > 0);
  const site = ctx.content.site || {};
  return html`<div class="rv-card rv-done" data-done>
    <h2 tabindex="-1" data-step-heading>Thank you, ${ctx.guest.household}</h2>
    ${evs.length ? html`<p class="rv-help">Your reply is in. We can't wait to celebrate with you.</p>` : html`<p class="rv-help">Your reply is in. We'll miss you and are grateful for your kind wishes.</p>`}
    ${evs.length ? html`<h3>You're joining us for</h3>
      <ul class="rv-sum">${evs.map((e) => html`<li class="rv-sum-ev"><p class="rv-sum-name">${e.name} <span class="rv-muted">${when(e, ctx)}</span></p>
        <p class="rv-sum-who"><span class="rv-pill is-yes">${comingLabel(countAt(st, e.id), ctx)} <span aria-hidden="true">✓</span></span></p></li>`)}</ul>
      <h3>Add these events to your calendar</h3>
      <div class="rv-cal"><button type="button" class="btn btn--primary" data-act="ics">Download calendar file (.ics)</button></div>
      <ul class="rv-gcal">${evs.map((e) => html`<li><a class="btn btn--secondary btn--small" href="${googleCalUrl(e, site)}" target="_blank" rel="noopener">${e.name} on Google Calendar</a></li>`)}</ul>` : ""}
    <div class="rv-nav rv-nav--solo"><button type="button" class="btn btn--secondary" data-act="change">Change my response</button></div>
  </div>`;
}

/* ---------- drawing ---------- */
function setLive(root, msg) {
  const el = root.querySelector("[data-live]");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = msg; }, 40);
}

function draw(root, focus) {
  const ui = UI.get(root);
  const ctx = ui.ctx;
  const body = root.querySelector("[data-body]");
  if (!body) return;
  let v;
  if (deadlinePassed(ctx)) v = passedView(ui, ctx);
  else if (ui.st.phase === "done") v = doneView(ui, ctx);
  else v = formView(ui, ctx);
  body.innerHTML = String(v);
  if (focus === "heading") {
    const h = body.querySelector("[data-step-heading]");
    if (h) { h.focus({ preventScroll: true }); h.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
  } else if (focus) {
    body.querySelector(focus)?.focus();
  }
}

function saveDraft(ui) {
  if (ui.st.phase === "done") return;
  const { replied, ...rest } = ui.st;
  write("sessionStorage", DRAFT(ui.code), rest);
}

function goStep(root, n) {
  const ui = UI.get(root);
  ui.st.step = n;
  ui.sendErr = "";
  saveDraft(ui);
  draw(root, "heading");
  setLive(root, `Step ${n} of 3: ${n === 2 && !most(ui.st, ui.ctx) ? "Send your wishes" : STEP_NAMES[n - 1]}`);
}

/* ---------- validation ---------- */
function validate1(root) {
  const ui = UI.get(root);
  const { st, ctx } = ui;
  const body = root.querySelector("[data-body]");
  let first = null;
  let count = 0;
  for (const e of rsvpEvents(ctx)) {
    const err = body.querySelector(`#er-${e.id}`);
    if (!err) continue;
    if (!answered(st, e.id)) {
      err.textContent = seats(ctx) === 1 ? `Please let us know if you can come to ${e.name}.` : `Please choose how many of you are coming to ${e.name}.`;
      err.hidden = false;
      count++;
      if (!first) first = body.querySelector(`input[name="n__${e.id}"]`);
    } else err.hidden = true;
  }
  if (first) {
    first.focus();
    first.scrollIntoView({ block: "center" });
    setLive(root, `${count} ${count === 1 ? "answer is" : "answers are"} still needed. ${first.closest(".rv-howmany")?.querySelector(".rv-err")?.textContent || ""}`);
    return false;
  }
  return true;
}

/* ---------- submit ---------- */
const UNCONFIRMED = "We couldn't confirm your RSVP was saved. Nothing you typed is lost, so please try again or message us.";
/* The no-cors POST can't report failures, so read the reply back with a plain GET (no custom headers, so no preflight). */
async function confirmSaved(ep, P) {
  const url = ep + (ep.includes("?") ? "&" : "?") + "action=get&code=" + encodeURIComponent(P.code) + "&_=" + Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 900));
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      let j;
      try { j = await (await fetch(url, { signal: ctl.signal })).json(); } finally { clearTimeout(t); }
      if (j && j.ok && j.P && j.P.submittedAt === P.submittedAt) return;
    } catch { /* try once more */ }
  }
  const err = new Error("unconfirmed");
  err.unconfirmed = true;
  throw err;
}

async function submit(root) {
  const ui = UI.get(root);
  const { ctx, st } = ui;
  if (ui.busy) return;
  const btn = root.querySelector("[data-act=send]");
  const P = buildPayload(st, ctx);
  const ep = ctx.content.site?.rsvpEndpoint;
  ui.busy = true;
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Sending…"; }
  setLive(root, "Sending your RSVP");
  try {
    if (ep) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 25000);
      try {
        await fetch(ep, { method: "POST", mode: "no-cors", body: new URLSearchParams({ payload: JSON.stringify(P) }), signal: ctl.signal });
      } finally { clearTimeout(t); }
      await confirmSaved(ep, P);
    } else {
      console.log("[rsvp demo] would send", P);
    }
    write("localStorage", KEY(P.code), P);
    drop("sessionStorage", DRAFT(ui.code));
    st.replied = P.submittedAt;
    st.phase = "done";
    ui.sendErr = "";
    ui.busy = false;
    draw(root, "heading");
    setLive(root, "Thank you. Your RSVP was sent.");
  } catch (err) {
    console.warn("[rsvp] send failed", err);
    ui.busy = false;
    ui.sendErr = err?.unconfirmed ? UNCONFIRMED : "We couldn't send your reply just now. Nothing you typed is lost, so please check your connection and try again.";
    draw(root);
    const e = root.querySelector("[data-send-err]");
    e?.scrollIntoView({ block: "center" });
    root.querySelector("[data-act=send]")?.focus();
    const s = root.querySelector("[data-act=send]");
    if (s) s.textContent = "Try again";
  }
}

/* ---------- events ---------- */
function bind(root) {
  if (root.dataset.bound) return;
  root.dataset.bound = "1";

  root.addEventListener("submit", (e) => { e.preventDefault(); const ui = UI.get(root); if (ui && ui.st.step === 3) submit(root); });

  const onField = (e) => {
    const ui = UI.get(root);
    const t = e.target;
    if (!ui || !(t instanceof HTMLElement)) return;
    const { st, ctx } = ui;
    ui.dirty = true;
    if (t.dataset.f) {
      if (t.type === "radio" && !t.checked) return;
      setPath(st, t.dataset.f, t.value);
      if (t.id === "x-arrival") { const d = root.querySelector("#x-departure"); if (d) d.min = t.value || d.min; }
    } else if (t.dataset.count) {
      if (!t.checked) return;
      st.counts[t.dataset.count] = Math.max(0, Math.min(seats(ctx), Math.round(+t.value) || 0));
      const err = root.querySelector(`#er-${t.dataset.count}`); if (err) err.hidden = true;
      const names = root.querySelector("[data-names-card]");
      if (names) names.hidden = !rsvpEvents(ctx).some((ev) => countAt(st, ev.id) > 0);
    } else return;
    saveDraft(ui);
  };
  root.addEventListener("change", onField);
  root.addEventListener("input", (e) => { if (e.target.matches("input:not([type=radio]):not([type=checkbox]), textarea")) onField(e); });

  /** −/+ on a counter: shuttle seats per event (cap: that event's count) or a food count (cap: the biggest event). */
  function bump(root, b, st, ctx) {
    const [kind, dir] = [b.dataset.act.slice(0, -1), b.dataset.act.slice(-1)];
    const k = b.dataset.k;
    let mx, cur, set;
    if (kind === "seat") {
      mx = countAt(st, k);
      cur = Math.min(+st.x.shuttle[k] || 0, mx);
      set = (n) => { st.x.shuttle[k] = n; };
    } else {
      const label = foodOptions(ctx)[+k];
      mx = most(st, ctx);
      cur = Math.min(+st.diet[label] || 0, mx);
      set = (n) => { if (n) st.diet[label] = n; else delete st.diet[label]; };
    }
    const n = Math.max(0, Math.min(mx, cur + (dir === "+" ? 1 : -1)));
    set(n);
    const out = root.querySelector(`[data-num="${kind}:${k}"]`);
    if (out) out.textContent = n;
    const grp = b.closest(".rv-step-ctl");
    grp.querySelector(`[data-act='${kind}-']`).disabled = n <= 0;
    grp.querySelector(`[data-act='${kind}+']`).disabled = n >= mx;
    if (b.disabled) grp.querySelector("button:not([disabled])")?.focus();
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    const ui = UI.get(root);
    if (!b || !ui || b.type === "submit") return;
    const { st, ctx } = ui;
    const act = b.dataset.act;
    ui.dirty = true;
    if (act === "all" || act === "clear") {
      const yes = act === "all";
      st.counts = {};
      if (yes) for (const ev of rsvpEvents(ctx)) st.counts[ev.id] = seats(ctx);
      saveDraft(ui);
      draw(root);
      root.querySelector(`[data-act=${act}]`)?.focus();
      setLive(root, yes ? (seats(ctx) === 1 ? "Set to coming to every event." : `Set to all ${seats(ctx)} of you at every event.`) : "All answers cleared.");
    } else if (act === "next") {
      if (st.step === 1 && !validate1(root)) return;
      goStep(root, Math.min(3, st.step + 1));
    } else if (act === "back") goStep(root, Math.max(1, st.step - 1));
    else if (act === "goto") goStep(root, +b.dataset.step);
    else if (/^(seat|diet)[+-]$/.test(act)) {
      bump(root, b, st, ctx);
      saveDraft(ui);
    } else if (act === "ics") {
      const evs = rsvpEvents(ctx).filter((ev) => countAt(st, ev.id) > 0);
      downloadIcs(evs, ctx.content.site, "wedding-events.ics");
    } else if (act === "change") {
      st.phase = "form"; st.step = 1;
      draw(root, "heading");
      setLive(root, "Step 1 of 3: Who's coming");
    }
  });
}

/* ---------- init ---------- */
function initUi(root, ctx) {
  const code = ctx.guest.code;
  const ui = { code, ctx, st: blank(), dirty: false, busy: false, sendErr: "" };
  const prior = read("localStorage", KEY(code));
  if (prior && (prior.counts || prior.members)) ui.st = fromPayload(prior, ctx);
  const draft = read("sessionStorage", DRAFT(code));
  if (draft && draft.counts) { ui.st = { ...blank(), ...draft, x: { ...blank().x, ...draft.x }, replied: ui.st.replied }; ui.dirty = true; }
  UI.set(root, ui);
  const ep = ctx.content.site?.rsvpEndpoint;
  if (ep && ctx.mode !== "edit") {
    const url = ep + (ep.includes("?") ? "&" : "?") + "action=get&code=" + encodeURIComponent(code);
    fetch(url).then((r) => r.json()).then((j) => {
      const P = j && j.ok && j.P;
      if (!P || !(P.counts || P.members)) return;
      const mine = ui.st.replied;
      if (mine && new Date(mine) >= new Date(P.submittedAt)) return;
      write("localStorage", KEY(code), P);
      if (ui.dirty || ui.busy || ui.st.phase === "done") { ui.st.replied = ui.st.replied || P.submittedAt; return; }
      ui.st = fromPayload(P, ui.ctx);
      if (UI.get(root) === ui) draw(root);
    }).catch(() => { /* offline: local data is enough */ });
  }
  return ui;
}

export default {
  id: "rsvp",
  navLabel: "RSVP",
  title: () => "RSVP",
  isEmpty: () => false,
  render(root, ctx) {
    root._ctx = ctx;
    const r = ctx.content.rsvp || {};
    const g = ctx.guest;
    root.innerHTML = String(html`
      <div class="section section--paper rv page-head">
        <div class="container container--narrow rv-wrap">
          <h1 class="page-title center">RSVP</h1>
          ${g ? html`<p class="lede center">${g.greeting}</p>` : ""}
          <div class="stack stack--s center" ${listAttrs("rsvp.intro")}>
            ${(r.intro || []).map((p, i) => html`<p class="lede" ${editAttrs("multiline", `rsvp.intro.${i}`)} data-index="${i}">${p}</p>`)}
          </div>
          ${r.deadlineText || ctx.mode === "edit" ? html`<p class="center rv-deadline">Please reply by <strong ${editAttrs("text", "rsvp.deadlineText", { placeholder: "Add deadline" })}>${r.deadlineText}</strong></p>` : ""}
          <div class="visually-hidden" role="status" aria-live="polite" data-live></div>
          ${g ? html`<div class="rv-body" data-body></div>` : html`<div class="rv-card rv-lookup" data-lookup></div>`}
        </div>
      </div>`);
    if (!g) {
      renderLookup(root.querySelector("[data-lookup]"), ctx, { heading: "Find your invitation to RSVP" });
      return;
    }
    let ui = UI.get(root);
    if (!ui || ui.code !== g.code) ui = initUi(root, ctx);
    ui.ctx = ctx;
    bind(root);
    draw(root);
  },
};

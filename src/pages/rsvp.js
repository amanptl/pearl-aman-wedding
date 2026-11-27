import { html, raw, editAttrs, listAttrs, setPath } from "../lib/dom.js";
import { renderLookup } from "./_lookup.js";
import { formatDate, formatTime, toInstant } from "../lib/time.js";
import { downloadIcs } from "../lib/calendar.js";
import { calendarSheet } from "./schedule.js";
import { seatsOf, eventSeatsOf, eventSeatsMap, displayGreeting, rsvpDeadline } from "../lib/guestfiles.js";
import { envelopeHeart, calendarPlus as calIcon } from "../lib/icons.js";

/*
 * RSVP by household headcount: for each invited event the family says how many of them are coming (0 up to that
 * event's invited count), plus one empty name field per person coming (required unless rsvp.namesRequired is false),
 * and an optional note for the couple at the bottom of the same step. Step 2 is the review.
 * Payload v3: { v:3, code, household, seats, eventSeats, submittedAt, counts:{eventId:n}, namesByEvent:{eventId:string[]}, names, message }.
 * Older saved replies (v1 per-person, v2 with diet/extras/phone) are still read back; only counts, names and the note are kept.
 */

/* ---------- storage helpers (always guarded) ---------- */
const KEY = (code) => `pa.rsvp.v1.${code}`; // the last reply sent (also read by the home page); v1 or v2 payloads
const DRAFT = (code) => `pa.rsvp.draft.v3.${code}`; // v3: two steps (v2 drafts had three)
const read = (area, k) => { try { return JSON.parse(window[area].getItem(k)); } catch { return null; } };
const write = (area, k, v) => { try { window[area].setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const drop = (area, k) => { try { window[area].removeItem(k); } catch { /* ignore */ } };

const UI = new WeakMap();
const STEP_NAMES = ["Who's coming", "Review"];
const LAST = STEP_NAMES.length;

const blank = () => ({
  phase: "form", step: 1, counts: {}, namesByEvent: {}, replied: null,
  x: { message: "" },
});

/* ---------- derived data ---------- */
const rsvpEvents = (ctx) => ctx.events.filter((e) => e.rsvp !== false);
/** Names of those coming. Required unless content.rsvp.namesRequired is explicitly false. */
const namesAreRequired = (ctx) => ctx.content.rsvp?.namesRequired !== false;
const evTz = (e, ctx) => e.timezone || ctx.tz;
const when = (e, ctx) => `${formatDate(e.start, evTz(e, ctx), "long")} · ${formatTime(e.start, evTz(e, ctx))}`;
const seats = (ctx) => seatsOf(ctx.guest);
/** How many people are invited to one event (0 = not invited). */
const seatsFor = (ctx, eid) => eventSeatsOf(ctx.guest, eid);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const countAt = (st, eid) => (Number.isInteger(st.counts[eid]) ? st.counts[eid] : 0);
const answered = (st, eid) => Number.isInteger(st.counts[eid]);
const comingLabel = (n, cap) => (n === 0 ? (cap === 1 ? "Not coming" : "None of us") : cap === 1 ? "Coming" : plural(n, "guest"));

/** Keep namesByEvent[eid] length equal to the coming count; new slots stay empty. */
function fitNames(st, eid, n) {
  const prev = Array.isArray(st.namesByEvent[eid]) ? st.namesByEvent[eid] : [];
  st.namesByEvent[eid] = Array.from({ length: Math.max(0, n) }, (_, i) => (prev[i] != null ? String(prev[i]) : ""));
}

/* ---------- guest book (names required): one ruled line per invited seat; the names written are the count ---------- */
/** Invited seats for one event. */
const capOf = (ctx, eid) => seatsFor(ctx, eid) || seats(ctx);
/** That event's lines, always one per seat (empty lines stay ""). */
const linesOf = (st, ctx, eid) => {
  const a = Array.isArray(st.namesByEvent[eid]) ? st.namesByEvent[eid] : [];
  return Array.from({ length: capOf(ctx, eid) }, (_, i) => (a[i] != null ? String(a[i]) : ""));
};
const tidy = (s) => String(s || "").trim().replace(/\s+/g, " ");
const nameKey = (s) => tidy(s).toLowerCase();
const filledOf = (st, ctx, eid) => linesOf(st, ctx, eid).map(tidy).filter(Boolean);
const declinedAt = (st, eid) => st.counts[eid] === 0;
/** Every name this household has: the guest list's members, then anything written on any event's lines. */
function namePool(st, ctx) {
  const seen = new Set(), out = [];
  const add = (n) => { const t = tidy(n), k = t.toLowerCase(); if (t && !seen.has(k)) { seen.add(k); out.push(t); } };
  for (const m of ctx.guest?.members || []) add(m?.name ?? m);
  for (const e of rsvpEvents(ctx)) linesOf(st, ctx, e.id).forEach(add);
  return out;
}
/** Short pill labels: first names, or the full name when two people share a first name. */
function pillLabels(pool) {
  const first = (n) => n.split(" ")[0];
  const dup = new Set(pool.map(first).filter((f, i, a) => a.indexOf(f) !== i));
  return new Map(pool.map((n) => [n, dup.has(first(n)) ? n : first(n)]));
}
/** After a line changes: the count is the names written (0 stays only while "None of us" is chosen). */
function syncCount(st, ctx, eid) {
  const n = filledOf(st, ctx, eid).length;
  if (n > 0) st.counts[eid] = n;
  else if (!declinedAt(st, eid)) delete st.counts[eid];
}
/** Lines per event: one per seat when names are required (the guest book); otherwise one per person coming. */
function fitAll(st, ctx) {
  for (const e of rsvpEvents(ctx)) {
    if (namesAreRequired(ctx)) st.namesByEvent[e.id] = linesOf(st, ctx, e.id);
    else fitNames(st, e.id, countAt(st, e.id));
  }
}

function namesFor(st, eid, ctx) {
  const n = countAt(st, eid);
  const list = Array.isArray(st.namesByEvent[eid]) ? st.namesByEvent[eid] : [];
  // Guest book: the names written, in order, whichever lines they are on.
  if (ctx && namesAreRequired(ctx)) return list.map(tidy).filter(Boolean).slice(0, n);
  return Array.from({ length: n }, (_, i) => String(list[i] || "").trim());
}

function namesSummary(st, ctx) {
  return rsvpEvents(ctx)
    .filter((e) => countAt(st, e.id) > 0)
    .map((e) => {
      const names = namesFor(st, e.id, ctx).filter(Boolean);
      return names.length ? `${e.name}: ${names.join(", ")}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

/** Split an older single names string on commas into up to `n` slots. */
function splitNames(text, n) {
  const parts = String(text || "").split(",").map((s) => s.trim()).filter(Boolean);
  return Array.from({ length: n }, (_, i) => parts[i] || "");
}

function buildPayload(st, ctx) {
  const evs = rsvpEvents(ctx);
  const eventSeats = eventSeatsMap(ctx.guest, evs.map((e) => e.id));
  const counts = Object.fromEntries(evs.map((e) => {
    const cap = seatsFor(ctx, e.id) || seats(ctx);
    return [e.id, Math.min(cap, countAt(st, e.id))];
  }));
  const any = Object.values(counts).some((n) => n > 0);
  const namesByEvent = {};
  if (any) for (const e of evs) {
    const n = counts[e.id];
    if (n > 0) namesByEvent[e.id] = namesFor(st, e.id, ctx).slice(0, n);
  }
  return {
    v: 3,
    code: ctx.guest.code,
    household: ctx.guest.household,
    seats: seats(ctx),
    eventSeats,
    submittedAt: ctx.now().toISOString(),
    counts,
    namesByEvent,
    names: any ? namesSummary({ ...st, counts, namesByEvent }, ctx) : "",
    message: (st.x.message || "").trim(),
  };
}

/** State from a saved reply (v3, or an older v2 whose note sat in `extras`). Also reads the older per-person
    replies (v1): counts are the yeses, names the people saying yes. Food, hotel and travel answers in old replies are dropped. */
function fromPayload(P, ctx) {
  const st = blank();
  if (P.v >= 2 || P.counts) {
    for (const [id, n] of Object.entries(P.counts || {})) if (Number.isInteger(n)) st.counts[id] = n;
    if (P.namesByEvent && typeof P.namesByEvent === "object") {
      for (const [id, list] of Object.entries(P.namesByEvent)) {
        const n = countAt(st, id);
        st.namesByEvent[id] = Array.isArray(list) ? Array.from({ length: n }, (_, i) => String(list[i] || "")) : splitNames(list, n);
      }
    } else {
      // Older v2: one shared names string — copy into each event's slots up to its count.
      for (const e of rsvpEvents(ctx)) {
        const n = countAt(st, e.id);
        if (n > 0) st.namesByEvent[e.id] = splitNames(P.names || "", n);
      }
    }
  } else {
    const yes = new Set();
    for (const r of P.responses || []) {
      st.counts[r.eventId] = (st.counts[r.eventId] || 0) + (r.attending === "yes" ? 1 : 0);
      if (r.attending === "yes") yes.add(r.memberId);
    }
    const shared = (P.members || []).filter((m) => yes.has(m.id)).map((m) => m.name).filter(Boolean);
    for (const e of rsvpEvents(ctx)) {
      const n = countAt(st, e.id);
      if (n > 0) st.namesByEvent[e.id] = Array.from({ length: n }, (_, i) => shared[i] || "");
    }
  }
  fitAll(st, ctx);
  st.x.message = String(P.message ?? P.extras?.message ?? "");
  st.replied = P.submittedAt || null;
  // A household that has replied comes back to their reply (with "Change my response"), not to step 1 of the form.
  if (st.replied) st.phase = "done";
  return st;
}

const fmtDay = (iso, ctx) => {
  try { return new Date(iso).toLocaleDateString("en-US", { timeZone: ctx.tz, month: "long", day: "numeric", year: "numeric" }); } catch { return ""; }
};
const deadlinePassed = (ctx) => {
  const d = rsvpDeadline(ctx.content, ctx.guest).date;
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
      const cap = seatsFor(ctx, e.id) || seats(ctx);
      const names = namesFor(st, e.id, ctx).filter(Boolean);
      return html`<li class="rv-sum-ev" data-sum-event="${e.id}">
        <p class="rv-sum-name">${e.name} <span class="rv-muted">${when(e, ctx)}</span></p>
        <p class="rv-sum-who"><span class="rv-pill ${n > 0 ? "is-yes" : "is-no"}">${comingLabel(n, cap)} <span aria-hidden="true">${n > 0 ? "✓" : "✗"}</span></span></p>
        ${names.length ? html`<p class="rv-sum-names">${names.join(", ")}</p>` : ""}
      </li>`;
    })}
  </ul>`;
}

function noteSummary(st) {
  const note = String(st.x.message || "").trim();
  return note ? html`<p class="rv-note-text">${note}</p>` : "";
}

/* ---------- steps ---------- */
function stepHead(n, title, help) {
  return html`<legend class="rv-legend"><span class="rv-count">Step ${n} of ${LAST}</span><h2 tabindex="-1" data-step-heading>${title}</h2></legend>${help ? html`<p class="rv-help">${help}</p>` : ""}`;
}

function step1(st, ctx) {
  return namesAreRequired(ctx) ? step1Book(st, ctx) : step1Counts(st, ctx);
}

/* Guest book: each event is an ivory page with one ruled line per invited seat. Writing a name on a line means that
   person is coming; names already written anywhere (and the household's names from the guest list) are offered as
   "Tap to add" pills on every event that still has an empty line. */
const comingText = (st, ctx, eid) => {
  const cap = capOf(ctx, eid), n = filledOf(st, ctx, eid).length;
  if (declinedAt(st, eid)) return "We'll miss you";
  if (cap === 1) return n ? "Coming ✓" : "";
  return `${n} of ${cap} coming${n === cap ? " ✓" : ""}`;
};
const declineLabel = (ctx, eid) => (capOf(ctx, eid) === 1 ? "Regretfully declines" : "None of us");

function pillsHtml(st, ctx, e, pool = namePool(st, ctx)) {
  if (declinedAt(st, e.id) || !linesOf(st, ctx, e.id).some((v) => !tidy(v))) return "";
  const here = new Set(filledOf(st, ctx, e.id).map(nameKey));
  const list = pool.filter((n) => !here.has(nameKey(n)));
  if (!list.length) return "";
  const label = pillLabels(pool);
  return html`<p class="rv-pills-label" id="pl-${e.id}">Tap to add</p>
    <div class="rv-pills-list" role="group" aria-labelledby="pl-${e.id}">${list.map((n) => html`<button type="button" class="rv-addname" data-act="addname" data-k="${e.id}" data-name="${n}" aria-label="Add ${n} to ${e.name}"><span aria-hidden="true">+</span> ${label.get(n)}</button>`)}</div>`;
}

function bookCard(st, ctx, e, pool, seatsSaid) {
  const cap = capOf(ctx, e.id);
  const declined = declinedAt(st, e.id);
  const lines = linesOf(st, ctx, e.id);
  return html`<section class="rv-ev rv-ev--book" aria-labelledby="evh-${e.id}" data-ev="${e.id}" data-cap="${cap}">
    <div class="rv-book ${declined ? "is-declined" : ""}" role="group" aria-labelledby="evh-${e.id}${seatsSaid ? "" : ` bk-${e.id}`}">
      <header class="rv-book-head"><h3 class="rv-book-name" id="evh-${e.id}">${e.name}</h3><p class="rv-when">${when(e, ctx)}</p></header>
      ${seatsSaid ? "" : html`<p class="rv-book-sub" id="bk-${e.id}">${cap === 1 ? "We've saved a seat for you" : `We've saved ${cap} seats for you`}</p>`}
      <div class="rv-book-lines" data-names-for="${e.id}" ${declined ? "hidden" : ""}>
        ${lines.map((v, i) => html`<div class="rv-line"><label class="rv-line-n" for="x-name-${e.id}-${i}"><span aria-hidden="true">${i + 1}</span><span class="visually-hidden">Guest ${i + 1} of ${cap}, ${e.name}</span></label>
          <input id="x-name-${e.id}-${i}" type="text" data-name-slot="${e.id}" data-i="${i}" value="${v}" maxlength="80" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Full name" aria-describedby="er-${e.id}" /></div>`)}
      </div>
      <div class="rv-pills" data-pills-for="${e.id}">${pillsHtml(st, ctx, e, pool)}</div>
      <p class="rv-err" id="er-${e.id}" hidden></p>
      <div class="rv-book-foot">
        <span class="rv-book-count" data-count-for="${e.id}">${comingText(st, ctx, e.id)}</span>
        <button type="button" class="rv-decline" data-act="decline" data-k="${e.id}" aria-pressed="${declined ? "true" : "false"}">${declined ? html`<span aria-hidden="true">✗ </span>` : ""}${declineLabel(ctx, e.id)}</button>
      </div>
    </div>
  </section>`;
}

/** Optional note for the couple, at the bottom of the first step. */
function noteCard(st) {
  return html`<section class="rv-card rv-note">
    <div class="rv-field">
      <label for="x-message">A note for the couple (optional)</label>
      <textarea id="x-message" data-f="x.message" rows="3" maxlength="1000">${st.x.message}</textarea>
    </div>
  </section>`;
}

function step1Book(st, ctx) {
  const evs = rsvpEvents(ctx);
  const pool = namePool(st, ctx);
  const allOne = evs.length > 0 && evs.every((e) => capOf(ctx, e.id) === 1);
  // When every event has the same number of seats, say it once up top instead of on each event.
  const caps = new Set(evs.map((e) => capOf(ctx, e.id)));
  const seats = caps.size === 1 ? [...caps][0] : 0;
  const help = allOne
    ? "We've saved a seat for you. Write your name at each event you can join — you can change it any time before the deadline."
    : seats
      ? `We've saved ${seats} seats for you. Write the names of those joining us at each event — you can change it any time before the deadline.`
      : "Write the names of those joining us at each event — you can change it any time before the deadline.";
  return html`<fieldset class="rv-step" data-step="1">
    ${stepHead(1, "Who's coming?", help)}
    <div class="rv-quick" role="group" aria-label="Quick answers">
      <button type="button" class="btn btn--secondary btn--small" data-act="all">${allOne ? "Coming to all events" : "Everyone, every event"}</button>
      <button type="button" class="rv-quick-link" data-act="clear">Clear</button>
    </div>
    <div class="rv-sheet">${evs.map((e) => bookCard(st, ctx, e, pool, seats > 0))}</div>
    ${noteCard(st)}
  </fieldset>`;
}

/** Keep every event's "Tap to add" pills and count in step with the lines, without redrawing the lines being typed in.
    Pills are patched by name, so a pill being pressed is never swapped out from under the pointer. */
function refreshBook(root) {
  const ui = UI.get(root);
  if (!ui || ui.st.step !== 1 || !namesAreRequired(ui.ctx)) return;
  const { st, ctx } = ui;
  const pool = namePool(st, ctx);
  for (const e of rsvpEvents(ctx)) {
    const out = root.querySelector(`[data-count-for="${e.id}"]`);
    if (out) out.textContent = comingText(st, ctx, e.id);
    const box = root.querySelector(`[data-pills-for="${e.id}"]`);
    if (!box) continue;
    const want = String(pillsHtml(st, ctx, e, pool));
    const list = box.querySelector(".rv-pills-list");
    const tmp = document.createElement("div");
    tmp.innerHTML = want;
    const next = tmp.querySelector(".rv-pills-list");
    if (!list || !next) { if (box.innerHTML !== want) box.innerHTML = want; continue; }
    const have = new Map([...list.children].map((b) => [b.dataset.name, b]));
    const keep = new Set([...next.children].map((b) => b.dataset.name));
    for (const [n, b] of have) if (!keep.has(n)) b.remove();
    [...next.children].forEach((b, i) => {
      const cur = have.get(b.dataset.name);
      const node = cur && cur.isConnected ? cur : b;
      if (node === b || node.innerHTML !== b.innerHTML) { if (node !== b) node.innerHTML = b.innerHTML; }
      if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null);
    });
  }
}

function step1Counts(st, ctx) {
  const evs = rsvpEvents(ctx);
  const needNames = namesAreRequired(ctx);
  const allOne = evs.length > 0 && evs.every((e) => (seatsFor(ctx, e.id) || seats(ctx)) === 1);
  return html`<fieldset class="rv-step" data-step="1">
    ${stepHead(1, "Who's coming?", allOne
      ? "For each event, let us know if you can join us. You can change it any time before the deadline."
      : html`For each event, tap how many of you will join us (up to the number invited). You can change it any time before the deadline.`)}
    <div class="rv-quick" role="group" aria-label="Quick answers">
      <button type="button" class="btn btn--secondary btn--small" data-act="all">${allOne ? "Coming to all events" : "Everyone, every event"}</button>
      <button type="button" class="btn btn--secondary btn--small" data-act="clear">Clear</button>
    </div>
    ${evs.map((e) => {
      const cap = seatsFor(ctx, e.id) || seats(ctx);
      const one = cap === 1;
      const v = st.counts[e.id];
      const coming = countAt(st, e.id);
      const opts = Array.from({ length: cap + 1 }, (_, n) => n);
      const slots = Array.isArray(st.namesByEvent[e.id]) ? st.namesByEvent[e.id] : Array.from({ length: coming }, () => "");
      return html`<section class="rv-card rv-ev" aria-labelledby="evh-${e.id}" data-ev="${e.id}" data-cap="${cap}">
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
        <div class="rv-ev-names" data-names-for="${e.id}" ${coming > 0 ? "" : "hidden"}>
          <p class="rv-names-label" id="nm-${e.id}">Names of those coming${needNames ? "" : html` <span class="rv-muted">(optional)</span>`}</p>
          <div class="rv-name-slots" role="group" aria-labelledby="nm-${e.id}">
            ${slots.map((name, i) => html`<div class="rv-field"><label for="x-name-${e.id}-${i}">Person ${i + 1}</label>
              <input id="x-name-${e.id}-${i}" type="text" data-name-slot="${e.id}" data-i="${i}" value="${name}" maxlength="80" autocomplete="name" placeholder="Full name" ${needNames ? raw('aria-required="true"') : ""} /></div>`)}
          </div>
          ${needNames ? html`<p class="rv-err" id="er-names-${e.id}" hidden></p>` : ""}
        </div>
      </section>`;
    })}
    ${noteCard(st)}
  </fieldset>`;
}

function stepReview(st, ctx, err) {
  const goto = (n, label) => html`<button type="button" class="btn btn--ghost btn--small" data-act="goto" data-step="${n}">${label}</button>`;
  return html`<fieldset class="rv-step" data-step="2">
    ${stepHead(2, "Review and send", "Please check everything. You can edit any part before sending.")}
    <section class="rv-card" aria-labelledby="rv-s1"><div class="rv-cardhead"><h3 id="rv-s1">Who's coming</h3>${goto(1, html`Edit<span class="visually-hidden"> who's coming</span>`)}</div>${summaryHtml(st, ctx)}</section>
    <section class="rv-card" aria-labelledby="rv-s2"><div class="rv-cardhead"><h3 id="rv-s2">Your note</h3>${goto(1, html`Edit<span class="visually-hidden"> your note</span>`)}</div>
      ${noteSummary(st) || html`<p class="rv-muted">No note added.</p>`}</section>
    <p class="rv-err rv-send-err" data-send-err role="alert" ${err ? "" : "hidden"}>${err || ""}</p>
  </fieldset>`;
}

/* ---------- views ---------- */
function formView(ui, ctx) {
  const st = ui.st;
  const fn = st.step === 1 ? step1 : stepReview;
  const stepper = html`<ol class="rv-steps" aria-label="Progress">${STEP_NAMES.map((n, i) => html`<li ${st.step === i + 1 ? raw('aria-current="step"') : ""} class="${st.step === i + 1 ? "is-current" : st.step > i + 1 ? "is-done" : ""}"><span class="rv-dot" aria-hidden="true">${st.step > i + 1 ? "✓" : i + 1}</span><span class="rv-steplabel">${n}${st.step === i + 1 ? html`<span class="visually-hidden"> (current step)</span>` : ""}</span></li>`)}</ol>`;
  const last = st.step === LAST;
  return html`${stepper}<form class="rv-form" novalidate data-form>
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
    ${has ? html`<div class="rv-card"><h3>What we have for you${st.replied ? html` <span class="rv-muted">(sent ${fmtDay(st.replied, ctx)})</span>` : ""}</h3>${summaryHtml(st, ctx)}${noteSummary(st)}</div>` : ""}`;
}

const NOTED = (code) => `pa.rsvp.noted.${code}`;
/** Apple devices open a multi-event .ics straight into Calendar; elsewhere a sheet offers the file or Google, one by one. */
const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

function doneView(ui, ctx) {
  const st = ui.st;
  const evs = rsvpEvents(ctx).filter((e) => countAt(st, e.id) > 0);
  // The signed note drops in (and signs itself) the first time only; after that it simply sits there.
  const fresh = !read("localStorage", NOTED(ui.code));
  if (fresh) write("localStorage", NOTED(ui.code), 1);
  return html`<div class="rv-done" data-done>
    <aside class="rv-signed${fresh ? " is-new" : ""}" aria-label="A note from Pearl and Aman">
      <p>${evs.length ? "We can't wait to celebrate with you." : "We'll miss you and are grateful for your kind wishes."}</p>
      <img src="assets/img/signature-wine.webp" width="747" height="180" alt="Pearl &amp; Aman">
    </aside>
    <div class="rv-done-head"><h2 tabindex="-1" data-step-heading>Your reply</h2></div>
    ${evs.length ? html`<ul class="rv-sum" aria-label="You're joining us for">${evs.map((e) => html`<li class="rv-sum-ev">
        <span class="rv-sum-name">${e.name}</span>
        <span class="rv-sum-detail"><span class="rv-sum-when">${formatDate(e.start, evTz(e, ctx), "short")}</span>${namesFor(st, e.id, ctx).filter(Boolean).join(", ") || comingLabel(countAt(st, e.id), seatsFor(ctx, e.id) || seats(ctx))}</span>
      </li>`)}</ul>
      <button type="button" class="btn btn--primary rv-done-btn" data-act="ics" aria-haspopup="${isApple() ? "false" : "dialog"}">${calIcon()}Add to my calendar</button>` : ""}
    <button type="button" class="btn btn--secondary rv-done-btn" data-act="change">Change my response</button>
  </div>`;
}

/** While we ask the server whether this household already replied (from another device), so step 1 doesn't flash first. */
const loadingView = () => html`<div class="rv-card rv-loading" data-loading aria-busy="true"><p class="rv-help">Looking up your reply…</p></div>`;

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
  else if (ui.loading) v = loadingView();
  else if (ui.st.phase === "done") v = doneView(ui, ctx);
  else v = formView(ui, ctx);
  body.innerHTML = String(v);
  syncHead(root, ui, ctx);
  // The signed note writes itself in once; hold that until its image has arrived (slow connections).
  const sig = body.querySelector(".rv-signed.is-new img");
  if (sig && !(sig.complete && sig.naturalWidth)) {
    sig.style.animationPlayState = "paused";
    sig.addEventListener("load", () => { sig.style.animationPlayState = ""; }, { once: true });
  }
  if (focus === "heading") {
    const h = body.querySelector("[data-step-heading]");
    if (h) { h.focus({ preventScroll: true }); h.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
  } else if (focus) {
    body.querySelector(focus)?.focus();
  }
}

/** Once a household has replied, the header thanks them (instead of inviting them) and says when they replied. */
function syncHead(root, ui, ctx) {
  const replied = !!ui.st.replied && !deadlinePassed(ctx) && ctx.mode !== "edit";
  const greet = root.querySelector("[data-greet]"), intro = root.querySelector("[data-intro]");
  const warn = root.querySelector(".rv-warn"), line = root.querySelector("[data-replied]");
  if (greet) greet.textContent = replied ? `Thank you, ${ctx.guest.household}` : displayGreeting(ctx.guest.greeting);
  if (intro) intro.hidden = replied;
  if (warn) warn.hidden = replied;
  if (line) {
    line.hidden = !replied;
    if (replied) {
      let day = "";
      try { day = new Date(ui.st.replied).toLocaleDateString("en-US", { timeZone: ctx.tz, month: "short", day: "numeric", year: "numeric" }); } catch { /* keep it short */ }
      const until = rsvpDeadline(ctx.content, ctx.guest).text;
      line.innerHTML = String(html`<span class="rv-replied-tag"><span aria-hidden="true">✓ </span>Replied</span><span class="rv-replied-rule" aria-hidden="true"></span><span>${day}${until ? html` · You can update it until ${until}` : ""}</span>`);
    }
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
  setLive(root, `Step ${n} of ${LAST}: ${STEP_NAMES[n - 1]}`);
}

/* ---------- validation ---------- */
function validate1(root) {
  const ui = UI.get(root);
  const { st, ctx } = ui;
  const body = root.querySelector("[data-body]");
  let first = null;
  let firstMsg = "";
  let count = 0;
  const needNames = namesAreRequired(ctx);
  if (needNames) {
    // Guest book: every event needs at least one name written, or "None of us".
    for (const e of rsvpEvents(ctx)) {
      const err = body.querySelector(`#er-${e.id}`);
      const inputs = body.querySelectorAll(`input[data-name-slot="${e.id}"]`);
      const ok = declinedAt(st, e.id) || filledOf(st, ctx, e.id).length > 0;
      inputs.forEach((el) => (ok ? el.removeAttribute("aria-invalid") : el.setAttribute("aria-invalid", "true")));
      if (!err) continue;
      if (ok) { err.hidden = true; continue; }
      err.textContent = `Please write who's coming to ${e.name}, or choose ${declineLabel(ctx, e.id)}.`;
      err.hidden = false;
      count++;
      if (!first) { first = inputs[0] || body.querySelector(`[data-act=decline][data-k="${e.id}"]`); firstMsg = err.textContent; }
    }
  } else for (const e of rsvpEvents(ctx)) {
    const cap = seatsFor(ctx, e.id) || seats(ctx);
    const err = body.querySelector(`#er-${e.id}`);
    if (err) {
      if (!answered(st, e.id)) {
        err.textContent = cap === 1 ? `Please let us know if you can come to ${e.name}.` : `Please choose how many of you are coming to ${e.name}.`;
        err.hidden = false;
        count++;
        if (!first) { first = body.querySelector(`input[name="n__${e.id}"]`); firstMsg = err.textContent; }
      } else err.hidden = true;
    }
    const namesErr = body.querySelector(`#er-names-${e.id}`);
    const coming = countAt(st, e.id);
    if (needNames && coming > 0) {
      const slots = body.querySelectorAll(`input[data-name-slot="${e.id}"]`);
      let missing = null;
      slots.forEach((el) => {
        if (!el.value.trim()) {
          el.setAttribute("aria-invalid", "true");
          if (!missing) missing = el;
        } else el.removeAttribute("aria-invalid");
      });
      if (missing && namesErr) {
        namesErr.textContent = coming === 1 ? `Please add the name of who is coming to ${e.name}.` : `Please add a name for each person coming to ${e.name}.`;
        namesErr.hidden = false;
        count++;
        if (!first) { first = missing; firstMsg = namesErr.textContent; }
      } else if (namesErr) namesErr.hidden = true;
    } else if (namesErr) namesErr.hidden = true;
  }
  if (first) {
    first.focus();
    first.scrollIntoView({ block: "center" });
    setLive(root, `${count} ${count === 1 ? "answer is" : "answers are"} still needed. ${firstMsg}`);
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

  root.addEventListener("submit", (e) => { e.preventDefault(); const ui = UI.get(root); if (ui && ui.st.step === LAST) submit(root); });

  const onField = (e) => {
    const ui = UI.get(root);
    const t = e.target;
    if (!ui || !(t instanceof HTMLElement)) return;
    const { st, ctx } = ui;
    ui.dirty = true;
    if (t.dataset.f) {
      if (t.type === "radio" && !t.checked) return;
      setPath(st, t.dataset.f, t.value);
    } else if (t.dataset.nameSlot && namesAreRequired(ctx)) {
      const eid = t.dataset.nameSlot;
      st.namesByEvent[eid] = linesOf(st, ctx, eid);
      st.namesByEvent[eid][+t.dataset.i] = t.value;
      syncCount(st, ctx, eid);
      const out = root.querySelector(`[data-count-for="${eid}"]`);
      if (out) out.textContent = comingText(st, ctx, eid);
      if (filledOf(st, ctx, eid).length) {
        root.querySelectorAll(`input[data-name-slot="${eid}"]`).forEach((el) => el.removeAttribute("aria-invalid"));
        const err = root.querySelector(`#er-${eid}`); if (err) err.hidden = true;
      }
      // New names become pills elsewhere once the line is finished (change), not on every keystroke.
      if (e.type === "change") laterRefresh();
    } else if (t.dataset.nameSlot) {
      const eid = t.dataset.nameSlot;
      const i = +t.dataset.i;
      if (!Array.isArray(st.namesByEvent[eid])) st.namesByEvent[eid] = [];
      st.namesByEvent[eid][i] = t.value;
      if (t.value.trim()) {
        t.removeAttribute("aria-invalid");
        const err = root.querySelector(`#er-names-${eid}`);
        if (err && namesFor(st, eid).every(Boolean)) err.hidden = true;
      }
    } else if (t.dataset.count) {
      if (!t.checked) return;
      const eid = t.dataset.count;
      const cap = seatsFor(ctx, eid) || seats(ctx);
      const n = Math.max(0, Math.min(cap, Math.round(+t.value) || 0));
      st.counts[eid] = n;
      fitNames(st, eid, n);
      const err = root.querySelector(`#er-${eid}`); if (err) err.hidden = true;
      saveDraft(ui);
      draw(root, `input[name="n__${eid}"]:checked`);
      return;
    } else return;
    saveDraft(ui);
  };
  /* A line is finished (change) the moment the guest taps something else. Updating the pills then would move the page
     under that tap (Continue, a pill), so while a pointer is down the update waits until the tap has landed. */
  let pressing = false, pending = false;
  const laterRefresh = () => { if (pressing) pending = true; else refreshBook(root); };
  root.addEventListener("pointerdown", () => { pressing = true; }, true);
  const release = () => setTimeout(() => { pressing = false; if (pending) { pending = false; refreshBook(root); } }, 0);
  addEventListener("pointerup", release, true);
  addEventListener("pointercancel", release, true);
  root.addEventListener("change", onField);
  root.addEventListener("input", (e) => { if (e.target.matches("input:not([type=radio]):not([type=checkbox]), textarea")) onField(e); });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    const ui = UI.get(root);
    if (!b || !ui || b.type === "submit") return;
    const { st, ctx } = ui;
    const act = b.dataset.act;
    ui.dirty = true;
    if ((act === "all" || act === "clear") && namesAreRequired(ctx)) {
      const yes = act === "all";
      if (yes) {
        // Write the names we know (guest list first, then names already written) onto each event's empty lines.
        const pool = namePool(st, ctx);
        for (const ev of rsvpEvents(ctx)) {
          const lines = linesOf(st, ctx, ev.id);
          const here = new Set(lines.map(nameKey).filter(Boolean));
          const spare = pool.filter((n) => !here.has(nameKey(n)));
          st.namesByEvent[ev.id] = lines.map((v) => (tidy(v) ? v : spare.shift() || ""));
          if (declinedAt(st, ev.id)) delete st.counts[ev.id];
          syncCount(st, ctx, ev.id);
        }
      } else { st.counts = {}; st.namesByEvent = {}; fitAll(st, ctx); }
      saveDraft(ui);
      draw(root);
      root.querySelector(`[data-act=${act}]`)?.focus();
      setLive(root, yes ? "Filled in the names we have for every event." : "All answers cleared.");
    } else if (act === "addname") {
      const eid = b.dataset.k, name = b.dataset.name;
      const lines = linesOf(st, ctx, eid);
      const i = lines.findIndex((v) => !tidy(v));
      if (i < 0) return;
      lines[i] = name;
      st.namesByEvent[eid] = lines;
      syncCount(st, ctx, eid);
      const input = root.querySelector(`#x-name-${eid}-${i}`);
      if (input) { input.value = name; input.removeAttribute("aria-invalid"); }
      const err = root.querySelector(`#er-${eid}`); if (err) err.hidden = true;
      const after = b.nextElementSibling || b.previousElementSibling;
      saveDraft(ui);
      refreshBook(root);
      // Keep the keyboard in the pills while there is room; once the page is full, land on the line just filled.
      (after?.isConnected ? after : input)?.focus();
      const ev = rsvpEvents(ctx).find((x) => x.id === eid);
      setLive(root, `Added ${name} to ${ev?.name || "this event"}. ${comingText(st, ctx, eid)}.`);
    } else if (act === "decline") {
      const eid = b.dataset.k;
      if (declinedAt(st, eid)) { delete st.counts[eid]; syncCount(st, ctx, eid); } else st.counts[eid] = 0;
      const err = root.querySelector(`#er-${eid}`); if (err) err.hidden = true;
      saveDraft(ui);
      draw(root, `[data-act=decline][data-k="${eid}"]`);
      const ev = rsvpEvents(ctx).find((x) => x.id === eid);
      setLive(root, declinedAt(st, eid) ? `${declineLabel(ctx, eid)} for ${ev?.name}.` : `${ev?.name}: write who's coming.`);
    } else if (act === "all" || act === "clear") {
      const yes = act === "all";
      st.counts = {};
      st.namesByEvent = {};
      if (yes) for (const ev of rsvpEvents(ctx)) {
        const n = seatsFor(ctx, ev.id) || seats(ctx);
        st.counts[ev.id] = n;
        fitNames(st, ev.id, n);
      } else for (const ev of rsvpEvents(ctx)) fitNames(st, ev.id, 0);
      saveDraft(ui);
      draw(root);
      root.querySelector(`[data-act=${act}]`)?.focus();
      const allOne = rsvpEvents(ctx).every((ev) => (seatsFor(ctx, ev.id) || seats(ctx)) === 1);
      setLive(root, yes ? (allOne ? "Set to coming to every event." : "Set to everyone invited at every event.") : "All answers cleared.");
    } else if (act === "next") {
      if (st.step === 1 && !validate1(root)) return;
      goStep(root, Math.min(LAST, st.step + 1));
    } else if (act === "back") goStep(root, Math.max(1, st.step - 1));
    else if (act === "goto") goStep(root, +b.dataset.step);
    else if (act === "ics") {
      const evs = rsvpEvents(ctx).filter((ev) => countAt(st, ev.id) > 0);
      if (isApple()) downloadIcs(evs, ctx.content.site, "pearl-and-aman-wedding.ics");
      else calendarSheet(evs, ctx, "pearl-and-aman-wedding.ics");
    } else if (act === "change") {
      st.phase = "form"; st.step = 1;
      draw(root, "heading");
      setLive(root, `Step 1 of ${LAST}: Who's coming`);
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
  if (draft && draft.counts) {
    ui.st = { ...blank(), ...draft, namesByEvent: { ...(draft.namesByEvent || {}) }, step: Math.min(LAST, Math.max(1, +draft.step || 1)), x: { message: String(draft.x?.message || "") }, replied: ui.st.replied };
    // Older drafts stored a single names string — spread into each event's slots.
    if (draft.names && !draft.namesByEvent) {
      for (const e of rsvpEvents(ctx)) {
        const n = countAt(ui.st, e.id);
        if (n > 0) ui.st.namesByEvent[e.id] = splitNames(draft.names, n);
      }
    }
    fitAll(ui.st, ctx);
    ui.dirty = true;
  }
  UI.set(root, ui);
  const ep = ctx.content.site?.rsvpEndpoint;
  if (ep && ctx.mode !== "edit") {
    const url = ep + (ep.includes("?") ? "&" : "?") + "action=get&code=" + encodeURIComponent(code);
    // Nothing saved on this device yet: show "Looking up your reply…" instead of step 1 until the server answers
    // (or 8 s pass), so a reply sent from another device opens straight on "Your reply".
    ui.loading = !ui.st.replied && !ui.dirty;
    const settle = () => {
      if (!ui.loading) return;
      ui.loading = false;
      if (UI.get(root) === ui) draw(root);
    };
    const slow = setTimeout(settle, 8000);
    fetch(url).then((r) => r.json()).then((j) => {
      const P = j && j.ok && j.P;
      if (!P || !(P.counts || P.members)) return;
      const mine = ui.st.replied;
      if (mine && new Date(mine) >= new Date(P.submittedAt)) return;
      write("localStorage", KEY(code), P);
      if (ui.dirty || ui.busy || ui.st.phase === "done") { ui.st.replied = ui.st.replied || P.submittedAt; return; }
      ui.st = fromPayload(P, ui.ctx);
      ui.loading = false;
      if (UI.get(root) === ui) draw(root);
    }).catch(() => { /* offline: local data is enough */ }).finally(() => { clearTimeout(slow); settle(); });
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
    const dl = rsvpDeadline(ctx.content, g); // the guest's own reply-by date (from their invitation wave) or the site-wide one
    root.innerHTML = String(html`
      <div class="section section--paper rv page-head">
        <div class="container container--narrow rv-wrap">
          <h1 class="page-title center">RSVP</h1>
          ${g ? html`<p class="lede center" data-greet>${displayGreeting(g.greeting)}</p>` : ""}
          <div class="stack stack--s center" data-intro ${listAttrs("rsvp.intro")}>
            ${(r.intro || []).map((p, i) => html`<p class="lede" ${editAttrs("multiline", `rsvp.intro.${i}`)} data-index="${i}">${p}</p>`)}
          </div>
          ${!g && (r.deadlineText || ctx.mode === "edit") ? html`<p class="center rv-deadline">Kindly RSVP by <strong ${editAttrs("text", "rsvp.deadlineText", { placeholder: "Add deadline" })}>${r.deadlineText}</strong></p>` : ""}
          ${g && (dl.text || ctx.mode === "edit") && !deadlinePassed(ctx) ? html`<div class="rv-warn" role="note"><span class="rv-warn-tag">${envelopeHeart()}<span>Kindly reply</span></span><p>Please let us know by <strong ${dl.own ? "" : editAttrs("text", "rsvp.deadlineText", { placeholder: "Add deadline" })}>${dl.text || ""}</strong>. If we don't hear from you by then, we'll miss you, but we'll assume you can't make it.</p></div>` : ""}
          ${g ? html`<p class="rv-replied" data-replied hidden></p>` : ""}
          <div class="visually-hidden" role="status" aria-live="polite" data-live></div>
          ${g ? html`<div class="rv-body" data-body></div>` : html`<div class="rv-card rv-lookup" data-lookup></div>`}
        </div>
      </div>`);
    if (!g) {
      renderLookup(root.querySelector("[data-lookup]"), ctx, { heading: "Find your invitation to RSVP" });
      return;
    }
    // Fetch the couple's signature now, so the thank-you note can sign itself the moment they reply.
    if (!root._sigPreload) { root._sigPreload = new Image(); root._sigPreload.src = "assets/img/signature-wine.webp"; }
    let ui = UI.get(root);
    if (!ui || ui.code !== g.code) ui = initUi(root, ctx);
    ui.ctx = ctx;
    bind(root);
    draw(root);
  },
};

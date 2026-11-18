import { html, raw, editAttrs, multiline, imgTag, isEdit } from "../lib/dom.js";
import { formatRange, formatDate, toInstant, nowNext } from "../lib/time.js";
import { renderLookup } from "./_lookup.js";
import * as icon from "../lib/icons.js";

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "July 2027" from the wedding date, for a visitor with no events (the plain link before a name lookup). */
function monthYear(site) {
  const [y, m] = String(site.weddingDate || "").slice(0, 7).split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : "";
}

/**
 * The days a guest is invited to, as one line: "July 23, 2027", "July 24–25, 2027" (consecutive days), "July 23 & 25, 2027"
 * (a gap), "July 21, 23 & 25, 2027", "July 23–24 & 26, 2027". Only start days count, so a reception running past midnight adds no day. With no
 * events (the plain link before a name lookup), only the month and year.
 */
export function inviteDates(events, site) {
  const days = [...new Set(events.map((e) => String(e.start || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (!days.length) return monthYear(site) || site.dateText || "";
  const ymd = days.map((d) => d.split("-").map(Number));
  // Runs of consecutive days; Date.UTC handles month ends (July 31 → August 1).
  const runs = [];
  for (const [y, m, d] of ymd) {
    const t = Date.UTC(y, m - 1, d), last = runs[runs.length - 1];
    if (last && t - last.endT === 864e5) { last.end = [y, m, d]; last.endT = t; } else runs.push({ start: [y, m, d], end: [y, m, d], endT: t });
  }
  // "a", "a & b", "a, b & c": the way printed invitations list dates.
  const list = (xs) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`;
  const years = new Set(ymd.map(([y]) => y)), months = new Set(ymd.map(([y, m]) => `${y}-${m}`));
  if (months.size === 1) {
    const [y, m] = ymd[0];
    return `${MONTHS[m - 1]} ${list(runs.map((r) => r.start[2] === r.end[2] ? r.start[2] : `${r.start[2]}–${r.end[2]}`))}, ${y}`;
  }
  const day = ([y, m, d]) => `${MONTHS[m - 1]} ${d}${years.size > 1 ? `, ${y}` : ""}`;
  const text = list(runs.map((r) => r.endT === Date.UTC(r.start[0], r.start[1] - 1, r.start[2]) ? day(r.start) : `${day(r.start)} – ${day(r.end)}`));
  return years.size > 1 ? text : `${text}, ${ymd[0][0]}`;
}

/**
 * Is the wedding itself among these events? Picks the card's opening line ("the wedding of" vs "the wedding celebrations
 * of"). The wedding is the event with id "wedding" (in the events or the invite) or the one that starts at site.weddingDate.
 */
function hasWedding(events, site, guest) {
  const at = String(site.weddingDate || "").slice(0, 16);
  return (guest?.eventIds || []).includes("wedding") || events.some((e) => e.id === "wedding" || (at && String(e.start || "").slice(0, 16) === at));
}

/** The home card, page heading and tab title show only the days this guest is invited to. */
export const homeDate = (ctx) => inviteDates(ctx.events, ctx.content.site);

function countdownHtml(ms) {
  const units = [["Days", Math.floor(ms / 864e5)], ["Hours", Math.floor(ms / 36e5) % 24], ["Minutes", Math.floor(ms / 6e4) % 60], ["Seconds", Math.floor(ms / 1e3) % 60]];
  return html`${units.map(([l, v]) => html`<div class="cd-unit"><b>${pad(v)}</b><span>${l}</span></div>`)}`;
}

// Shrink the invitation text until it fits the card (long names / long venue lines).
function fitInvite(root) {
  const card = root.querySelector(".invite");
  const t = root.querySelector(".invite-text");
  if (!card || !t || !card.clientHeight) return;
  let f = 1;
  t.style.setProperty("--fit", f);
  for (let i = 0; i < 14 && t.scrollHeight > card.clientHeight * 0.93; i++) {
    f -= 0.06;
    t.style.setProperty("--fit", f.toFixed(2));
  }
}

/**
 * Desktop: the invitation stack is sized by the board's height (u = height / 880), but the card and tags are styled in
 * board-width units, so their `scale` needs u relative to the width. CSS can't divide one length by another in every
 * browser yet, so the ratio is set here as --k (the CSS falls back to the photo's natural proportions).
 */
function scaleStack(root) {
  const board = root.querySelector(".board");
  if (!board?.clientWidth) return;
  board.style.setProperty("--k", ((board.clientHeight / 880) * 864 / board.clientWidth).toFixed(4));
}

const hasReplied = (guest) => {
  if (!guest?.code) return false;
  try { return localStorage.getItem(`pa.rsvp.v1.${guest.code}`) != null; } catch { return false; }
};

const pageOn = (ctx, id) => ctx.content.pages?.[id]?.enabled !== false;

// The little burgundy tag hung under Respond: "by Jan 31st" from the RSVP deadline (or the editor's own wording).
// Hidden once the deadline has passed, when there is no deadline, or when the RSVP page is off.
const ordinal = (d) => d + (d % 100 >= 11 && d % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] || "th");
export function dueLabel(ctx) {
  const d = ctx.content.rsvp?.deadline, custom = ctx.content.home?.board?.dueLabel;
  if (!pageOn(ctx, "rsvp") || !d) return "";
  if (!isEdit()) {
    const t = toInstant(`${d}T23:59:59`, ctx.tz);
    if (!isNaN(t) && ctx.now() > t) return "";
  }
  if (custom) return custom;
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return "";
  const mon = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `by ${mon} ${ordinal(day)}`;
}
const travelHasContent = (c) => {
  const t = c.travel || {};
  return !!(c.hotels?.length || t.airports?.length || t.gettingAround?.length || t.shuttles?.length || t.aroundTown?.length || t.international?.text);
};

// "Up next / Happening now" card. Hidden for now (it repeats the invitation card months out); planned to return
// for the wedding week. Flip this to bring it back.
const SHOW_NEXT_UP = false;

function nextUp(ctx) {
  if (!SHOW_NEXT_UP) return "";
  const { current, next } = nowNext(ctx.events, ctx.now(), ctx.tz);
  const e = current || next;
  if (!e) return "";
  const tz = e.timezone || ctx.tz;
  const v = e.venue || {};
  return html`
    <a class="card nextup" href="#schedule/${e.id}">
      <span class="nextup-body stack stack--s">
        <span class="cluster cluster--s">
          <span class="badge ${current ? "" : "badge--gold"}">${current ? "Happening now" : "Up next"}</span>
          <span class="eyebrow"><span class="nowrap">${formatDate(e.start, tz, "short")}</span> &middot; <span class="nowrap">${formatRange(e.start, e.end, tz)}</span></span>
        </span>
        <span class="display display--m nextup-name">${e.name}</span>
        ${v.name ? html`<span class="nextup-venue">${icon.mapPin()}<span>${v.name}</span></span>` : ""}
      </span>
      <span class="nextup-go" aria-hidden="true">${icon.chevron()}</span>
    </a>`;
}

function quickActions(ctx) {
  const c = ctx.content;
  const n = ctx.events.length;
  const replied = hasReplied(ctx.guest);
  const deadline = c.rsvp?.deadlineText || (c.rsvp?.deadline ? formatDate(c.rsvp.deadline + "T12:00", ctx.tz, "full") : "");
  const items = [];
  if (n) items.push({ href: "#schedule", ic: icon.calendarPlus(), title: "Schedule", sub: ctx.guest ? `Your ${n} ${n === 1 ? "event" : "events"}` : `${n} ${n === 1 ? "event" : "events"}` });
  if (pageOn(ctx, "travel") && travelHasContent(c)) items.push({ href: "#travel", ic: icon.plane(), title: "Travel & Stay", sub: "Hotels, flights and getting around" });
  if (pageOn(ctx, "rsvp")) items.push({ href: "#rsvp", ic: replied ? icon.check() : icon.heart(), title: "RSVP", sub: replied ? "You’ve replied ✓" : deadline ? `Reply by ${deadline}` : "Let us know you’re coming", done: replied });
  if (!items.length) return "";
  return html`<ul class="quick" aria-label="Quick links">${items.map((i) => html`
    <li><a class="card quick-card ${i.done ? "is-done" : ""}" href="${i.href}">
      <span class="quick-ic" aria-hidden="true">${i.ic}</span>
      <span class="quick-text"><span class="quick-title">${i.title}</span><span class="quick-sub">${i.sub}</span></span>
      <span class="quick-go" aria-hidden="true">${icon.chevron()}</span>
    </a></li>`)}</ul>`;
}

export default {
  id: "home",
  navLabel: "Home",
  title: (ctx) => `${ctx.content.site.couple.first} & ${ctx.content.site.couple.second}`,
  isEmpty: () => false,
  render(root, ctx) {
    const { site, home } = ctx.content;
    const lines = home.invitationLines || {};
    const board = home.board || {};
    // Every guest sees only the days they are invited to, and the city: not every guest is invited to the wedding.
    const range = homeDate(ctx);
    const wedding = hasWedding(ctx.events, site, ctx.guest);
    const smallPath = wedding ? "home.invitationLines.small" : "home.invitationLines.celebrationSmall";
    const small = (wedding ? lines.small : lines.celebrationSmall) || lines.small || "";
    const edit = isEdit();
    const due = dueLabel(ctx);
    root.classList.add("page-home");
    root.innerHTML = html`
      <h1 class="visually-hidden">${site.couple.first} &amp; ${site.couple.second} are getting married in ${site.city || ""}, ${range}</h1>
      <div class="stage">
      <div class="board" data-allow-clip>
        <span class="board-seal" aria-hidden="true"></span>
        <div class="env" aria-hidden="true">
          <span class="env-back"></span>
          <span class="env-flap"><span class="flap-out"><span class="env-seal seal-hi"><span></span></span></span><span class="flap-in"></span></span>
          <div class="env-photo">${imgTag(home.photo, { eager: true, sizes: "(min-width: 641px) 10rem, 28vw", path: "home.photo" })}</div>
          <span class="env-pocket"></span>
          ${ctx.guest?.household ? html`<span class="env-name">${ctx.guest.household}</span>` : ""}
          <span class="env-sprig" aria-hidden="true"></span>
          <span class="env-shade"></span>
          <span class="env-seal seal-lo"><span></span></span>
          <span class="env-sheen"></span>
        </div>

        <div class="invite">
          <svg class="invite-shape" viewBox="0 0 300 420" preserveAspectRatio="none" aria-hidden="true">
            <defs><pattern id="invite-paper" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="assets/img/card-paper.webp" width="1" height="1" preserveAspectRatio="none" /></pattern></defs>
            <path class="fill" d="M40 20 Q115 20 135 8 Q150 -2 165 8 Q185 20 260 20 A20 20 0 0 0 280 40 L280 380 A20 20 0 0 0 260 400 Q185 400 165 412 Q150 422 135 412 Q115 400 40 400 A20 20 0 0 0 20 380 L20 40 A20 20 0 0 0 40 20 Z" />
            <path class="paper" d="M40 20 Q115 20 135 8 Q150 -2 165 8 Q185 20 260 20 A20 20 0 0 0 280 40 L280 380 A20 20 0 0 0 260 400 Q185 400 165 412 Q150 422 135 412 Q115 400 40 400 A20 20 0 0 0 20 380 L20 40 A20 20 0 0 0 40 20 Z" fill="url(#invite-paper)" />
            <path class="line" transform="translate(150 210) scale(.93 .95) translate(-150 -210)" d="M40 20 Q115 20 135 8 Q150 -2 165 8 Q185 20 260 20 A20 20 0 0 0 280 40 L280 380 A20 20 0 0 0 260 400 Q185 400 165 412 Q150 422 135 412 Q115 400 40 400 A20 20 0 0 0 20 380 L20 40 A20 20 0 0 0 40 20 Z" />
          </svg>
          <div class="invite-text">
            <p class="inv-small" ${editAttrs("multiline", smallPath, { placeholder: "Add invitation wording" })}>${multiline(small)}</p>
            <p class="inv-name" ${editAttrs("text", "site.couple.first", { placeholder: "First name" })}>${site.couple.first}</p>
            <p class="inv-and" aria-hidden="true">and</p>
            <p class="inv-name" ${editAttrs("text", "site.couple.second", { placeholder: "Second name" })}>${site.couple.second}</p>
            <p class="inv-date">${range}</p>
            ${site.city || edit ? html`<p class="inv-venue"><span ${editAttrs("text", "site.city", { placeholder: "City, country" })}>${site.city || ""}</span></p>` : ""}
          </div>
        </div>

        <p class="kindly" aria-hidden="true" ${editAttrs("text", "home.board.kindly", { placeholder: "Kindly" })}>${board.kindly || "Kindly"}</p>
        <p class="rsvp-word" aria-hidden="true" ${editAttrs("text", "home.board.rsvpWord", { placeholder: "Rsvp" })}>${board.rsvpWord || "Rsvp"}</p>
        <img class="bow" src="assets/img/lace-bow-600.webp" srcset="assets/img/lace-bow-600.webp 600w, assets/img/lace-bow.webp 1024w" sizes="(min-width: 641px) 295px, 46vw" width="600" height="600" alt="" aria-hidden="true" />
        <a class="tag tag-respond" href="#rsvp" ${due ? raw('aria-describedby="due-tag"') : ""} ${editAttrs("text", "home.board.respondLabel", { placeholder: "Respond" })}>${board.respondLabel || "Respond"}</a>
        ${due ? html`<span class="due-tag" aria-hidden="true"><span class="due-string"></span><span class="due-card"><span class="due-face"><span class="due-text" id="due-tag" ${editAttrs("text", "home.board.dueLabel", { placeholder: "by Jan 31st" })}>${due}</span></span><span class="due-hole"></span></span></span>` : ""}
      </div>
      </div>

      <div class="section section--ivory welcome">
        <div class="container container--narrow stack stack--l">
          <header class="welcome-head center stack stack--s">
            ${ctx.guest?.greeting ? html`<p class="welcome-greeting display display--l" data-greeting>${ctx.guest.greeting}</p>` : ""}
            ${home.welcome || edit ? html`<p class="lede" ${editAttrs("multiline", "home.welcome", { placeholder: "Add a welcome message" })}>${multiline(home.welcome || "")}</p>` : ""}
            <p class="welcome-when">
              <strong class="welcome-dates">${range}</strong>
              ${site.city || edit ? html`<span class="welcome-city muted" ${editAttrs("text", "site.city", { placeholder: "Add the city" })}>${site.city || ""}</span>` : ""}
            </p>
          </header>

          ${!ctx.guest && !edit ? html`<section class="card lookup-card" aria-label="Find your invitation"><div data-lookup></div></section>` : ""}

          <section class="center stack stack--s countdown-wrap" aria-label="Countdown">
            <h2 class="eyebrow">Time left until the wedding</h2>
            <div class="countdown" data-countdown aria-live="off" aria-hidden="true"></div>
            <p class="visually-hidden" data-countdown-sr></p>
          </section>

          ${nextUp(ctx)}
          ${quickActions(ctx)}
        </div>
      </div>`;

    const lookup = root.querySelector("[data-lookup]");
    if (lookup) renderLookup(lookup, ctx, { heading: "Find your invitation" });

    scaleStack(root);
    fitInvite(root);
    document.fonts?.ready.then(() => fitInvite(root));
    // The page may render while hidden (0 × 0), so re-measure whenever the board gets or changes its size.
    root._stackObserver?.disconnect();
    const boardEl = root.querySelector(".board");
    if (boardEl && "ResizeObserver" in window) {
      root._stackObserver = new ResizeObserver(() => scaleStack(root));
      root._stackObserver.observe(boardEl);
    }

    // Mounted on #app so position:fixed is not trapped by the page-enter transform on [data-page].
    const welcome = root.querySelector(".welcome");
    document.querySelectorAll(".scroll-hint").forEach((el) => el.remove());
    root._scrollHintObs?.disconnect();
    if (welcome) {
      const hint = document.createElement("button");
      hint.type = "button";
      hint.className = "scroll-hint";
      hint.setAttribute("aria-label", "Scroll for more");
      hint.innerHTML = '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
      (document.getElementById("app") || document.body).appendChild(hint);
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      hint.addEventListener("click", () => welcome.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
      root._scrollHintObs = new IntersectionObserver(([e]) => hint.classList.toggle("is-gone", e.isIntersecting), { threshold: 0.15 });
      root._scrollHintObs.observe(welcome);
    }

    // Countdown to the wedding ceremony. One interval per root; cleared on re-render.
    clearInterval(root._cd);
    const target = site.weddingDate ? toInstant(site.weddingDate, ctx.tz).getTime() : NaN;
    const box = root.querySelector("[data-countdown]");
    const wrap = box.closest(".countdown-wrap");
    const sr = root.querySelector("[data-countdown-sr]");
    const tick = () => {
      if (!root.isConnected) return clearInterval(root._cd);
      const ms = target - ctx.now().getTime();
      if (Number.isNaN(ms)) { wrap.hidden = true; return clearInterval(root._cd); }
      if (ms <= 0) {
        box.innerHTML = '<p class="script">Just married!</p>';
        sr.textContent = "Just married!";
        return clearInterval(root._cd);
      }
      box.innerHTML = countdownHtml(ms);
      const d = Math.floor(ms / 864e5);
      if (sr.dataset.d !== String(d)) { sr.dataset.d = d; sr.textContent = `${d} ${d === 1 ? "day" : "days"} until the wedding ceremony.`; }
    };
    tick();
    root._cd = setInterval(tick, 1000);
  },
};

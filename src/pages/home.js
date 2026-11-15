import { html, editAttrs, multiline, imgTag, showField, isEdit } from "../lib/dom.js";
import { formatTime, formatRange, formatDate, toInstant, nowNext } from "../lib/time.js";
import { renderLookup } from "./_lookup.js";
import * as icon from "../lib/icons.js";

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "July 23–25, 2027" from the first and last event day. Falls back to the site's own date text. */
function dateRange(events, site) {
  if (!events.length) return site.dateText || "";
  const a = events[0].start.slice(0, 10).split("-").map(Number);
  const last = events[events.length - 1];
  const b = (last.end || last.start).slice(0, 10).split("-").map(Number);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return site.dateText || "";
  const [ay, am, ad] = a, [by, bm, bd] = b;
  if (ay === by && am === bm && ad === bd) return `${MONTHS[am - 1]} ${ad}, ${ay}`;
  if (ay === by && am === bm) return `${MONTHS[am - 1]} ${ad}–${bd}, ${ay}`;
  if (ay === by) return `${MONTHS[am - 1]} ${ad} – ${MONTHS[bm - 1]} ${bd}, ${ay}`;
  return `${MONTHS[am - 1]} ${ad}, ${ay} – ${MONTHS[bm - 1]} ${bd}, ${by}`;
}

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

const hasReplied = (guest) => {
  if (!guest?.code) return false;
  try { return localStorage.getItem(`pa.rsvp.v1.${guest.code}`) != null; } catch { return false; }
};

const pageOn = (ctx, id) => ctx.content.pages?.[id]?.enabled !== false;
const travelHasContent = (c) => {
  const t = c.travel || {};
  return !!(c.hotels?.length || t.airports?.length || t.gettingAround?.length || t.shuttles?.length || t.aroundTown?.length || t.international?.text);
};

function nextUp(ctx) {
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
    const venue = lines.venueLines || [];
    const board = home.board || {};
    const timeText = site.weddingDate ? `at ${formatTime(site.weddingDate, ctx.tz)}` : "";
    const range = dateRange(ctx.events, site);
    const edit = isEdit();
    root.classList.add("page-home");
    root.innerHTML = html`
      <h1 class="visually-hidden">${site.couple.first} &amp; ${site.couple.second} are getting married on ${site.dateText}</h1>
      <div class="board" data-allow-clip>
        <div class="env" aria-hidden="true">
          <div class="env-back"></div>
          <div class="env-flap"></div>
          <div class="env-photo">${imgTag(home.photo, { eager: true, sizes: "(min-width: 641px) 10rem, 28vw", path: "home.photo" })}</div>
          <div class="env-pocket"></div>
        </div>

        <div class="invite">
          <svg class="invite-shape" viewBox="0 0 300 420" preserveAspectRatio="none" aria-hidden="true">
            <path class="fill" d="M40 20 Q115 20 135 8 Q150 -2 165 8 Q185 20 260 20 A20 20 0 0 0 280 40 L280 380 A20 20 0 0 0 260 400 Q185 400 165 412 Q150 422 135 412 Q115 400 40 400 A20 20 0 0 0 20 380 L20 40 A20 20 0 0 0 40 20 Z" />
            <path class="line" transform="translate(150 210) scale(.93 .95) translate(-150 -210)" d="M40 20 Q115 20 135 8 Q150 -2 165 8 Q185 20 260 20 A20 20 0 0 0 280 40 L280 380 A20 20 0 0 0 260 400 Q185 400 165 412 Q150 422 135 412 Q115 400 40 400 A20 20 0 0 0 20 380 L20 40 A20 20 0 0 0 40 20 Z" />
          </svg>
          <div class="invite-text">
            <p class="inv-small" ${editAttrs("multiline", "home.invitationLines.small", { placeholder: "Add invitation wording" })}>${multiline(lines.small || "")}</p>
            <p class="inv-name" ${editAttrs("text", "site.couple.first", { placeholder: "First name" })}>${site.couple.first}</p>
            <p class="inv-and" aria-hidden="true">and</p>
            <p class="inv-name" ${editAttrs("text", "site.couple.second", { placeholder: "Second name" })}>${site.couple.second}</p>
            <p class="inv-date"><span ${editAttrs("text", "site.dateText", { placeholder: "Add the date" })}>${site.dateText}</span><br />${timeText}</p>
            ${showField(venue) ? html`<p class="inv-venue">${venue.map((l, i) => html`<span ${editAttrs("text", `home.invitationLines.venueLines.${i}`, { placeholder: "Venue line" })}>${l}</span><br />`)}</p>` : ""}
          </div>
        </div>

        <a class="tag tag-details" href="#schedule" ${editAttrs("text", "home.board.detailsLabel", { placeholder: "Details" })}>${board.detailsLabel || "Details"}</a>
        <p class="kindly" aria-hidden="true" ${editAttrs("text", "home.board.kindly", { placeholder: "Kindly" })}>${board.kindly || "Kindly"}</p>
        <p class="rsvp-word" aria-hidden="true" ${editAttrs("text", "home.board.rsvpWord", { placeholder: "Rsvp" })}>${board.rsvpWord || "Rsvp"}</p>
        <img class="bow" src="assets/img/lace-bow-600.webp" srcset="assets/img/lace-bow-600.webp 600w, assets/img/lace-bow.webp 1024w" sizes="(min-width: 641px) 295px, 46vw" width="600" height="600" alt="" aria-hidden="true" />
        <a class="tag tag-respond" href="#rsvp" ${editAttrs("text", "home.board.respondLabel", { placeholder: "Respond" })}>${board.respondLabel || "Respond"}</a>
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

    fitInvite(root);
    document.fonts?.ready.then(() => fitInvite(root));

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

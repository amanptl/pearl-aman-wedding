// Boot: load content -> resolve guest -> build ctx -> render pages -> router.
import { $, $$, html, esc } from "./lib/dom.js";
import { loadContent } from "./lib/store.js";
import { resolveGuest } from "./lib/guest.js";
import { registerSW } from "./lib/pwa.js";
import { toast, openSheet } from "./lib/ui.js";
import { telUrl, whatsappUrl } from "./lib/maps.js";
import * as icon from "./lib/icons.js";
import { renderGuestBadge } from "./pages/_lookup.js";

import home from "./pages/home.js";
import schedule from "./pages/schedule.js";
import travel from "./pages/travel.js";
import story from "./pages/story.js";
import faq from "./pages/faq.js";
import registry from "./pages/registry.js";
import rsvp from "./pages/rsvp.js";

const PAGES = [home, schedule, travel, story, faq, registry, rsvp];
const byId = Object.fromEntries(PAGES.map((p) => [p.id, p]));
const TAB_IDS = ["home", "schedule", "travel", "faq", "rsvp"];
const TAB_ICON = { home: icon.home, schedule: icon.calendarPlus, travel: icon.plane, faq: icon.question, rsvp: icon.check, story: icon.heart, registry: icon.gift };

const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const params = new URLSearchParams(location.search);
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = (fn) => { try { return fn(); } catch { return null; } };
/* View Transitions are supported in Safari 18+, but WebKit still crashes under rapid hash navigations. */
const canViewTransition = () => typeof document.startViewTransition === "function"
  && !(navigator.vendor === "Apple Computer, Inc." && !("chrome" in window));
// Edit mode: the editor (edit/index.html) loads this page in an iframe with ?edit=1 and drives it via window.__wedding.
const EDIT = params.get("edit") === "1";
if (EDIT) document.documentElement.dataset.mode = "edit";

let ctx;
let current = { id: null, sub: null };
let pageTransitioning = false;

function contentUrl() {
  const o = params.get("content");
  return isLocal && o && /^[\w\-./]+\.json$/.test(o) ? o : "content/content.json";
}

/**
 * Which events this viewer sees. Private events only ever come from the decrypted guest record
 * (or, in the editor, from the draft: view "all"). `?all=1` is a localhost dev switch that shows every event
 * in the public file; since content.json no longer holds private events it only matters together with `?guest=`
 * (a plaintext Guest fixture whose privateEvents are then merged in).
 */
function visibleEvents(content, guest, view = EDIT ? "all" : "guest") {
  let list;
  if (view === "all" || (isLocal && params.get("all") === "1")) list = [...content.events];
  else list = content.events.filter((e) => e.visibility !== "private");
  if (view !== "public") for (const e of guest?.privateEvents || []) if (!list.some((x) => x.id === e.id)) list.push(e);
  return list.sort((a, b) => a.start.localeCompare(b.start));
}

function pageVisible(p) {
  if (p.id === "home") return true;
  if (ctx.content.pages?.[p.id]?.enabled === false) return false;
  return !p.isEmpty(ctx);
}
const orderOf = (p) => ctx.content.pages?.[p.id]?.order ?? 99;
const visiblePages = () => PAGES.filter(pageVisible).sort((a, b) => orderOf(a) - orderOf(b));

function parseHash() {
  const [id, ...rest] = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/");
  return { id: byId[id] ? id : "home", sub: rest.join("/") || null };
}

/* ---------- Navigation ---------- */
function renderNav() {
  const pages = visiblePages();
  const cur = current.id;
  const ink = html`<span class="nav-ink" aria-hidden="true"></span>`;
  const link = (p, cls = "") => html`<a href="#${p.id}" ${cur === p.id ? html`aria-current="page"` : ""} class="${cls}">${p.navLabel}${cur === p.id ? ink : ""}</a>`;
  $("#top-nav").innerHTML = html`<ul>${pages.map((p) => html`<li>${link(p)}</li>`)}</ul>`;

  const tabs = pages.filter((p) => TAB_IDS.includes(p.id)).sort((a, b) => TAB_IDS.indexOf(a.id) - TAB_IDS.indexOf(b.id));
  const more = pages.filter((p) => !TAB_IDS.includes(p.id));
  $("#tabbar").innerHTML = html`<ul>
    ${tabs.map((p) => html`<li><a href="#${p.id}" ${cur === p.id ? html`aria-current="page"` : ""}>${TAB_ICON[p.id]()}<span class="tab-label">${p.navLabel}</span></a></li>`)}
    ${more.length ? html`<li><button type="button" data-more ${more.some((p) => p.id === cur) ? html`aria-current="page"` : ""} aria-haspopup="dialog">${icon.menuDots()}<span class="tab-label">More</span></button></li>` : ""}
  </ul>`;
  $("#tabbar").dataset.moreIds = more.map((p) => p.id).join(",");
}

function openMore() {
  const ids = ($("#tabbar").dataset.moreIds || "").split(",").filter(Boolean);
  const nav = document.createElement("nav");
  nav.className = "sheet-list";
  nav.setAttribute("aria-label", "More pages");
  nav.innerHTML = ids.map((id) => `<a href="#${esc(id)}">${TAB_ICON[id]().toString()}<span>${esc(byId[id].navLabel)}</span></a>`).join("");
  const d = openSheet("More", nav);
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) d.close(); });
}

/* ---------- Help sheet ---------- */
function setupHelp() {
  const b = $("#help");
  const contacts = ctx.content.site.contacts || [];
  b.hidden = contacts.length === 0;
  b.innerHTML = html`${icon.question()}<span>Help</span>`.toString();
  b.setAttribute("aria-haspopup", "dialog");
  b.onclick = () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = html`<p class="muted">Questions on the day, or need directions? Message one of us.</p>${contacts.map((c) => html`
      <div class="contact-row">
        <div><strong>${c.name}</strong>${c.role ? html`<br /><span class="muted">${c.role}</span>` : ""}</div>
        <div class="cluster">
          ${c.phone ? html`<a class="btn btn--secondary btn--small" href="${telUrl(c.phone)}">${icon.phone()}Call</a>` : ""}
          ${c.phone && c.whatsapp ? html`<a class="btn btn--secondary btn--small" href="${whatsappUrl(c.phone)}" target="_blank" rel="noopener">${icon.whatsapp()}WhatsApp</a>` : ""}
        </div>
      </div>`)}`.toString();
    openSheet("Need a hand?", wrap);
  };
}

/* ---------- Rendering & routing ---------- */
function sectionFor(id) { return $(`[data-page="${id}"]`); }

const rendered = new Set();
function renderPage(p) {
  const root = sectionFor(p.id);
  rendered.add(p.id);
  try { p.render(root, ctx); } catch (err) { console.error(`Render failed for ${p.id}`, err); root.innerHTML = "<p class='container section'>Sorry, this page could not be displayed.</p>"; }
}

function applyRoute(id, sub, { animate = false, focus = true } = {}) {
  current = { id, sub };
  document.documentElement.dataset.route = id;
  $$("[data-page]").forEach((s) => { s.hidden = s.dataset.page !== id; });
  const root = sectionFor(id);
  document.title = id === "home" ? `${ctx.content.site.title} · ${ctx.content.site.dateText}` : `${byId[id].title(ctx)} · ${ctx.content.site.title}`;
  renderNav();
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  if (animate) {
    root.classList.remove("is-entering");
    void root.offsetWidth;
    root.classList.add("is-entering");
  }
  if (focus) focusHeading(root);
  if (sub) root.dispatchEvent(new CustomEvent("subroute", { detail: { sub } }));
  return root;
}

function route(initial = false) {
  let { id, sub } = parseHash();
  const page = byId[id];
  if (!pageVisible(page)) { id = "home"; sub = null; if (location.hash && location.hash !== "#home") history.replaceState(null, "", "#home"); }
  if (!rendered.has(id)) renderPage(byId[id]);
  const samePage = current.id === id;
  const shouldEnter = !samePage || initial;
  const focus = !initial || !$("#intro") || $("#intro").hidden;
  if (!shouldEnter) {
    current = { id, sub };
    document.documentElement.dataset.route = id;
    renderNav();
    if (sub) sectionFor(id).dispatchEvent(new CustomEvent("subroute", { detail: { sub } }));
    return;
  }
  const useVT = !EDIT && !initial && !samePage && !reduced() && !pageTransitioning && canViewTransition();
  if (useVT) {
    pageTransitioning = true;
    const transition = document.startViewTransition(() => { applyRoute(id, sub, { focus }); });
    // Aborted when a newer navigation starts; never leave an unhandled rejection.
    transition.finished.catch(() => {}).finally(() => { pageTransitioning = false; });
    return;
  }
  applyRoute(id, sub, { animate: !samePage || initial, focus });
}

function focusHeading(root) {
  const h = root.querySelector("h1");
  if (!h) return;
  h.setAttribute("tabindex", "-1");
  h.focus({ preventScroll: true });
}

/* ---------- Intro ---------- */
function setupIntro() {
  const intro = $("#intro");
  const app = $("#app");
  const done = store(() => sessionStorage.getItem("pa.intro"));
  const wantsHome = parseHash().id === "home";
  if (EDIT || done || !wantsHome || params.get("intro") === "0") { intro.remove(); return; }
  intro.hidden = false;
  app.inert = true;
  const skip = $(".skip-link");
  if (skip) skip.inert = true;
  document.body.classList.add("locked");
  $("#intro-open").focus();
  let closing = false;
  const finish = (animated) => {
    if (closing) return;
    closing = true;
    store(() => sessionStorage.setItem("pa.intro", "1"));
    const end = () => {
      app.inert = false;
      if (skip) skip.inert = false;
      document.body.classList.remove("locked");
      intro.classList.add("gone");
      setTimeout(() => intro.remove(), 800);
      focusHeading(sectionFor(current.id));
    };
    if (!animated) { end(); return; }
    intro.classList.add("opening");
    if (reduced()) { setTimeout(end, 260); return; }
    document.documentElement.dataset.reveal = "1";
    const flap = intro.querySelector(".ienv-flap");
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      end();
    };
    const onFlapDone = (e) => {
      if (e.target !== flap) return;
      flap.removeEventListener("transitionend", onFlapDone);
      // Let the envelope drift finish, then hand off to the board reveal.
      setTimeout(settle, 450);
    };
    if (flap) flap.addEventListener("transitionend", onFlapDone);
    setTimeout(settle, 1800);
  };
  $("#intro-open").addEventListener("click", () => finish(true));
  $("#intro-skip").addEventListener("click", () => finish(false));
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape" && document.body.contains(intro)) { finish(false); document.removeEventListener("keydown", esc); }
  });
}

/* ---------- Boot ---------- */
async function boot() {
  const main = $("#main");
  let content;
  try {
    // index.html starts the default content fetch before the modules load; fall back to a normal load if it failed.
    const early = window.__content && contentUrl() === "content/content.json" ? window.__content : null;
    window.__content = null;
    content = await (early ? early.catch(() => loadContent(contentUrl())) : loadContent(contentUrl()));
  } catch (err) {
    console.error(err);
    $("#intro").remove();
    $("#boot")?.remove();
    $("#app").hidden = false;
    main.innerHTML = "<section class='section section--paper'><div class='container center'><h1 class='page-title'>Pearl &amp; Aman</h1><p>We couldn't load the invitation. Please refresh, or contact us directly.</p></div></section>";
    return;
  }
  const guest = await devGuest() ?? (EDIT ? null : await resolveGuest());

  ctx = {
    content,
    guest,
    events: visibleEvents(content, guest),
    mode: EDIT ? "edit" : "guest",
    now: () => new Date(),
    tz: content.site.timezone || "America/Toronto",
    navigate: (r) => { const h = "#" + String(r).replace(/^#/, ""); if (location.hash === h) route(); else location.hash = h; },
    toast,
    rerender: (id) => { (id ? [byId[id]] : PAGES).forEach(renderPage); renderNav(); setupHelp(); },
  };

  // Meta
  const s = content.site;
  const title = `${s.title} · ${s.dateText}`;
  document.title = title;
  $('meta[property="og:title"]').content = title;
  if (s.ogImage?.src) $('meta[property="og:image"]').content = new URL(s.ogImage.src, document.baseURI).href;
  $(".banner .script").textContent = s.title;

  main.replaceChildren(...PAGES.map((p) => { const el = document.createElement("section"); el.dataset.page = p.id; el.hidden = true; return el; }));
  // Render only the page being opened first, so the first paint is quick; the rest follow right after.
  const first = parseHash().id;
  if (EDIT || !byId[first] || !pageVisible(byId[first])) PAGES.forEach(renderPage); else renderPage(byId[first]);
  setupHelp();
  if (!EDIT) renderGuestBadge($("#guest-badge"), ctx);
  $("#app").hidden = false;
  const boot_ = $("#boot");
  if (boot_) { boot_.classList.add("is-done"); setTimeout(() => boot_.remove(), 400); }
  route(true);
  setupIntro();
  window.addEventListener("hashchange", () => route());
  $("#tabbar").addEventListener("click", (e) => { if (e.target.closest("[data-more]")) openMore(); });
  if (EDIT) exposeEditBridge();
  else registerSW();
  const finish = () => { PAGES.filter((p) => !rendered.has(p.id)).forEach(renderPage); document.documentElement.dataset.ready = "1"; };
  if (rendered.size === PAGES.length) finish(); else setTimeout(finish, 30);
}

/* Dev only: ?guest=tests/fixtures/guest-family.json loads a plaintext Guest (localhost only). */
async function devGuest() {
  const g = params.get("guest");
  if (!isLocal || !g || !/^[\w\-./]+\.json$/.test(g)) return null;
  try { return await (await fetch(g, { cache: "no-cache" })).json(); } catch { return null; }
}

/* ---------- Edit bridge (used by edit/) ---------- */
function exposeEditBridge() {
  window.__wedding = {
    get ctx() { return ctx; },
    pages: PAGES.map((p) => p.id),
    /** Replace content (and optionally the previewed guest) and re-render everything. */
    setContent(content, { guest = null, view } = {}) {
      // view: "public" = what an unrecognised visitor sees (public events, no greeting); default = everything in the draft, or the guest's own view.
      const v = view || (guest ? "guest" : "all");
      ctx.content = content;
      ctx.guest = v === "public" ? null : guest;
      ctx.tz = content.site.timezone || "America/Toronto";
      ctx.events = visibleEvents(content, ctx.guest, v);
      ctx.rerender();
      route();
      window.parent?.postMessage({ type: "wedding:rendered" }, location.origin);
    },
    go(id) { ctx.navigate(id); },
    current: () => ({ ...current }),
  };
  window.parent?.postMessage({ type: "wedding:ready" }, location.origin);
}

boot();

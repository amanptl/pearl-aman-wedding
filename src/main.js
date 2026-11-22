// Boot: load content -> resolve guest -> build ctx -> render pages -> router.
import { $, $$, html, esc } from "./lib/dom.js";
import { loadContent } from "./lib/store.js";
import { resolveGuest } from "./lib/guest.js";
import { syncEventSeats } from "./lib/guestfiles.js";
import { registerSW } from "./lib/pwa.js";
import { toast, openSheet } from "./lib/ui.js";
import { telUrl, whatsappUrl } from "./lib/maps.js";
import * as icon from "./lib/icons.js";
import { createFilm } from "./lib/film.js";

import home, { homeDate } from "./pages/home.js";
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
const skipsEnvelope = () => EDIT || params.get("intro") === "0";
/* View Transitions are supported in Safari 18+, but WebKit still crashes under rapid hash navigations. */
const canViewTransition = () => typeof document.startViewTransition === "function"
  && !(navigator.vendor === "Apple Computer, Inc." && !("chrome" in window));
// Edit mode: the editor (edit/index.html) loads this page in an iframe with ?edit=1 and drives it via window.__wedding.
const EDIT = params.get("edit") === "1";
if (EDIT) document.documentElement.dataset.mode = "edit";

let ctx;
let current = { id: null, sub: null };
let pageTransitioning = false;
let introEl = null;
let envelopeGen = 0;
let envelopeClosing = false;
let envelopeOpening = false;
let envelopeHideTimer = 0;
let film = null; // the opening film (src/lib/film.js) while the sealed envelope is up

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

function hashBody() {
  return decodeURIComponent(location.hash.replace(/^#\/?/, ""));
}

/** Empty hash is the sealed envelope. A named route, including #home, is the opened site. */
function parseHash() {
  const raw = hashBody();
  if (!raw) return { id: null, sub: null };
  const [id, ...rest] = raw.split("/");
  return { id: byId[id] ? id : "home", sub: rest.join("/") || null };
}

function isHomeHash() {
  const raw = hashBody();
  return raw === "home" || raw.startsWith("home/");
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
// Floating Help button. Hidden for now; flip this to bring it back.
const SHOW_HELP = false;

function setupHelp() {
  const b = $("#help");
  if (!SHOW_HELP) { b.hidden = true; return; }
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
  document.title = id === "home" ? `${ctx.content.site.title} · ${homeDate(ctx)}` : `${byId[id].title(ctx)} · ${ctx.content.site.title}`;
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
  const sealed = id === null && !skipsEnvelope();
  if (id === null) { id = "home"; sub = null; }
  if (sealed) showEnvelope();
  else if (!envelopeOpening) hideEnvelope();
  const page = byId[id];
  if (!pageVisible(page)) { id = "home"; sub = null; if (location.hash && location.hash !== "#home") history.replaceState(null, "", "#home"); }
  if (!rendered.has(id)) renderPage(byId[id]);
  const samePage = current.id === id;
  const shouldEnter = !samePage || initial;
  const introGone = !introEl || !introEl.isConnected || introEl.hidden;
  const focus = !sealed && !envelopeOpening && (!initial || introGone);
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

/* ---------- Envelope ----------
   `/` (empty hash) is the sealed envelope. Opening it pushes `#home`.
   `#home` and every other hash are the opened site, with no ceremony.
   ?intro=0 and edit mode never show the envelope. */
function setupEnvelope() {
  introEl = $("#intro");
  if (!introEl) return;
  if (skipsEnvelope()) {
    document.documentElement.classList.remove("intro-early");
    introEl.remove();
    introEl = null;
    return;
  }
  // Skip / Escape jump to the last frame, also mid-shot.
  const skip = () => { if (film?.state === "play") film.finish(); else openEnvelope(false); };
  $("#intro-open").addEventListener("click", () => openEnvelope(true));
  $("#intro-skip").addEventListener("click", skip);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && introEl?.isConnected && !introEl.hidden) skip();
  });
}

function showEnvelope() {
  if (!introEl) return;
  envelopeGen++;
  envelopeClosing = false;
  envelopeOpening = false;
  clearTimeout(envelopeHideTimer);
  if (!introEl.isConnected) $("#app")?.before(introEl);
  introEl.classList.remove("opening", "gone", "is-ready");
  introEl.hidden = false;
  document.documentElement.classList.remove("intro-early");
  queueFilm();
  delete document.documentElement.dataset.reveal;
  const app = $("#app");
  if (app) app.inert = true;
  const skip = $(".skip-link");
  if (skip) skip.inert = true;
  document.body.classList.add("locked");
  introEl.querySelector("#intro-open")?.focus();
}

/** Close in on the home board's envelope (after this route's render), then fade up from black once its art is in. */
function queueFilm() {
  const gen = envelopeGen;
  requestAnimationFrame(async () => {
    if (gen !== envelopeGen || !introEl?.isConnected || introEl.hidden || envelopeClosing) return;
    const board = sectionFor("home")?.querySelector(".board");
    if (!board) { introEl.classList.add("is-ready"); return; }
    film?.finish();
    film = createFilm(board, { chrome: [$("#site-header"), $("#top-nav"), $("#tabbar"), $("#help")], vignette: introEl.querySelector(".intro-lens") });
    const art = ["env-back", "env-pocket", "env-flap-out", "env-sprig"].map((n) => { const i = new Image(); i.src = `assets/img/${n}.webp`; return i.decode().catch(() => {}); });
    await Promise.race([Promise.all(art), new Promise((r) => setTimeout(r, 1500))]);
    if (gen === envelopeGen && introEl?.isConnected) introEl.classList.add("is-ready");
  });
}

function hideEnvelope() {
  if (film && film.state !== "play") { film.finish(); film = null; }
  document.documentElement.classList.remove("intro-early");
  const app = $("#app");
  if (app) app.inert = false;
  const skip = $(".skip-link");
  if (skip) skip.inert = false;
  document.body.classList.remove("locked");
  if (!introEl?.isConnected) return;
  if (introEl.hidden) { introEl.remove(); return; }
  introEl.classList.add("gone");
  const gen = envelopeGen;
  clearTimeout(envelopeHideTimer);
  envelopeHideTimer = setTimeout(() => {
    if (gen !== envelopeGen || !introEl) return;
    introEl.hidden = true;
    introEl.classList.remove("opening", "gone");
    introEl.remove();
  }, reduced() ? 260 : 800);
}

function openEnvelope(animated) {
  if (!introEl?.isConnected || introEl.hidden || envelopeClosing) return;
  envelopeClosing = true;
  const gen = envelopeGen;
  const end = () => {
    if (gen !== envelopeGen) return;
    envelopeOpening = false;
    hideEnvelope();
    if (!isHomeHash()) location.hash = "home";
    focusHeading(sectionFor("home"));
  };
  if (!animated) { film?.finish(); film = null; end(); return; }
  envelopeOpening = true;
  introEl.classList.add("opening");
  if (!isHomeHash()) location.hash = "home";
  if (reduced() || !film) { film?.finish(); film = null; setTimeout(end, 260); return; }
  const f = film;
  f.play().then(() => { if (film === f) film = null; end(); });
}

/* Corinthia's final l runs through the space before &, so the mark is its own span (see .banner-amp). */
function setBannerTitle(title) {
  const el = $(".banner .script");
  if (!el) return;
  const text = String(title ?? "");
  const i = text.indexOf("&");
  if (i < 0) { el.textContent = text; return; }
  const mark = document.createElement("span");
  mark.className = "banner-amp";
  mark.textContent = "&";
  el.replaceChildren(document.createTextNode(text.slice(0, i)), mark, document.createTextNode(text.slice(i + 1)));
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
    $("#intro")?.remove();
    document.documentElement.classList.remove("intro-early");
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
  // Not every guest is invited to the wedding itself, so the title names only their own dates; the link preview stays
  // general (chat apps read it before any invite is unlocked).
  document.title = `${s.title} · ${homeDate(ctx)}`;
  if (s.ogImage?.src) $('meta[property="og:image"]').content = new URL(s.ogImage.src, document.baseURI).href;
  setBannerTitle(s.title);

  main.replaceChildren(...PAGES.map((p) => { const el = document.createElement("section"); el.dataset.page = p.id; el.hidden = true; return el; }));
  // Render only the page being opened first, so the first paint is quick; the rest follow right after.
  const first = parseHash().id || "home";
  if (EDIT || !byId[first] || !pageVisible(byId[first])) PAGES.forEach(renderPage); else renderPage(byId[first]);
  setupHelp();
  setupSignature();
  $("#app").hidden = false;
  const boot_ = $("#boot");
  if (boot_) { boot_.classList.add("is-done"); setTimeout(() => boot_.remove(), 400); }
  setupEnvelope();
  route(true);
  window.addEventListener("hashchange", () => route());
  $("#tabbar").addEventListener("click", (e) => { if (e.target.closest("[data-more]")) openMore(); });
  if (EDIT) exposeEditBridge();
  else registerSW();
  const finish = () => { PAGES.filter((p) => !rendered.has(p.id)).forEach(renderPage); document.documentElement.dataset.ready = "1"; };
  if (rendered.size === PAGES.length) finish(); else setTimeout(finish, 30);
}

/* Easter egg: the footer heart reveals the couple's signature (and hides it again). */
function setupSignature() {
  const heart = $(".colophon-heart"), sign = $("#colophon-sign");
  if (!heart || !sign) return;
  // The image loads lazily, so fetch it once the footer is near; and only start writing it in once it has loaded,
  // otherwise the first tap plays the animation on an empty image.
  const preload = () => { if (sign.loading !== "eager") sign.loading = "eager"; if (!sign.complete) { const i = new Image(); i.src = sign.src; } };
  const write = () => { sign.classList.remove("is-writing"); void sign.offsetWidth; sign.classList.add("is-writing"); };
  heart.addEventListener("pointerenter", preload, { once: true });
  heart.addEventListener("focus", preload, { once: true });
  heart.addEventListener("click", () => {
    const open = heart.getAttribute("aria-expanded") !== "true";
    heart.setAttribute("aria-expanded", String(open));
    sign.hidden = !open;
    heart.classList.remove("is-hint");
    if (!open) { sign.classList.remove("is-writing"); return; }
    // Bring the whole signature into view (its space is reserved even while the image loads).
    requestAnimationFrame(() => sign.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    if (sign.complete && sign.naturalWidth) write();
    else { preload(); sign.addEventListener("load", write, { once: true }); }
  });
  if ("IntersectionObserver" in window) {
    const near = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { near.disconnect(); preload(); } }, { rootMargin: "200px 0px" });
    near.observe(heart);
  }
  // A soft heartbeat when the footer comes into view, once on each page the guest visits (up to 3 per visit), as a
  // nudge that the heart can be tapped. It stops for good once they've found it.
  if (!("IntersectionObserver" in window)) return;
  const KEY = "pa.heartHint", FOUND = "pa.heartFound", MAX = 3;
  const get = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked: fine */ } };
  let armed = true; // re-armed each time the guest moves to another page
  heart.addEventListener("click", () => set(FOUND, "1"));
  window.addEventListener("hashchange", () => { armed = true; });
  const io = new IntersectionObserver((entries) => {
    if (!armed || !entries.some((e) => e.isIntersecting)) return;
    armed = false;
    const shown = Number(get(KEY)) || 0;
    if (get(FOUND) || shown >= MAX || heart.getAttribute("aria-expanded") === "true") return;
    set(KEY, String(shown + 1));
    heart.classList.remove("is-hint"); void heart.offsetWidth; // restart if it was mid-beat
    heart.classList.add("is-hint");
    heart.addEventListener("animationend", () => heart.classList.remove("is-hint"), { once: true });
  }, { threshold: 1 });
  io.observe(heart);
}

/* Dev only: ?guest=tests/fixtures/guest-family.json loads a plaintext Guest (localhost only). */
async function devGuest() {
  const g = params.get("guest");
  if (!isLocal || !g || !/^[\w\-./]+\.json$/.test(g)) return null;
  try { return syncEventSeats(await (await fetch(g, { cache: "no-cache" })).json()); } catch { return null; }
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
      ctx.guest = v === "public" ? null : guest ? syncEventSeats({ ...guest }) : guest;
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

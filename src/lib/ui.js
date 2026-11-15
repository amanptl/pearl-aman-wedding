// Toast, clipboard and sheet helpers. Owner: utilities agent.
import { esc } from "./dom.js";
import { x as xIcon } from "./icons.js";

/* ---------- Toast (queued, single aria-live region above the tab bar) ---------- */
const queue = [];
let showing = false;

function region() {
  let r = document.getElementById("toast");
  if (!r) {
    r = document.createElement("div");
    r.id = "toast";
    r.className = "toast-region"; // base.css positions it above the tab bar (--tabbar-h + safe area)
    r.setAttribute("role", "status");
    r.setAttribute("aria-live", "polite");
    r.setAttribute("aria-atomic", "true");
    if ("popover" in r) {
      // Top layer, so toasts stay visible above an open modal sheet.
      r.setAttribute("popover", "manual");
      r.style.cssText = "top:auto;margin:0;width:auto;height:auto;border:0;background:transparent;overflow:visible;color:inherit";
    }
    document.body.append(r);
  }
  return r;
}

function raise(r) {
  try { if (r.matches(":popover-open")) r.hidePopover(); r.showPopover(); } catch { /* unsupported */ }
}

function next() {
  const item = queue.shift();
  if (!item) { showing = false; return; }
  showing = true;
  const r = region();
  const t = document.createElement("div");
  t.className = "toast";
  const span = document.createElement("span");
  span.textContent = item.msg;
  t.append(span);
  let finished = false;
  let timer;
  const done = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    t.remove();
    if (!queue.length) { try { r.hidePopover?.(); } catch { /* ignore */ } }
    setTimeout(next, 120);
  };
  if (item.action?.label) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = item.action.label;
    b.style.cssText = "pointer-events:auto;margin-inline-start:.75rem;min-height:44px;padding:0 .5rem;background:none;border:0;color:var(--gold-light,#e6cf94);text-decoration:underline;font:inherit;cursor:pointer";
    b.addEventListener("click", () => { try { item.action.onClick?.(); } finally { done(); } });
    t.append(b);
    t.style.pointerEvents = "auto";
  }
  timer = setTimeout(done, item.ms);
  r.replaceChildren(t);
  raise(r);
}

/**
 * Show a non-blocking message in the single aria-live region. Messages queue and show one at a time.
 * @param {string} msg
 * @param {number|{ms?:number, action?:{label:string,onClick:()=>void}}} [opts] duration in ms, or options
 */
export function toast(msg, opts = 2800) {
  const o = typeof opts === "number" ? { ms: opts } : opts || {};
  if (queue.length && queue[queue.length - 1].msg === String(msg)) return; // collapse immediate duplicates
  queue.push({ msg: String(msg), ms: o.action ? Math.max(o.ms ?? 0, 8000) : o.ms ?? 2800, action: o.action });
  if (!showing) next();
}

/* ---------- Clipboard ---------- */
/**
 * Copy text and toast "Copied {label}". Falls back to a textarea + execCommand when the Clipboard API is unavailable.
 * @param {string} text @param {string} [label] @returns {Promise<boolean>}
 */
export async function copyText(text, label = "to clipboard") {
  let ok = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard api");
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    let ta;
    try {
      ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.setAttribute("aria-hidden", "true");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;width:1px;height:1px";
      // Inside an open modal everything else is inert, so the textarea must live in the dialog to be focusable.
      const host = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
      const prev = document.activeElement;
      host.append(ta);
      ta.focus({ preventScroll: true });
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand("copy");
      try { prev?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    } catch { ok = false; }
    ta?.remove();
  }
  toast(ok ? `Copied ${label}` : "Couldn't copy — press and hold to copy");
  return ok;
}

/* ---------- Sheets ---------- */
let sheetId = 0;
// Safari doesn't focus buttons on click, so document.activeElement is <body>; remember the last pressed control instead.
let lastTrigger = null;
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => { lastTrigger = e.target?.closest?.("button,a[href],[role=button],summary,input,[tabindex]") || null; }, true);
}
let locks = 0;
let savedOverflow = "";
function lockScroll() {
  if (locks++ === 0) {
    savedOverflow = document.body.style.overflow;
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (sbw > 0) document.body.style.paddingRight = sbw + "px";
  }
}
function unlockScroll() {
  if (locks > 0 && --locks === 0) {
    document.body.style.overflow = savedOverflow;
    document.body.style.paddingRight = "";
  }
}
const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

/**
 * Open an accessible bottom-sheet <dialog> (native modal: focus is trapped, Esc closes, backdrop click closes).
 * Focus starts on the first focusable element in the content (else the title) and returns to the opener on close.
 * Body scroll is locked while any sheet is open. Opening a sheet with the same title as one already open returns that one.
 * @param {string} title
 * @param {Node|string} contentNode a Node, or a trusted HTML string
 * @returns {HTMLDialogElement} the dialog (call .close() to dismiss)
 */
export function openSheet(title, contentNode) {
  const dup = [...document.querySelectorAll("dialog.sheet[open]")].find((x) => x.dataset.title === title);
  if (dup) return dup;
  const ae = document.activeElement;
  const opener = ae && ae !== document.body && ae !== document.documentElement ? ae : lastTrigger;
  const id = "sheet-title-" + ++sheetId;
  const d = document.createElement("dialog");
  d.className = "sheet";
  d.dataset.title = title;
  d.setAttribute("aria-labelledby", id);
  d.innerHTML = `<div class="sheet-head"><h2 id="${id}" tabindex="-1">${esc(title)}</h2><button type="button" class="sheet-close" aria-label="Close">${xIcon()}</button></div><div class="sheet-body"></div>`;
  const body = d.querySelector(".sheet-body");
  if (typeof contentNode === "string") body.innerHTML = contentNode;
  else if (contentNode) body.append(contentNode);
  d.querySelector(".sheet-close").addEventListener("click", () => d.close());
  // Backdrop click: only when press and release both happen on the dialog itself (not a text-selection drag).
  let downOnBackdrop = false;
  d.addEventListener("pointerdown", (e) => { downOnBackdrop = e.target === d; });
  d.addEventListener("click", (e) => { if (e.target === d && downOnBackdrop) d.close(); });
  // Wrap Tab / Shift+Tab inside the dialog (native modals can otherwise hand focus to browser chrome).
  d.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const items = [...d.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest("[hidden],[inert]") && el.getClientRects().length);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === d || !d.contains(active) || active.id === d.getAttribute("aria-labelledby"))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  });
  d.addEventListener("close", () => {
    // Restore focus, then re-assert on the next frame: WebKit's own dialog focus restoration can run after us
    // and leave focus on <body>.
    const restore = () => {
      try {
        if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
        else document.querySelector("main, #main")?.focus?.();
      } catch { /* ignore */ }
    };
    d.remove();
    unlockScroll();
    restore();
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a === document.documentElement) restore();
    });
  });
  document.body.append(d);
  lockScroll();
  d.showModal();
  const first = body.querySelector(FOCUSABLE);
  (first || d.querySelector("h2")).focus({ preventScroll: true });
  return d;
}

/**
 * Promise-based confirmation sheet (replaces window.confirm). Resolves true on confirm, false on cancel / Esc / backdrop.
 * @param {string} title @param {string} message
 * @param {{confirmLabel?:string, cancelLabel?:string}} [opts]
 * @returns {Promise<boolean>}
 */
export function confirmSheet(title, message, { confirmLabel = "Confirm", cancelLabel = "Cancel" } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    const p = document.createElement("p");
    p.textContent = message;
    const row = document.createElement("div");
    row.className = "cluster cluster--between";
    row.style.marginBlockStart = "var(--space-m, 1.5rem)";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--secondary";
    cancel.textContent = cancelLabel;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn btn--primary";
    ok.textContent = confirmLabel;
    row.append(cancel, ok);
    wrap.append(p, row);
    let result = false;
    const d = openSheet(title, wrap);
    d.addEventListener("close", () => resolve(result));
    cancel.addEventListener("click", () => d.close());
    ok.addEventListener("click", () => { result = true; d.close(); });
    cancel.focus({ preventScroll: true });
  });
}

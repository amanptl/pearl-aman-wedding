// Inline text editing inside the frame. Typing updates the draft silently; the frame re-renders on blur.
import { getPath } from "../src/lib/dom.js";

let cur = null; // { el, path, kind, orig, reverted, plain }

export const isEditing = () => !!cur;
export const currentEl = () => cur?.el || null;
export const currentPath = () => cur?.path || null;

/** Read the element's text, turning <br>/newlines into "\n". */
function read(el, kind) {
  let out = "";
  const walk = (n) => {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeName === "BR") out += "\n";
    else if (n.nodeType === 1) {
      const block = /^(DIV|P)$/.test(n.nodeName) && out && !out.endsWith("\n");
      if (block) out += "\n";
      n.childNodes.forEach(walk);
    }
  };
  el.childNodes.forEach(walk);
  out = out.replace(/ /g, " ").replace(/\r/g, "");
  if (kind === "text") out = out.replace(/\s*\n\s*/g, " ");
  else out = out.replace(/\n$/, "");
  return out;
}

function caretAt(doc, x, y) {
  if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
  if (doc.caretRangeFromPoint) { const r = doc.caretRangeFromPoint(x, y); return r ? { node: r.startContainer, offset: r.startOffset } : null; }
  return null;
}
function setCaret(el, pos) {
  const doc = el.ownerDocument;
  const sel = doc.defaultView.getSelection();
  const r = doc.createRange();
  if (pos && el.contains(pos.node)) r.setStart(pos.node, pos.offset);
  else { r.selectNodeContents(el); r.collapse(false); }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}
function setCaretOffset(el, offset) {
  const text = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : null;
  if (text) setCaret(el, { node: text, offset: Math.min(offset, text.length) });
  else setCaret(el, null);
}

export function placeCaret(e) {
  if (!cur) return;
  // Native mousedown already placed the caret; nothing to do on click.
}

export function start(app, F, el, ev, opts = {}) {
  if (cur) stop(true);
  const path = el.dataset.path;
  const kind = el.dataset.edit === "multiline" ? "multiline" : "text";
  const v = getPath(app.draft, path);
  const orig = typeof v === "string" ? v : v == null ? "" : String(v);
  cur = { el, path, kind, orig, reverted: false, last: orig };
  const doc = el.ownerDocument;
  // Normalise content to plain text so the browser's editing model is predictable.
  el.textContent = orig;
  el.dataset.editing = "1";
  el.style.whiteSpace = "pre-wrap";
  el.contentEditable = "plaintext-only";
  cur.plain = el.contentEditable === "plaintext-only";
  if (!cur.plain) el.contentEditable = "true";
  el.setAttribute("role", "textbox");
  if (kind === "multiline") el.setAttribute("aria-multiline", "true");
  const link = el.closest("a");
  if (link) { link.setAttribute("draggable", "false"); cur.link = link; }
  el.focus({ preventScroll: true });
  let pos = null;
  if (opts.offset != null) { setCaretOffset(el, opts.offset); }
  else {
    if (ev && ev.clientX != null) pos = caretAt(doc, ev.clientX, ev.clientY);
    setCaret(el, pos);
  }

  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKey);
  el.addEventListener("blur", onBlur);
  el.addEventListener("paste", onPaste);
  el.addEventListener("keyup", stopSpace, true);
  F.reposition();
  app.emit("editstart", path);
}

function stopSpace(e) { if (e.key === " ") e.stopPropagation(); }

let appRef = null;
export function bindApp(app) { appRef = app; }

function onInput() {
  if (!cur || !appRef) return;
  const val = read(cur.el, cur.kind);
  if (val === cur.last) return;
  cur.last = val;
  appRef.commit(cur.path, val, "Edit text", { silent: true, coalesce: cur.path, source: "inline" });
}
function onKey(e) {
  if (!cur) return;
  if (e.key === "Enter" && cur.kind === "text") { e.preventDefault(); cur.el.blur(); return; }
  if (e.key === "Enter" && cur.kind === "multiline" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); cur.el.blur(); return; }
  if (e.key === "Escape") {
    e.preventDefault(); e.stopPropagation();
    cur.reverted = true;
    cur.el.blur();
    return;
  }
  e.stopPropagation(); // keep page-level shortcuts out while typing (undo uses the browser's own text undo only via editor buttons)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); appRef.saveNow(); }
}
function onPaste(e) {
  if (!cur) return;
  if (cur.plain) {
    if (cur.kind === "text") {
      const t = (e.clipboardData?.getData("text/plain") || "").replace(/\s*\n\s*/g, " ");
      e.preventDefault();
      cur.el.ownerDocument.execCommand("insertText", false, t);
    }
    return;
  }
  e.preventDefault();
  let t = e.clipboardData?.getData("text/plain") || "";
  if (cur.kind === "text") t = t.replace(/\s*\n\s*/g, " ");
  cur.el.ownerDocument.execCommand("insertText", false, t);
}
function onBlur() { if (cur) finish(); }

function finish() {
  const c = cur;
  cur = null;
  c.el.removeEventListener("input", onInput);
  c.el.removeEventListener("keydown", onKey);
  c.el.removeEventListener("blur", onBlur);
  c.el.removeEventListener("paste", onPaste);
  c.el.removeEventListener("keyup", stopSpace, true);
  c.el.removeAttribute("contenteditable");
  c.el.removeAttribute("role");
  c.el.removeAttribute("aria-multiline");
  delete c.el.dataset.editing;
  c.el.style.whiteSpace = "";
  c.link?.removeAttribute("draggable");
  const val = c.reverted ? c.orig : read(c.el, c.kind);
  if (c.reverted && getPath(appRef.draft, c.path) !== c.orig) appRef.commit(c.path, c.orig, "Edit text", { silent: true, coalesce: c.path, force: true, source: "inline" });
  else if (!c.reverted && getPath(appRef.draft, c.path) !== val) appRef.commit(c.path, val, "Edit text", { silent: true, coalesce: c.path, source: "inline" });
  appRef.emit("editend", c.path);
  appRef.render({ deferred: true, source: "inline" });
}

/** Programmatic stop. commit=true keeps typed text. */
export function stop(commit = true) {
  if (!cur) return;
  if (!commit) cur.reverted = true;
  cur.el.blur();
  if (cur) finish();
}

/** Caret offset within the active element (for restoring after a forced re-render). */
export function snapshot() {
  if (!cur) return null;
  const sel = cur.el.ownerDocument.defaultView.getSelection();
  let offset = read(cur.el, cur.kind).length;
  if (sel.rangeCount && cur.el.contains(sel.anchorNode)) offset = sel.anchorOffset;
  return { path: cur.path, offset };
}

/** Drop the active edit without committing or re-rendering (used when the DOM is about to be replaced). */
export function abandon() {
  if (!cur) return;
  const c = cur;
  cur = null;
  c.el.removeEventListener("input", onInput);
  c.el.removeEventListener("keydown", onKey);
  c.el.removeEventListener("blur", onBlur);
  c.el.removeEventListener("paste", onPaste);
  c.el.removeEventListener("keyup", stopSpace, true);
}

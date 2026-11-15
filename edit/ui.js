// Small UI toolkit for the editor chrome: element builder, toasts, dialogs. No alert/confirm/prompt.
import { ico } from "./icons.js";

/** h("div.cls#id", {attr}, ...children) -> Element. Strings become text. */
export function h(sel, attrs, ...kids) {
  const [tagPart, ...classes] = sel.split(".");
  const [tag, id] = tagPart.split("#");
  const el = document.createElement(tag || "div");
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(" ");
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className += " " + v;
    else if (k in el && k !== "list" && k !== "style" && typeof v !== "object") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  const add = (k) => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else if (typeof k === "string" && k.startsWith('<svg class="ico"')) { const t = document.createElement("template"); t.innerHTML = k; el.append(t.content); }
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}

/** Icon button with tooltip + accessible name. */
export function iconBtn(name, label, onClick, cls = "") {
  return h(`button.ibtn${cls ? "." + cls : ""}`, { type: "button", title: label, "aria-label": label, html: ico(name), onclick: onClick });
}

export function createUI() {
  const toasts = document.getElementById("toasts");
  function toast(msg, { action, ms = 3600, kind = "" } = {}) {
    const t = h(`div.toast${kind ? "." + kind : ""}`, { role: "status" }, h("span", msg));
    if (action) t.append(h("button.link", { type: "button", onclick: () => { action.run(); t.remove(); } }, action.label));
    toasts.append(t);
    requestAnimationFrame(() => t.classList.add("in"));
    setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 250); }, ms);
    return t;
  }

  /**
   * Generic modal. body: Element. actions: [{label, value, primary, danger, keepOpen}].
   * Resolves with the chosen value (undefined when dismissed).
   */
  function dialog({ title, body, actions = [], wide = false, cls = "", onOpen }) {
    return new Promise((resolve) => {
      const dlg = h(`dialog.dlg${wide ? ".wide" : ""}${cls ? "." + cls : ""}`, { "aria-label": title });
      const close = (v) => { if (dlg.open) dlg.close(); dlg.remove(); resolve(v); };
      dlg.append(
        h("header.dlg-h", h("h2", title), h("button.ibtn", { type: "button", "aria-label": "Close", title: "Close", html: ico("x"), onclick: () => close(undefined) })),
        h("div.dlg-b", body),
        actions.length ? h("footer.dlg-f", actions.map((a) => h(`button.btn${a.primary ? ".primary" : ""}${a.danger ? ".danger" : ""}`, { type: "button", onclick: () => (a.keepOpen ? a.onClick?.(close) : close(a.value)) }, a.label))) : null
      );
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(undefined); });
      dlg.addEventListener("click", (e) => { if (e.target === dlg) close(undefined); });
      document.body.append(dlg);
      dlg.showModal();
      const first = dlg.querySelector("[autofocus], .dlg-b input, .dlg-b textarea, .dlg-b select") || dlg.querySelector(".dlg-f .primary, .dlg-f .btn");
      first?.focus();
      onOpen?.(dlg, close);
    });
  }

  async function confirm({ title = "Are you sure?", message = "", confirmLabel = "OK", cancelLabel = "Cancel", danger = false }) {
    const v = await dialog({
      title,
      body: h("p.dlg-msg", message),
      actions: [{ label: cancelLabel, value: false }, { label: confirmLabel, value: true, primary: !danger, danger }],
    });
    return v === true;
  }

  return { toast, dialog, confirm };
}

/** Lightweight popover anchored under a button. Returns {el, close}. */
export function popover(anchor, content, { align = "right", cls = "" } = {}) {
  document.querySelectorAll(".pop").forEach((p) => p.remove());
  const r = anchor.getBoundingClientRect();
  const pop = h(`div.pop${cls ? "." + cls : ""}`, { role: "dialog" }, content);
  document.body.append(pop);
  const w = pop.offsetWidth;
  const left = align === "right" ? Math.max(8, r.right - w) : Math.min(r.left, innerWidth - w - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${r.bottom + 8}px`;
  const off = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const key = (e) => { if (e.key === "Escape") { close(); anchor.focus(); } };
  function close() { pop.remove(); document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", key, true); }
  setTimeout(() => { document.addEventListener("pointerdown", off, true); document.addEventListener("keydown", key, true); });
  return { el: pop, close };
}

export function ago(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

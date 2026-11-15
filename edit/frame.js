// Bridge to the guest site running in the iframe (?edit=1) + the on-page overlay (selection, item toolbar, image chip).
import { ico } from "./icons.js";
import { getPath } from "../src/lib/dom.js";
import * as inline from "./inline.js";
import * as lists from "./lists.js";

const cssEsc = (s) => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));

export function createFrame(app, iframe) {
  const F = { doc: null, win: null, hoverItem: null, hoverImg: null };
  let ui = null;
  let boundDoc = null;
  let hideTimer = 0;
  let raf = 0;
  let dragging = false;

  /* ---------- bridge ---------- */
  window.addEventListener("message", (e) => {
    if (e.source !== iframe.contentWindow) return;
    if (e.data?.type === "wedding:ready") onReady();
  });
  iframe.addEventListener("load", () => { setTimeout(() => { if (iframe.contentWindow?.__wedding && iframe.contentDocument !== boundDoc) onReady(); }, 400); });

  function onReady() {
    F.win = iframe.contentWindow;
    F.doc = iframe.contentDocument;
    if (boundDoc !== F.doc) bind();
    app.render({ now: true, first: true });
    app.emit("frameready");
  }

  F.get = () => F.win?.__wedding || null;
  F.go = (id) => { F.get()?.go(id); setTimeout(() => { F.reposition(); app.emit("route", F.current()); }, 30); };
  F.current = () => F.get()?.current() || { id: "home" };
  F.pages = () => F.get()?.pages || [];
  // The "Public visitor" preview passes a sentinel (_preview): public events only and no greeting.
  F.setContent = (content, guest) => F.get()?.setContent(content, guest?._preview ? { guest: null, view: "public" } : { guest });

  /* ---------- item helpers ---------- */
  function itemInfo(n) {
    const parent = n?.parentElement;
    if (!parent || n.closest?.("[data-ed-ui]")) return null;
    const container = parent.closest("[data-list]");
    if (n.dataset.item) {
      const path = n.dataset.item;
      const i = path.lastIndexOf(".");
      return { el: n, path, listPath: path.slice(0, i), index: +path.slice(i + 1), container, sortAuto: container?.dataset.sort === "auto", isString: false };
    }
    if (parent.dataset.list) {
      const listPath = parent.dataset.list;
      let index = n.dataset.index != null ? +n.dataset.index : NaN;
      if (Number.isNaN(index)) {
        const holder = n.dataset.path ? n : n.querySelector(`[data-path^="${cssEsc(listPath)}."]`);
        const m = holder?.dataset.path?.slice(listPath.length + 1).match(/^(\d+)/);
        if (m) index = +m[1];
      }
      if (Number.isNaN(index)) return null;
      const v = getPath(app.draft, `${listPath}.${index}`);
      return { el: n, path: `${listPath}.${index}`, listPath, index, container: parent, sortAuto: parent.dataset.sort === "auto", isString: typeof v === "string" || n.dataset.edit === "image" };
    }
    return null;
  }
  F.itemInfo = itemInfo;
  /** Nearest ancestor (incl. self) that is a list item. */
  F.itemOf = (t) => {
    for (let n = t; n && n.nodeType === 1 && n !== F.doc.body; n = n.parentElement) { const i = itemInfo(n); if (i) return i; }
    return null;
  };
  /** Nearest [data-item] ancestor path (selectable object item). */
  F.selectableOf = (t) => t?.closest?.("[data-item]")?.dataset.item || null;
  F.itemsIn = (info) => {
    if (!info.container) return [];
    return [...info.container.querySelectorAll(":scope [data-item], :scope > [data-index]")]
      .map(itemInfo).filter((i) => i && i.listPath === info.listPath && i.container === info.container);
  };
  F.findItemEl = (path) => F.doc?.querySelector(`[data-item="${cssEsc(path)}"]`) || F.doc?.querySelector(`[data-path="${cssEsc(path)}"][data-index]`) || null;
  F.findTextEl = (path) => F.doc?.querySelector(`[data-edit="text"][data-path="${cssEsc(path)}"], [data-edit="multiline"][data-path="${cssEsc(path)}"]`) || null;

  /* ---------- overlay ---------- */
  function build() {
    const d = F.doc;
    if (!d.querySelector('link[data-ed-css]')) {
      const l = d.createElement("link");
      l.rel = "stylesheet"; l.href = new URL("frame.css", location.href).href; l.dataset.edCss = "1";
      d.head.append(l);
    }
    ui?.root.remove();
    const root = d.createElement("div");
    root.dataset.edUi = "1";
    root.className = "ed-ui";
    root.innerHTML = `
      <div class="ed-hover" hidden></div>
      <div class="ed-sel" hidden><span class="ed-sel-tag"></span></div>
      <div class="ed-toolbar" role="toolbar" aria-label="Item actions" hidden>
        <button type="button" class="ed-b ed-drag" data-act="drag" title="Drag to reorder" aria-label="Drag to reorder">${ico("drag", 16)}</button>
        <button type="button" class="ed-b" data-act="up" title="Move up (earlier)" aria-label="Move earlier">${ico("up", 16)}</button>
        <button type="button" class="ed-b" data-act="down" title="Move down (later)" aria-label="Move later">${ico("down", 16)}</button>
        <span class="ed-sep"></span>
        <button type="button" class="ed-b" data-act="dup" title="Duplicate" aria-label="Duplicate">${ico("copy", 16)}</button>
        <button type="button" class="ed-b" data-act="add" title="Add new after this" aria-label="Add new after this">${ico("plus", 16)}</button>
        <button type="button" class="ed-b ed-danger" data-act="del" title="Delete" aria-label="Delete">${ico("trash", 16)}</button>
      </div>
      <button type="button" class="ed-replace" hidden>${ico("camera", 16)}<span>Replace photo</span></button>
      <div class="ed-drop" hidden></div>`;
    d.body.append(root);
    ui = {
      root,
      hover: root.querySelector(".ed-hover"),
      sel: root.querySelector(".ed-sel"),
      tag: root.querySelector(".ed-sel-tag"),
      bar: root.querySelector(".ed-toolbar"),
      replace: root.querySelector(".ed-replace"),
      drop: root.querySelector(".ed-drop"),
    };
    F.ui = ui;
    ui.bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || !F.hoverItem) return;
      e.preventDefault(); e.stopPropagation();
      if (b.dataset.act !== "drag") lists.act(app, F, F.hoverItem, b.dataset.act);
    });
    ui.bar.addEventListener("pointerdown", (e) => {
      const b = e.target.closest('[data-act="drag"]');
      if (b && F.hoverItem && e.button === 0) { e.preventDefault(); dragging = true; lists.startDrag(app, F, F.hoverItem, e, () => { dragging = false; position(); }); }
    });
    ui.bar.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    ui.bar.addEventListener("pointerleave", () => scheduleHide());
    ui.replace.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (F.hoverImg) app.pickImage(F.hoverImg.dataset.path); });
    ui.replace.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    ui.replace.addEventListener("pointerleave", () => scheduleHide());
  }

  function show(el, on) { el.hidden = !on; }

  function boxFor(el, r) {
    el.style.left = `${r.left}px`; el.style.top = `${r.top}px`; el.style.width = `${r.width}px`; el.style.height = `${r.height}px`;
  }

  function position() {
    if (!ui || !F.doc) return;
    const win = F.win;
    // selection
    const selEl = app.selection ? (F.findItemEl(app.selection) || F.doc.querySelector(`[data-edit="image"][data-path="${cssEsc(app.selection)}"]`)) : null;
    if (selEl) {
      boxFor(ui.sel, selEl.getBoundingClientRect());
      ui.tag.textContent = app.crumbText?.() || "";
      show(ui.sel, true);
    } else show(ui.sel, false);
    // hover outline + toolbar (hover wins; selection toolbar otherwise)
    let target = F.hoverItem;
    if (target && !target.el.isConnected) target = F.hoverItem = F.findItemEl(target.path) ? F.itemInfo(F.findItemEl(target.path)) : null;
    if (!target && selEl && !dragging) target = F.itemInfo(selEl) || (F.itemInfo(selEl.firstElementChild || selEl));
    if (target && !inline.isEditing()) {
      const r = target.el.getBoundingClientRect();
      if (F.hoverItem && target.el !== selEl) { boxFor(ui.hover, r); show(ui.hover, true); } else show(ui.hover, false);
      const sortAuto = target.sortAuto;
      const sibs = F.itemsIn(target);
      const pos = sibs.findIndex((s) => s.el === target.el);
      for (const b of ui.bar.querySelectorAll("[data-act]")) {
        const a = b.dataset.act;
        const orderable = !sortAuto && sibs.length > 1;
        b.hidden = (a === "drag" || a === "up" || a === "down") && !orderable;
        if (a === "up") b.disabled = pos <= 0;
        if (a === "down") b.disabled = pos < 0 || pos >= sibs.length - 1;
      }
      ui.bar.querySelector(".ed-sep").hidden = false;
      show(ui.bar, true);
      const w = ui.bar.offsetWidth;
      const left = Math.min(Math.max(4, r.right - w - 6), win.innerWidth - w - 4);
      const top = Math.min(Math.max(4, r.top - 15), win.innerHeight - 40);
      ui.bar.style.left = `${left}px`; ui.bar.style.top = `${top}px`;
      ui.bar.style.visibility = r.bottom < 0 || r.top > win.innerHeight ? "hidden" : "visible";
    } else { show(ui.bar, false); show(ui.hover, false); }
    // image chip
    const img = F.hoverImg;
    if (img && img.isConnected && !dragging && !inline.isEditing()) {
      const r = img.getBoundingClientRect();
      const vis = { l: Math.max(r.left, 0), t: Math.max(r.top, 0), r: Math.min(r.right, win.innerWidth), b: Math.min(r.bottom, win.innerHeight) };
      if (vis.r - vis.l > 60 && vis.b - vis.t > 40) {
        show(ui.replace, true);
        ui.replace.style.left = `${(vis.l + vis.r) / 2 - ui.replace.offsetWidth / 2}px`;
        ui.replace.style.top = `${vis.b - ui.replace.offsetHeight - 12}px`;
      } else show(ui.replace, false);
    } else show(ui.replace, false);
  }
  F.reposition = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(position); };

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (dragging || (ui && ui.bar.contains(F.doc.activeElement))) return; F.hoverItem = null; F.hoverImg = null; position(); }, 320);
  }

  F.focusItem = (path) => {
    const el = F.findItemEl(path);
    F.hoverItem = el ? itemInfo(el) : null;
    position();
  };
  F.reveal = (path) => {
    const el = F.findItemEl(path) || F.findTextEl(path);
    el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setTimeout(position, 350);
  };

  /* ---------- document listeners ---------- */
  function bind() {
    boundDoc = F.doc;
    const d = F.doc, w = F.win;
    build();
    new w.ResizeObserver(() => F.reposition()).observe(d.documentElement);
    w.addEventListener("scroll", F.reposition, { passive: true, capture: true });
    w.addEventListener("resize", F.reposition);
    w.addEventListener("hashchange", () => { F.hoverItem = null; F.hoverImg = null; app.emit("route", F.current()); setTimeout(() => F.afterRender(), 60); });

    d.addEventListener("pointermove", (e) => {
      if (dragging) return;
      const t = e.target;
      if (t.closest?.("[data-ed-ui]")) { clearTimeout(hideTimer); return; }
      const item = F.itemOf(t);
      const img = t.closest?.('[data-edit="image"]');
      if (item || img) clearTimeout(hideTimer);
      const changed = (item?.path !== F.hoverItem?.path) || (img !== F.hoverImg);
      if (item) F.hoverItem = item; else if (!img) { scheduleHide(); }
      if (img) F.hoverImg = img; else if (F.hoverImg) scheduleHide();
      if (!img && !item) return;
      if (changed) F.reposition();
    }, { passive: true });
    d.documentElement.addEventListener("pointerleave", () => scheduleHide());

    d.addEventListener("click", onClick, true);
    d.addEventListener("submit", (e) => e.preventDefault(), true);
    d.addEventListener("auxclick", (e) => { if (!e.altKey) e.preventDefault(); }, true);
    d.addEventListener("keydown", (e) => app.onKey(e), true);
    // Never navigate by dropping a file on the page.
    d.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const img = e.target.closest?.('[data-edit="image"]');
      d.querySelectorAll(".ed-dropping").forEach((x) => x !== img && x.classList.remove("ed-dropping"));
      img?.classList.add("ed-dropping");
    });
    d.addEventListener("dragleave", (e) => { if (!e.relatedTarget) d.querySelectorAll(".ed-dropping").forEach((x) => x.classList.remove("ed-dropping")); });
    d.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      d.querySelectorAll(".ed-dropping").forEach((x) => x.classList.remove("ed-dropping"));
      const img = e.target.closest?.('[data-edit="image"]');
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/")) || e.dataTransfer.files[0];
      if (!img) { app.toast("Drop the photo onto a picture on the page to replace it."); return; }
      app.setImageFromFile(img.dataset.path, file);
    });
    d.addEventListener("dragstart", (e) => { if (e.target.closest?.("a, img") && !e.altKey) e.preventDefault(); });
  }
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

  function onClick(e) {
    const t = e.target;
    if (t.closest("[data-ed-ui]")) return;
    if (e.altKey) return; // Alt-click follows links / triggers the page's own behaviour
    if (t.closest('#top-nav a[href^="#"], #tabbar a[href^="#"], .skip-link')) return; // site navigation keeps working
    e.preventDefault();
    e.stopPropagation();
    // Describe the click before any re-render can replace the DOM.
    const textEl = t.closest('[data-edit="text"], [data-edit="multiline"]');
    const imgEl = t.closest('[data-edit="image"]');
    const textPath = textEl?.dataset.path || null;
    const imgPath = imgEl?.dataset.path || null;
    const itemPath = F.selectableOf(t);
    if (textEl && inline.isEditing() && inline.currentEl() === textEl) { inline.placeCaret(e); return; }
    app.flushRender();
    if (!textPath && !imgPath && inline.isEditing()) inline.stop(true);
    if (itemPath) app.select(itemPath);
    else app.select(null);
    if (imgPath) { app.pickImage(imgPath); return; }
    if (textPath) {
      const el = F.findTextEl(textPath);
      if (el) inline.start(app, F, el, e);
    }
  }

  F.afterRender = () => {
    const d = F.doc;
    if (!d) return;
    app.images.applyPending(d);
    if (!ui || !d.body.contains(ui.root)) build();
    // Keep overlay on top (pages re-render only <main>, but be safe)
    if (ui.root.parentNode !== d.body || ui.root !== d.body.lastElementChild) d.body.append(ui.root);
    if (F.hoverItem) { const el = F.findItemEl(F.hoverItem.path); F.hoverItem = el ? itemInfo(el) : null; }
    position();
    // Late image loads change layout
    d.querySelectorAll("img").forEach((img) => { if (!img.complete) img.addEventListener("load", F.reposition, { once: true }); });
  };

  F.setDropIndicator = (rect, vertical) => {
    if (!rect) { show(ui.drop, false); return; }
    const o = ui.drop.style;
    if (vertical) { o.left = `${rect.x - 2}px`; o.top = `${rect.y}px`; o.width = "4px"; o.height = `${rect.len}px`; }
    else { o.left = `${rect.x}px`; o.top = `${rect.y - 2}px`; o.width = `${rect.len}px`; o.height = "4px"; }
    show(ui.drop, true);
  };
  F.setDragging = (v) => { dragging = v; };
  return F;
}

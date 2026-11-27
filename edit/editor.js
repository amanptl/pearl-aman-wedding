// Editor boot + state. A single `draft` object; every change goes through commit()/mutate().
import { getPath, setPath } from "../src/lib/dom.js";
import { validate, loadContent } from "../src/lib/store.js";
import { h, createUI, popover, ago } from "./ui.js";
import { ico } from "./icons.js";
import { createSchemaTools } from "./schema.js";
import { createHistory } from "./history.js";
import { loadDraft, saveDraft, clearDraft, contentSha, cleanContent } from "./draft.js";
import { openAdmin } from "../src/lib/guestfiles.js";
import { randomCode } from "../src/lib/crypto.js";
import * as GL from "./guestlib.js";
import { createImages, pendingPaths } from "./images.js";
import { createFrame } from "./frame.js";
import * as inline from "./inline.js";
import { createPanel, pageLabel } from "./panel.js";
import { openPublish, downloadContent, mountHistory } from "./publish.js";
import { openSettings } from "./settings.js";
import { github } from "./github.js";
import { mountGuests } from "./guests.js";

const $ = (s) => document.querySelector(s);
const safe = (fn, fb = null) => { try { return fn(); } catch { return fb; } };
const clone = (x) => structuredClone(x);
const PAGE_OF = { schedule: "schedule", events: "schedule", hotels: "travel", travel: "travel", story: "story", people: "story", faq: "faq", faqCategories: "faq", registry: "registry", rsvp: "rsvp", home: "home", site: "home" };
const PUBLIC_GUEST = { code: "", household: "", greeting: "", members: [], seats: 1, eventIds: [], privateEvents: [], tags: [], _preview: true };

async function boot() {
  const app = { selection: null, errors: [], warnings: [], currentPage: "home", lastSource: "ui", previewGuest: null, dirty: false, liveState: "", savedAt: 0 };
  const listeners = {};
  app.on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
  app.emit = (ev, d) => (listeners[ev] || []).forEach((fn) => fn(d));

  let schema, base, draft;
  try {
    [schema, base] = await Promise.all([fetch("../content/schema.json", { cache: "no-cache" }).then((r) => r.json()), loadContent("../content/content.json")]);
  } catch (e) {
    $("#boot").innerHTML = '<p>Sorry, the editor could not load the site content. Check your connection and refresh.</p>';
    console.error(e);
    return;
  }
  const ui = createUI();
  app.ui = ui; app.toast = ui.toast; app.confirm = ui.confirm;
  app.schema = schema;
  const T = (app.schemaTools = createSchemaTools(schema));
  app.base = base;
  app.baseSha = await contentSha(base);
  draft = clone(base);
  const history = createHistory();
  const images = (app.images = createImages());
  await images.load();
  inline.bindApp(app);
  Object.defineProperty(app, "draft", { get: () => draft });

  // Restore an unpublished draft
  const stored = loadDraft();
  if (stored?.draft && JSON.stringify(cleanContent(stored.draft)) !== JSON.stringify(cleanContent(stored.base || base))) {
    if (stored.baseSha === app.baseSha) { draft = stored.draft; app.restored = true; }
    else {
      const keep = await ui.dialog({
        title: "Saved draft found",
        body: h("p.dlg-msg", `You have unpublished changes saved on this computer, but the site has been updated since (${ago(stored.savedAt)}). Keep editing your draft, or start again from the latest version?`),
        actions: [{ label: "Start from latest", value: false }, { label: "Keep my draft", value: true, primary: true }],
      });
      if (keep) { draft = stored.draft; app.base = stored.base || base; app.baseSha = stored.baseSha; app.restored = true; }
      else clearDraft();
    }
  }

  /* ---------- state changes ---------- */
  const adminDirty = () => !!draft._admin && JSON.stringify(draft._admin) !== JSON.stringify(app.adminBase?.admin);
  const dirtyNow = () => JSON.stringify(cleanContent(draft)) !== JSON.stringify(cleanContent(app.base)) || adminDirty();
  /** The draft's private events, in a stable order (what goes into the encrypted bundle). */
  app.privateEvents = () => GL.sortEvents(cleanContent(draft).events.filter(GL.isPrivate));
  app.guestsChanged = () => !!app.unlocked && (app.adminIsNew || adminDirty() || JSON.stringify(app.privateEvents()) !== JSON.stringify(app.adminBase?.privateEvents || [])
    || (draft?.site?.nameLookup === true) !== (app.base?.site?.nameLookup === true)); // switching name lookup rebuilds (or drops) the name index
  let saveTimer = 0;
  function saveNow() {
    clearTimeout(saveTimer);
    if (!dirtyNow()) { clearDraft(); app.savedAt = 0; } else app.savedAt = saveDraft(draft, app.baseSha, app.base) || app.savedAt;
    renderStatus();
  }
  app.saveNow = () => { saveNow(); ui.toast("Draft saved on this computer"); };
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 450); renderStatus(true); };

  function revalidate() {
    app.errors = validate(draft, schema);
    const warn = [];
    const walk = (v, p) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, p ? `${p}.${i}` : String(i)));
      else if (v && typeof v === "object") {
        if (typeof v.src === "string" && v.src && typeof v.alt === "string" && !v.alt.trim()) warn.push({ path: `${p}.alt`, message: "Photo needs a description (alt text)", kind: "alt" });
        for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
      } else if (typeof v === "string" && /\[[^\]\n]{1,60}\]/.test(v) && !/(^|\.)id$/.test(p)) warn.push({ path: p, message: "Looks like placeholder text: replace the [brackets]", kind: "placeholder" });
    };
    walk(draft, "");
    if (draft._admin) {
      const hhs = draft._admin.households || [];
      hhs.forEach((hh, i) => {
        if (!String(hh.household || "").trim()) app.errors.push({ path: `_admin.households.${i}.household`, message: "A household needs a name" });
      });
      for (const w of draft._admin.waves || []) {
        if (!w.deadline) app.errors.push({ path: "_admin.waves", message: `The wave "${w.name || w.id}" needs a reply-by date` });
        const n = hhs.filter((hh) => hh.wave === w.id).length;
        if (!w.sent && n) warn.push({ path: "_admin.waves", message: `"${w.name || w.id}" isn't sent yet, so the links for its ${n} household${n === 1 ? "" : "s"} won't work until you mark it sent` });
      }
      for (const e of draft.events.filter(GL.isPrivate)) if (!hhs.some((hh) => (hh.eventIds || []).includes(e.id))) warn.push({ path: "_admin.households", message: `Nobody is invited to the private event "${e.name || e.id}" yet` });
    }
    app.warnings = warn;
  }

  function mutate(fn, label, opts = {}) {
    const before = JSON.stringify(draft);
    const next = clone(draft);
    fn(next);
    const after = JSON.stringify(next);
    if (before === after) return false;
    draft = next;
    history.push(before, after, label, opts.coalesce || null, { force: opts.force });
    afterChange(opts);
    return true;
  }
  function afterChange(opts = {}) {
    app.lastSource = opts.source || "ui";
    revalidate();
    app.dirty = dirtyNow();
    if (app.liveState && app.dirty) app.liveState = "";
    scheduleSave();
    renderChrome();
    app.emit("change", { source: app.lastSource });
    if (opts.silent) return;
    const r = opts.render ?? "now";
    if (r === "none") return;
    app.render(r === "soon" ? { soon: true, source: app.lastSource } : { now: true, source: app.lastSource });
  }
  app.mutate = mutate;
  app.commit = (path, value, label = "Edit", opts = {}) =>
    mutate((d) => {
      if (value === undefined) {
        const segs = path.split(".");
        const parent = segs.length > 1 ? getPath(d, segs.slice(0, -1).join(".")) : d;
        if (parent) delete parent[segs.at(-1)];
      } else setPath(d, path, value);
    }, label, opts);

  /** Content with the private events and guest list put back (used when a public-only version replaces the draft). */
  function fold(content, privateEvents, admin) {
    const c = clone(content);
    c.events = GL.sortEvents([...(c.events || []).filter((e) => !GL.isPrivate(e)), ...clone(privateEvents || [])]);
    if (admin) c._admin = clone(admin);
    return c;
  }
  app.replaceDraft = (content, label = "Replace content") => {
    inline.stop(false);
    const before = JSON.stringify(draft);
    draft = fold(content, app.privateEvents(), draft._admin);
    history.push(before, JSON.stringify(draft), label);
    app.selection = null;
    afterChange({ render: "now" });
    renderSelection();
  };
  app.resetTo = async (content) => {
    inline.stop(false);
    const priv = app.adminBase?.privateEvents || [];
    draft = fold(content, priv, app.adminBase && clone(app.adminBase.admin)); app.base = fold(content, priv); app.baseSha = await contentSha(content);
    history.clear(); clearDraft(); app.selection = null;
    afterChange({ render: "now" }); renderSelection();
    ui.toast("Loaded the latest version of the site");
  };
  app.afterPublish = async (clean, sha, published, adminState) => {
    draft = clone(clean); app.base = clone(clean); app.baseSha = sha;
    if (app.unlocked && adminState) {
      draft._admin = clone(adminState.admin);
      app.adminBase = { admin: clone(adminState.admin), privateEvents: clone(adminState.privateEvents) };
      app.adminCt = adminState.ct; app.adminIsNew = false;
    }
    history.clear(); clearDraft(); app.savedAt = 0;
    afterChange({ render: "now" });
  };
  app.setLive = (state) => { app.liveState = state; renderStatus(); };

  function restore(str) {
    inline.stop(false);
    draft = JSON.parse(str);
    afterChange({ render: "now", source: "history" });
    panel.render();
  }
  const undo = () => { const e = history.undo(); if (e) { restore(e.before); ui.toast(`Undid: ${e.label}`, { ms: 1800 }); } };
  const redo = () => { const e = history.redo(); if (e) { restore(e.after); ui.toast(`Redid: ${e.label}`, { ms: 1800 }); } };
  app.undo = undo; app.redo = redo;

  /* ---------- rendering the frame ---------- */
  let soonTimer = 0, deferTimer = 0, pending = false;
  const frameEl = $("#frame");
  const frame = (app.frame = createFrame(app, frameEl));
  function doRender() {
    clearTimeout(soonTimer); clearTimeout(deferTimer); pending = false;
    if (!frame.get()) return;
    const snap = inline.snapshot();
    const y = frame.win.scrollY;
    if (snap) inline.abandon();
    frame.setContent(draft, previewGuest());
    frame.afterRender();
    if (Math.abs(frame.win.scrollY - y) > 1) frame.win.scrollTo(0, y);
    if (snap) { const el = frame.findTextEl(snap.path); if (el) inline.start(app, frame, el, null, { offset: snap.offset }); }
    app.emit("render", { source: app.lastSource });
  }
  app.render = (o = {}) => {
    if (o.now) return doRender();
    if (o.deferred) { pending = true; clearTimeout(deferTimer); deferTimer = setTimeout(doRender, 450); return; }
    clearTimeout(soonTimer);
    soonTimer = setTimeout(doRender, 120);
  };
  app.flushRender = () => { if (pending || soonTimer) doRender(); };
  // Preview modes: everyone (all events in the draft), public visitor (public events only, no greeting), or one household.
  const previewGuest = () => {
    const g = app.previewGuest;
    if (!g || g._preview) return g;
    const hh = (draft._admin?.households || []).find((x) => x.code === g.code);
    return hh ? GL.makeGuestFor(hh, draft.events, draft._admin?.waves) : g; // rebuilt from the draft so edits show straight away
  };
  app.setPreviewGuest = (guest) => {
    app.previewGuest = guest || null;
    const sel = $("#preview-as");
    sel.value = !guest ? "all" : guest._preview ? "public" : sel.querySelector(`[value="g:${guest.code}"]`) ? `g:${guest.code}` : "all";
    doRender();
  };
  app.previewAs = (code) => {
    const hh = (draft._admin?.households || []).find((x) => x.code === code);
    if (!hh) return;
    app.setPreviewGuest(GL.makeGuestFor(hh, draft.events, draft._admin?.waves));
    app.toast(`Previewing as ${hh.household}`);
  };
  app.refreshPreview = () => { if (app.previewGuest && !app.previewGuest._preview) app.render({ soon: true, source: "guests" }); };
  function syncPreviewOptions() {
    const sel = $("#preview-as");
    sel.querySelectorAll("option[data-hh]").forEach((o) => o.remove());
    for (const hh of draft._admin?.households || []) sel.append(h("option", { value: `g:${hh.code}`, "data-hh": "1" }, hh.household || "(unnamed)"));
    const g = app.previewGuest;
    sel.value = !g ? "all" : g._preview ? "public" : sel.querySelector(`[value="g:${g.code}"]`) ? `g:${g.code}` : "all";
    if (g && !g._preview && sel.value === "all") app.previewGuest = null;
  }
  app.on("change", () => { if (draft._admin) syncPreviewOptions(); });

  /* ---------- selection ---------- */
  app.crumbText = () => (app.selection ? T.crumbs(app.selection, draft).map((c) => c.label).join(" › ") : "");
  function pageFor(path) { return PAGE_OF[path.split(".")[0]]; }
  app.select = (path, o = {}) => {
    if (app.selection === path && !o.force) return;
    app.selection = path || null;
    renderSelection();
    if (path && o.reveal) { const pg = pageFor(path); if (pg && pg !== frame.current().id) frame.go(pg); setTimeout(() => frame.reveal(path), 120); }
  };
  function renderSelection() {
    panel.render();
    frame.reposition?.();
    if (app.selection) showTab("edit");
    app.emit("select", app.selection);
  }

  /* ---------- panel + tabs ---------- */
  const panel = (app.panel = createPanel(app, $("#body-edit")));
  let guestsMounted = false;
  function showTab(name) {
    for (const t of document.querySelectorAll(".tabs [role=tab]")) t.setAttribute("aria-selected", t.dataset.tab === name ? "true" : "false");
    for (const n of ["edit", "guests", "history"]) $(`#body-${n}`).hidden = n !== name;
    document.body.classList.toggle("wide-panel", name === "guests");
    if (name === "guests" && !guestsMounted) {
      guestsMounted = true;
      mountGuests($("#body-guests"), {
        getDraft: () => draft, commit: app.commit, setPreviewGuest: app.setPreviewGuest, previewAs: app.previewAs, refreshPreview: app.refreshPreview,
        toast: ui.toast, confirm: ui.confirm, dialog: ui.dialog, github, on: app.on,
        isUnlocked: () => app.unlocked, requestUnlock: () => app.requestUnlock(), app,
      });
    }
    if (name === "history") mountHistory($("#body-history"), app);
  }
  document.querySelectorAll(".tabs [role=tab]").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  app.showTab = showTab;

  app.on("render", ({ source }) => {
    if (source === "panel") { panel.showErrors(); return; }
    if (panel.contains(document.activeElement) && source !== "history" && source !== "ui") { panel.showErrors(); return; }
    panel.render();
  });
  app.on("change", () => panel.showErrors());
  app.on("route", (r) => { app.currentPage = r.id; $("#page-select").value = r.id; if (!app.selection) panel.render(); });

  /* ---------- images ---------- */
  const fileInput = $("#file-input");
  let pickPath = null;
  app.pickImage = (path) => { pickPath = path; fileInput.value = ""; fileInput.click(); };
  fileInput.addEventListener("change", () => { const f = fileInput.files[0]; if (f && pickPath) app.setImageFromFile(pickPath, f); });
  app.setImageFromFile = async (path, file) => {
    const note = ui.toast("Processing photo…", { ms: 30000 });
    try {
      const r = await images.addFile(file);
      note.remove();
      mutate((d) => {
        const cur = getPath(d, path);
        setPath(d, path, { ...(cur && typeof cur === "object" ? cur : {}), src: r.src, srcSmall: r.srcSmall, alt: "", focal: cur?.focal || [50, 50], _pending: true });
      }, "Replace photo");
      app.select(path, { force: true });
      ui.toast("Photo added. Describe it in the side panel for screen readers.");
    } catch (e) { note.remove(); ui.toast(e.message || "That photo couldn't be added.", { kind: "err", ms: 6000 }); }
  };

  /* ---------- toolbar ---------- */
  $("#undo").innerHTML = ico("undo"); $("#redo").innerHTML = ico("redo");
  $("#toggle-panel").innerHTML = ico("panel"); $("#more").innerHTML = ico("more");
  $("#dev-phone").innerHTML = ico("phone"); $("#dev-tablet").innerHTML = ico("tablet"); $("#dev-desktop").innerHTML = ico("desktop");
  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);
  $("#publish").addEventListener("click", () => openPublish(app));
  $("#toggle-panel").addEventListener("click", () => { document.body.classList.toggle("panel-collapsed"); layoutStage(); });
  $("#brand").textContent = `${draft.site?.title || "Wedding"} · Editor`;

  // devices
  let deviceW = +(safe(() => localStorage.getItem("pa.editor.device")) || 1280);
  function setDevice(w) {
    deviceW = w;
    safe(() => localStorage.setItem("pa.editor.device", String(w)));
    document.querySelectorAll("#devices button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.w === w)));
    $("#app").dataset.device = w <= 480 ? "phone" : w <= 900 ? "tablet" : "desktop";
    layoutStage();
  }
  function layoutStage() {
    const stage = $("#stage");
    const pad = 28;
    const kind = $("#app").dataset.device;
    const bezel = kind === "desktop" ? 0 : kind === "phone" ? 12 : 14;
    const chrome = kind === "desktop" ? 30 : 0;
    const availW = stage.clientWidth - pad * 2;
    const availH = stage.clientHeight - pad * 2;
    const outerW = deviceW + bezel * 2;
    const scale = Math.min(1, availW / outerW);
    const capH = kind === "phone" ? 860 : kind === "tablet" ? 1100 : 4000;
    const screenH = Math.max(320, Math.min(capH, availH / scale - bezel * 2 - chrome));
    const dev = $("#device");
    dev.style.width = `${outerW}px`;
    dev.style.padding = `${bezel}px`;
    dev.style.transform = `scale(${scale})`;
    frameEl.style.width = `${deviceW}px`;
    frameEl.style.height = `${screenH}px`;
    const outerH = screenH + bezel * 2 + chrome;
    $("#sizer").style.width = `${outerW * scale}px`;
    $("#sizer").style.height = `${outerH * scale}px`;
    frame.reposition?.();
  }
  document.querySelectorAll("#devices button").forEach((b) => b.addEventListener("click", () => setDevice(+b.dataset.w)));
  new ResizeObserver(() => layoutStage()).observe($("#stage"));

  // page picker + preview-as
  const pageSel = $("#page-select");
  function fillPages() {
    const ids = frame.pages();
    const order = (id) => draft.pages?.[id]?.order ?? 99;
    pageSel.replaceChildren(...[...ids].sort((a, b) => order(a) - order(b)).map((id) => h("option", { value: id }, pageLabel(id) + (draft.pages?.[id]?.enabled === false ? " (hidden)" : ""))));
    pageSel.value = frame.current().id;
  }
  pageSel.addEventListener("change", () => frame.go(pageSel.value));
  $("#preview-as").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v.startsWith("g:")) app.previewAs(v.slice(2));
    else app.setPreviewGuest(v === "public" ? PUBLIC_GUEST : null);
  });
  app.on("render", fillPages);
  app.on("frameready", () => { app.currentPage = frame.current().id; fillPages(); $("#boot").remove(); layoutStage(); startCoach(); });

  /* ---------- status + badge ---------- */
  function renderStatus(saving = false) {
    const el = $("#status");
    let t;
    if (app.liveState === "going") t = "Published · going live…";
    else if (app.liveState === "live") t = "Live ✓";
    else if (!app.dirty) t = app.restored && false ? "" : "No unpublished changes";
    else if (saving) t = "Saving draft…";
    else t = app.savedAt ? `Saved draft · ${ago(app.savedAt)}` : "Unsaved changes";
    el.textContent = t;
    el.dataset.state = app.dirty ? "dirty" : "clean";
  }
  setInterval(() => renderStatus(), 15000);
  function renderChrome() {
    $("#undo").disabled = !history.canUndo();
    $("#redo").disabled = !history.canRedo();
    const l = history.labels();
    $("#undo").title = l.undo ? `Undo ${l.undo} (Ctrl+Z)` : "Undo (Ctrl+Z)";
    $("#redo").title = l.redo ? `Redo ${l.redo} (Ctrl+Shift+Z)` : "Redo (Ctrl+Shift+Z)";
    const b = $("#badge");
    const e = app.errors.length, w = app.warnings.length;
    b.dataset.level = e ? "err" : w ? "warn" : "ok";
    b.innerHTML = (e ? `${ico("alert", 15)}<span>${e} ${e === 1 ? "problem" : "problems"}</span>` : w ? `${ico("alert", 15)}<span>${w} ${w === 1 ? "tip" : "tips"}</span>` : `${ico("check", 15)}<span>All good</span>`);
    const pub = $("#publish");
    pub.disabled = e > 0;
    pub.title = e ? "Fix the problems first (click the red badge to see them)" : "Publish your changes to the website";
    renderStatus();
  }
  $("#badge").addEventListener("click", (ev) => {
    const list = h("div.issues");
    const row = (i, level) => h("button.issue", { type: "button", "data-level": level, onclick: () => { pop.close(); goToIssue(i.path); } },
      h("span.dot"), h("span", h("strong", i.path.startsWith("_admin") ? "Guest list" : T.crumbs(i.path.replace(/\.[^.]+$/, (m) => (/^\.\d+$/.test(m) ? "" : m)), draft).map((c) => c.label).slice(-3).join(" › ") || i.path), h("br"), h("span.muted", i.message)));
    if (!app.errors.length && !app.warnings.length) list.append(h("div.empty", ico("check", 26), h("p", "No problems found.")));
    if (app.errors.length) list.append(h("h4", `Problems to fix (${app.errors.length})`), ...app.errors.map((i) => row(i, "err")));
    if (app.warnings.length) list.append(h("h4", `Worth a look (${app.warnings.length})`), ...app.warnings.slice(0, 80).map((i) => row(i, "warn")));
    const pop = popover(ev.currentTarget, list, { cls: "wide" });
  });
  function goToIssue(path) {
    if (path.startsWith("_admin")) { showTab("guests"); return; }
    const segs = path.split(".");
    const idx = segs.findIndex((s, i) => i > 0 && /^\d+$/.test(s));
    const target = idx > 0 ? segs.slice(0, idx + 1).join(".") : segs.length > 1 ? segs.slice(0, -1).join(".") : segs[0];
    const pg = pageFor(path);
    if (pg && pg !== frame.current().id) frame.go(pg);
    app.select(target, { force: true });
    setTimeout(() => { panel.focusField(path); frame.reveal(target); }, 160);
  }
  app.goToIssue = goToIssue;

  // more menu
  $("#more").addEventListener("click", (ev) => {
    const item = (ic, label, fn) => h("button.menu-i", { type: "button", role: "menuitem", onclick: () => { pop.close(); fn(); } }, h("span", { html: ico(ic, 16) }), label);
    const menu = h("div.menu", { role: "menu" },
      item("gear", "Publishing settings…", () => openSettings(app)),
      item("download", "Download content.json", () => downloadContent(app)),
      item("history", "Version history", () => showTab("history")),
      item("edit", "Show the quick tour again", () => startCoach(true)),
      h("hr"),
      h("div.menu-n", h("strong", "Tip"), " Alt-click follows a link inside the preview."));
    const pop = popover(ev.currentTarget, menu);
  });

  /* ---------- keyboard ---------- */
  app.onKey = (e) => {
    const t = e.target;
    const editable = t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || "");
    const mod = e.ctrlKey || e.metaKey;
    const k = (e.key || "").toLowerCase();
    if (mod && k === "s") { e.preventDefault(); app.saveNow(); return; }
    if (mod && k === "z" && !editable) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === "y" && !editable) { e.preventDefault(); redo(); return; }
    if (k === "escape" && !editable && !document.querySelector("dialog[open]") && !inline.isEditing()) { if (app.selection) { e.preventDefault(); app.select(null); } }
  };
  document.addEventListener("keydown", app.onKey);
  window.addEventListener("beforeunload", (e) => { if (app.dirty) { saveNow(); e.preventDefault(); e.returnValue = ""; } });
  app.announce = (m) => { $("#sr-live").textContent = m; };

  /* ---------- first run ---------- */
  function startCoach(force = false) {
    if (!force && safe(() => localStorage.getItem("pa.editor.coach.v1"))) return;
    const steps = [
      ["Click any text to edit it", "Click a title or paragraph on the page and just start typing. Press Enter to finish, or Esc to undo."],
      ["Drag to reorder", "Hover over a card, then use the handle (or the arrow buttons) to move it. Add, copy and delete live there too."],
      ["Drop photos", "Drop a photo from your computer onto any picture, or click it. We shrink it for you."],
      ["Publish when ready", "Nothing goes live until you press Publish. Your draft is saved on this computer as you go."],
    ];
    let i = 0;
    const card = h("div.coach", { role: "dialog", "aria-label": "Quick tour" });
    const done = () => { card.remove(); safe(() => localStorage.setItem("pa.editor.coach.v1", "1")); };
    const draw = () => {
      card.replaceChildren(h("div.coach-step", `${i + 1} of ${steps.length}`), h("strong", steps[i][0]), h("p", steps[i][1]),
        h("div.coach-a", h("button.link", { type: "button", onclick: done }, "Skip"), h("span.dots", steps.map((_, k) => h("i", { class: k === i ? "on" : "" }))),
          h("button.btn.primary.small", { type: "button", onclick: () => { if (i < steps.length - 1) { i++; draw(); } else done(); } }, i < steps.length - 1 ? "Next" : "Got it")));
    };
    draw();
    document.body.append(card);
  }

  if (innerWidth < 700 && !safe(() => sessionStorage.getItem("pa.editor.phone"))) {
    $("#phone-note").hidden = false;
    $("#phone-ok").addEventListener("click", () => { $("#phone-note").hidden = true; safe(() => sessionStorage.setItem("pa.editor.phone", "1")); });
  }

  /* ---------- guest list: private events + households (encrypted in admin.enc.json) ---------- */
  const PASS_KEY = "pa.editor.pass.v1"; // sessionStorage only: gone when the tab closes
  app.unlocked = false; app.passphrase = ""; app.adminBase = null; app.adminCt = null; app.adminIsNew = false;
  const normAdmin = (b) => ({ households: clone(b.households || []), presets: b.presets, waves: b.waves, waTemplate: b.waTemplate, waReminder: b.waReminder, rsvpAdminKey: b.rsvpAdminKey });
  function showLock() { $("#lock-banner").hidden = app.unlocked; }

  async function fetchAdminFile() {
    if (github.isConfigured()) { try { const f = await github.getFile("content/admin.enc.json"); if (f) return JSON.parse(f.text); } catch { /* fall back to the published copy */ } }
    let res;
    try { res = await fetch("../content/admin.enc.json", { cache: "no-cache" }); } catch { throw new Error("offline"); }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("load");
    return res.json();
  }

  function applyUnlock(bundle, adminJson, passphrase, isNew) {
    const priv = GL.sortEvents(bundle.privateEvents || []);
    const admin = normAdmin(bundle);
    app.adminBase = { admin: clone(admin), privateEvents: clone(priv) };
    app.adminCt = adminJson?.ct || null;
    app.adminIsNew = !!isNew;
    app.passphrase = passphrase;
    safe(() => sessionStorage.setItem(PASS_KEY, passphrase));
    const addMissing = (c) => {
      const have = new Set(c.events.map((e) => e.id));
      c.events = GL.sortEvents([...c.events, ...clone(priv).filter((e) => !have.has(e.id))]);
    };
    app.base = clone(app.base); addMissing(app.base);
    if (!draft._admin) { draft = clone(draft); addMissing(draft); draft._admin = clone(admin); }
    app.unlocked = true;
    history.clear();
    showLock();
    revalidate();
    app.dirty = dirtyNow();
    syncPreviewOptions();
    renderChrome();
    app.emit("unlock");
    app.emit("change", { source: "unlock" });
    doRender();
    if (!isNew) saveNow();
  }

  async function autoUnlock() {
    const pass = safe(() => sessionStorage.getItem(PASS_KEY));
    if (!pass) return false;
    try {
      const adminJson = await fetchAdminFile();
      if (!adminJson) return false;
      applyUnlock(await openAdmin(adminJson, pass), adminJson, pass, false);
      return true;
    } catch { safe(() => sessionStorage.removeItem(PASS_KEY)); return false; }
  }

  app.requestUnlock = async () => {
    if (app.unlocked) return true;
    let adminJson;
    try { adminJson = await fetchAdminFile(); }
    catch { ui.toast("Couldn't load the guest list. Check your connection and try again.", { kind: "err", ms: 5000 }); return false; }
    const creating = !adminJson;
    const pass = h("input", { type: "password", id: "unlock-pass", autocomplete: creating ? "new-password" : "current-password", "aria-label": creating ? "New passphrase" : "Guest list passphrase", placeholder: creating ? "Choose a passphrase" : "Passphrase" });
    const pass2 = creating ? h("input", { type: "password", "aria-label": "Repeat passphrase", placeholder: "Repeat the passphrase", autocomplete: "new-password" }) : null;
    const note = h("p.dlg-note", { role: "alert" });
    let closeDlg;
    const submit = async () => {
      note.className = "dlg-note"; note.textContent = "";
      if (!pass.value) { note.textContent = "Type the passphrase."; note.className = "dlg-note err"; return; }
      try {
        if (creating) {
          if (pass.value.length < 8) throw new Error("Use at least 8 characters.");
          if (pass.value !== pass2.value) throw new Error("The two passphrases don't match.");
          applyUnlock({ households: [], privateEvents: [], rsvpAdminKey: randomCode(24) }, null, pass.value, true);
        } else {
          note.textContent = "Unlocking…";
          applyUnlock(await openAdmin(adminJson, pass.value), adminJson, pass.value, false);
        }
        closeDlg(true);
      } catch (e) { note.textContent = e.message; note.className = "dlg-note err"; }
    };
    [pass, pass2].forEach((i) => i?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }));
    const ok = await ui.dialog({
      title: creating ? "Create a guest list passphrase" : "Unlock the guest list",
      body: h("div.unlock",
        h("p.dlg-msg", creating
          ? "Your guest list and private events are stored encrypted. Choose a passphrase to protect them, and write it down somewhere safe: if it is lost, the list cannot be recovered."
          : "Enter the passphrase for your guest list. It unlocks private events and your guests in this editor. It stays in this browser tab only and is forgotten when you close it."),
        pass, pass2, note),
      actions: [{ label: "Not now", value: false }, { label: creating ? "Create" : "Unlock", primary: true, keepOpen: true, onClick: () => submit() }],
      onOpen: (d, close) => { closeDlg = close; },
    });
    return ok === true;
  };
  $("#unlock-btn").addEventListener("click", () => app.requestUnlock());
  showLock();
  if (!(await autoUnlock())) { if (draft._admin) { draft = clone(draft); delete draft._admin; } }

  /* ---------- go ---------- */
  revalidate();
  app.dirty = dirtyNow();
  renderChrome();
  setDevice([390, 768, 1280].includes(deviceW) ? deviceW : 1280);
  panel.render();
  frameEl.src = "../?edit=1";
  if (app.restored) ui.toast("Restored your unpublished draft");
  window.__editor = app; // handy for tests and debugging
}

boot();

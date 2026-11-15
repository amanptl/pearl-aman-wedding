// Inspector panel: forms generated from content/schema.json for the selected item, plus page/site settings.
import { getPath } from "../src/lib/dom.js";
import { h, iconBtn } from "./ui.js";
import { ico } from "./icons.js";
import { moveRelative, addItem } from "./lists.js";
import { parseMapsLink } from "./maps-link.js";

const PAGE_LABEL = { home: "Home", schedule: "Schedule", travel: "Travel & Stay", story: "Our Story", faq: "Q&A", registry: "Registry", rsvp: "RSVP" };
const PAGE_KEYS = { home: ["home"], schedule: ["events"], travel: ["hotels", "travel"], story: ["story", "people"], faq: ["faqCategories", "faq"], registry: ["registry"], rsvp: ["rsvp"] };
export const pageLabel = (id) => PAGE_LABEL[id] || id;

export function createPanel(app, body) {
  const T = app.schemaTools;
  const P = { };
  const openRows = new Set();
  const lastSegs = (p) => p.split(".").pop();

  /* ---------- field plumbing ---------- */
  function shell(s, path, control, { title, help, inline = false, cls = "" } = {}) {
    const t = title ?? s.title ?? lastSegs(path);
    const hint = help ?? s.description;
    const wrap = h(`div.fld${inline ? ".inline" : ""}${cls ? "." + cls : ""}`, { "data-fpath": path });
    const labelId = `lbl-${path.replace(/\W/g, "-")}`;
    wrap.append(h("div.fld-top", h("span.fld-l", { id: labelId }, t), inline ? control : null));
    if (!inline) wrap.append(control);
    if (hint) wrap.append(h("div.fld-h", hint));
    wrap.append(h("div.fld-err", { "data-err-for": path, role: "alert" }));
    return wrap;
  }
  const setter = (path, title) => (v, opts = {}) => app.commit(path, v, `Edit ${String(title).toLowerCase()}`, { coalesce: path, source: "panel", render: "soon", ...opts });

  /* ---------- leaf widgets ---------- */
  function textInput(s, path, value, set, type = "text") {
    const inp = h("input", { type, value: value ?? "", id: `f-${path}`, "data-field": path, autocomplete: "off", spellcheck: type === "text", oninput: () => set(inp.value) });
    return inp;
  }
  function field(schema, path, opts = {}) {
    const s = T.resolve(schema);
    if (!s) return h("div");
    const title = opts.title ?? s.title ?? lastSegs(path);
    const val = getPath(app.draft, path);
    const set = setter(path, title);
    const label = (control, o) => shell(s, path, control, { title, ...o });

    if (T.isImage(s)) return imageField(s, path, title);
    if (s.type === "array") {
      const it = T.resolve(s.items);
      if (s["x-widget"] === "swatches") return label(swatches(path, val || [], set));
      if (it?.["x-widget"] === "event-picker") return label(eventChecks(path, val || [], set));
      if (it?.type === "object" || T.isImage(it)) return objList(s, path, title);
      return label(stringList(it, path, val || []));
    }
    if (s.type === "object") {
      if (s.additionalProperties && !s.properties) return label(mapField(s, path, val || {}));
      return group(s, path, { title });
    }
    if (s.type === "boolean") {
      const cb = h("input", { type: "checkbox", role: "switch", checked: !!val, id: `f-${path}`, "data-field": path, onchange: () => set(cb.checked, { coalesce: null }) });
      return shell(s, path, h("label.switch", cb, h("span.knob")), { title, inline: true });
    }
    if (s.type === "number" || s.type === "integer") {
      const inp = h("input", { type: "number", value: val ?? "", step: s.type === "integer" ? 1 : "any", min: s.minimum, max: s.maximum, id: `f-${path}`, "data-field": path, oninput: () => set(inp.value === "" ? undefined : Number(inp.value)) });
      return label(inp);
    }
    // strings
    if (s["x-widget"] === "event-picker") {
      const sel = h("select", { id: `f-${path}`, "data-field": path, onchange: () => set(sel.value, { coalesce: null }) },
        h("option", { value: "" }, "— choose an event —"),
        app.draft.events.map((e) => h("option", { value: e.id, selected: e.id === val }, e.name || e.id)));
      return label(sel);
    }
    if (s.enum) {
      const sel = h("select", { id: `f-${path}`, "data-field": path, onchange: () => set(sel.value, { coalesce: null }) },
        s.enum.map((o) => h("option", { value: o, selected: o === val }, enumLabel(path, o))));
      return label(sel);
    }
    if (s["x-widget"] === "textarea") {
      const ta = h("textarea", { rows: 3, id: `f-${path}`, "data-field": path, oninput: () => { set(ta.value); grow(ta); } }, val ?? "");
      queueMicrotask(() => grow(ta));
      return label(ta);
    }
    switch (s.format) {
      case "date": return label(textInput(s, path, val, set, "date"));
      case "date-time-local": return label(textInput(s, path, typeof val === "string" ? val.slice(0, 16) : "", set, "datetime-local"));
      case "tel": return label(textInput(s, path, val, set, "tel"));
      case "uri": {
        const inp = textInput(s, path, val, set, "text");
        inp.placeholder = "https://…";
        inp.inputMode = "url";
        const test = h("button.btn.small", { type: "button", title: "Open this link in a new tab to check it", onclick: () => { try { const u = new URL(inp.value); if (/^https?:$/.test(u.protocol)) window.open(u.href, "_blank", "noopener"); } catch {} } }, h("span", { html: ico("external", 14) }), "Test link");
        const upd = () => { let ok = false; try { ok = /^https?:$/.test(new URL(inp.value).protocol); } catch {} test.disabled = !ok; };
        inp.addEventListener("input", upd); upd();
        return label(h("div.row", inp, test));
      }
      case "color": {
        const hex = (v) => (/^#[0-9a-f]{3}$/i.test(v) ? "#" + [...v.slice(1)].map((c) => c + c).join("") : /^#[0-9a-f]{6}$/i.test(v) ? v : "#000000");
        const txt = h("input", { type: "text", value: val ?? "", "data-field": path, id: `f-${path}`, maxlength: 7, oninput: () => { set(txt.value); if (/^#[0-9a-f]{3,6}$/i.test(txt.value)) pick.value = hex(txt.value); } });
        const pick = h("input.color", { type: "color", value: hex(val || ""), "aria-label": `${title} colour picker`, oninput: () => { txt.value = pick.value; set(pick.value); } });
        return label(h("div.row", pick, txt));
      }
    }
    return label(textInput(s, path, val, set));
  }
  const grow = (ta) => { ta.style.height = "auto"; ta.style.height = Math.min(320, ta.scrollHeight + 2) + "px"; };
  const enumLabel = (path, o) => ({ block: "Block (group rate)", nearby: "Nearby (no block)", public: "Public (everyone)", private: "Private (invited guests)" }[o] || o);

  /* ---------- composite widgets ---------- */
  function stringList(itemSchema, path, arr) {
    const it = T.resolve(itemSchema);
    const long = it?.["x-widget"] === "textarea";
    const wrap = h("div.slist");
    const draw = () => {
      const cur = getPath(app.draft, path) || [];
      wrap.replaceChildren(...cur.map((v, i) => {
        const inp = long ? h("textarea", { rows: 2, value: v, "data-field": `${path}.${i}`, "aria-label": `${it.title || "Item"} ${i + 1}`, oninput: () => { app.commit(`${path}.${i}`, inp.value, "Edit text", { coalesce: `${path}.${i}`, source: "panel", render: "soon" }); grow(inp); } }, v)
          : h("input", { type: "text", value: v, "data-field": `${path}.${i}`, "aria-label": `${it.title || "Item"} ${i + 1}`, oninput: () => app.commit(`${path}.${i}`, inp.value, "Edit text", { coalesce: `${path}.${i}`, source: "panel", render: "soon" }) });
        return h("div.srow", inp,
          iconBtn("up", "Move up", () => move(i, i - 1)), iconBtn("down", "Move down", () => move(i, i + 2)),
          iconBtn("trash", "Remove", () => { app.mutate((d) => getPath(d, path).splice(i, 1), "Remove item", { source: "panel" }); draw(); }, "danger"));
      }), h("button.btn.small.add", { type: "button", onclick: () => { app.mutate((d) => { const a = getPath(d, path); if (a) a.push(""); else setIn(d, path, [""]); }, "Add item", { source: "panel" }); draw(); wrap.querySelector(".srow:last-of-type input, .srow:last-of-type textarea")?.focus(); } }, h("span", { html: ico("plus", 14) }), "Add"));
      wrap.querySelectorAll("textarea").forEach(grow);
    };
    const move = (i, to) => { if (to < 0 || to > (getPath(app.draft, path) || []).length) return; app.mutate((d) => moveRelative(getPath(d, path), i, to, false), "Reorder", { source: "panel" }); draw(); };
    draw();
    return wrap;
  }
  function swatches(path, arr, set) {
    const wrap = h("div.swatches");
    const draw = () => {
      const cur = getPath(app.draft, path) || [];
      wrap.replaceChildren(...cur.map((c, i) => h("div.sw", h("input.color", { type: "color", value: /^#[0-9a-f]{6}$/i.test(c) ? c : "#888888", "aria-label": `Colour ${i + 1}`, oninput: (e) => app.commit(`${path}.${i}`, e.target.value, "Edit colour", { coalesce: `${path}.${i}`, source: "panel", render: "soon" }) }),
        h("button.sw-x", { type: "button", "aria-label": `Remove colour ${i + 1}`, title: "Remove", html: ico("x", 12), onclick: () => { app.mutate((d) => getPath(d, path).splice(i, 1), "Remove colour", { source: "panel" }); draw(); } })),
      ), h("button.sw-add", { type: "button", title: "Add colour", "aria-label": "Add colour", html: ico("plus", 16), onclick: () => { app.mutate((d) => { const a = getPath(d, path); if (a) a.push("#c9a96e"); else setIn(d, path, ["#c9a96e"]); }, "Add colour", { source: "panel" }); draw(); } }));
    };
    draw();
    return wrap;
  }
  function eventChecks(path, arr, set) {
    const wrap = h("div.checks");
    for (const e of app.draft.events) {
      const cb = h("input", { type: "checkbox", checked: (arr || []).includes(e.id), onchange: () => { const cur = new Set(getPath(app.draft, path) || []); cb.checked ? cur.add(e.id) : cur.delete(e.id); set(app.draft.events.map((x) => x.id).filter((x) => cur.has(x)), { coalesce: null }); } });
      wrap.append(h("label.check", cb, h("span", e.name || e.id)));
    }
    return wrap;
  }
  function mapField(s, path, obj) {
    const wrap = h("div.mapf");
    const draw = () => {
      const cur = getPath(app.draft, path) || {};
      wrap.replaceChildren(...Object.entries(cur).map(([k, v]) => h("div.srow", h("span.mapk", app.draft.events.find((e) => e.id === k)?.name || k),
        h("input", { type: "number", value: v, "aria-label": `${k} minutes`, oninput: (e) => app.commit(`${path}.${k}`, e.target.value === "" ? undefined : Number(e.target.value), "Edit drive time", { coalesce: `${path}.${k}`, source: "panel", render: "soon" }) }),
        iconBtn("trash", "Remove", () => { app.commit(`${path}.${k}`, undefined, "Remove", { source: "panel" }); draw(); }, "danger"))));
      const free = app.draft.events.filter((e) => !(e.id in cur));
      if (free.length) {
        const sel = h("select", { "aria-label": "Add drive time for event" }, h("option", { value: "" }, "Add a drive time…"), free.map((e) => h("option", { value: e.id }, e.name || e.id)));
        sel.addEventListener("change", () => { if (sel.value) { app.commit(`${path}.${sel.value}`, 10, "Add drive time", { source: "panel" }); draw(); } });
        wrap.append(sel);
      }
    };
    draw();
    return wrap;
  }

  function setIn(d, path, v) { const segs = path.split("."); let o = d; segs.slice(0, -1).forEach((k) => { o = o[k] ??= {}; }); o[segs.at(-1)] = v; }

  /* ---------- object list (array of objects / images) ---------- */
  function objList(s, path, title) {
    const it = T.resolve(s.items);
    const noun = T.noun(path);
    const box = h("div.olist");
    const wrap = shell(s, path, box, { title });
    const draw = () => {
      const arr = getPath(app.draft, path) || [];
      const sortAuto = path === "events";
      box.replaceChildren(
        ...(arr.length ? [] : [h("div.muted.small", `No ${noun}s yet.`)]),
        ...arr.map((v, i) => {
          const ip = `${path}.${i}`;
          const d = h("details.orow", { "data-fpath": ip }, h("summary", h("span.chev", { html: ico("chevron", 14) }), h("span.otitle", T.itemLabel(v) || `${noun} ${i + 1}`),
            h("span.oact", ...(sortAuto ? [] : [iconBtn("up", "Move up", (e) => { e.preventDefault(); mv(i, i - 1); }), iconBtn("down", "Move down", (e) => { e.preventDefault(); mv(i, i + 2); })]),
              iconBtn("trash", `Remove ${noun}`, async (e) => { e.preventDefault(); if (await app.confirm({ title: `Delete this ${noun}?`, message: "You can bring it back with Undo.", confirmLabel: "Delete", danger: true })) { app.mutate((dd) => getPath(dd, path).splice(i, 1), `Delete ${noun}`, { source: "panel" }); draw(); } }, "danger"))));
          const fill = () => { if (d.dataset.filled) return; d.dataset.filled = "1"; d.append(h("div.obody", T.isImage(it) ? imageField(it, ip, `${noun} ${i + 1}`) : itemBody(it, ip))); };
          if (openRows.has(ip) || arr.length === 1) { d.open = true; fill(); }
          d.addEventListener("toggle", () => { if (d.open) { openRows.add(ip); fill(); } else openRows.delete(ip); });
          return d;
        }),
        h("button.btn.small.add", { type: "button", onclick: () => { addItem(app, path, null); openRows.add(`${path}.${(getPath(app.draft, path) || []).length - 1}`); draw(); } }, h("span", { html: ico("plus", 14) }), `Add ${noun}`));
    };
    const mv = (i, to) => { const a = getPath(app.draft, path) || []; if (to < 0 || to > a.length) return; app.mutate((d) => moveRelative(getPath(d, path), i, to, false), "Reorder", { source: "panel" }); openRows.clear(); draw(); };
    draw();
    return wrap;
  }
  const itemBody = (it, path) => { const f = h("div.group"); fillGroup(f, it, path); return f; };

  /* ---------- groups ---------- */
  function group(s, path, { title, collapsible = true } = {}) {
    const box = h("div.group");
    fillGroup(box, s, path);
    if (!title) return box;
    return h("fieldset.fset", h("legend", title), s.description ? h("div.fld-h", s.description) : null, box);
  }
  function fillGroup(box, s, path) {
    const props = Object.entries(s.properties || {});
    if (props.some(([k]) => k === "lat") && props.some(([k]) => k === "lng")) box.append(mapsHelper(path));
    const adv = [];
    for (const [k, sub] of props) {
      if (k === "id") { adv.push([k, sub]); continue; }
      box.append(field(sub, path ? `${path}.${k}` : k));
    }
    if (adv.length) box.append(h("details.adv", h("summary", "Advanced"), ...adv.map(([k, sub]) => field(sub, `${path}.${k}`))));
  }

  function mapsHelper(path) {
    const inp = h("input", { type: "text", placeholder: "Paste a Google Maps link…", "aria-label": "Google Maps link", autocomplete: "off" });
    const msg = h("div.fld-h");
    const apply = () => {
      const v = inp.value.trim();
      if (!v) return;
      const r = parseMapsLink(v);
      if (!r) { msg.textContent = /goo\.gl|maps\.app/.test(v) ? "Short links can't be read here. Open the link in your browser, then copy the longer address from the address bar." : "Couldn't find coordinates in that link."; msg.className = "fld-h bad"; return; }
      app.mutate((d) => { const o = getPath(d, path); o.lat = r.lat; o.lng = r.lng; }, "Set map location", { source: "panel" });
      msg.textContent = `Location set (${r.lat}, ${r.lng}).`; msg.className = "fld-h ok";
      inp.value = "";
      P.refresh();
    };
    inp.addEventListener("paste", () => setTimeout(apply, 0));
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); });
    return h("div.fld.maps", h("div.fld-top", h("span.fld-l", "Map location")), h("div.row", inp, h("button.btn.small", { type: "button", onclick: apply }, "Use link")), h("div.fld-h", "Sets latitude and longitude for directions."), msg);
  }

  /* ---------- image field ---------- */
  function imageField(s, path, title) {
    const is = T.imageSchema(s);
    const nullable = T.nullable(s);
    const wrap = h("div.fld.imgf", { "data-fpath": path });
    const draw = () => {
      const v = getPath(app.draft, path);
      wrap.replaceChildren(h("div.fld-top", h("span.fld-l", title)));
      if (!v || !v.src) {
        wrap.append(h("button.dropzone", { type: "button", onclick: () => app.pickImage(path) }, h("span", { html: ico("image", 22) }), h("strong", "Add a photo"), h("span.muted", "Click, or drop a file onto the picture on the page")));
      } else {
        const f = Array.isArray(v.focal) ? v.focal : [50, 50];
        const img = h("img", { src: app.images.previewUrl(v.src), alt: "", draggable: false });
        const cross = h("span.cross", { html: ico("crosshair", 26) });
        const place = (fx, fy) => { cross.style.left = `${fx}%`; cross.style.top = `${fy}%`; };
        place(f[0], f[1]);
        const thumb = h("div.thumb", { tabindex: 0, role: "button", "aria-label": "Set the focal point: click the most important part of the photo", title: "Click to set the focal point" }, img, cross, v._pending ? h("span.badge.pend", "New") : null);
        const setFocal = (fx, fy) => { fx = Math.round(Math.max(0, Math.min(100, fx))); fy = Math.round(Math.max(0, Math.min(100, fy))); place(fx, fy); app.commit(`${path}.focal`, [fx, fy], "Set focal point", { coalesce: `${path}.focal`, source: "panel" }); };
        thumb.addEventListener("click", (e) => { const r = thumb.getBoundingClientRect(); setFocal(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100); });
        thumb.addEventListener("keydown", (e) => { const step = e.shiftKey ? 10 : 2; const cur = getPath(app.draft, `${path}.focal`) || [50, 50]; const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]; if (m) { e.preventDefault(); setFocal(cur[0] + m[0], cur[1] + m[1]); } });
        const alt = h("input", { type: "text", value: v.alt ?? "", id: `f-${path}.alt`, "data-field": `${path}.alt`, placeholder: "Describe the photo for people who can't see it", oninput: () => { app.commit(`${path}.alt`, alt.value, "Edit alt text", { coalesce: `${path}.alt`, source: "panel", render: "soon" }); warn.hidden = !!alt.value.trim(); } });
        const warn = h("div.warn", { "data-alt-warning": "1", hidden: !!(v.alt || "").trim() }, h("span", { html: ico("alert", 14) }), "Alt text missing. Screen readers need a short description.");
        wrap.append(thumb,
          h("div.fld-h", "Click the photo to choose the focal point: the spot that always stays visible when the picture is cropped."),
          h("div.row.wrap", h("button.btn.small", { type: "button", onclick: () => app.pickImage(path) }, h("span", { html: ico("camera", 14) }), "Replace photo"),
            nullable ? h("button.btn.small", { type: "button", onclick: () => { app.commit(path, null, "Remove photo", { source: "panel" }); draw(); } }, "Remove") : null),
          h("label.fld.sub", h("span.fld-l", is?.properties?.alt?.title || "Alt text"), alt, h("div.fld-h", is?.properties?.alt?.description || "")),
          warn, h("div.fld-err", { "data-err-for": `${path}.alt`, role: "alert" }));
      }
      wrap.append(h("div.fld-err", { "data-err-for": path, role: "alert" }));
    };
    wrap.redraw = draw;
    draw();
    return wrap;
  }

  /* ---------- views ---------- */
  function crumbBar(path) {
    const parts = app.schemaTools.crumbs(path, app.draft);
    const bar = h("nav.crumbs", { "aria-label": "Breadcrumb" });
    bar.append(h("button.crumb", { type: "button", onclick: () => app.select(null) }, "Site"));
    parts.forEach((p, i) => {
      bar.append(h("span.sepc", { html: ico("chevron", 12) }));
      const last = i === parts.length - 1;
      bar.append(h(last ? "span.crumb.cur" : "button.crumb", last ? { "aria-current": "true" } : { type: "button", onclick: () => app.select(p.path) }, p.label));
    });
    return bar;
  }

  function selectionView(path) {
    const s = T.schemaAt(path);
    const wrap = h("div.view");
    wrap.append(crumbBar(path));
    if (!s) { wrap.append(h("div.empty", h("p", "Nothing to edit here."))); return wrap; }
    const val = getPath(app.draft, path);
    if (val === undefined) { wrap.append(h("div.empty", h("p", "This item no longer exists."), h("button.btn", { type: "button", onclick: () => app.select(null) }, "Back"))); return wrap; }
    if (s.type === "object" && !T.isImage(s)) {
      const box = h("div.group");
      fillGroup(box, s, path);
      wrap.append(h("h3.vt", s.title || "Details"), box);
    } else wrap.append(field(s, path));
    // item actions
    const m = path.match(/^(.*)\.(\d+)$/);
    if (m && Array.isArray(getPath(app.draft, m[1]))) {
      const noun = T.noun(m[1]);
      wrap.append(h("div.view-foot", h("button.btn.danger.small", { type: "button", onclick: async () => { const { deleteItem } = await import("./lists.js"); await deleteItem(app, m[1], +m[2]); } }, h("span", { html: ico("trash", 14) }), `Delete this ${noun}`)));
    }
    return wrap;
  }

  function overview() {
    const page = app.currentPage || "home";
    const wrap = h("div.view");
    wrap.append(h("div.ptitle", h("h3.vt", pageLabel(page)), h("span.muted.small", "Click anything on the page to edit it. Items you click show their hidden settings here.")));
    if (page !== "home") {
      const on = app.draft.pages?.[page]?.enabled !== false;
      const cb = h("input", { type: "checkbox", role: "switch", checked: on, "data-field": `pages.${page}.enabled`, onchange: () => app.commit(`pages.${page}.enabled`, cb.checked, `${cb.checked ? "Show" : "Hide"} ${pageLabel(page)} page`, { source: "panel", render: "now" }) });
      wrap.append(h("div.fld.inline", h("div.fld-top", h("span.fld-l", "Show this page in the menu"), h("label.switch", cb, h("span.knob")))));
    }
    for (const key of PAGE_KEYS[page] || []) {
      const s = T.schemaAt(key);
      if (!s) continue;
      wrap.append(lazySection(s.title || key, () => (s.type === "object" ? (() => { const b = h("div.group"); fillGroup(b, s, key); return b; })() : field(s, key, { title: s.title })), page === "schedule" || page === "faq"));
    }
    wrap.append(lazySection("Menu order & visibility", pagesEditor), lazySection("Site settings", () => { const s = T.schemaAt("site"); const b = h("div.group"); fillGroup(b, s, "site"); return b; }));
    return wrap;
  }
  function lazySection(title, build, open = false) {
    const d = h("details.sect", h("summary", h("span.chev", { html: ico("chevron", 14) }), title));
    const fill = () => { if (!d.dataset.f) { d.dataset.f = "1"; d.append(h("div.sbody", build())); } };
    d.addEventListener("toggle", () => { if (d.open) fill(); });
    if (open) { d.open = true; fill(); }
    return d;
  }

  function pagesEditor() {
    const wrap = h("div.pages");
    const ids = () => Object.keys(PAGE_LABEL).sort((a, b) => (app.draft.pages?.[a]?.order ?? 99) - (app.draft.pages?.[b]?.order ?? 99));
    const reorder = (from, to) => {
      const list = ids();
      const [x] = list.splice(from, 1);
      list.splice(to, 0, x);
      app.mutate((d) => { d.pages ??= {}; list.forEach((id, i) => { d.pages[id] = { ...(d.pages[id] || {}), order: i + 1 }; }); }, "Reorder pages", { source: "panel" });
      draw();
    };
    const draw = () => {
      const list = ids();
      wrap.replaceChildren(...list.map((id, i) => {
        const on = app.draft.pages?.[id]?.enabled !== false;
        const cb = h("input", { type: "checkbox", role: "switch", checked: on, disabled: id === "home", "aria-label": `Show ${pageLabel(id)}`, onchange: () => app.commit(`pages.${id}.enabled`, cb.checked, "Toggle page", { source: "panel" }) });
        const row = h("div.prow", { draggable: "true", "data-page": id }, h("span.grip", { html: ico("drag", 14) }), h("span.pname", pageLabel(id)),
          iconBtn("up", `Move ${pageLabel(id)} up`, () => reorder(i, i - 1)), iconBtn("down", `Move ${pageLabel(id)} down`, () => reorder(i, Math.min(list.length - 1, i + 1))),
          h("label.switch", cb, h("span.knob")));
        row.querySelector('button[aria-label$="up"]').disabled = i === 0;
        row.querySelector('button[aria-label$="down"]').disabled = i === list.length - 1;
        row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(i)); row.classList.add("drag"); });
        row.addEventListener("dragend", () => row.classList.remove("drag"));
        row.addEventListener("dragover", (e) => e.preventDefault());
        row.addEventListener("drop", (e) => { e.preventDefault(); const from = +e.dataTransfer.getData("text/plain"); if (!Number.isNaN(from) && from !== i) reorder(from, i); });
        return row;
      }));
    };
    draw();
    return wrap;
  }

  /* ---------- public API ---------- */
  P.render = () => {
    const scroll = body.scrollTop;
    body.replaceChildren(app.selection ? selectionView(app.selection) : overview());
    body.scrollTop = scroll;
    P.showErrors();
  };
  P.refresh = () => P.render();
  P.showErrors = () => {
    body.querySelectorAll(".fld.bad").forEach((e) => e.classList.remove("bad"));
    body.querySelectorAll("[data-err-for]").forEach((e) => { e.textContent = ""; });
    body.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
    for (const err of app.errors) {
      const el = body.querySelector(`[data-err-for="${CSS.escape(err.path)}"]`);
      if (el) { el.textContent = err.message; el.closest(".fld")?.classList.add("bad"); const inp = body.querySelector(`[data-field="${CSS.escape(err.path)}"]`); inp?.setAttribute("aria-invalid", "true"); }
    }
  };
  P.focusField = (path) => {
    const el = body.querySelector(`[data-field="${CSS.escape(path)}"]`);
    if (el) { el.scrollIntoView({ block: "center" }); el.focus(); }
  };
  P.contains = (n) => body.contains(n);
  return P;
}

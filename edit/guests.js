// Guest manager (the "Guests" tab): households, group presets, links, CSV, previews and the RSVP dashboard.
// All household data lives in draft._admin (encrypted on publish); nothing here is ever written to a public file.
import { h } from "./ui.js";
import { ico } from "./icons.js";
import * as GL from "./guestlib.js";
import { makeHousehold, seatsOf, eventSeatsOf, syncEventSeats, clampEventSeats, MAX_SEATS } from "../src/lib/guestfiles.js";
import { randomCode } from "../src/lib/crypto.js";

const clone = (x) => structuredClone(x);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const pad2 = (n) => String(n).padStart(2, "0");
const todayIso = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const withIcon = (name, text, size = 15) => [h("span.ic", { html: ico(name, size) }), text];

function download(name, data, type = "text/csv;charset=utf-8") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

let qrLib;
const loadQr = () => (qrLib ||= new Promise((res, rej) => {
  if (window.QRCode) return res();
  const s = document.createElement("script");
  s.src = "../vendor/qrcode.min.js";
  s.onload = () => res();
  s.onerror = () => { qrLib = null; rej(new Error("The QR code library didn't load.")); };
  document.head.append(s);
}));

let xlsxLib;
const loadXlsx = () => (xlsxLib ||= new Promise((res, rej) => {
  if (window.XLSX) return res(window.XLSX);
  const s = document.createElement("script");
  s.src = "../vendor/xlsx.mini.min.js";
  s.onload = () => (window.XLSX ? res(window.XLSX) : (xlsxLib = null, rej(new Error("The spreadsheet library didn't load."))));
  s.onerror = () => { xlsxLib = null; rej(new Error("The spreadsheet library didn't load.")); };
  document.head.append(s);
}));

/** Editable chips: [{key, text}] -> onChange(items). Enter or comma adds, Backspace on an empty box removes the last. */
function chipEditor({ items, label, placeholder, onChange, fieldName }) {
  const list = items.map((i) => ({ ...i }));
  const wrap = h("div.chips", { "data-field": fieldName });
  const emit = (next) => onChange(next.filter((i) => i.text.trim() !== "").map((i) => ({ ...i, text: i.text.trim() })));
  const add = h("input.chip-add", { type: "text", placeholder, "aria-label": `Add ${label}`, autocomplete: "off", spellcheck: false });
  const commitAdd = () => { const t = add.value.trim().replace(/,$/, "").trim(); if (!t) return false; add.value = ""; emit([...list, { text: t }]); return true; };
  add.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitAdd(); }
    else if (e.key === "Backspace" && !add.value && list.length) { emit(list.slice(0, -1)); }
  });
  add.addEventListener("blur", commitAdd);
  list.forEach((it, i) => {
    const input = h("input.chip-in", { type: "text", value: it.text, size: Math.max(4, Math.min(it.text.length + 1, 26)), "aria-label": `${label} name`, spellcheck: false });
    input.addEventListener("change", () => { const next = list.map((x, k) => (k === i ? { ...x, text: input.value } : x)); emit(next); });
    wrap.append(h("span.chip", input, h("button.chip-x", { type: "button", "aria-label": `Remove ${it.text}`, title: "Remove", html: ico("x", 12), onclick: () => emit(list.filter((_, k) => k !== i)) })));
  });
  wrap.append(add);
  return wrap;
}

export function mountGuests(el, api) {
  const S = { view: "households", q: "", tag: "", event: "", wave: "", side: "", selected: new Set(), summary: null, summaryState: "idle", summaryMsg: "", showKey: false, rSide: null, rTab: "waiting" };
  const app = api.app;
  let sig = "";
  let tbodyHost = null;

  const draft = () => api.getDraft();
  const admin = () => draft()._admin;
  const events = () => GL.sortEvents(draft().events);
  const households = () => admin()?.households || [];
  const presets = () => GL.getPresets(admin());
  const waves = () => admin()?.waves || [];
  const sides = () => GL.knownSides(draft(), households());
  const waveLabel = (w) => `${w.name || "Unnamed wave"}${w.sent ? "" : " (not sent)"}`;
  const signature = () => JSON.stringify([admin(), events().map((e) => [e.id, e.name, e.visibility])]);

  /* ---------- state changes ---------- */
  function setAdminField(path, value, label, coalesce) {
    api.commit(`_admin.${path}`, value, label, { render: "none", source: "guests", coalesce });
    sig = signature();
  }
  const setHouseholds = (list, label, coalesce) => setAdminField("households", list, label, coalesce);
  function editHousehold(code, fn, label, coalesce) {
    const list = clone(households());
    const hh = list.find((x) => x.code === code);
    if (!hh) return;
    fn(hh);
    setHouseholds(list, label, coalesce);
    if (hh.code) api.refreshPreview();
  }
  const nextMemberId = (hh) => `m${hh.members.reduce((a, m) => Math.max(a, +String(m.id).replace(/\D/g, "") || 0), 0) + 1}`;
  const linkFor = (hh) => GL.personalLink(draft().site, hh.code);

  async function copy(text, okMsg) {
    app.lastCopied = text;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = h("textarea", { value: text, style: "position:fixed;opacity:0" });
      document.body.append(t); t.select();
      try { document.execCommand("copy"); } catch { /* the toast still tells them */ }
      t.remove();
    }
    api.toast(okMsg);
  }
  const message = (hh, kind = "invite") => GL.waMessage(kind === "invite" ? (admin().waTemplate || GL.DEFAULT_WA_TEMPLATE) : (admin().waReminder || GL.DEFAULT_WA_REMINDER), { household: hh, link: linkFor(hh), content: draft(), waves: waves() });

  /* ---------- top-level render ---------- */
  function render() {
    sig = signature();
    if (!api.isUnlocked()) {
      el.replaceChildren(h("div.gm-locked", h("span.gm-lock", { html: ico("lock", 26) }), h("h3", "The guest list is locked"),
        h("p.muted", "Households, personal links and private events are stored encrypted. Unlock them with your guest list passphrase to see and edit them here."),
        h("button.btn.primary", { type: "button", onclick: () => api.requestUnlock() }, "Unlock guest list")));
      return;
    }
    const tabs = h("div.gm-seg", { role: "tablist", "aria-label": "Guest tools" },
      ...[["households", "Households"], ["responses", "Responses"]].map(([id, label]) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(S.view === id), onclick: () => { S.view = id; render(); } }, label)));
    el.replaceChildren(h("div.gm", tabs, S.view === "households" ? householdsView() : responsesView()));
  }

  /* ================= Households ================= */
  function filtered() {
    const q = S.q.trim().toLowerCase();
    return households().filter((hh) => {
      if (S.tag && !(hh.tags || []).includes(S.tag)) return false;
      if (S.event && !(hh.eventIds || []).includes(S.event)) return false;
      if (S.side && (S.side === "none" ? !!hh.side : GL.sideKey(hh.side) !== GL.sideKey(S.side))) return false;
      if (S.wave && (S.wave === "none" ? waves().some((w) => w.id === hh.wave) : hh.wave !== S.wave)) return false;
      if (q && !(`${hh.household} ${(hh.members || []).map((m) => m.name).join(" ")} ${(hh.tags || []).join(" ")} ${hh.side || ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function householdsView() {
    const evs = events();
    const tags = [...new Set(households().flatMap((x) => x.tags || []))].sort();
    const people = households().reduce((n, x) => n + seatsOf(x), 0);

    const search = h("input.gm-search", { type: "search", placeholder: "Search names, groups…", "aria-label": "Search households", value: S.q, autocomplete: "off" });
    search.addEventListener("input", () => { S.q = search.value; renderTable(); });
    const tagSel = h("select", { "aria-label": "Filter by group" }, h("option", { value: "" }, "All groups"), tags.map((t) => h("option", { value: t, selected: S.tag === t }, t)));
    tagSel.addEventListener("change", () => { S.tag = tagSel.value; renderTable(); });
    const evSel = h("select", { "aria-label": "Filter by event" }, h("option", { value: "" }, "All events"), evs.map((e) => h("option", { value: e.id, selected: S.event === e.id }, `Invited to ${e.name || e.id}`)));
    evSel.addEventListener("change", () => { S.event = evSel.value; renderTable(); });
    const sideSel = h("select", { "aria-label": "Filter by side" }, h("option", { value: "" }, "Both sides"),
      sides().map((sd) => h("option", { value: sd, selected: S.side === sd }, GL.sideLabel(sd))), h("option", { value: "none", selected: S.side === "none" }, "No side"));
    sideSel.addEventListener("change", () => { S.side = sideSel.value; renderTable(); });
    if (S.wave && S.wave !== "none" && !waves().some((w) => w.id === S.wave)) S.wave = "";
    const waveSel = waves().length ? h("select", { "aria-label": "Filter by wave" }, h("option", { value: "" }, "All waves"),
      waves().map((w) => h("option", { value: w.id, selected: S.wave === w.id }, waveLabel(w))), h("option", { value: "none", selected: S.wave === "none" }, "No wave")) : null;
    waveSel?.addEventListener("change", () => { S.wave = waveSel.value; renderTable(); });

    const presetBar = h("div.gm-presets", { role: "group", "aria-label": "Group presets" });
    const renderPresets = () => {
      const n = S.selected.size;
      presetBar.replaceChildren(
        h("span.gm-lab", n ? `Apply to ${plural(n, "ticked household")}:` : "Tick households, then apply a group:"),
        ...presets().map((p) => {
          const ids = GL.presetEventIds(p, evs);
          const names = p.eventIds.includes("*") ? "all events" : ids.map((id) => evs.find((e) => e.id === id)?.name || id).join(" + ") || "no events";
          return h("button.preset", { type: "button", disabled: !n, title: `${p.name} = ${names}`, "data-preset": p.id, onclick: () => applyPreset(p) }, h("strong", p.name), h("small", names));
        }),
        h("button.btn.small", { type: "button", onclick: editPresets }, "Edit groups…"),
        ...(waves().length ? [h("span.gm-lab.gm-wlab", n ? "Move them to:" : "Waves:"),
          ...waves().map((w) => h("button.preset", { type: "button", disabled: !n, "data-wave": w.id, title: `Reply by ${GL.deadlineWords(w.deadline) || "(no date yet)"}`, onclick: () => setWave(w) },
            h("strong", w.name || "Unnamed wave"), h("small", `${w.deadline ? `by ${GL.deadlineWords(w.deadline)}` : "no date yet"}${w.sent ? "" : " · not sent"}`))),
          h("button.preset", { type: "button", disabled: !n, "data-wave": "", onclick: () => setWave(null) }, h("strong", "No wave"), h("small", "site-wide date"))] : []));
    };
    S.renderPresets = renderPresets;
    renderPresets();

    const count = h("span.gm-count", { "aria-live": "polite" });
    S.updateCount = () => { count.textContent = `${filtered().length} of ${plural(households().length, "household")} · ${plural(people, "guest")}`; };

    const actions = h("div.gm-actions",
      h("button.btn.primary.small", { type: "button", id: "gm-add", onclick: addHousehold }, withIcon("plus", "Add household")),
      h("button.btn.small", { type: "button", onclick: importCsv }, withIcon("upload", "Import CSV / Excel")),
      h("button.btn.small", { type: "button", onclick: downloadExcelDialog }, withIcon("download", "Download Excel")),
      h("button.btn.small", { type: "button", onclick: exportCsv }, withIcon("download", "Export CSV")),
      h("button.btn.small", { type: "button", onclick: editWaves }, withIcon("users", "Waves")),
      h("button.btn.small", { type: "button", onclick: editTemplates }, withIcon("chat", "Message text")),
      count);

    tbodyHost = h("div.gm-tablewrap");
    const view = h("div.gm-view", h("div.gm-filters", search, sideSel, tagSel, evSel, waveSel), presetBar, actions, tbodyHost);
    renderTable();
    return view;
  }

  function renderTable() {
    const evs = events();
    const rows = filtered();
    S.updateCount?.();
    S.renderPresets?.();
    if (!households().length) {
      tbodyHost.replaceChildren(h("div.empty", h("p", h("strong", "No households yet")), h("p.muted", "Add a household, or import your list from a spreadsheet (Excel template, then Import CSV / Excel). Each household gets its own private link."),
        h("button.btn.primary", { type: "button", onclick: addHousehold }, "Add the first household")));
      return;
    }
    if (!rows.length) { tbodyHost.replaceChildren(h("div.empty", h("p.muted", "No households match your search."))); return; }
    const allOn = rows.every((r) => S.selected.has(r.code));
    const selAll = h("input", { type: "checkbox", checked: allOn, "aria-label": "Select all shown households" });
    selAll.addEventListener("change", () => { rows.forEach((r) => (selAll.checked ? S.selected.add(r.code) : S.selected.delete(r.code))); renderTable(); });
    const head = h("tr", h("th.c-sel", selAll), h("th.c-name", "Household"), h("th.c-mem", { title: "Optional: used for name lookup" }, "Names (optional)"), h("th.c-side", { title: "Whose list this household is on" }, "Side"), h("th.c-tags", "Groups"),
      waves().length ? h("th.c-wave", { title: "Which invitation wave this household is in. It sets their reply-by date." }, "Wave") : null,
      ...evs.map((e) => h("th.c-ev", { title: `How many people are invited to ${e.name || e.id}. 0 means not invited.${e.visibility === "private" ? " (private)" : ""}` }, h("span", e.name || e.id), e.visibility === "private" ? h("small", "private") : null)));
    const table = h("table.gm-table", { "aria-label": "Households" }, h("thead", head), h("tbody", rows.map((hh) => row(hh, evs))));
    tbodyHost.replaceChildren(table);
    if (S.refocus) {
      const { code, field } = S.refocus;
      S.refocus = null;
      table.querySelector(`tr[data-code="${code}"] ${field}`)?.focus();
    }
  }

  function row(hh, evs) {
    const sel = h("input", { type: "checkbox", checked: S.selected.has(hh.code), "aria-label": `Select ${hh.household || "new household"}` });
    sel.addEventListener("change", () => { sel.checked ? S.selected.add(hh.code) : S.selected.delete(hh.code); S.renderPresets(); });
    const name = h("input.gm-in", { type: "text", value: hh.household, placeholder: "Household name", "aria-label": "Household name", autocomplete: "off" });
    name.addEventListener("change", () => editHousehold(hh.code, (x) => {
      const auto = !x.greeting || x.greeting === `Dear ${x.household}`;
      x.household = name.value.trim();
      if (auto) x.greeting = x.household ? `Dear ${x.household}` : "";
    }, "Rename household", `hh-${hh.code}-name`));
    const label = hh.household || "this household";
    const act = (icon, title, fn, cls = "") => h(`button.ibtn${cls}`, { type: "button", title: `${title}`, "aria-label": `${title} for ${label}`, html: ico(icon, 16), onclick: fn });
    const acts = h("div.gm-acts",
      act("link", "Copy link", () => copy(linkFor(hh), `Link for ${label} copied`)),
      act("chat", "Copy WhatsApp message", () => copy(message(hh), `Message for ${label} copied. Paste it into WhatsApp.`)),
      act("qr", "QR code", () => showQr(hh)),
      act("eye", "Preview as", () => api.previewAs(hh.code)),
      act("trash", "Delete", () => removeHousehold(hh), ".danger"));
    const members = chipEditor({
      label: "name", placeholder: hh.members.length ? "Add name" : "Optional names", fieldName: "members",
      items: hh.members.map((m) => ({ key: m.id, text: m.name })),
      onChange: (items) => { S.refocus = { code: hh.code, field: ".chip-add" }; editHousehold(hh.code, (x) => { let n = nextMemberId(x); const used = new Set(); x.members = items.map((i) => { const id = i.key && !used.has(i.key) ? i.key : `m${n++}`; used.add(id); return { id, name: i.text }; }); }, "Edit guests"); renderTable(); },
    });
    const tagsEd = chipEditor({
      label: "group", placeholder: "Add group", fieldName: "tags",
      items: (hh.tags || []).map((t) => ({ key: t, text: t })),
      onChange: (items) => { S.refocus = { code: hh.code, field: '[data-field="tags"] .chip-add' }; editHousehold(hh.code, (x) => { x.tags = [...new Set(items.map((i) => GL.slug(i.text)).filter(Boolean))]; }, "Edit groups"); renderTable(); },
    });
    const seats = evs.map((e) => {
      const n = eventSeatsOf(hh, e.id);
      const input = h("input.gm-in.num", { type: "number", min: 0, max: MAX_SEATS, value: n, "aria-label": `${label}: guests invited to ${e.name || e.id}` });
      input.addEventListener("change", () => editHousehold(hh.code, (x) => {
        if (!x.eventSeats) x.eventSeats = Object.fromEntries((x.eventIds || []).map((id) => [id, seatsOf(x)]));
        const v = clampEventSeats(input.value);
        if (v > 0) x.eventSeats[e.id] = v; else delete x.eventSeats[e.id];
        syncEventSeats(x);
        input.value = eventSeatsOf(x, e.id);
      }, "Change invitations", `hh-${hh.code}-ev-${e.id}`));
      return h("td.c-ev", input);
    });
    const sideIn = h("select.gm-in", { "aria-label": `${label}: side`, "data-field": "side" }, h("option", { value: "" }, "No side"),
      sides().map((sd) => h("option", { value: sd, selected: GL.sideKey(hh.side) === GL.sideKey(sd) && !!hh.side }, sd)));
    sideIn.addEventListener("change", () => { editHousehold(hh.code, (x) => { if (sideIn.value) x.side = sideIn.value; else delete x.side; }, "Change side"); });
    let waveCell = null;
    if (waves().length) {
      const ws = h("select.gm-in", { "aria-label": `${label}: wave`, "data-field": "wave" }, h("option", { value: "" }, "No wave"),
        waves().map((w) => h("option", { value: w.id, selected: hh.wave === w.id }, waveLabel(w))));
      ws.addEventListener("change", () => { editHousehold(hh.code, (x) => { if (ws.value) x.wave = ws.value; else delete x.wave; }, "Change wave"); });
      waveCell = h("td.c-wave", ws);
    }
    return h("tr", { "data-code": hh.code }, h("td.c-sel", sel), h("td.c-name", name, acts), h("td.c-mem", members), h("td.c-side", sideIn), h("td.c-tags", tagsEd), waveCell, ...seats);
  }

  /* ---------- household actions ---------- */
  function addHousehold() {
    const keepSide = S.side && S.side !== "none" ? S.side : "";
    S.q = ""; S.tag = ""; S.event = ""; S.wave = "";
    const list = clone(households());
    const hh = makeHousehold({ id: `hh-${randomCode(6).toLowerCase()}`, household: "New household", members: [], seats: 2, eventIds: [], eventSeats: {} }, new Set(list.map((x) => x.code)));
    hh.household = ""; hh.greeting = "";
    if (keepSide) hh.side = keepSide;
    list.push(hh);
    setHouseholds(list, "Add household");
    if (S.view !== "households") { S.view = "households"; }
    render();
    const input = el.querySelector(`tr[data-code="${hh.code}"] .gm-in`);
    input?.scrollIntoView({ block: "center" });
    input?.focus();
  }

  async function removeHousehold(hh) {
    const ok = await api.confirm({ title: "Delete this household?", message: `${hh.household || "This household"} will be removed from the guest list. Their personal link stops working once you publish. Any RSVP they already sent stays in your Google Sheet.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    S.selected.delete(hh.code);
    setHouseholds(households().filter((x) => x.code !== hh.code), `Delete ${hh.household || "household"}`);
    renderTable();
    api.refreshPreview();
  }

  function applyPreset(p) {
    const evs = events();
    const codes = [...S.selected].filter((c) => households().some((x) => x.code === c));
    if (!codes.length) return;
    const ids = GL.presetEventIds(p, evs);
    const list = clone(households());
    for (const hh of list) if (codes.includes(hh.code)) {
      const keep = {};
      for (const [id, n] of Object.entries(hh.eventSeats || Object.fromEntries((hh.eventIds || []).map((eid) => [eid, seatsOf(hh)])))) {
        if (!evs.some((e) => e.id === id)) keep[id] = n;
      }
      const fill = seatsOf(hh) || 2;
      for (const id of ids) keep[id] = keep[id] || fill;
      hh.eventSeats = keep;
      syncEventSeats(hh);
      if (p.tag && !(hh.tags || []).includes(p.tag)) hh.tags = [...(hh.tags || []), p.tag];
    }
    setHouseholds(list, `Apply "${p.name}" to ${plural(codes.length, "household")}`);
    renderTable();
    api.refreshPreview();
    api.toast(`"${p.name}" applied to ${plural(codes.length, "household")}`);
  }

  function setWave(w) {
    const codes = [...S.selected].filter((c) => households().some((x) => x.code === c));
    if (!codes.length) return;
    const list = clone(households());
    for (const hh of list) if (codes.includes(hh.code)) { if (w) hh.wave = w.id; else delete hh.wave; }
    setHouseholds(list, `Move ${plural(codes.length, "household")} to ${w ? w.name || "a wave" : "no wave"}`);
    renderTable();
    api.refreshPreview();
    api.toast(`${plural(codes.length, "household")} moved to ${w ? w.name || "the wave" : "no wave"}`);
  }

  /* ---------- dialogs ---------- */
  function editWaves() {
    let list = clone(waves());
    const box = h("div.gm-pe");
    const redraw = () => {
      box.replaceChildren(
        h("p.dlg-msg", "Send invitations in rounds. Each wave has its own reply-by date, and the households in it see only that date, never the wave's name. Households with no wave use the date in the RSVP settings."),
        h("p.dlg-note", "Until a wave is marked sent, its households are left out when you publish, so their links and name search don't work yet. Tick it and publish just before you send their messages."),
        ...list.map((w, i) => {
          const name = h("input", { type: "text", value: w.name, placeholder: "For example: Close family", "aria-label": "Wave name" });
          name.addEventListener("input", () => { w.name = name.value; });
          const date = h("input.gm-in", { type: "date", value: w.deadline || "", "aria-label": `${w.name || "Wave"}: reply by` });
          date.addEventListener("input", () => { w.deadline = date.value; });
          const sent = h("input", { type: "checkbox", checked: !!w.sent, "aria-label": `${w.name || "Wave"}: invitations sent` });
          sent.addEventListener("change", () => { w.sent = sent.checked; if (w.sent) w.sentOn = todayIso(); else delete w.sentOn; });
          const n = households().filter((hh) => hh.wave === w.id).length;
          return h("fieldset.gm-pset", { "data-wave": w.id },
            h("div.gm-prow", name, h("button.ibtn.danger", { type: "button", title: "Remove wave", "aria-label": `Remove ${w.name || "wave"}`, html: ico("trash", 16), onclick: () => { list.splice(i, 1); redraw(); } })),
            h("div.gm-pev", h("label.gm-chk", "Reply by", date), h("label.gm-chk", sent, "Invitations sent (links work)"), h("small.muted", plural(n, "household"))));
        }),
        h("button.btn.small", { type: "button", onclick: () => { list.push({ id: `w-${randomCode(6).toLowerCase()}`, name: `Wave ${list.length + 1}`, deadline: "", sent: false }); redraw(); box.querySelector("fieldset:last-of-type input")?.select(); } }, withIcon("plus", "Add wave")));
    };
    redraw();
    api.dialog({
      title: "Invitation waves", body: box, wide: true,
      actions: [{ label: "Cancel", value: false }, {
        label: "Save waves", primary: true, keepOpen: true,
        onClick: (close) => {
          const clean = list.map((w) => ({ id: w.id, name: String(w.name || "").trim() || "Unnamed wave", deadline: w.deadline || "", sent: !!w.sent, ...(w.sent && w.sentOn ? { sentOn: w.sentOn } : {}) }));
          const ids = new Set(clean.map((w) => w.id));
          setAdminField("waves", clean.length ? clean : undefined, "Edit waves");
          if (households().some((hh) => hh.wave && !ids.has(hh.wave))) setHouseholds(households().map((hh) => { if (!hh.wave || ids.has(hh.wave)) return hh; const x = clone(hh); delete x.wave; return x; }), "Edit waves");
          close(true);
          render();
          api.refreshPreview();
        },
      }],
    });
  }

  function editPresets() {
    const evs = events();
    let list = clone(presets());
    const box = h("div.gm-pe");
    const redraw = () => {
      box.replaceChildren(h("p.dlg-msg", "A group sets which events a household is invited to. Tick households in the table, then press a group to apply it."),
        ...list.map((p, i) => {
          const all = p.eventIds.includes("*");
          const name = h("input", { type: "text", value: p.name, "aria-label": "Group name" });
          name.addEventListener("input", () => { p.name = name.value; p.tag = GL.slug(p.name); p.id = p.tag || p.id; });
          const allBox = h("input", { type: "checkbox", checked: all, "aria-label": `${p.name || "Group"}: all events` });
          allBox.addEventListener("change", () => { p.eventIds = allBox.checked ? ["*"] : evs.map((e) => e.id); redraw(); });
          return h("fieldset.gm-pset", h("div.gm-prow", name, h("button.ibtn.danger", { type: "button", title: "Remove group", "aria-label": `Remove ${p.name}`, html: ico("trash", 16), onclick: () => { list.splice(i, 1); redraw(); } })),
            h("div.gm-pev", h("label.gm-chk", allBox, "All events"),
              ...evs.map((e) => {
                const c = h("input", { type: "checkbox", checked: all || p.eventIds.includes(e.id), disabled: all, "aria-label": `${p.name || "Group"}: ${e.name || e.id}` });
                c.addEventListener("change", () => { p.eventIds = c.checked ? [...new Set([...p.eventIds, e.id])] : p.eventIds.filter((x) => x !== e.id); });
                return h("label.gm-chk", c, e.name || e.id);
              })));
        }),
        h("button.btn.small", { type: "button", onclick: () => { list.push({ id: `group-${list.length + 1}`, name: "", tag: "", eventIds: [] }); redraw(); box.querySelector("fieldset:last-of-type input")?.focus(); } }, withIcon("plus", "Add group")));
    };
    redraw();
    api.dialog({
      title: "Edit groups", body: box, wide: true,
      actions: [{ label: "Cancel", value: false }, {
        label: "Save groups", primary: true, keepOpen: true,
        onClick: (close) => {
          const clean = list.filter((p) => p.name.trim()).map((p) => ({ id: p.id || GL.slug(p.name), name: p.name.trim(), tag: GL.slug(p.name), eventIds: p.eventIds }));
          setAdminField("presets", clean, "Edit groups");
          close(true);
          renderTable();
        },
      }],
    });
  }

  function editTemplates() {
    const inv = h("textarea", { rows: 7, "aria-label": "Invitation message", value: admin().waTemplate || GL.DEFAULT_WA_TEMPLATE });
    const rem = h("textarea", { rows: 6, "aria-label": "Reminder message", value: admin().waReminder || GL.DEFAULT_WA_REMINDER });
    const sample = households()[0];
    const preview = h("pre.gm-pre");
    const upd = () => { preview.textContent = sample ? GL.waMessage(inv.value, { household: sample, link: linkFor(sample), content: draft(), waves: waves() }) : ""; };
    inv.addEventListener("input", upd); upd();
    api.dialog({
      title: "WhatsApp message text", wide: true,
      body: h("div.gm-tpl",
        h("p.dlg-msg", "This is the text copied by the speech-bubble button next to each household. These words are replaced for each household:"),
        h("p.gm-tokens", ...["{greeting}", "{link}", "{couple}", "{household}", "{deadline}"].map((t) => h("code", t))),
        h("label.gm-l", "Invitation message", inv),
        sample ? h("div", h("span.gm-lab", `How it looks for ${sample.household || "the first household"}`), preview) : null,
        h("label.gm-l", "Reminder message (for people who haven't replied)", rem)),
      actions: [
        { label: "Cancel", value: false },
        { label: "Reset to default", keepOpen: true, onClick: () => { inv.value = GL.DEFAULT_WA_TEMPLATE; rem.value = GL.DEFAULT_WA_REMINDER; upd(); } },
        { label: "Save", primary: true, keepOpen: true, onClick: (close) => { setAdminField("waTemplate", inv.value.trim() || undefined, "Edit message text"); setAdminField("waReminder", rem.value.trim() || undefined, "Edit message text"); close(true); api.toast("Message text saved"); } },
      ],
    });
  }

  async function showQr(hh) {
    const link = linkFor(hh);
    const holder = h("div.gm-qr", { "aria-label": `QR code for ${hh.household}` });
    const note = h("p.dlg-note");
    const body = h("div.gm-qrbox", holder, h("p.gm-qrlink", link), note);
    if (!draft().site?.siteUrl) body.append(h("p.dlg-note", "Tip: set the website address in Site settings so these codes point at the live site."));
    let canvas = null;
    api.dialog({
      title: `QR code · ${hh.household || "household"}`, body,
      actions: [{ label: "Close", value: false }, { label: "Download PNG", primary: true, keepOpen: true, onClick: () => {
        if (!canvas) return;
        const a = h("a", { href: canvas.toDataURL("image/png"), download: `qr-${GL.slug(hh.household) || hh.code}.png` });
        document.body.append(a); a.click(); a.remove();
      } }],
    });
    try {
      await loadQr();
      new window.QRCode(holder, { text: link, width: 512, height: 512, colorDark: "#2f3a26", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
      canvas = holder.querySelector("canvas");
      holder.querySelector("img")?.setAttribute("alt", `QR code that opens ${link}`);
    } catch (e) { note.textContent = e.message; note.className = "dlg-note err"; }
  }

  function exportCsv() {
    download("households.csv", GL.exportHouseholdsCsv(households(), events(), linkFor, waves()));
    api.toast("Exported households with their personal links");
  }

  /* ---------- Excel: download a side's own list (or a blank template), edit it, upload it again ---------- */
  const SIDE_PREF = "pa.editor.side"; // this device's usual side (the bride's laptop vs the groom's), remembered locally
  const prefSide = () => { try { return localStorage.getItem(SIDE_PREF) || ""; } catch { return ""; } };
  const savePrefSide = (s) => { try { localStorage.setItem(SIDE_PREF, s); } catch { /* fine without it */ } };
  const onSide = (s) => households().filter((hh) => GL.sideKey(hh.side) === GL.sideKey(s));

  async function writeWorkbook(grid, filename, guide) {
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(grid);
    ws["!cols"] = grid[0].map((head, i) => ({ wch: Math.min(48, Math.max(String(head).length + 2, ...grid.slice(1).map((r) => String(r[i] ?? "").length + 1), 8)) }));
    XLSX.utils.book_append_sheet(wb, ws, "Households");
    const g = XLSX.utils.aoa_to_sheet(guide);
    g["!cols"] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, g, "How to fill");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    download(filename, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  function downloadExcelDialog() {
    const evs = events(), sd = sides();
    const guide = GL.householdsGuideGrid(evs, presets(), { waves: waves(), sides: sd });
    const choices = [
      ...sd.map((s) => ({ id: `side:${s}`, label: `${GL.sideLabel(s)} list`, note: plural(onSide(s).length, "household"), list: () => onSide(s), file: `guest-list-${GL.slug(s)}.xlsx` })),
      ...(households().some((hh) => !hh.side) ? [{ id: "noside", label: "Households with no side", note: plural(households().filter((hh) => !hh.side).length, "household"), list: () => households().filter((hh) => !hh.side), file: "guest-list-no-side.xlsx" }] : []),
      { id: "all", label: "Everyone", note: plural(households().length, "household"), list: () => households(), file: "guest-list-everyone.xlsx" },
      { id: "blank", label: "Blank template", note: "two example rows", list: null, file: "households-template.xlsx" },
    ];
    const pref = prefSide();
    let pick = choices.find((c) => c.id === `side:${pref}`)?.id || choices[0].id;
    const box = h("div.gm-dl", { role: "radiogroup", "aria-label": "Which list" },
      h("p.dlg-msg", "Download a list, edit it in Excel (add rows, change names or numbers), then upload it with Import CSV / Excel. Each row keeps its personal link."),
      ...choices.map((c) => {
        const r = h("input", { type: "radio", name: "gm-dl", value: c.id, checked: c.id === pick });
        r.addEventListener("change", () => { pick = c.id; });
        return h("label.gm-opt", r, h("span", h("strong", c.label), h("small.muted", ` ${c.note}`)));
      }));
    api.dialog({
      title: "Download Excel", body: box,
      actions: [{ label: "Cancel", value: false }, { label: "Download", primary: true, keepOpen: true, onClick: async (close) => {
        const c = choices.find((x) => x.id === pick);
        try {
          const grid = c.list ? GL.householdsTemplateGrid(evs, { households: c.list(), waves: waves(), linkFor }) : GL.householdsTemplateGrid(evs, { sides: sd });
          await writeWorkbook(grid, c.file, guide);
          if (c.id.startsWith("side:")) savePrefSide(c.id.slice(5));
          close(true);
          api.toast(`Downloaded ${c.file}`);
        } catch (e) { api.toast(e.message || "Couldn't build the Excel file", { ms: 5000 }); }
      } }],
    });
  }

  function importCsv() {
    const evs = events(), sd = sides();
    const opt = { side: sd.find((s) => s === prefSide()) || "", mode: "merge", wave: "" };
    const unsent = waves().filter((w) => !w.sent);
    opt.wave = unsent.length ? unsent[unsent.length - 1].id : "";
    let csvRows = null, parsed = null, applyBtn = null, ack = false;

    const text = h("textarea", { rows: 4, placeholder: "household,guests,members,tags,events\nSharma Family,4,Raj Sharma; Priya Sharma,close-family,all", "aria-label": "Paste CSV text", spellcheck: false });
    const file = h("input", { type: "file", accept: ".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "aria-label": "Choose a CSV or Excel file" });
    const out = h("div.gm-prev", { "aria-live": "polite" });

    const sideSel = h("select.gm-in", { "aria-label": "Whose list is this?" },
      h("option", { value: "" }, "Mixed: use the side column"), sd.map((s) => h("option", { value: s, selected: opt.side === s }, `${GL.sideLabel(s)} list`)));
    const modeBox = h("div.gm-modes", { role: "radiogroup", "aria-label": "What should the import do?" });
    const waveSel = h("select.gm-in", { "aria-label": "New households go to" },
      h("option", { value: "" }, "No wave (live when you publish)"), waves().map((w) => h("option", { value: w.id, selected: opt.wave === w.id }, `${w.name}${w.sent ? "" : " (not sent: held back)"}`)));
    const drawModes = () => {
      const who = opt.side ? `${GL.sideLabel(opt.side)}` : "a side";
      modeBox.replaceChildren(...[
        ["merge", "Add and update", "New rows are added, matching households are updated. Nobody is removed."],
        ["replace", `Replace ${who} list`, opt.side ? `Also removes ${GL.sideLabel(opt.side)} households that aren't in this file. The other side's list is never touched.` : "Pick whose list this is first."],
      ].map(([id, label, note]) => {
        const r = h("input", { type: "radio", name: "gm-mode", value: id, checked: opt.mode === id, disabled: id === "replace" && !opt.side });
        r.addEventListener("change", () => { opt.mode = id; refresh(); });
        return h("label.gm-opt", r, h("span", h("strong", label), h("small.muted", ` ${note}`)));
      }));
    };
    sideSel.addEventListener("change", () => { opt.side = sideSel.value; if (!opt.side) opt.mode = "merge"; else savePrefSide(opt.side); drawModes(); refresh(); });
    waveSel.addEventListener("change", () => { opt.wave = waveSel.value; refresh(); });
    drawModes();

    const setBtn = (label, on) => { if (applyBtn) { applyBtn.textContent = label; applyBtn.disabled = !on; } };
    function refresh() {
      parsed = null; ack = false;
      if (!csvRows?.length) {
        out.replaceChildren(h("p.muted", "Choose your Excel file (the one from Download Excel works best), or paste CSV text."));
        return setBtn("Import", false);
      }
      parsed = GL.importRows(csvRows, { events: evs, presets: presets(), existing: households(), waves: waves(), side: opt.side, mode: opt.mode, defaultWave: opt.wave, sides: sd });
      if (parsed.headerErrors.length) { out.replaceChildren(h("p.dlg-note.err", parsed.headerErrors.join(" "))); parsed = null; return setBtn("Nothing to import", false); }
      const by = (a) => parsed.rows.filter((r) => r.action === a);
      const adds = by("add"), ups = by("update"), same = by("same"), bad = by("error"), rem = parsed.removals;
      const liveRem = rem.filter((r) => r.live);
      const waveName = (id) => waves().find((w) => w.id === id)?.name || "";
      const bits = [adds.length && `${plural(adds.length, "household")} to add`, ups.length && `${ups.length} to update`, same.length && `${same.length} unchanged`, rem.length && `${rem.length} to remove`].filter(Boolean);
      const rowEl = (r) => h("tr", { "data-action": r.action },
        h("td", String(r.line)), h("td", r.data.household || "—", r.data.side ? h("small.muted", ` ${GL.sideLabel(r.data.side)}`) : null),
        h("td", [String(r.data.seats), r.data.members.length ? h("small.muted", ` ${r.data.members.join(", ")}`) : null]),
        h("td", r.data.eventIds.map((id) => `${evs.find((e) => e.id === id)?.name || id} ${r.data.eventSeats?.[id] ?? ""}`.trim()).join(", ") || "none", r.data.wave ? h("small.muted", ` · ${waveName(r.data.wave)}`) : null),
        h("td", r.action === "error" ? h("span.err", r.errors.join("; "))
          : [h("span.pill", { "data-kind": r.action }, { add: "New", update: "Update", same: "No change" }[r.action]), r.changes.length ? h("small", ` ${r.changes.join(" · ")}`) : null, ...r.warnings.map((w) => h("span.warnt", ` ${w}`))]));
      const shown = [...bad, ...adds, ...ups];
      const ackBox = liveRem.length ? h("label.gm-ack", (() => { const c = h("input", { type: "checkbox" }); c.addEventListener("change", () => { ack = c.checked; label(); }); return c; })(),
        ` I understand: ${plural(liveRem.length, "household")} may already have their link, and it stops working once I publish.`) : null;
      out.replaceChildren(...[
        h("p.gm-sum", bits.join(", ") || "Nothing to change", bad.length ? ", " : "", bad.length ? h("strong.err", `${plural(bad.length, "row")} with problems (skipped)`) : null),
        h("div.gm-tablewrap.short", h("table.gm-table.prev", h("thead", h("tr", ...["Row", "Household", "Guests", "Events", "Result"].map((t) => h("th", t)))),
          h("tbody", shown.map(rowEl),
            rem.map((x) => h("tr", { "data-action": "remove" }, h("td", "—"), h("td", x.household), h("td", ""), h("td", ""), h("td", h("span.pill", { "data-kind": "remove" }, "Remove"), h("small", x.live ? " Its link may already be sent" : " Never sent")))),
            same.length ? h("tr.gm-same", h("td", { colspan: 5 }, h("small.muted", `${plural(same.length, "household")} unchanged: ${same.map((r) => r.data.household).join(", ")}`))) : null))),
        opt.wave && adds.length ? h("p.dlg-note", `New households go to ${waveName(opt.wave)}${waves().find((w) => w.id === opt.wave)?.sent ? "." : ", which isn't sent: they stay off the live site until you mark it sent."}`) : null,
        ackBox].filter(Boolean));
      label();
      function label() {
        const n = adds.length + ups.length;
        if (!n && !rem.length) return setBtn("Nothing to import", false);
        setBtn(`Import ${plural(n, "household")}${rem.length ? ` and remove ${rem.length}` : ""}`, !liveRem.length || ack);
      }
    }

    text.addEventListener("input", () => { csvRows = text.value.trim() ? GL.parseCsv(text.value) : null; refresh(); });
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      const isXlsx = /\.xlsx$/i.test(f.name) || /spreadsheetml|excel|officedocument/.test(f.type);
      try {
        if (isXlsx) {
          const XLSX = await loadXlsx();
          const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
          const sheetName = wb.SheetNames.includes("Households") ? "Households" : wb.SheetNames[0];
          const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false });
          const adapted = GL.sheetToImportRows(grid, { events: evs });
          if (adapted.headerErrors.length) { csvRows = null; out.replaceChildren(h("p.dlg-note.err", adapted.headerErrors.join(" "))); text.value = ""; return setBtn("Nothing to import", false); }
          csvRows = adapted.rows;
          text.value = GL.toCsv(adapted.rows).trimEnd();
        } else {
          text.value = await f.text();
          csvRows = GL.parseCsv(text.value);
        }
        // A file named after a side (guest-list-aman.xlsx) picks that side when none is chosen yet.
        const named = !opt.side && sd.find((s) => GL.sideKey(f.name).split(" ").includes(GL.sideKey(s)));
        if (named) { opt.side = named; sideSel.value = named; drawModes(); }
        refresh();
      } catch (e) {
        csvRows = null;
        out.replaceChildren(h("p.dlg-note.err", e.message || "Couldn't read that file."));
        setBtn("Nothing to import", false);
      }
    });

    api.dialog({
      title: "Import households from Excel or CSV", wide: true,
      body: h("div.gm-imp",
        h("div.gm-impopts",
          h("label.gm-l", "Whose list is this?", sideSel),
          waves().length ? h("label.gm-l", "New households go to", waveSel) : null),
        modeBox,
        h("div.row", file, h("button.link", { type: "button", onclick: downloadExcelDialog }, "Download Excel")),
        h("details.gm-paste", h("summary", "Or paste CSV text"), text),
        out),
      actions: [{ label: "Cancel", value: false }, { label: "Import", primary: true, keepOpen: true, onClick: (close) => {
        if (!parsed) return;
        const good = parsed.rows.filter((r) => r.action === "add" || r.action === "update");
        if (!good.length && !parsed.removals.length) return;
        const n = good.length, m = parsed.removals.length;
        for (const x of parsed.removals) S.selected.delete(x.code);
        setHouseholds(GL.applyImport(households(), good, { removals: parsed.removals }), `Import ${plural(n, "household")}${m ? `, remove ${m}` : ""}`);
        close(true); render(); api.refreshPreview();
        api.toast(`Imported ${plural(n, "household")}${m ? ` and removed ${m}` : ""}. Publish when you're ready.`);
      } }],
      onOpen: () => { applyBtn = [...document.querySelectorAll("dialog.dlg .dlg-f .btn")].find((b) => /^Import/.test(b.textContent)); refresh(); },
    });
  }

  /* ================= Responses ================= */
  const endpoint = () => (draft().site?.rsvpEndpoint || "").trim();

  async function fetchSummary() {
    const url = endpoint();
    if (!url) { S.summaryState = "idle"; render(); return; }
    S.summaryState = "loading"; render();
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${sep}action=summary&key=${encodeURIComponent(admin().rsvpAdminKey || "")}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) { S.summaryState = "badkey"; S.summary = null; }
      else { S.summary = j; S.summaryState = "ready"; S.fetchedAt = new Date(); }
    } catch {
      S.summaryState = "error"; S.summary = null;
    }
    render();
  }

  function keyCard() {
    const key = admin().rsvpAdminKey || "";
    const shown = S.showKey ? key : key ? `${"•".repeat(12)}${key.slice(-4)}` : "(none yet)";
    return h("details.gm-card", { open: S.summaryState !== "ready" },
      h("summary", "RSVP connection and admin key"),
      h("div.gm-cardb",
        h("p.muted", "This key lets only you read the replies from your Google Sheet. It has to be saved in two places: here (it is stored encrypted when you publish) and in your Google Apps Script."),
        h("p.gm-keyline", h("code.gm-key", { "data-testid": "admin-key" }, shown),
          h("button.btn.small", { type: "button", onclick: () => { S.showKey = !S.showKey; render(); } }, S.showKey ? "Hide" : "Show"),
          h("button.btn.small", { type: "button", disabled: !key, onclick: () => copy(key, "Admin key copied") }, "Copy key"),
          h("button.btn.small", { type: "button", onclick: generateKey }, "Generate admin key")),
        h("ol.gm-steps",
          h("li", "Press Copy key."),
          h("li", "Open your Google Sheet, then Extensions, then Apps Script."),
          h("li", "Open Project Settings (the gear), scroll to Script properties, and add one named ", h("code", "ADMIN_KEY"), " with the key as its value. Save."),
          h("li", "Come back here and press Publish so the key is saved, then Refresh responses.")),
        h("p.muted", endpoint() ? h("span", "Reading replies from ", h("code", endpoint().replace(/^https?:\/\//, "").slice(0, 46) + (endpoint().length > 56 ? "…" : ""))) : "No RSVP address is set yet. Deploy the Apps Script (see SETUP.md), then paste its web app URL into Site settings.")));
  }

  async function generateKey() {
    const had = !!admin().rsvpAdminKey;
    if (had) {
      const ok = await api.confirm({ title: "Generate a new admin key?", message: "The old key stops working. You will then need to paste the new key into Apps Script (Project Settings, Script properties, ADMIN_KEY) before the dashboard can read replies again.", confirmLabel: "Generate new key" });
      if (!ok) return;
    }
    setAdminField("rsvpAdminKey", randomCode(24), "Generate admin key");
    S.showKey = true; S.summaryState = "idle"; S.summary = null;
    render();
    api.toast("New key created. Copy it into Apps Script as ADMIN_KEY, then publish.", { ms: 6000 });
  }

  function responsesView() {
    const evs = events(), wv = waves(), sd = sides();
    if (endpoint() && S.summaryState === "idle") queueMicrotask(fetchSummary); // load replies as soon as the tab opens
    const ready = S.summaryState === "ready" && !!S.summary;
    const view = h("div.gm-view.gm-resp");
    const rows = ready ? GL.replyRows(S.summary, households(), evs, { waves: wv, sides: sd }) : [];

    // Whose numbers: every side together (each shown in its colour), or one side at a time.
    const groups = [...sd.map((s, i) => ({ key: s, label: GL.sideLabel(s), cls: `gm-s${i % 4}` })),
      ...(rows.some((r) => !r.side) ? [{ key: "", label: "No side", cls: "gm-sx" }] : [])];
    const pick = (key) => rows.filter((r) => r.side === key);
    if (S.rSide !== null && !groups.some((g) => g.key === S.rSide)) S.rSide = null;
    const visible = S.rSide === null ? rows : pick(S.rSide);
    const split = S.rSide === null && groups.length > 1;
    const one = groups.find((g) => g.key === S.rSide);

    const head = h("div.gm-rhead");
    if (ready && groups.length > 1) {
      head.append(h("div.gm-rseg", { role: "group", "aria-label": "Whose guests" },
        h("button", { type: "button", "aria-pressed": String(S.rSide === null), onclick: () => { S.rSide = null; render(); } }, groups.length > 2 ? "Everyone" : "Both"),
        groups.map((g) => h("button", { type: "button", "aria-pressed": String(S.rSide === g.key), onclick: () => { S.rSide = g.key; render(); } },
          h(`span.gm-dot.${g.cls}`, { "aria-hidden": "true" }), g.key || "No side"))));
    }
    head.append(h("span.gm-rgap"),
      S.fetchedAt ? h("span.muted.small", `Updated ${S.fetchedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`) : null,
      h("button.btn.small", { type: "button", id: "gm-refresh", disabled: S.summaryState === "loading" || !endpoint(), onclick: fetchSummary }, withIcon("history", S.summaryState === "loading" ? "Loading…" : "Refresh")),
      h("button.btn.small", { type: "button", disabled: !ready, onclick: () => download("rsvp-responses.csv", GL.exportResponsesCsv(S.summary, households(), evs, { waves: wv })) }, withIcon("download", "Export CSV")));
    view.append(head);

    const say = (cls, ...kids) => view.append(h(`div.gm-note.${cls}`, { role: "status" }, ...kids));
    if (!endpoint()) say("info", h("strong", "Replies aren't connected yet. "), "Deploy the Apps Script from SETUP.md and paste its web app URL into Site settings (RSVP address). Until then the RSVP form runs in demo mode and nothing is collected.");
    else if (S.summaryState === "loading" || S.summaryState === "idle") say("info", h("span.spin"), " Loading replies…");
    else if (S.summaryState === "badkey") say("err", h("strong", "The sheet didn't accept the admin key. "), "Check that ADMIN_KEY in Apps Script (Project Settings, Script properties) is exactly the key shown below, and that you re-deployed the script after changing it.");
    else if (S.summaryState === "error") say("err", h("strong", "Couldn't reach the RSVP sheet. "), "Check your internet connection and the RSVP address in Site settings, then try again.");
    if (!ready) { view.append(keyCard()); return view; }

    // A number cell: the total for what's shown, plus each side's share in its colour when every side is shown.
    const num = (fn) => h("td.n", h("span.gm-tot", String(fn(visible))),
      split ? h("span.gm-split", groups.map((g) => h(`span.${g.cls}`, h("span.vh", `${g.label}: `), String(fn(pick(g.key)))))) : null);
    const dash = () => h("td.n.muted", "–");
    const card = (title, sub, ...kids) => h("section.gm-rcard", { "aria-label": title }, h("h4", title, sub ? h("small", ` ${sub}`) : null), ...kids);

    /* Invitations by wave (households) */
    const live = (list) => list.filter((r) => r.live);
    const waveGroups = [...wv.map((w) => ({ id: w.id, name: w.name || "Unnamed wave", deadline: w.deadline, sent: !!w.sent, sentOn: w.sentOn })),
      ...(rows.some((r) => !r.wave) ? [{ id: "", name: wv.length ? "No wave" : "Everyone", deadline: draft().rsvp?.deadline, sent: true, nowave: true }] : [])];
    const dueCell = (date) => {
      const d = GL.daysUntil(date);
      if (d === null) return h("td.muted", "No date");
      const left = d > 14 ? h("span.sub", `${d} days left`) : d > 0 ? h("span.sub", h("span.pill.gm-soon", `${plural(d, "day")} left`))
        : d === 0 ? h("span.sub", h("span.pill.gm-soon", "Today")) : h("span.sub", h("span.pill.gm-late", `Passed ${plural(-d, "day")} ago`));
      return h("td", shortDate(date), left);
    };
    const waveRows = waveGroups.map((w) => {
      const of = (list) => list.filter((r) => r.wave === w.id);
      const status = w.nowave ? h("span.sub", wv.length ? "Not in a wave" : "Reply-by date from RSVP settings")
        : w.sent ? h("span.sub", h("span.pill.gm-sent", w.sentOn ? `Sent ${shortDate(w.sentOn)}` : "Sent")) : h("span.sub", h("span.pill", "Not sent yet"));
      return h(`tr${w.sent ? "" : ".gm-unsent"}`, { "data-wave": w.id || "none" }, h("th", { scope: "row" }, w.name, status), dueCell(w.deadline),
        num((l) => of(l).length),
        w.sent ? num((l) => of(l).filter((r) => r.replied).length) : dash(),
        w.sent ? num((l) => of(l).filter((r) => !r.replied).length) : dash());
    });
    if (waveGroups.length > 1) waveRows.push(h("tr.gm-total", { "data-wave": "total" }, h("th", { scope: "row" }, "All sent invitations"), h("td"),
      num((l) => live(l).length), num((l) => live(l).filter((r) => r.replied).length), num((l) => live(l).filter((r) => !r.replied).length)));
    view.append(card("Invitations", "households", h("div.gm-rscroll", h("table.gm-rtable", { "aria-label": "Invitations by wave" },
      h("thead", h("tr", h("th", "Wave"), h("th", "Reply by"), h("th.n", "Invited"), h("th.n", "Replied"), h("th.n", "Waiting"))),
      h("tbody", waveRows)))));

    /* Events (guests, from invitations already sent) */
    const tallyOf = (list) => GL.tallyEvents(list, evs);
    const T = tallyOf(visible), TG = split ? groups.map((g) => tallyOf(pick(g.key))) : [];
    const n = (id, k) => (list) => tallyOf(list)[id][k];
    const comingCls = one ? one.cls : groups.length > 1 ? "gm-s0" : "gm-sy";
    const evRows = evs.map((e) => {
      const c = T[e.id], tot = Math.max(1, c.invited), pct = (v) => `width:${(v / tot) * 100}%`;
      const segs = split ? groups.map((g, i) => h(`i.${g.cls}`, { style: pct(TG[i][e.id].coming) })) : [h(`i.${comingCls}`, { style: pct(c.coming) })];
      return h("tr", { "data-event": e.id },
        h("th", { scope: "row" }, e.name || e.id, eventWhen(e) ? h("span.sub", eventWhen(e)) : null),
        num(n(e.id, "invited")), num(n(e.id, "coming")), num(n(e.id, "declined")), num(n(e.id, "waiting")),
        h("td.gm-barcell", h("span.gm-bar", { "aria-hidden": "true" }, ...segs, h("i.gm-no", { style: pct(c.declined) }))));
    });
    const sw = (cls, label) => h("span", h(`i.${cls}`), label);
    const legend = h("div.gm-legend", { "aria-hidden": "true" },
      ...(split ? groups.map((g) => sw(g.cls, `Coming · ${g.label}`)) : [sw(comingCls, one ? `Coming · ${one.label}` : "Coming")]),
      sw("gm-no", "Can't come"), sw("gm-wait", "Waiting"));
    const held = visible.filter((r) => !r.live);
    const heldWaves = [...new Set(held.map((r) => wv.find((w) => w.id === r.wave)?.name || "a wave"))];
    const heldNote = held.length ? h("p.gm-foot", `Not counted yet: ${plural(held.length, "household")} (${plural(held.reduce((a, r) => a + r.seats, 0), "guest")}) in ${heldWaves.join(", ")}, not sent yet.`) : null;
    view.append(card("Events", "guests, from invitations already sent", ...(evs.length
      ? [h("div.gm-rscroll", h("table.gm-rtable", { "aria-label": "Guests by event" },
          h("thead", h("tr", h("th", "Event"), h("th.n", "Invited"), h("th.n", "Coming"), h("th.n", "Can't come"), h("th.n", "Waiting"), h("th.gm-barcell", h("span.vh", "Chart")))),
          h("tbody", evRows))), legend, heldNote]
      : [h("p.gm-foot", "No events yet.")])));

    /* Waiting / Replied */
    const pool = live(visible);
    const waiting = pool.filter((r) => !r.replied), replied = pool.filter((r) => r.replied).sort((a, b) => (b.repliedAt || 0) - (a.repliedAt || 0));
    const dotFor = (r) => { const g = groups.find((x) => x.key === r.side); return g && groups.length > 1 ? h(`span.gm-dot.${g.cls}`, { title: g.label }, h("span.vh", g.label)) : null; };
    const evNames = (r) => evs.filter((e) => r.invited[e.id]).map((e) => e.name || e.id);
    let list;
    if (S.rTab === "replied") {
      list = replied.length ? replied.map((r) => h("div.gm-rrow", { "data-code": r.code }, dotFor(r),
        h("div.gm-who", h("strong", r.household), r.repliedAt ? h("span.muted.small", ` · replied ${shortDate(new Date(r.repliedAt))}`) : null,
          r.message ? h("span.gm-msg", `“${r.message}”`) : null),
        h("span.gm-counts", evs.filter((e) => r.invited[e.id]).map((e) => {
          const c = r.coming[e.id];
          return h(`span${c ? "" : ".zero"}`, `${e.name || e.id} `, h("b", c === undefined ? "–" : String(c)), `/${r.invited[e.id]}`);
        })))) : [h("p.gm-foot", "No replies yet.")];
    } else {
      const byWave = waveGroups.filter((w) => w.sent).map((w) => ({ w, rs: waiting.filter((r) => r.wave === w.id) })).filter((x) => x.rs.length);
      list = byWave.length ? byWave.flatMap(({ w, rs }) => [
        wv.length ? h("div.gm-grp", w.name, w.deadline ? h("span.muted", ` · reply by ${shortDate(w.deadline)}`) : null) : null,
        ...rs.map((r) => h("div.gm-rrow", { "data-code": r.code }, dotFor(r),
          h("div.gm-who", h("strong", r.household), h("span.sub", `${plural(r.seats, "guest")} · ${evNames(r).join(", ")}`)),
          h("button.btn.small", { type: "button", "aria-label": `Copy WhatsApp reminder for ${r.household}`, onclick: () => copy(message(r.hh, "reminder"), `Reminder for ${r.household} copied`) }, withIcon("chat", "Copy reminder"))))])
        : [h("p.gm-foot", pool.length ? "Everyone has replied." : "No invitations sent yet.")];
    }
    const tab = (id, label) => h("button", { type: "button", role: "tab", "aria-selected": String(S.rTab === id), onclick: () => { S.rTab = id; render(); } }, label);
    view.append(h("section.gm-rcard", { "aria-label": "Households" },
      h("div.gm-rtabs", { role: "tablist", "aria-label": "Households" }, tab("waiting", `Waiting (${waiting.length})`), tab("replied", `Replied (${replied.length})`)),
      h("div", { role: "tabpanel" }, list.filter(Boolean))));

    view.append(keyCard());
    return view;
  }
  function shortDate(v) {
    const d = v instanceof Date ? v : (() => { const [y, m, dd] = String(v).split("-").map(Number); return new Date(y, m - 1, dd); })();
    if (Number.isNaN(d.getTime())) return "";
    const o = { month: "short", day: "numeric" };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
    return d.toLocaleDateString("en-US", o);
  }
  function eventWhen(e) {
    const d = e.start ? new Date(e.start) : null;
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  /* ---------- wiring ---------- */
  api.on("unlock", render);
  api.on("change", ({ source } = {}) => { if (source === "guests") return; if (signature() !== sig) render(); });
  render();
}

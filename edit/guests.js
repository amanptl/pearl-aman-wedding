// Guest manager (the "Guests" tab): households, group presets, links, CSV, previews and the RSVP dashboard.
// All household data lives in draft._admin (encrypted on publish); nothing here is ever written to a public file.
import { h } from "./ui.js";
import { ico } from "./icons.js";
import * as GL from "./guestlib.js";
import { makeHousehold } from "../src/lib/guestfiles.js";
import { randomCode } from "../src/lib/crypto.js";

const clone = (x) => structuredClone(x);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const withIcon = (name, text, size = 15) => [h("span.ic", { html: ico(name, size) }), text];

function download(name, text, type = "text/csv;charset=utf-8") {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
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
  const S = { view: "households", q: "", tag: "", event: "", selected: new Set(), summary: null, summaryState: "idle", summaryMsg: "", showKey: false };
  const app = api.app;
  let sig = "";
  let tbodyHost = null;

  const draft = () => api.getDraft();
  const admin = () => draft()._admin;
  const events = () => GL.sortEvents(draft().events);
  const households = () => admin()?.households || [];
  const presets = () => GL.getPresets(admin());
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
  const message = (hh, kind = "invite") => GL.waMessage(kind === "invite" ? (admin().waTemplate || GL.DEFAULT_WA_TEMPLATE) : (admin().waReminder || GL.DEFAULT_WA_REMINDER), { household: hh, link: linkFor(hh), content: draft() });

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
      if (q && !(`${hh.household} ${(hh.members || []).map((m) => m.name).join(" ")} ${(hh.tags || []).join(" ")}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function householdsView() {
    const evs = events();
    const tags = [...new Set(households().flatMap((x) => x.tags || []))].sort();
    const people = households().reduce((n, x) => n + x.members.length + (x.plusOnes || 0), 0);

    const search = h("input.gm-search", { type: "search", placeholder: "Search names, groups…", "aria-label": "Search households", value: S.q, autocomplete: "off" });
    search.addEventListener("input", () => { S.q = search.value; renderTable(); });
    const tagSel = h("select", { "aria-label": "Filter by group" }, h("option", { value: "" }, "All groups"), tags.map((t) => h("option", { value: t, selected: S.tag === t }, t)));
    tagSel.addEventListener("change", () => { S.tag = tagSel.value; renderTable(); });
    const evSel = h("select", { "aria-label": "Filter by event" }, h("option", { value: "" }, "All events"), evs.map((e) => h("option", { value: e.id, selected: S.event === e.id }, `Invited to ${e.name || e.id}`)));
    evSel.addEventListener("change", () => { S.event = evSel.value; renderTable(); });

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
        h("button.btn.small", { type: "button", onclick: editPresets }, "Edit groups…"));
    };
    S.renderPresets = renderPresets;
    renderPresets();

    const count = h("span.gm-count", { "aria-live": "polite" });
    S.updateCount = () => { count.textContent = `${filtered().length} of ${plural(households().length, "household")} · ${plural(people, "guest")}`; };

    const actions = h("div.gm-actions",
      h("button.btn.primary.small", { type: "button", id: "gm-add", onclick: addHousehold }, withIcon("plus", "Add household")),
      h("button.btn.small", { type: "button", onclick: importCsv }, withIcon("upload", "Import CSV")),
      h("button.btn.small", { type: "button", onclick: exportCsv }, withIcon("download", "Export CSV")),
      h("button.btn.small", { type: "button", onclick: editTemplates }, withIcon("chat", "Message text")),
      count);

    tbodyHost = h("div.gm-tablewrap");
    const view = h("div.gm-view", h("div.gm-filters", search, tagSel, evSel), presetBar, actions, tbodyHost);
    renderTable();
    return view;
  }

  function renderTable() {
    const evs = events();
    const rows = filtered();
    S.updateCount?.();
    S.renderPresets?.();
    if (!households().length) {
      tbodyHost.replaceChildren(h("div.empty", h("p", h("strong", "No households yet")), h("p.muted", "Add a household, or import your list from a spreadsheet (Import CSV). Each household gets its own private link."),
        h("button.btn.primary", { type: "button", onclick: addHousehold }, "Add the first household")));
      return;
    }
    if (!rows.length) { tbodyHost.replaceChildren(h("div.empty", h("p.muted", "No households match your search."))); return; }
    const allOn = rows.every((r) => S.selected.has(r.code));
    const selAll = h("input", { type: "checkbox", checked: allOn, "aria-label": "Select all shown households" });
    selAll.addEventListener("change", () => { rows.forEach((r) => (selAll.checked ? S.selected.add(r.code) : S.selected.delete(r.code))); renderTable(); });
    const head = h("tr", h("th.c-sel", selAll), h("th.c-name", "Household"), h("th.c-mem", "Guests"), h("th.c-po", { title: "Extra unnamed guests they may bring" }, "+1s"), h("th.c-tags", "Groups"),
      ...evs.map((e) => h("th.c-ev", { title: `${e.name || e.id}${e.visibility === "private" ? " (private)" : ""}` }, h("span", e.name || e.id), e.visibility === "private" ? h("small", "private") : null)));
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
      label: "guest", placeholder: hh.members.length ? "Add guest" : "Type a name, press Enter", fieldName: "members",
      items: hh.members.map((m) => ({ key: m.id, text: m.name })),
      onChange: (items) => { S.refocus = { code: hh.code, field: ".chip-add" }; editHousehold(hh.code, (x) => { let n = nextMemberId(x); const used = new Set(); x.members = items.map((i) => { const id = i.key && !used.has(i.key) ? i.key : `m${n++}`; used.add(id); return { id, name: i.text }; }); }, "Edit guests"); renderTable(); },
    });
    const tagsEd = chipEditor({
      label: "group", placeholder: "Add group", fieldName: "tags",
      items: (hh.tags || []).map((t) => ({ key: t, text: t })),
      onChange: (items) => { S.refocus = { code: hh.code, field: '[data-field="tags"] .chip-add' }; editHousehold(hh.code, (x) => { x.tags = [...new Set(items.map((i) => GL.slug(i.text)).filter(Boolean))]; }, "Edit groups"); renderTable(); },
    });
    const po = h("input.gm-in.num", { type: "number", min: 0, max: 10, value: hh.plusOnes || 0, "aria-label": `Plus-ones for ${label}` });
    po.addEventListener("change", () => editHousehold(hh.code, (x) => { x.plusOnes = Math.max(0, Math.min(10, Math.round(+po.value) || 0)); }, "Change plus-ones", `hh-${hh.code}-po`));
    const checks = evs.map((e) => {
      const c = h("input", { type: "checkbox", checked: (hh.eventIds || []).includes(e.id), "aria-label": `${label}: invited to ${e.name || e.id}` });
      c.addEventListener("change", () => editHousehold(hh.code, (x) => { const s = new Set(x.eventIds || []); c.checked ? s.add(e.id) : s.delete(e.id); x.eventIds = [...s]; }, "Change invitations"));
      return h("td.c-ev", c);
    });
    return h("tr", { "data-code": hh.code }, h("td.c-sel", sel), h("td.c-name", name, acts), h("td.c-mem", members), h("td.c-po", po), h("td.c-tags", tagsEd), ...checks);
  }

  /* ---------- household actions ---------- */
  function addHousehold() {
    S.q = ""; S.tag = ""; S.event = "";
    const list = clone(households());
    const hh = makeHousehold({ id: `hh-${randomCode(6).toLowerCase()}`, household: "New household", members: [], eventIds: [] }, new Set(list.map((x) => x.code)));
    hh.household = ""; hh.greeting = "";
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
      hh.eventIds = [...new Set([...(hh.eventIds || []).filter((id) => !evs.some((e) => e.id === id)), ...ids])];
      if (p.tag && !(hh.tags || []).includes(p.tag)) hh.tags = [...(hh.tags || []), p.tag];
    }
    setHouseholds(list, `Apply "${p.name}" to ${plural(codes.length, "household")}`);
    renderTable();
    api.refreshPreview();
    api.toast(`"${p.name}" applied to ${plural(codes.length, "household")}`);
  }

  /* ---------- dialogs ---------- */
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
    const upd = () => { preview.textContent = sample ? GL.waMessage(inv.value, { household: sample, link: linkFor(sample), content: draft() }) : ""; };
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
    download("households.csv", GL.exportHouseholdsCsv(households(), events(), linkFor));
    api.toast("Exported households with their personal links");
  }

  function importCsv() {
    const evs = events();
    const text = h("textarea", { rows: 5, placeholder: "household,members,tags,events,plusOnes\nSharma Family,Raj Sharma; Priya Sharma,close-family,all,0", "aria-label": "Paste CSV text", spellcheck: false });
    const file = h("input", { type: "file", accept: ".csv,text/csv,text/plain", "aria-label": "Choose a CSV file" });
    const out = h("div.gm-prev", { "aria-live": "polite" });
    let parsed = null;
    let applyBtn;
    const refresh = () => {
      parsed = null;
      if (!text.value.trim()) { out.replaceChildren(h("p.muted", "Columns: household, members (separate names with ;), tags, events (event ids separated by ; or a group name like Friends), plusOnes.")); return; }
      parsed = GL.importRows(GL.parseCsv(text.value), { events: evs, presets: presets(), existing: households() });
      if (parsed.headerErrors.length) { out.replaceChildren(h("p.dlg-note.err", parsed.headerErrors.join(" "))); parsed = null; return; }
      const ok = parsed.rows.filter((r) => r.action !== "error");
      const bad = parsed.rows.length - ok.length;
      out.replaceChildren(
        h("p.gm-sum", `${plural(ok.filter((r) => r.action === "add").length, "household")} to add, ${ok.filter((r) => r.action === "update").length} to update${bad ? `, ` : ""}`, bad ? h("strong.err", `${plural(bad, "row")} with problems (skipped)`) : null),
        h("div.gm-tablewrap.short", h("table.gm-table.prev", h("thead", h("tr", ...["Row", "Household", "Guests", "Events", "Result"].map((t) => h("th", t)))),
          h("tbody", parsed.rows.map((r) => h("tr", { "data-action": r.action },
            h("td", String(r.line)), h("td", r.data.household || "—"), h("td", r.data.members.join(", ")), h("td", r.data.eventIds.join(", ") || "none"),
            h("td", r.action === "error" ? h("span.err", r.errors.join("; ")) : [h("span.pill", r.action === "add" ? "New" : "Update"), ...r.warnings.map((w) => h("span.warnt", ` ${w}`))])))))));
      applyBtn.textContent = ok.length ? `Import ${plural(ok.length, "household")}` : "Nothing to import";
      applyBtn.disabled = !ok.length;
    };
    text.addEventListener("input", refresh);
    file.addEventListener("change", async () => { const f = file.files[0]; if (f) { text.value = await f.text(); refresh(); } });
    api.dialog({
      title: "Import households from CSV", wide: true,
      body: h("div.gm-imp", h("div.row", file, h("button.link", { type: "button", onclick: () => download("households-template.csv", GL.toCsv([["household", "members", "tags", "events", "plusOnes"], ["Sharma Family", "Raj Sharma; Priya Sharma", "close-family", "all", "0"], ["Maria Garcia", "Maria Garcia", "friends", "Friends", "1"]])) }, "Download a template")), text, out),
      actions: [{ label: "Cancel", value: false }, { label: "Import", primary: true, keepOpen: true, onClick: (close) => {
        if (!parsed) return;
        const good = parsed.rows.filter((r) => r.action !== "error");
        if (!good.length) return;
        setHouseholds(GL.applyImport(households(), good), `Import ${plural(good.length, "household")}`);
        close(true); render(); api.toast(`Imported ${plural(good.length, "household")}`);
      } }],
      onOpen: () => { applyBtn = [...document.querySelectorAll("dialog.dlg .dlg-f .btn")].find((b) => /^Import/.test(b.textContent)); applyBtn.disabled = true; refresh(); },
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
    const evs = events();
    const view = h("div.gm-view.gm-resp", keyCard());
    const bar = h("div.gm-actions",
      h("button.btn.primary.small", { type: "button", id: "gm-refresh", disabled: S.summaryState === "loading", onclick: fetchSummary }, withIcon("history", S.summaryState === "loading" ? "Loading…" : "Refresh responses")),
      h("button.btn.small", { type: "button", disabled: !S.summary, onclick: () => download("rsvp-responses.csv", GL.exportResponsesCsv(S.summary, households(), evs)) }, withIcon("download", "Export CSV")),
      S.fetchedAt ? h("span.muted", `Updated ${S.fetchedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`) : null);
    view.append(bar);
    const say = (cls, ...kids) => view.append(h(`div.gm-note.${cls}`, { role: "status" }, ...kids));
    if (!endpoint()) say("info", h("strong", "Replies aren't connected yet. "), "Deploy the Apps Script from SETUP.md and paste its web app URL into Site settings (RSVP address). Until then the RSVP form runs in demo mode and nothing is collected.");
    else if (S.summaryState === "idle") say("info", "Press Refresh responses to load the latest replies from your Google Sheet.");
    else if (S.summaryState === "loading") say("info", h("span.spin"), " Loading replies…");
    else if (S.summaryState === "badkey") say("err", h("strong", "The sheet didn't accept the admin key. "), "Check that ADMIN_KEY in Apps Script (Project Settings, Script properties) is exactly the key shown above, and that you re-deployed the script after changing it.");
    else if (S.summaryState === "error") say("err", h("strong", "Couldn't reach the RSVP sheet. "), "Check your internet connection and the RSVP address in Site settings, then try again.");
    if (S.summaryState !== "ready" || !S.summary) return view;

    const a = GL.analyseSummary(S.summary, households(), evs);
    view.append(h("div.gm-tiles",
      tile(`${a.replied} of ${a.total}`, "households replied"),
      tile(String(a.notReplied.length), "still to reply"),
      tile(String(a.attending), "guests saying yes")));
    view.append(section("Attendance by event", h("table.gm-table.sum", { "aria-label": "Attendance by event" },
      h("thead", h("tr", ...["Event", "Yes", "No", "Pending", ""].map((t) => h("th", t)))),
      h("tbody", evs.map((e) => {
        const c = a.byEvent[e.id];
        const tot = Math.max(1, c.yes + c.no + c.pending);
        return h("tr", { "data-event": e.id }, h("th", { scope: "row" }, e.name || e.id, e.visibility === "private" ? h("small.muted", " private") : null), h("td.n.yes", String(c.yes)), h("td.n", String(c.no)), h("td.n.pend", String(c.pending)),
          h("td.bar", h("span.stack", { "aria-hidden": "true" }, h("i.s-y", { style: `width:${(c.yes / tot) * 100}%` }), h("i.s-n", { style: `width:${(c.no / tot) * 100}%` }), h("i.s-p", { style: `width:${(c.pending / tot) * 100}%` }))));
      })))));
    view.append(h("div.gm-two",
      section("Meals", countList(a.meals, "No meal choices yet")),
      section("Dietary needs", countList(a.dietary, "None reported"))));
    view.append(section(`Not replied yet (${a.notReplied.length})`, a.notReplied.length
      ? h("ul.gm-list", a.notReplied.map((hh) => h("li", h("span", h("strong", hh.household), h("small.muted", ` ${hh.members.map((m) => m.name).join(", ")}`)),
        h("button.btn.small", { type: "button", "aria-label": `Copy WhatsApp reminder for ${hh.household}`, onclick: () => copy(message(hh, "reminder"), `Reminder for ${hh.household} copied`) }, withIcon("chat", "Copy reminder")))))
      : h("p.muted", "Everyone has replied.")));
    view.append(section(`Hotel (${a.hotel.need.length} need a room)`, h("div",
      h("p.muted", `${a.hotel.need.length} need a room · ${a.hotel.booked.length} already booked · ${a.hotel.local.length} local`),
      a.hotel.need.length ? h("ul.gm-list", a.hotel.need.map((x) => h("li", h("span", h("strong", x.household), x.arrival ? h("small.muted", ` arriving ${x.arrival}`) : null)))) : null)));
    view.append(section("Arrivals and flights", a.travel.length
      ? h("table.gm-table.sum", { "aria-label": "Arrivals" }, h("thead", h("tr", ...["Household", "Arrives", "Leaves", "Flight", "Time"].map((t) => h("th", t)))),
        h("tbody", a.travel.map((x) => h("tr", h("th", { scope: "row" }, x.household), h("td", String(x.arrival || "")), h("td", String(x.departure || "")), h("td", String(x.flight || "")), h("td", String(x.flightTime || ""))))))
      : h("p.muted", "No travel details yet.")));
    return view;
  }
  const tile = (n, l) => h("div.gm-tile", h("strong", n), h("span", l));
  const section = (title, ...kids) => h("section.gm-sec", h("h4", title), ...kids);
  const countList = (o, empty) => (Object.keys(o).length ? h("ul.gm-counts", Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, n]) => h("li", h("span", k), h("strong", String(n))))) : h("p.muted", empty));

  /* ---------- wiring ---------- */
  api.on("unlock", render);
  api.on("change", ({ source } = {}) => { if (source === "guests") return; if (signature() !== sig) render(); });
  render();
}

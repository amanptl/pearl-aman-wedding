// Publish flow: change summary, conflict check, one-commit publish, live polling, history, download.
import { h } from "./ui.js";
import { ico } from "./icons.js";
import * as gh from "./github.js";
import { openSettings } from "./settings.js";
import { cleanContent, contentSha, serialize } from "./draft.js";
import { pendingPaths } from "./images.js";
import { buildGuestFiles } from "../src/lib/guestfiles.js";
import { randomCode } from "../src/lib/crypto.js";

export function summarize(base, draft, noun = (p) => p.split(".").pop()) {
  let fields = 0, photos = 0;
  const added = {}, removed = {};
  const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const isImg = (v) => v && typeof v === "object" && !Array.isArray(v) && "src" in v && "alt" in v;
  const diff = (a, b, path) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (isImg(a) || isImg(b)) {
      if (a?.src !== b?.src) photos++;
      else fields++;
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const idd = (x) => x.length && x.every((i) => i && typeof i === "object" && "id" in i);
      if (idd(a) || idd(b)) {
        const am = new Map(a.map((x) => [x.id, x])), bm = new Map(b.map((x) => [x.id, x]));
        for (const [id, x] of bm) { if (!am.has(id)) bump(added, noun(path)); else diff(am.get(id), x, `${path}.${id}`); }
        for (const id of am.keys()) if (!bm.has(id)) bump(removed, noun(path));
        const order = (m) => [...m.keys()].filter((k) => am.has(k) && bm.has(k)).join();
        if (order(am) !== order(bm)) fields++;
        return;
      }
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (i >= a.length) bump(added, noun(path));
        else if (i >= b.length) bump(removed, noun(path));
        else diff(a[i], b[i], `${path}.${i}`);
      }
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    fields++;
  };
  diff(cleanContent(base), cleanContent(draft), "");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts = [];
  if (fields) parts.push(`Edited ${plural(fields, "field")}`);
  for (const [k, n] of Object.entries(added)) parts.push(`added ${plural(n, k)}`);
  for (const [k, n] of Object.entries(removed)) parts.push(`removed ${plural(n, k)}`);
  if (photos) parts.push(plural(photos, "photo"));
  return { fields, photos, added, removed, text: parts.length ? parts.join(", ") : "No changes" };
}

let pollToken = 0;

export async function openPublish(app) {
  // Private events can only be published together with the encrypted guest files, which need the passphrase.
  if (!app.unlocked && app.draft.events.some((e) => e.visibility === "private")) {
    const go = await app.ui.dialog({
      title: "Unlock to publish private events",
      body: h("p.dlg-msg", "Some events are marked private. They are stored encrypted, so the guest list passphrase is needed before they can be published."),
      actions: [{ label: "Close", value: false }, { label: "Unlock guest list", value: true, primary: true }],
    });
    if (go && (await app.requestUnlock())) return openPublish(app);
    return;
  }
  if (!gh.isConfigured()) { if (!(await openSettings(app))) return; }
  const info = summarize(app.base, app.draft, app.schemaTools.noun);
  const rebuild = app.guestsChanged();
  if (rebuild) {
    const n = app.draft._admin?.households?.length || 0;
    const note = `updated the guest list (${n} ${n === 1 ? "household" : "households"})`;
    info.text = info.text === "No changes" ? note[0].toUpperCase() + note.slice(1) : `${info.text}, ${note}`;
  }
  const status = h("div.pub-status", { "aria-live": "polite" });
  const body = h("div.pub",
    h("p.dlg-msg", "This will update the live website for everyone."),
    h("ul.pub-sum", ...(info.text === "No changes" ? [h("li", "No changes since the last publish.")] : info.text.split(", ").map((t) => h("li", ico("check", 14), t)))),
    status);
  let busy = false;

  const setStatus = (...kids) => { status.replaceChildren(...kids); };
  const spinner = (t) => h("p.pub-line", h("span.spin"), t);

  async function run(close, force) {
    if (busy) return;
    busy = true;
    try {
      const s = gh.getSettings();
      setStatus(spinner("Checking for newer changes…"));
      if (!force) {
        const remote = await gh.getFile("content/content.json");
        if (remote) {
          let parsed = null;
          try { parsed = JSON.parse(remote.text); } catch {}
          if (parsed && (await contentSha(parsed)) !== app.baseSha) {
            busy = false;
            setStatus(h("div.pub-warn", h("strong", "The site was changed elsewhere since you started."),
              h("p", "Someone (or another device) published after you began editing. You can load the latest version and lose your draft, or publish anyway and overwrite theirs."),
              h("div.row", h("button.btn", { type: "button", onclick: async () => { await app.resetTo(parsed, "Loaded the latest version"); close(false); } }, "Reload latest (discard my changes)"),
                h("button.btn.danger", { type: "button", onclick: () => run(close, true) }, "Publish anyway"))));
            return;
          }
        }
        if (rebuild && !app.adminIsNew) {
          const remoteAdmin = await gh.getFile("content/admin.enc.json");
          let ct = null;
          try { ct = JSON.parse(remoteAdmin?.text || "null")?.ct; } catch {}
          if (remoteAdmin && ct !== app.adminCt) {
            busy = false;
            setStatus(h("div.pub-warn", h("strong", "The guest list was changed elsewhere since you unlocked it."),
              h("p", "Another device published a different guest list. Publishing now would overwrite it. Close this window, reload the editor and unlock again to see the latest, or publish anyway."),
              h("div.row", h("button.btn.danger", { type: "button", onclick: () => run(close, true) }, "Publish anyway"))));
            return;
          }
        }
      }
      const clean = cleanContent(app.draft);
      const files = [{ path: "content/content.json", text: serialize(app.draft) }];
      let adminState = null;
      if (rebuild) {
        setStatus(spinner("Locking the guest list…"));
        const admin = JSON.parse(JSON.stringify(app.draft._admin));
        admin.rsvpAdminKey = admin.rsvpAdminKey || randomCode(24);
        const privateEvents = app.privateEvents();
        const { guestsJson, adminJson } = await buildGuestFiles({ households: admin.households, privateEvents, passphrase: app.passphrase, nameLookup: app.draft.site?.nameLookup === true, rsvpAdminKey: admin.rsvpAdminKey, presets: admin.presets, waves: admin.waves, waTemplate: admin.waTemplate, waReminder: admin.waReminder });
        files.push({ path: "content/guests.json", text: JSON.stringify(guestsJson) + "\n" }, { path: "content/admin.enc.json", text: JSON.stringify(adminJson) + "\n" });
        adminState = { admin, privateEvents, ct: adminJson.ct };
      }
      for (const p of pendingPaths(app.draft)) {
        const blob = app.images.blobFor(p);
        if (blob) files.push({ path: p, blob });
      }
      const message = `Update site content via editor\n\n${info.text}`;
      await gh.publishFiles(files, message, (step) => setStatus(spinner(`${step}…`)));
      const newSha = await contentSha(clean);
      const published = files.filter((f) => f.blob).map((f) => f.path);
      await app.afterPublish(clean, newSha, published, adminState);
      const url = gh.siteUrl();
      const live = h("p.pub-line.muted", h("span.spin"), "Waiting for the site to update…");
      setStatus(h("div.pub-ok", h("div.ok-badge", ico("check", 22)), h("div", h("strong", "Published ✓ — live in about a minute"),
        h("p", url ? h("a", { href: url, target: "_blank", rel: "noopener" }, "Open the site ", h("span", { html: ico("external", 14) })) : ""), live)));
      pollLive(s, newSha, (state) => {
        if (state === "live") { live.replaceChildren(h("strong.live", "Live ✓")); app.toast("Your changes are live"); app.setLive("live"); }
        else if (state === "slow") live.textContent = "Still updating. GitHub can take a few minutes; you can close this window.";
      });
      app.setLive("going");
    } catch (e) {
      busy = false;
      setStatus(h("div.pub-err", h("strong", "Couldn't publish"), h("p", gh.friendlyError(e)),
        h("div.row", h("button.btn", { type: "button", onclick: () => { openSettings(app); } }, "Open settings"))));
      return;
    }
    busy = false;
  }

  const hasChanges = info.text !== "No changes";
  await app.ui.dialog({
    title: "Publish to the website",
    body,
    cls: "pubdlg",
    actions: [
      { label: "Close", value: false },
      ...(hasChanges ? [{ label: "Publish now", primary: true, keepOpen: true, onClick: (close) => { run(close, false); } }] : []),
    ],
  });
}

function pollLive(s, sha, cb) {
  const my = ++pollToken;
  const t0 = Date.now();
  const tick = async () => {
    if (my !== pollToken) return;
    try {
      const r = await fetch(`https://${s.owner}.github.io/${s.repo}/content/content.json?ts=${Date.now()}`, { cache: "no-store" });
      if (r.ok && (await contentSha(await r.json())) === sha) { cb("live"); return; }
    } catch {}
    const el = Date.now() - t0;
    if (el > 180000) { cb("slow"); return; }
    setTimeout(tick, el < 20000 ? 4000 : 8000);
  };
  setTimeout(tick, 3000);
}

export function downloadContent(app) {
  const blob = new Blob([serialize(app.draft)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: "content.json" });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** History tab content. */
export async function mountHistory(el, app) {
  el.replaceChildren(h("p.muted.pad", "Loading…"));
  if (!gh.isConfigured()) {
    el.replaceChildren(h("div.empty", ico("history", 28), h("p", "Connect to GitHub to see earlier versions."), h("button.btn.primary", { type: "button", onclick: async () => { if (await openSettings(app)) mountHistory(el, app); } }, "Open settings")));
    return;
  }
  try {
    const commits = await gh.listCommits("content/content.json", 20);
    if (!commits.length) { el.replaceChildren(h("div.empty", h("p", "No earlier versions yet."))); return; }
    el.replaceChildren(h("ul.hist", commits.map((c) => h("li", h("div", h("strong", c.message.split("\n")[0]), h("span.muted", `${new Date(c.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}${c.author ? " · " + c.author : ""}`)),
      h("button.btn.small", { type: "button", onclick: () => restore(c) }, "Restore this version")))));
  } catch (e) { el.replaceChildren(h("div.empty", h("p", gh.friendlyError(e)), h("button.btn", { type: "button", onclick: () => mountHistory(el, app) }, "Try again"))); }

  async function restore(c) {
    const ok = await app.confirm({ title: "Restore this version?", message: "This replaces your current draft with the older version. Nothing is published until you press Publish, and you can undo.", confirmLabel: "Restore" });
    if (!ok) return;
    try {
      const f = await gh.getFile("content/content.json", c.sha);
      if (!f) throw new Error("File not found in that version.");
      app.replaceDraft(JSON.parse(f.text), "Restore earlier version");
      app.toast("Version restored in your draft. Press Publish to make it live.");
    } catch (e) { app.toast(gh.friendlyError(e), { kind: "err" }); }
  }
}

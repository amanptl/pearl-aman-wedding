// Draft persistence + hashing helpers.
// Private parts of the draft (private events and the guest list under `_admin`) are NEVER written to localStorage:
// they go to sessionStorage only. Events that were already public before the edit may stay in localStorage.
const KEY = "pa.editor.draft.v1";
const SKEY = "pa.editor.draft.private.v1";
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const isPrivate = (e) => e?.visibility === "private";

/** Drop `_admin` and any private event that was not already public in `base`. */
function redact(content, publicIds) {
  const { _admin, ...rest } = content;
  return { ...rest, events: (rest.events || []).filter((e) => !isPrivate(e) || publicIds.has(e.id)) };
}
const hasPrivateParts = (c) => !!c._admin || (c.events || []).some(isPrivate);

export function loadDraft() {
  const local = safe(() => JSON.parse(localStorage.getItem(KEY) || "null"));
  const full = safe(() => JSON.parse(sessionStorage.getItem(SKEY) || "null"));
  return full && local && full.savedAt === local.savedAt ? full : local;
}
export function saveDraft(draft, baseSha, base) {
  const savedAt = Date.now();
  const publicIds = new Set((base?.events || []).filter((e) => !isPrivate(e)).map((e) => e.id));
  const ok = safe(() => { localStorage.setItem(KEY, JSON.stringify({ draft: redact(draft, publicIds), baseSha, base: base ? redact(base, publicIds) : base, savedAt })); return true; }, false);
  if (ok) {
    if (hasPrivateParts(draft)) safe(() => sessionStorage.setItem(SKEY, JSON.stringify({ draft, baseSha, base, savedAt })));
    else safe(() => sessionStorage.removeItem(SKEY));
  }
  return ok ? savedAt : 0;
}
export const clearDraft = () => { safe(() => localStorage.removeItem(KEY)); safe(() => sessionStorage.removeItem(SKEY)); };

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A copy of the content without editor-only fields (_pending, _admin). Private events are kept; see publicContent. */
export function cleanContent(content) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v)) if (k !== "_pending" && k !== "_admin") o[k] = walk(x);
      return o;
    }
    return v;
  };
  return walk(content);
}
/** What content.json holds: the cleaned draft minus private events. */
export function publicContent(content) {
  const c = cleanContent(content);
  return { ...c, events: (c.events || []).filter((e) => !isPrivate(e)) };
}
/** Canonical hash of the PUBLIC content (independent of whitespace/line endings). */
export const contentSha = (content) => sha256Hex(JSON.stringify(publicContent(content)));
export const serialize = (content) => JSON.stringify(publicContent(content), null, 2) + "\n";

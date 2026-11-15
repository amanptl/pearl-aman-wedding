// List operations (move / duplicate / delete / add) and pointer drag-to-reorder inside the frame.
import { getPath } from "../src/lib/dom.js";

/** Move arr[from] before/after arr[to], using original indices. Returns the new index. */
export function moveRelative(arr, from, to, after) {
  if (from === to) return from;
  const [x] = arr.splice(from, 1);
  const t = to > from ? to - 1 : to;
  const at = after ? t + 1 : t;
  arr.splice(at, 0, x);
  return at;
}

/** Fields copied from the neighbouring item when adding to a list (keeps a new hotel in the same group, etc.). */
const INHERIT = { hotels: ["type"], faq: ["category"], "travel.aroundTown": ["category"], events: [] };

export function buildNewItem(app, listPath, refItem) {
  const draft = app.draft;
  const arr = getPath(draft, listPath) || [];
  const ischema = app.schemaTools.resolve(app.schemaTools.schemaAt(listPath)?.items);
  const item = app.schemaTools.defaultFor(ischema, { arr, content: draft });
  if (item && typeof item === "object" && refItem && typeof refItem === "object") {
    for (const k of INHERIT[listPath] || []) if (refItem[k] !== undefined) item[k] = refItem[k];
    if (listPath === "events" && refItem.start) item.start = refItem.start;
  }
  if (listPath === "faq" && item && !item.category) item.category = draft.faqCategories?.[0]?.id || "";
  return item;
}

/** Add a new item after `index` (or at the end when index is null). Returns the new item path. */
export function addItem(app, listPath, index = null) {
  const arr = getPath(app.draft, listPath);
  const ref = index != null && arr ? arr[index] : arr?.[arr.length - 1];
  const item = buildNewItem(app, listPath, ref);
  const at = index == null ? (arr ? arr.length : 0) : index + 1;
  const noun = app.schemaTools.noun(listPath);
  app.mutate((d) => {
    let a = getPath(d, listPath);
    if (!Array.isArray(a)) { a = []; setIn(d, listPath, a); }
    a.splice(at, 0, item);
  }, `Add ${noun}`);
  const path = `${listPath}.${at}`;
  return path;
}
function setIn(d, path, v) {
  const segs = path.split(".");
  let o = d;
  segs.slice(0, -1).forEach((k) => { o = o[k] ??= {}; });
  o[segs[segs.length - 1]] = v;
}

export function duplicateItem(app, listPath, index) {
  const arr = getPath(app.draft, listPath);
  const copy = structuredClone(arr[index]);
  if (copy && typeof copy === "object" && "id" in copy) copy.id = app.schemaTools.uniqueId(arr, `${copy.id}-copy`);
  app.mutate((d) => { getPath(d, listPath).splice(index + 1, 0, copy); }, `Duplicate ${app.schemaTools.noun(listPath)}`);
  return `${listPath}.${index + 1}`;
}

export async function deleteItem(app, listPath, index) {
  const arr = getPath(app.draft, listPath);
  const noun = app.schemaTools.noun(listPath);
  const label = app.schemaTools.itemLabel(arr[index]);
  const ok = await app.confirm({ title: `Delete this ${noun}?`, message: `${label ? `“${label}” will be removed` : `This ${noun} will be removed`}. You can bring it back with Undo.`, confirmLabel: "Delete", danger: true });
  if (!ok) return false;
  app.mutate((d) => { getPath(d, listPath).splice(index, 1); }, `Delete ${noun}`);
  if (app.selection && (app.selection === `${listPath}.${index}` || app.selection.startsWith(`${listPath}.${index}.`))) app.select(null);
  return true;
}

/** Toolbar action dispatcher. */
export async function act(app, F, info, name) {
  const { listPath, index } = info;
  const sibs = F.itemsIn(info);
  const pos = sibs.findIndex((s) => s.el === info.el);
  if (name === "up" || name === "down") {
    const nb = sibs[pos + (name === "up" ? -1 : 1)];
    if (!nb) return;
    const wasSel = app.selection === info.path;
    let newIdx;
    app.mutate((d) => { newIdx = moveRelative(getPath(d, listPath), index, nb.index, name === "down"); }, "Reorder");
    const np = `${listPath}.${newIdx}`;
    if (wasSel) app.select(np);
    F.focusItem(np);
    app.announce?.(`Moved ${name === "up" ? "earlier" : "later"}`);
  } else if (name === "dup") {
    const p = duplicateItem(app, listPath, index);
    if (info.el.dataset.item) app.select(p);
    F.focusItem(p);
    F.reveal(p);
  } else if (name === "add") {
    const p = addItem(app, listPath, index);
    if (info.el.dataset.item) app.select(p);
    F.focusItem(p);
    F.reveal(p);
  } else if (name === "del") {
    F.hoverItem = null;
    await deleteItem(app, listPath, index);
    F.reposition();
  }
}

/* ---------- pointer drag ---------- */
export function startDrag(app, F, info, downEvent, done) {
  const sibs = F.itemsIn(info);
  if (sibs.length < 2) { done(); return; }
  const doc = F.doc, win = F.win;
  const handle = downEvent.target;
  try { handle.setPointerCapture(downEvent.pointerId); } catch {}
  info.el.classList.add("ed-dragging");
  doc.documentElement.classList.add("ed-drag-active");
  let target = null; // { info, after, vertical }
  let lastY = downEvent.clientY, lastX = downEvent.clientX;
  let scrollRaf = 0;

  const compute = () => {
    let best = null, bestD = Infinity;
    for (const s of sibs) {
      if (s.el === info.el) continue;
      const r = s.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const inside = lastX >= r.left && lastX <= r.right && lastY >= r.top && lastY <= r.bottom;
      const d = inside ? -1 : Math.hypot(lastX - cx, lastY - cy);
      if (d < bestD) { bestD = d; best = { s, r, cx, cy }; }
    }
    if (!best) return;
    const { s, r, cx, cy } = best;
    const dx = (lastX - cx) / Math.max(1, r.width), dy = (lastY - cy) / Math.max(1, r.height);
    // Items laid out side by side in a row compare on x, stacked items on y.
    const row = sibs.some((o) => o !== s && Math.abs(o.el.getBoundingClientRect().top - r.top) < 4 && o.el !== s.el);
    const vertical = row && Math.abs(dx) >= Math.abs(dy) * 0.6;
    const after = vertical ? dx > 0 : dy > 0;
    target = { info: s, after, vertical };
    if (vertical) F.setDropIndicator({ x: after ? r.right + 4 : r.left - 4, y: r.top, len: r.height }, true);
    else F.setDropIndicator({ x: r.left, y: after ? r.bottom + 4 : r.top - 4, len: r.width }, false);
  };
  const move = (e) => { lastX = e.clientX; lastY = e.clientY; compute(); };
  const scrollLoop = () => {
    const h = win.innerHeight;
    if (lastY < 70) win.scrollBy(0, -14); else if (lastY > h - 70) win.scrollBy(0, 14);
    compute();
    scrollRaf = requestAnimationFrame(scrollLoop);
  };
  scrollRaf = requestAnimationFrame(scrollLoop);

  const end = (commit) => {
    cancelAnimationFrame(scrollRaf);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", cancel);
    doc.removeEventListener("keydown", key, true);
    info.el.classList.remove("ed-dragging");
    doc.documentElement.classList.remove("ed-drag-active");
    F.setDropIndicator(null);
    if (commit && target && target.info.index !== info.index) {
      const wasSel = app.selection === info.path;
      let newIdx;
      app.mutate((d) => { newIdx = moveRelative(getPath(d, info.listPath), info.index, target.info.index, target.after); }, "Reorder");
      const np = `${info.listPath}.${newIdx}`;
      if (wasSel) app.select(np);
      F.focusItem(np);
    }
    done();
  };
  const up = () => end(true);
  const cancel = () => end(false);
  const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(false); } };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
  doc.addEventListener("keydown", key, true);
}

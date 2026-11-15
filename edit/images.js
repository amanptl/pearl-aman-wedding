// Photo handling: client-side resize/encode (WebP), IndexedDB store for pending uploads, preview mapping.
import { sha256Hex } from "./draft.js";

const DB = "pa-editor";
const STORE = "assets";
const MAX_BYTES = 25 * 1024 * 1024;
const FULL_MAX = 2000;
const SMALL_MAX = 600;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "path" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(r?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export function createImages() {
  /** path -> { blob, url } for pending uploads (url is a blob: URL for previews). */
  const pending = new Map();

  async function load() {
    try {
      const rows = (await tx("readonly", (s) => s.getAll())) || [];
      for (const r of rows) pending.set(r.path, { blob: r.blob, url: URL.createObjectURL(r.blob) });
    } catch (e) { console.warn("Could not read pending photos", e); }
  }
  async function put(path, blob) {
    pending.set(path, { blob, url: URL.createObjectURL(blob) });
    try { await tx("readwrite", (s) => s.put({ path, blob })); } catch (e) { console.warn("Could not store photo", e); }
  }
  async function remove(path) {
    const p = pending.get(path);
    if (p) { URL.revokeObjectURL(p.url); pending.delete(path); }
    try { await tx("readwrite", (s) => s.delete(path)); } catch {}
  }
  async function prune(usedPaths) {
    for (const path of [...pending.keys()]) if (!usedPaths.has(path)) await remove(path);
  }

  async function encode(bitmap, max) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    let blob;
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      blob = await c.convertToBlob({ type: "image/webp", quality: 0.8 });
    } else {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      blob = await new Promise((res) => c.toBlob(res, "image/webp", 0.8));
    }
    if (!blob || blob.type !== "image/webp") throw new Error("This browser could not create a WebP image.");
    return { blob, w, h };
  }

  /**
   * Validate + process a File. Returns { src, srcSmall } (site-relative paths) after storing both blobs.
   * Throws Error with a friendly message.
   */
  async function addFile(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error("That file isn't a photo. Please choose a JPG, PNG, WebP or GIF image.");
    if (file.size > MAX_BYTES) throw new Error("That photo is larger than 25 MB. Please choose a smaller one.");
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { throw new Error("We couldn't read that photo. HEIC files from iPhones sometimes fail; try exporting it as JPG first."); }
    try {
      const full = await encode(bitmap, FULL_MAX);
      const small = await encode(bitmap, SMALL_MAX);
      const hash = (await sha256Hex(await readBlobText(full.blob))).slice(0, 16);
      const src = `assets/uploads/${hash}.webp`;
      const srcSmall = `assets/uploads/${hash}-600.webp`;
      await put(src, full.blob);
      await put(srcSmall, small.blob);
      return { src, srcSmall, width: full.w, height: full.h };
    } finally { bitmap.close?.(); }
  }
  async function readBlobText(blob) {
    // hash raw bytes (as latin1 text so the digest is stable)
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return s;
  }

  const isPendingPath = (p) => pending.has(p);
  const urlFor = (path) => pending.get(path)?.url || null;
  /** Preview URL for a content image path (editor document, one level below the site root). */
  const previewUrl = (path) => (!path ? "" : pending.get(path)?.url || (/^(https?:|data:|blob:)/.test(path) ? path : `../${path}`));

  /** Point <img>s inside the frame at blob: URLs for pending uploads (srcset dropped). */
  function applyPending(doc) {
    if (!pending.size) return;
    for (const img of doc.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (src && pending.has(src)) { img.removeAttribute("srcset"); img.src = pending.get(src).url; img.dataset.pending = "1"; continue; }
      const set = img.getAttribute("srcset");
      if (set) {
        const first = set.split(",")[0].trim().split(/\s+/)[0];
        if (pending.has(first)) { img.removeAttribute("srcset"); img.src = pending.get(first).url; img.dataset.pending = "1"; }
      }
    }
  }

  /** Blob for publishing. */
  const blobFor = (path) => pending.get(path)?.blob || null;

  return { load, addFile, put, remove, prune, isPendingPath, urlFor, previewUrl, applyPending, blobFor, pending };
}

/** Collect {src, srcSmall} paths of pending images in the content. */
export function pendingPaths(content) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (v._pending) { if (v.src) out.add(v.src); if (v.srcSmall) out.add(v.srcSmall); }
      Object.values(v).forEach(walk);
    }
  };
  walk(content);
  return out;
}

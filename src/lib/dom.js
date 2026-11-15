// DOM helpers. Final: shared by guest site and editor.

/** querySelector shortcut. @param {string} sel @param {ParentNode} [root] @returns {Element|null} */
export const $ = (sel, root = document) => root.querySelector(sel);
/** querySelectorAll as a real array. @param {string} sel @param {ParentNode} [root] @returns {Element[]} */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape a value for use in HTML text or attribute values. */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

class Raw {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}
/** Mark a string as trusted HTML so html`` will not escape it. @param {string} s @returns {Raw} */
export const raw = (s) => new Raw(s);

const render = (v) => {
  if (v == null || v === false || v === true) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  return esc(v);
};

/**
 * Tagged template that escapes every interpolation.
 * Arrays are joined, raw() values and nested html`` results pass through, null/undefined/false render as "".
 * The result is a Raw object: assign it to innerHTML directly (it stringifies) or nest it in another html``.
 * @returns {Raw}
 */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/** Escape text and turn "\n" into <br>. @param {string} s @returns {Raw} */
export const multiline = (s) => raw(esc(s).replace(/\r?\n/g, "<br>"));

/** Read "a.0.b" from obj. */
export function getPath(obj, path) {
  return String(path).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
/** Write "a.0.b" into obj, creating containers as needed. Returns obj. */
export function setPath(obj, path, value) {
  const keys = String(path).split(".");
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => {
    if (o[k] == null || typeof o[k] !== "object") o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
  o[keys[keys.length - 1]] = value;
  return obj;
}

/** True when the page is running inside the editor. */
export const isEdit = () => document.documentElement.dataset.mode === "edit";
/** In edit mode every field renders (so it can be clicked); in guest mode only non-empty ones do. */
export const showField = (value) => isEdit() || (Array.isArray(value) ? value.length > 0 : value != null && value !== "");

/**
 * Attributes that make an element editable. Safe to call in guest mode (emits only data-path).
 * @param {"text"|"multiline"|"image"} kind
 * @param {string} path dot path into content.json, e.g. "hotels.0.name"
 * @param {{placeholder?: string}} [opts]
 * @returns {Raw} attribute string, e.g. html`<h3 ${editAttrs("text","hotels.0.name",{placeholder:"Add hotel name"})}>`
 */
export function editAttrs(kind, path, { placeholder } = {}) {
  if (!isEdit()) return raw(`data-path="${esc(path)}"`);
  return raw(
    `data-edit="${esc(kind)}" data-path="${esc(path)}"` + (placeholder ? ` data-placeholder="${esc(placeholder)}"` : "")
  );
}

/** Container of a reorderable list: data-list="hotels". @param {string} path @param {{sort?: string}} [opts] */
export const listAttrs = (path, { sort } = {}) => raw(`data-list="${esc(path)}"` + (sort ? ` data-sort="${esc(sort)}"` : ""));
/** Child of a list: data-item="hotels.3" data-index="3". */
export const itemAttrs = (path, index) => raw(`data-item="${esc(path)}.${index}" data-index="${index}"`);

/**
 * Build an <img> for an Image object (CONTRACTS 5.1): focal object-position, srcset when srcSmall exists, edit attrs.
 * Returns "" when there is no image, except in edit mode with `path` (renders a placeholder box so it can be clicked).
 * @param {{src:string, srcSmall?:string, alt?:string, focal?:[number,number]}|null|undefined} image
 * @param {{cls?: string, eager?: boolean, sizes?: string, path?: string}} [opts]
 * @returns {Raw}
 */
export function imgTag(image, { cls = "", eager = false, sizes, path } = {}) {
  const attrs = path ? editAttrs("image", path) : raw("");
  if (!image || !image.src) {
    return isEdit() && path ? html`<img class="${cls}" ${attrs} alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3Crect width='4' height='3' fill='%23ccc'/%3E%3C/svg%3E" data-placeholder="Add image">` : raw("");
  }
  const f = Array.isArray(image.focal) ? image.focal : [50, 50];
  const srcset = image.srcSmall ? ` srcset="${esc(image.srcSmall)} 600w, ${esc(image.src)} 1600w" sizes="${esc(sizes || "100vw")}"` : "";
  return raw(
    `<img class="${esc(cls)}" src="${esc(image.src)}"${srcset} alt="${esc(image.alt ?? "")}" ` +
      `style="object-position:${+f[0]}% ${+f[1]}%" loading="${eager ? "eager" : "lazy"}" decoding="async" ${attrs}>`
  );
}

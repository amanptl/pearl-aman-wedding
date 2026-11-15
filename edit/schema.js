// Schema helpers: $ref resolution, schema lookup by content path, defaults, labels, slugs.
import { getPath } from "../src/lib/dom.js";

export function createSchemaTools(root) {
  const refTarget = (ref) => ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], root);
  /** Resolve $ref chains; sibling keys (title/description) override the target's. */
  function resolve(s) {
    let guard = 0;
    while (s && s.$ref && guard++ < 10) {
      const { $ref, ...rest } = s;
      s = { ...refTarget($ref), ...rest };
    }
    return s;
  }
  const isImage = (s) => {
    s = resolve(s);
    if (!s) return false;
    if (s["x-widget"] === "image") return true;
    return Array.isArray(s.oneOf) && s.oneOf.some((o) => resolve(o)?.["x-widget"] === "image");
  };
  const imageSchema = (s) => {
    s = resolve(s);
    if (s?.["x-widget"] === "image") return s;
    return resolve(s.oneOf.find((o) => resolve(o)?.["x-widget"] === "image"));
  };
  const nullable = (s) => Array.isArray(resolve(s)?.oneOf) && resolve(s).oneOf.some((o) => resolve(o)?.type === "null");

  /** Schema for a content path like "hotels.2.photo" (resolved). Null when unknown. */
  function schemaAt(path) {
    let s = resolve(root);
    if (!path) return s;
    for (const seg of String(path).split(".")) {
      if (!s) return null;
      if (isImage(s)) s = imageSchema(s);
      if (s.type === "array" || s.items) s = /^\d+$/.test(seg) ? resolve(s.items) : null;
      else if (s.properties && seg in s.properties) s = resolve(s.properties[seg]);
      else if (s.additionalProperties && typeof s.additionalProperties === "object") s = resolve(s.additionalProperties);
      else return null;
    }
    return s;
  }

  const slug = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  const rand = () => Math.random().toString(36).slice(2, 8);
  function uniqueId(arr, base) {
    const taken = new Set((arr || []).map((x) => x && x.id));
    const stem = slug(base) || `item-${rand()}`;
    let id = stem;
    let n = 2;
    while (taken.has(id)) id = `${stem}-${n++}`;
    return id;
  }

  /** Default value for a schema node. ctx.arr is the sibling array (for ids), ctx.content the draft. */
  function defaultFor(s, ctx = {}) {
    s = resolve(s);
    if (!s) return "";
    if (isImage(s)) return nullable(s) ? null : { src: "", alt: "", focal: [50, 50] };
    if (s.default !== undefined) return structuredClone(s.default);
    if (s.oneOf) return null;
    switch (s.type) {
      case "object": {
        const o = {};
        const req = new Set(s.required || []);
        for (const [k, sub] of Object.entries(s.properties || {})) {
          const r = resolve(sub);
          if (k === "id") o.id = uniqueId(ctx.arr, "");
          else if (isImage(r)) { if (nullable(r) || req.has(k)) o[k] = defaultFor(r, ctx); }
          else if (req.has(k) || r.type === "array" || r.type === "string" || r.type === "boolean") o[k] = defaultFor(sub, ctx);
        }
        return o;
      }
      case "array": return [];
      case "boolean": return false;
      case "number": case "integer": return 0;
      case "string":
        if (s.enum) return s.enum[0];
        if (s.format === "date-time-local") return ctx.content?.site?.weddingDate || "2027-01-01T12:00";
        if (s.format === "date") return new Date().toISOString().slice(0, 10);
        return "";
      default: return "";
    }
  }

  const NOUN = { events: "event", hotels: "hotel", faq: "question", faqCategories: "category", "travel.airports": "airport", "travel.gettingAround": "transport option", "travel.shuttles": "shuttle", "travel.aroundTown": "place", "story.paragraphs": "paragraph", "story.photos": "photo", "registry.links": "link", "registry.paragraphs": "paragraph", people: "person", "site.contacts": "contact", "rsvp.intro": "paragraph", "rsvp.mealOptions": "meal option", "rsvp.dietaryOptions": "option" };
  const noun = (listPath) => NOUN[listPath] || (resolve(schemaAt(listPath)?.items)?.title || "item").toLowerCase();

  function itemLabel(v) {
    if (v == null) return "";
    if (typeof v === "string") return v.length > 40 ? v.slice(0, 38) + "…" : v;
    if (typeof v !== "object") return String(v);
    const t = String(v.name ?? v.title ?? v.q ?? v.label ?? v.city ?? v.household ?? v.code ?? v.id ?? v.eventId ?? "");
    return t.length > 40 ? t.slice(0, 38) + "…" : t;
  }

  /** Breadcrumb parts for a content path: [{label, path}] */
  function crumbs(path, draft) {
    const segs = path.split(".");
    const out = [];
    let acc = "";
    for (let i = 0; i < segs.length; i++) {
      acc = acc ? `${acc}.${segs[i]}` : segs[i];
      if (/^\d+$/.test(segs[i])) {
        const label = itemLabel(getPath(draft, acc)) || `${noun(segs.slice(0, i).join("."))} ${+segs[i] + 1}`;
        out.push({ label, path: acc });
      } else {
        out.push({ label: schemaAt(acc)?.title || segs[i], path: acc });
      }
    }
    return out;
  }
  return { resolve, isImage, imageSchema, nullable, schemaAt, defaultFor, uniqueId, slug, noun, itemLabel, crumbs, root };
}

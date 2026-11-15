// Loading and validating content. Final.

/**
 * Fetch content.json (always revalidated).
 * @param {string} [url] default "content/content.json" (relative to the page; the editor passes "../content/content.json")
 * @returns {Promise<object>}
 */
export async function loadContent(url = "content/content.json") {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

/**
 * Fetch the encrypted guest index. Returns { records: {}, names: {} } when the file is missing or invalid.
 * @param {string} [url]
 * @returns {Promise<{v?:number, kdf?:{iter:number,salt:string}, records:object, names:object}>}
 */
export async function loadGuests(url = "content/guests.json") {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return { records: {}, names: {} };
    const j = await res.json();
    return { records: {}, names: {}, ...j };
  } catch {
    return { records: {}, names: {} };
  }
}

const FORMATS = {
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
  "date-time-local": (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v) && !Number.isNaN(Date.parse(v)),
  uri: (v) => { try { new URL(v); return true; } catch { return false; } },
  color: (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v),
  tel: (v) => /^\+?[0-9 ()\-.]{5,}$/.test(v),
};

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const typeOk = (t, v) => t === typeOf(v) || (t === "number" && typeOf(v) === "integer");

/**
 * Small JSON-Schema validator (no external libs). Covers $ref, type, enum, required, properties,
 * items, additionalProperties(schema), oneOf, min/max, minItems/maxItems, pattern and the formats
 * date, date-time-local, uri, color, tel. Empty strings skip format checks (optional fields).
 * @param {object} content
 * @param {object} schema
 * @returns {{path: string, message: string}[]}
 */
export function validate(content, schema) {
  const errors = [];
  const resolve = (s) => {
    while (s && s.$ref) {
      const target = s.$ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], schema);
      const { $ref, ...rest } = s;
      s = { ...target, ...rest };
    }
    return s;
  };
  const walk = (value, s, path) => {
    s = resolve(s);
    if (!s || typeof s !== "object") return;
    const at = path || "(root)";
    if (s.oneOf) {
      const ok = s.oneOf.some((alt) => {
        const sub = validate_(value, alt, path);
        return sub.length === 0;
      });
      if (!ok) errors.push({ path: at, message: "Does not match any allowed shape" });
      return;
    }
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeOk(t, value))) {
        errors.push({ path: at, message: `Expected ${types.join(" or ")}, got ${typeOf(value)}` });
        return;
      }
    }
    if (s.enum && !s.enum.includes(value)) errors.push({ path: at, message: `Must be one of: ${s.enum.join(", ")}` });
    if (typeof value === "string") {
      if (s.format && value !== "" && FORMATS[s.format] && !FORMATS[s.format](value)) errors.push({ path: at, message: `Invalid ${s.format}` });
      if (s.pattern && value !== "" && !new RegExp(s.pattern).test(value)) errors.push({ path: at, message: "Invalid format" });
    }
    if (typeof value === "number") {
      if (s.minimum != null && value < s.minimum) errors.push({ path: at, message: `Must be at least ${s.minimum}` });
      if (s.maximum != null && value > s.maximum) errors.push({ path: at, message: `Must be at most ${s.maximum}` });
    }
    if (Array.isArray(value)) {
      if (s.minItems != null && value.length < s.minItems) errors.push({ path: at, message: `Needs at least ${s.minItems} items` });
      if (s.maxItems != null && value.length > s.maxItems) errors.push({ path: at, message: `At most ${s.maxItems} items` });
      if (s.items) value.forEach((v, i) => walk(v, s.items, path ? `${path}.${i}` : String(i)));
    } else if (value && typeof value === "object") {
      for (const k of s.required || []) if (value[k] === undefined) errors.push({ path: path ? `${path}.${k}` : k, message: "Required" });
      for (const [k, sub] of Object.entries(s.properties || {})) if (value[k] !== undefined) walk(value[k], sub, path ? `${path}.${k}` : k);
      if (s.additionalProperties && typeof s.additionalProperties === "object") {
        for (const [k, v] of Object.entries(value)) if (!(s.properties && k in s.properties)) walk(v, s.additionalProperties, path ? `${path}.${k}` : k);
      }
    }
  };
  // oneOf helper: validate in isolation
  const validate_ = (value, s, path) => {
    const before = errors.length;
    walk(value, s, path);
    return errors.splice(before);
  };
  walk(content, schema, "");
  return errors;
}

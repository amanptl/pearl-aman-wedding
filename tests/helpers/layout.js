import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Page must not scroll horizontally. */
export async function assertNoHorizontalOverflow(page) {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    bw: document.body.scrollWidth,
  }));
  expect(r.sw, `documentElement.scrollWidth ${r.sw} > innerWidth ${r.iw}`).toBeLessThanOrEqual(r.iw);
  expect(r.bw, `body.scrollWidth ${r.bw} > innerWidth ${r.iw}`).toBeLessThanOrEqual(r.iw);
}

/**
 * Visible elements matching `selector` must not intersect each other.
 * Ignores [aria-hidden=true] and anything inside [data-decor]. Ancestor/descendant pairs are skipped.
 */
export async function assertNoOverlaps(page, selector) {
  const clashes = await page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)].filter((el) => {
      if (el.closest("[aria-hidden=true], [data-decor]")) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const out = [];
    const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "") + ` "${(el.textContent || "").trim().slice(0, 24)}"`;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 1 && h > 1) out.push(`${name(a)} overlaps ${name(b)}`);
      }
    }
    return out;
  }, selector);
  expect(clashes, "overlapping elements").toEqual([]);
}

/** Elements with overflow:hidden must not hide content, unless marked [data-allow-clip]. */
export async function assertNoClippedText(page) {
  const clipped = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("[data-allow-clip], [data-decor], [aria-hidden=true]")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (!/hidden|clip/.test(cs.overflowX + cs.overflowY)) continue;
      if (el.clientWidth <= 1 && el.clientHeight <= 1) continue;
      if (["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE"].includes(el.tagName.toUpperCase())) continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, ".")} scroll ${el.scrollWidth}x${el.scrollHeight} client ${el.clientWidth}x${el.clientHeight} "${(el.textContent || "").trim().slice(0, 30)}"`);
      }
    }
    return out;
  });
  expect(clipped, "clipped content").toEqual([]);
}

/** Freeze the page clock at an ISO instant (include a zone, e.g. 2027-07-23T12:00:00-04:00). Call before page.goto. */
export async function freezeTime(page, iso) {
  await page.clock.setFixedTime(new Date(iso));
}

/** Run axe with WCAG 2.2 AA tags and return the violations array. */
export async function runAxe(page, { include, exclude } = {}) {
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) b = b.include(include);
  if (exclude) b = b.exclude(exclude);
  const res = await b.analyze();
  return res.violations;
}

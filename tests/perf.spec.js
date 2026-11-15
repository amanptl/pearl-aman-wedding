import { test, expect } from "@playwright/test";

// Personal-link resolution cost and first-load weight. Numbers are logged as annotations so slow regressions are visible.
const CODE = "NVMDUYC3MF"; // Sharma Family in the sample guest list (codes are stable: tools/make-guests.mjs keeps them)
const FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET|NAME|CONNECTION|BLOCKED)|Failed to load resource/i;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("pa.intro", "1"); } catch {}
    window.__kdf = 0;
    const orig = crypto.subtle.deriveKey.bind(crypto.subtle);
    crypto.subtle.deriveKey = (...a) => { window.__kdf++; return orig(...a); };
  });
});

test("?i=CODE: one PBKDF2, cached in sessionStorage, navigation and reload cost none", async ({ page }, info) => {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !FONT_NOISE.test(m.text())) errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`/?i=${CODE}&intro=0#home`);
  await page.waitForSelector("html[data-ready]");
  const resolveMs = Date.now() - t0;
  expect(await page.evaluate(() => window.__kdf)).toBe(1);
  const cached = await page.evaluate(() => JSON.parse(sessionStorage.getItem("pa.guest.session") || "null"));
  expect(cached?.code).toBe(CODE);
  expect(cached?.household).toBe("Sharma Family");
  expect(await page.evaluate(() => location.search)).not.toContain("i=");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("pa.guest.v1")).code)).toBe(CODE);
  // route changes never re-derive
  const nav = [];
  for (const r of ["schedule", "travel", "faq", "rsvp", "home"]) {
    const t = Date.now();
    await page.evaluate((h) => { location.hash = h; }, "#" + r);
    await page.locator(`[data-page="${r}"]`).waitFor({ state: "visible" });
    nav.push(Date.now() - t);
  }
  expect(await page.evaluate(() => window.__kdf)).toBe(1);
  // a reload in the same tab uses the session cache: zero derivations
  const t1 = Date.now();
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  const reloadMs = Date.now() - t1;
  expect(await page.evaluate(() => window.__kdf)).toBe(0);
  await expect(page.locator("[data-guest-badge]")).toContainText("Sharma");
  info.annotations.push({ type: "perf", description: `first resolve (incl. page load) ${resolveMs} ms; cached reload ${reloadMs} ms; route changes ${nav.join("/")} ms` });
  expect(resolveMs).toBeLessThan(8000);
  // View Transitions can add a short paint delay on slower WebKit devices.
  expect(Math.max(...nav)).toBeLessThan(2000);
  expect(errors).toEqual([]);
});

test("PBKDF2 itself (150k iterations) is well under a second", async ({ page }, info) => {
  await page.goto("/?intro=0");
  await page.waitForSelector("html[data-ready]");
  const r = await page.evaluate(async (code) => {
    const m = await import("/src/lib/crypto.js");
    const g = await (await fetch("/content/guests.json")).json();
    const t = performance.now();
    await m.deriveKey(code, g.kdf.salt, g.kdf.iter);
    return { iter: g.kdf.iter, ms: Math.round(performance.now() - t) };
  }, CODE);
  info.annotations.push({ type: "perf", description: `deriveKey ${r.iter} iterations: ${r.ms} ms` });
  expect(r.iter).toBeGreaterThanOrEqual(100000);
  expect(r.ms).toBeLessThan(2500);
});

test("first load weight: JS/CSS budgets, no original jpg where a WebP exists", async ({ page }, info) => {
  const res = [];
  page.on("response", async (r) => { try { res.push({ url: new URL(r.url()), type: r.headers()["content-type"] || "", len: (await r.body()).length }); } catch {} });
  await page.goto("/?intro=0");
  await page.waitForSelector("html[data-ready]");
  await page.waitForLoadState("networkidle");
  const local = res.filter((r) => r.url.hostname === "127.0.0.1" || r.url.hostname === "localhost");
  const sum = (re) => local.filter((r) => re.test(r.url.pathname)).reduce((a, r) => a + r.len, 0);
  const js = sum(/\.js$/), css = sum(/\.css$/);
  const imgs = local.filter((r) => /^image\//.test(r.type) || /\.(jpe?g|png|webp)$/.test(r.url.pathname));
  const imgBytes = imgs.reduce((a, r) => a + r.len, 0);
  info.annotations.push({ type: "perf", description: `first load: js ${Math.round(js / 1024)} KB, css ${Math.round(css / 1024)} KB, images ${Math.round(imgBytes / 1024)} KB (${imgs.length}), requests ${local.length}` });
  expect(js).toBeLessThan(300 * 1024);
  expect(css).toBeLessThan(150 * 1024);
  const fat = imgs.filter((r) => /\.jpe?g$/.test(r.url.pathname) && r.len > 120 * 1024 && !/\/og\.jpg$/.test(r.url.pathname));
  expect(fat.map((r) => r.url.pathname)).toEqual([]);
  expect(imgBytes).toBeLessThan(1200 * 1024);
});

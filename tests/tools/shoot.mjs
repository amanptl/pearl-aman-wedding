// Throwaway visual QA tool. Usage: node tests/tools/shoot.mjs [outdir] [--quick]
import { chromium } from "@playwright/test";
const OUT = process.argv[2] || "tests/screens/qa-a/r1";
const quick = process.argv.includes("--quick");
import fs from "node:fs";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:5208/";
const widths = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : quick ? [375, 1440] : [320, 375, 393, 768, 1024, 1280, 1440];
const routes = ["home", "schedule", "travel", "story", "faq", "registry", "rsvp"];
const variants = {
  plain: "?intro=0",
  fam: "?intro=0&guest=tests/fixtures/guest-family.json",
  stress: "?intro=0&content=tests/fixtures/stress.json&guest=tests/fixtures/guest-family.json",
};
const browser = await chromium.launch();
async function open(w, qs, route) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 800 : 900 }, deviceScaleFactor: 1, isMobile: w < 768, hasTouch: w < 768 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${qs}#${route}`);
  await page.waitForSelector("[data-page]", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  return { ctx, page };
}
const only = process.argv.find(a => a.startsWith("--only="))?.slice(7);
for (const [vn, qs] of Object.entries(variants)) {
  if (only && !only.split(",").includes(vn)) continue;
  for (const r of routes) for (const w of widths) {
    const { ctx, page } = await open(w, qs, r);
    const base = `${OUT}/${vn}-${r}-${w}`;
    await page.screenshot({ path: `${base}-top.png` });
    await page.addStyleTag({ content: ".tabbar,.help-fab{visibility:hidden!important}" });
    await page.screenshot({ path: `${base}-full.png`, fullPage: true });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (sw > 0) console.log("H-SCROLL", vn, r, w, sw);
    await ctx.close();
  }
}
// special states
if (!only || only.includes("states")) for (const w of [375, 1440]) {
  const g = variants.fam;
  let { ctx, page } = await open(w, g, "rsvp");
  const shot = (n) => page.screenshot({ path: `${OUT}/rsvp-${n}-${w}.png`, fullPage: true });
  await shot("step1");
  for (let i = 2; i <= 4; i++) {
    const next = page.locator("button:has-text('Continue'), button:has-text('Next'), button.btn--primary").last();
    if (await next.count()) { await next.click().catch(() => {}); await page.waitForTimeout(500); await shot("step" + i); }
  }
  await ctx.close();
  ({ ctx, page } = await open(w, g, "home"));
  await page.locator("#help").click().catch(() => {}); await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/sheet-help-${w}.png` });
  await ctx.close();
  ({ ctx, page } = await open(w, g, "schedule"));
  await page.locator("#help").click().catch(() => {}); await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/sheet-help-sched-${w}.png` });
  await page.keyboard.press("Escape");
  const cal = page.locator("button:has-text('calendar'), a:has-text('calendar')").first();
  if (await cal.count()) { await cal.click().catch(() => {}); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/sheet-cal-${w}.png` }); }
  await ctx.close();
  if (w < 768) {
    ({ ctx, page } = await open(w, g, "faq"));
    await page.locator("#tabbar button").last().click().catch(() => {}); await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/sheet-more-${w}.png` });
    await page.keyboard.press("Escape");
    await ctx.close();
  }
  ({ ctx, page } = await open(w, g, "faq"));
  const q = page.locator("[data-page=faq] button[aria-expanded]").first();
  if (await q.count()) { await q.click(); await page.waitForTimeout(500); }
  await page.screenshot({ path: `${OUT}/faq-open-${w}.png` });
  await ctx.close();
  ({ ctx, page } = await open(w, "?intro=0&edit=1", "travel"));
  await page.screenshot({ path: `${OUT}/edit-travel-${w}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log("done");

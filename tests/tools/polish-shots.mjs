// Capture polish before/after screenshots: intro, Home, Schedule, Travel, RSVP @ 375/768/1280 + reduced motion.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = process.argv[2] || "tests/screens/polish-before";
const BASE = process.argv[3] || "http://127.0.0.1:5173/";
fs.mkdirSync(OUT, { recursive: true });

const widths = [375, 768, 1280];
const routes = ["home", "schedule", "travel", "rsvp"];
const browser = await chromium.launch();

async function shot(label, page) {
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: false });
}

async function open(w, { qs = "?intro=0", hash = "home", reduced = false, keepIntro = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: w < 768 ? 812 : 900 },
    deviceScaleFactor: 1,
    isMobile: w < 768,
    hasTouch: w < 768,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const page = await ctx.newPage();
  if (!keepIntro) {
    await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
  } else {
    await page.addInitScript(() => { try { sessionStorage.removeItem("pa.intro"); } catch {} });
  }
  const url = `${BASE}${qs}${qs.includes("#") ? "" : `#${hash}`}`;
  await page.goto(url);
  await page.waitForSelector("html[data-ready]", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  return { ctx, page };
}

for (const w of widths) {
  // Intro (envelope visible)
  {
    const { ctx, page } = await open(w, { qs: "", hash: "home", keepIntro: true });
    await page.waitForSelector("#intro:not([hidden])", { timeout: 8000 }).catch(() => {});
    await shot(`intro-${w}`, page);
    await ctx.close();
  }
  // Pages without intro
  for (const r of routes) {
    const { ctx, page } = await open(w, { hash: r });
    await shot(`${r}-${w}`, page);
    await ctx.close();
  }
  // Reduced motion: intro + home
  {
    const { ctx, page } = await open(w, { qs: "", hash: "home", keepIntro: true, reduced: true });
    await page.waitForSelector("#intro:not([hidden])", { timeout: 8000 }).catch(() => {});
    await shot(`intro-rm-${w}`, page);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(w, { hash: "home", reduced: true });
    await shot(`home-rm-${w}`, page);
    await ctx.close();
  }
}

await browser.close();
console.log(`wrote shots to ${OUT}`);

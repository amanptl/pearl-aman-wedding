import { chromium } from "@playwright/test";
const [,, url, out, w, clip] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: 900 }, deviceScaleFactor: 2 });
await p.addInitScript(() => sessionStorage.setItem("pa.intro", "1"));
await p.goto(url); await p.waitForSelector("html[data-ready]"); await p.waitForTimeout(1500);
const el = await p.$(clip);
await el.screenshot({ path: out });
await b.close();

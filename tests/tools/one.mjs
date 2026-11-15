// node tests/tools/one.mjs "<query>" route width out.png [full]
import { chromium } from "@playwright/test";
const [q, route, w, out, full] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: +w, height: +w < 768 ? 800 : 900 }, isMobile: +w < 768, hasTouch: +w < 768 });
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:5208/?intro=0${q}#${route}`); await p.waitForTimeout(1200);
if (full) await p.addStyleTag({ content: ".tabbar,.help-fab{visibility:hidden!important}" });
await p.screenshot({ path: out, fullPage: !!full }); await b.close();

import { chromium } from "@playwright/test";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://127.0.0.1:5208/?intro=0&content=tests/fixtures/stress.json&guest=tests/fixtures/guest-family.json#travel");
await p.waitForTimeout(1500);
console.log(await p.evaluate(() => [...document.querySelectorAll(".hotel-name")].slice(0,2).map(e => ({ t: e.textContent, h: e.clientHeight, sh: e.scrollHeight, ch: getComputedStyle(e).display }))));
await b.close();

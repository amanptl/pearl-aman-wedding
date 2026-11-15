import { chromium } from "@playwright/test";
const OUT = process.argv[2];
const b = await chromium.launch();
for (const w of [375, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, isMobile: w < 768, hasTouch: w < 768 });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:5208/?intro=0&guest=tests/fixtures/guest-family.json#rsvp"); await p.waitForTimeout(1200);
  const shot = async (n) => { await p.addStyleTag({ content: ".tabbar,.help-fab{visibility:hidden!important}" }); await p.screenshot({ path: `${OUT}/rsvp-${n}-${w}.png`, fullPage: true }); };
  await p.getByRole("button", { name: /everyone, all events/i }).click(); await p.waitForTimeout(300);
  await shot("s1");
  for (let i = 2; i <= 3; i++) {
    await p.getByRole("button", { name: /continue|next|review/i }).last().click(); await p.waitForTimeout(600);
    await shot("s" + i);
  }
  const send = p.getByRole("button", { name: /send|submit|confirm/i }).last();
  if (await send.count()) { await send.click(); await p.waitForTimeout(1500); await shot("done"); }
  await ctx.close();
}
await b.close();

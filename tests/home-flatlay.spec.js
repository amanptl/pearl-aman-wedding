// Home flat lay (Etsy-style), on every screen size: one centre line in the template's order —
// photo envelope → invitation card → Details → "Kindly Rsvp" → Respond (just under the script).
// The lace bow stays in the artwork underneath as the scroll cue. Desktop may shrink the board
// so the script + Respond clear the fold; phones/tablets show the tall crop.
import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow } from "./helpers/layout.js";

const URL = "/?intro=0&guest=tests/fixtures/guest-family.json#home";
const boxes = (page) => page.evaluate(() => {
  const get = (sel) => { const r = document.querySelector(`[data-page="home"] ${sel}`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, bottom: r.y + r.height }; };
  return { env: get(".env-pocket"), card: get(".invite"), details: get(".tag-details"), rsvp: get(".rsvp-word"), respond: get(".tag-respond"), seal: get(".board-seal") };
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
});

test("pieces stack on one centre line in the template's order, without overlapping", async ({ page }, info) => {
  const desktop = /desktop/.test(info.project.name);
  await page.goto(URL);
  await page.waitForSelector("html[data-ready]");
  await page.waitForTimeout(1500); // let the entrance animations settle
  const b = await boxes(page);
  const axis = b.card.cx;
  for (const k of ["env", "details", "respond"]) expect(Math.abs(b[k].cx - axis), `${k} centred on the card`).toBeLessThan(2);
  // Order, top to bottom, with clear gaps
  expect(b.env.bottom).toBeLessThan(b.card.y);
  expect(b.card.bottom).toBeLessThan(b.details.y);
  expect(b.details.bottom).toBeLessThan(b.rsvp.y + b.rsvp.h * 0.25); // script line sits just below Details
  expect(b.rsvp.bottom).toBeLessThan(b.respond.y);
  expect(b.respond.y - b.rsvp.bottom, "Respond sits just under the script").toBeLessThan(32);
  // Readable sizes (board may shrink on short viewports so the script + Respond clear the fold)
  expect(b.card.w).toBeGreaterThan(desktop ? 170 : 160);
  expect(b.details.h).toBeGreaterThanOrEqual(desktop ? 40 : 44);
  expect(b.respond.h).toBeGreaterThanOrEqual(desktop ? 40 : 44);
  // Our P&A seal sits on the artwork's wax-sealed envelope (left of the card) at every size
  expect(b.seal.w).toBeGreaterThan(28);
  expect(b.seal.cx).toBeLessThan(b.card.x);
  await assertNoHorizontalOverflow(page);
});

test("desktop: Details and Respond still navigate", async ({ page }, info) => {
  test.skip(!/desktop/.test(info.project.name), "desktop layout only");
  await page.goto(URL);
  await page.waitForSelector("html[data-ready]");
  await page.locator('[data-page="home"] .tag-details').click();
  await expect(page).toHaveURL(/#schedule$/);
  await page.goto(URL);
  await page.waitForSelector("html[data-ready]");
  await page.locator('[data-page="home"] .tag-respond').click();
  await expect(page).toHaveURL(/#rsvp$/);
});

test("the artwork's bow replaces the separate bow image on every screen", async ({ page }) => {
  await page.goto(URL);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator('[data-page="home"] .bow')).toBeHidden();
  await expect(page.locator('[data-page="home"] .board-seal')).toBeVisible();
});

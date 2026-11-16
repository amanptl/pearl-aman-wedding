// Home flat lay (Etsy-style), on every screen size: one centre line in the template's order —
// photo envelope → invitation card → "Kindly Rsvp" → Respond (just under the script).
// A fixed chevron cues the scroll to the welcome block. Desktop may shrink the board
// so the script + Respond clear the fold; phones/tablets show the tall crop.
import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow } from "./helpers/layout.js";

const URL = "/?intro=0&guest=tests/fixtures/guest-family.json#home";
const boxes = (page) => page.evaluate(() => {
  const get = (sel) => { const r = document.querySelector(`[data-page="home"] ${sel}`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, bottom: r.y + r.height }; };
  return { env: get(".env-pocket"), card: get(".invite"), rsvp: get(".rsvp-word"), respond: get(".tag-respond"), seal: get(".board-seal") };
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
  for (const k of ["env", "respond"]) expect(Math.abs(b[k].cx - axis), `${k} centred on the card`).toBeLessThan(2);
  // Order, top to bottom, with clear gaps
  expect(b.env.bottom).toBeLessThan(b.card.y);
  expect(b.card.bottom).toBeLessThan(b.rsvp.y);
  expect(b.rsvp.bottom).toBeLessThan(b.respond.y);
  expect(b.respond.y - b.rsvp.bottom, "Respond sits just under the script").toBeLessThan(32);
  // Readable sizes (board may shrink on short viewports so the script + Respond clear the fold)
  expect(b.card.w).toBeGreaterThan(desktop ? 170 : 160);
  expect(b.respond.h).toBeGreaterThanOrEqual(desktop ? 40 : 44);
  // Our P&A seal sits on the artwork's wax-sealed envelope (left of the card) at every size
  expect(b.seal.w).toBeGreaterThan(28);
  expect(b.seal.cx).toBeLessThan(b.card.x);
  await assertNoHorizontalOverflow(page);
});

test("desktop: Respond still navigates", async ({ page }, info) => {
  test.skip(!/desktop/.test(info.project.name), "desktop layout only");
  await page.goto(URL);
  await page.waitForSelector("html[data-ready]");
  // Centre the tag first: a minimal scroll can leave it under the sticky top nav on a busy test machine.
  await page.locator('[data-page="home"] .tag-respond').evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.locator('[data-page="home"] .tag-respond').click();
  await expect(page).toHaveURL(/#rsvp$/);
});

test("scroll hint scrolls to the welcome block and hides once it is visible", async ({ page }) => {
  await page.goto(URL);
  await page.waitForSelector("html[data-ready]");
  const hint = page.locator(".scroll-hint");
  await expect(hint).toBeVisible();
  await hint.click({ force: true }); // it bobs forever, so it never reports "stable"
  await expect(page.locator('[data-page="home"] .welcome')).toBeInViewport();
  await expect(hint).toHaveClass(/is-gone/);
});

test("the artwork's bow replaces the separate bow image on every screen", async ({ page }) => {
  await page.goto(URL);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator('[data-page="home"] .bow')).toBeHidden();
  await expect(page.locator('[data-page="home"] .board-seal')).toBeVisible();
});

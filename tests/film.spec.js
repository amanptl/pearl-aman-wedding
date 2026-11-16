// The opening film (src/lib/film.js): it plays on the real home board, so its last frame must be the home page
// exactly as it looks with no intro, whether it plays out, is skipped mid-shot, or motion is reduced.
import { test, expect } from "@playwright/test";

const GUEST = "guest=tests/fixtures/guest-family.json";
const PIECES = [".env", ".env-photo", ".invite", ".rsvp-word", ".tag-respond"];

const rects = (page) => page.evaluate((sel) => Object.fromEntries(sel.map((s) => {
  const r = document.querySelector(`[data-page="home"] ${s}`).getBoundingClientRect();
  return [s, [r.x, r.y, r.width, r.height].map((v) => Math.round(v))];
})), PIECES);

async function restingLayout(page) {
  await page.goto(`/?intro=0&${GUEST}#home`);
  await page.waitForSelector("html[data-ready]");
  await page.waitForTimeout(300);
  return rects(page);
}

function expectSame(a, b) {
  for (const k of PIECES) for (let i = 0; i < 4; i++) expect(Math.abs(a[k][i] - b[k][i]), `${k}[${i}]`).toBeLessThanOrEqual(1);
}

async function sealed(page) {
  await page.goto(`/?${GUEST}`);
  await page.waitForSelector("#intro.is-ready");
  await expect(page.locator("html")).toHaveAttribute("data-film", "idle");
}

test("plays through and ends on the home page exactly", async ({ page }) => {
  const rest = await restingLayout(page);
  await sealed(page);
  await expect(page.locator(".env-name")).toHaveText("Sharma Family");
  await page.locator("#intro-open").click();
  await expect(page.locator("html")).toHaveAttribute("data-film", "play");
  await expect(page.locator("#intro")).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator("html")).not.toHaveAttribute("data-film", /.*/);
  await expect(page).toHaveURL(/#home$/);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length)).toBe(0);
  expectSame(await rects(page), rest);
  await expect(page.locator('[data-page="home"] h1')).toBeFocused();
});

test("Skip (Escape) mid-shot lands on the same last frame", async ({ page }) => {
  const rest = await restingLayout(page);
  await sealed(page);
  await page.locator("#intro-open").click();
  await page.waitForTimeout(1200);
  // Skip (Escape; the Skip button is hidden for guests) while the shot is still playing.
  await expect(page.locator("html")).toHaveAttribute("data-film", "play");
  await page.keyboard.press("Escape");
  await expect(page.locator("#intro")).toHaveCount(0, { timeout: 3000 });
  expectSame(await rects(page), rest);
});

test("reduced motion: the tap opens without the film", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const rest = await restingLayout(page);
  await sealed(page);
  await page.locator("#intro-open").click();
  await expect(page.locator("#intro")).toHaveCount(0, { timeout: 1500 });
  expectSame(await rects(page), rest);
});

test("the zoomed board never widens the page, and a public visitor's envelope has no name", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#intro.is-ready");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".env-name")).toHaveCount(0);
});

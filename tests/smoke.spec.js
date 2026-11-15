import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, assertNoClippedText, runAxe } from "./helpers/layout.js";
import fs from "node:fs";

const ROUTES = ["home", "schedule", "travel", "story", "faq", "registry", "rsvp"];
const LIVE_ROUTES = ROUTES.filter((r) => r !== "registry");
const FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET|NAME|CONNECTION|BLOCKED)|Failed to load resource/i;

function watchConsole(page) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !FONT_NOISE.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
});

for (const route of LIVE_ROUTES) {
  test(`route ${route}: h1, no errors, no overflow, axe clean`, async ({ page }, info) => {
    const errors = watchConsole(page);
    await open(page, `/#${route}`);
    const h1 = page.locator(`[data-page="${route}"] h1`).first();
    await expect(h1).toHaveCount(1);
    await expect(page.locator(`[data-page="${route}"]`)).toBeVisible();
    await page.waitForTimeout(300);
    await assertNoHorizontalOverflow(page);
    const bad = (await runAxe(page)).filter((v) => ["serious", "critical"].includes(v.impact));
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    expect(errors).toEqual([]);
    if (process.env.SHOTS && /iphone-se|desktop-1440/.test(info.project.name)) {
      fs.mkdirSync("tests/screens", { recursive: true });
      await page.screenshot({ path: `tests/screens/${info.project.name}-${route}.png`, fullPage: true });
    }
  });
}

for (const fixture of ["stress", "stress-empty"]) {
  test(`fixture ${fixture} renders without overflow or clipping on every route`, async ({ page }, info) => {
    const errors = watchConsole(page);
    for (const route of ROUTES) {
      await open(page, `/?content=tests/fixtures/${fixture}.json&all=1#${route}`);
      const expectRoute = fixture === "stress-empty" && route === "faq" ? "home" : route;
      await page.waitForFunction((r) => document.documentElement.dataset.route === r, expectRoute, { timeout: 5000 });
      const visibleRoute = await page.evaluate(() => document.documentElement.dataset.route);
      if (fixture === "stress-empty" && route === "faq") expect(visibleRoute).toBe("home");
      await assertNoHorizontalOverflow(page);
      await assertNoClippedText(page);
      if (process.env.SHOTS && /iphone-se|desktop-1440/.test(info.project.name)) {
        await page.screenshot({ path: `tests/screens/${info.project.name}-${fixture}-${route}.png`, fullPage: true });
      }
    }
    expect(errors).toEqual([]);
  });
}

test("stress fixture has 12 events over 4 days", async ({ page }) => {
  await open(page, "/?content=tests/fixtures/stress.json#schedule");
  await expect(page.locator(".event")).toHaveCount(12);
  await expect(page.locator(".day")).toHaveCount(4);
});

test("private events hidden by default; only a decrypted guest (dev fixture) adds them, ?all=1 alone cannot", async ({ page }) => {
  await open(page, "/#schedule");
  await expect(page.locator(".event")).toHaveCount(0);
  // content.json no longer holds events; they are private. ?all=1 still needs a guest fixture to show any.
  await open(page, "/?all=1#schedule");
  await expect(page.locator(".event")).toHaveCount(0);
  await open(page, "/?all=1&guest=tests/fixtures/guest-family.json#schedule");
  await expect(page.locator(".event")).toHaveCount(3);
});

test("registry is off: #registry opens home and the menu omits it", async ({ page }) => {
  const errors = watchConsole(page);
  await open(page, "/#registry");
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('[data-page="home"]')).toBeVisible();
  await expect(page.locator("#top-nav")).not.toContainText("Registry");
  await expect(page.locator("#tabbar")).not.toContainText("Registry");
  expect(errors).toEqual([]);
});

test("deep link #faq/<id> opens the answer", async ({ page }) => {
  await open(page, "/#faq/vegetarian");
  await expect(page.locator("#faq-vegetarian")).toHaveAttribute("open", "");
});

test("sealed envelope at / opens onto #home, and back reseals it", async ({ page }) => {
  await open(page, "/");
  await expect(page.locator("#intro")).toBeVisible();
  await page.locator("#intro-skip").click();
  await expect(page.locator("#intro")).toHaveCount(0);
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('[data-page="home"] h1')).toBeVisible();
  // #home is the opened invitation: a reload stays open.
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator("#intro")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator("#intro")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#intro")).toHaveCount(0);
  await expect(page).toHaveURL(/#home$/);
});

test("navigation: top nav on wide screens, tab bar and More sheet on narrow", async ({ page }) => {
  await open(page, "/#home");
  const width = page.viewportSize().width;
  if (width >= 768) {
    await expect(page.locator("#top-nav")).toBeVisible();
    await expect(page.locator("#tabbar")).toBeHidden();
    await page.locator("#top-nav a", { hasText: "Schedule" }).click();
    await expect(page.locator('[data-page="schedule"] h1')).toBeFocused();
  } else {
    await expect(page.locator("#tabbar")).toBeVisible();
    await expect(page.locator("#top-nav")).toBeHidden();
    await page.locator("#tabbar [data-more]").click();
    await expect(page.locator("dialog.sheet")).toBeVisible();
    await page.locator("dialog.sheet a", { hasText: "Our Story" }).click();
    await expect(page.locator('[data-page="story"]')).toBeVisible();
    await expect(page.locator("dialog.sheet")).toHaveCount(0);
  }
});

test("help button opens contacts sheet on inner pages", async ({ page }) => {
  await open(page, "/#faq");
  await page.locator("#help").click();
  await expect(page.locator("dialog.sheet")).toContainText("Priya");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.sheet")).toHaveCount(0);
});

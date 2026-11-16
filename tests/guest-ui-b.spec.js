import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, assertNoClippedText, assertNoOverlaps, runAxe } from "./helpers/layout.js";
import fs from "node:fs";

const FAMILY = "guest=tests/fixtures/guest-family.json";
const FRIEND = "guest=tests/fixtures/guest-friend.json";
const TRAVEL_DEMO = "content=tests/fixtures/content-travel-demo.json";

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
});

test("travel: copy group code puts it on the clipboard", async ({ page, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  else await page.addInitScript(() => {
    window.__copied = null;
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true });
  });
  await open(page, `/?${TRAVEL_DEMO}&${FAMILY}#travel`);
  const btn = page.locator('[data-page="travel"] .code-copy').first();
  const code = await page.locator('[data-page="travel"] .code').first().innerText();
  await btn.click();
  const got = browserName === "chromium" ? await page.evaluate(() => navigator.clipboard.readText()) : await page.evaluate(() => window.__copied);
  expect(got).toBe(code);
  await expect(page.locator("#toast")).toContainText("Copied group code");
});

test("travel: Book now opens in a new tab safely", async ({ page }) => {
  await open(page, `/?${TRAVEL_DEMO}&${FAMILY}#travel`);
  const a = page.locator('[data-page="travel"] .hotel-actions a.btn--primary').first();
  await expect(a).toHaveText(/Book now/);
  await expect(a).toHaveAttribute("target", "_blank");
  await expect(a).toHaveAttribute("rel", /noopener/);
  await expect(a).toHaveAttribute("aria-label", /Book now at .+/);
});

test("travel: hotel cards show drive times and align actions at the bottom", async ({ page }) => {
  await open(page, `/?${TRAVEL_DEMO}&${FAMILY}#travel`);
  await expect(page.locator('[data-page="travel"] .hotel').first().locator(".drives-list li").first()).toContainText(/~\d+ min to/);
  if (page.viewportSize().width >= 1000) {
    const bottoms = await page.locator('[data-page="travel"] .hotel-actions').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)));
    expect(new Set(bottoms).size).toBe(1);
  }
});

test("travel: shuttle table stays hidden unless the viewer can see that event", async ({ page }) => {
  await open(page, `/?${TRAVEL_DEMO}#travel`);
  await expect(page.locator('[data-page="travel"] .shuttle-table')).toHaveCount(0);
  await open(page, `/?${TRAVEL_DEMO}&${FRIEND}#travel`);
  await expect(page.locator('[data-page="travel"] .shuttle-table')).toHaveCount(0);
});

test("travel: placeholder hotel has no negotiated rate and shows coming-soon intro", async ({ page }) => {
  await open(page, "/#travel");
  const card = page.locator("#hotel-hotel-ehcc");
  await expect(card).toBeVisible();
  await expect(card.locator(".badge--outline")).toHaveCount(0);
  await expect(page.locator("#stay .sec-intro")).toContainText(/coming soon/i);
});

test("travel: segmented control scrolls and deep links work", async ({ page }) => {
  await open(page, `/?${FAMILY}#travel`);
  await page.locator('[data-seg="around"]').click();
  await expect(page.locator('[data-seg="around"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#around")).toBeInViewport();
  await open(page, `/?${FAMILY}#travel/getting-here`);
  await expect(page.locator("#getting-here")).toBeInViewport();
  await expect(page.locator('[data-seg="getting-here"]')).toHaveAttribute("aria-current", "true");
});

test("travel: empty hotels hides the stay segment", async ({ page }) => {
  await open(page, "/?content=tests/fixtures/stress-empty.json&all=1#travel");
  await expect(page.locator('[data-seg="stay"]')).toHaveCount(0);
  await expect(page.locator("#stay")).toHaveCount(0);
  await expect(page.locator('[data-seg="getting-here"]')).toHaveCount(1);
  await expect(page.locator('[data-page="travel"] h1')).toBeVisible();
});

test("faq: search narrows, highlights and announces", async ({ page }) => {
  await open(page, "/#faq");
  const items = page.locator('[data-page="faq"] .faq-item');
  const total = await items.count();
  await page.getByLabel("Search questions").fill("vegetarian");
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(total);
  await expect(page.locator('[data-page="faq"] .faq-item mark').first()).toBeVisible();
  await expect(page.locator("[data-count]")).toContainText(/\d+ questions? match/);
  await page.getByLabel("Search questions").fill("VEGÉTARIAN");
  expect(await items.count()).toBe(n);
  await page.getByLabel("Search questions").fill("<img src=x onerror=alert(1)>");
  await expect(page.locator('[data-page="faq"] .faq-empty')).toContainText("No answers match");
  await expect(page.locator('[data-page="faq"] .faq-empty a')).toContainText("WhatsApp");
  await page.locator("[data-clear]").click();
  expect(await items.count()).toBe(total);
});

test("faq: category chips filter", async ({ page }) => {
  await open(page, "/#faq");
  const items = page.locator('[data-page="faq"] .faq-item');
  const total = await items.count();
  await page.locator('[data-page="faq"] [data-cat]').nth(1).click();
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(total);
  await expect(page.locator('[data-page="faq"] [data-cat]').nth(1)).toHaveAttribute("aria-pressed", "true");
});

test("faq: deep link opens, focuses and copies link", async ({ page, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "/#faq/vegetarian");
  const item = page.locator("#faq-vegetarian");
  await expect(item).toHaveAttribute("open", "");
  await expect(item.locator("summary")).toBeFocused();
  await expect(item.locator(".faq-link")).toBeVisible();
  if (browserName === "chromium") {
    await item.locator(".faq-link").click();
    const t = await page.evaluate(() => navigator.clipboard.readText());
    expect(t).toMatch(/#faq\/vegetarian$/);
  }
  const other = page.locator('[data-page="faq"] .faq-item').first();
  await other.locator("summary").click();
  await expect(other).toHaveAttribute("open", "");
});

for (const fx of ["stress", "stress-empty"]) {
  for (const route of ["travel", "faq"]) {
    test(`layout ${route} with ${fx}`, async ({ page }) => {
      await open(page, `/?content=tests/fixtures/${fx}.json&all=1#${route}`);
      await page.waitForTimeout(200);
      await assertNoHorizontalOverflow(page);
      await assertNoClippedText(page);
      if (route === "travel") {
        await assertNoOverlaps(page, '[data-page="travel"] .hotel');
        await assertNoOverlaps(page, '[data-page="travel"] .hotel-actions > *');
      }
      if (route === "faq") await assertNoOverlaps(page, '[data-page="faq"] .faq-item');
    });
  }
}

for (const route of ["travel", "faq"]) {
  test(`axe ${route}: no serious or critical`, async ({ page }) => {
    await open(page, `/?${FAMILY}#${route}`);
    await page.waitForTimeout(300);
    if (route === "faq") {
      await page.locator('[data-page="faq"] .faq-item summary').first().click();
      // The answer fades in (260 ms); check contrast once it is fully opaque, not mid-animation.
      // Ignore endless loops (the home scroll hint's bob), which never finish.
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
    }
    const bad = (await runAxe(page)).filter((v) => ["serious", "critical"].includes(v.impact));
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });
  test(`screenshot ${route}`, async ({ page }, info) => {
    test.skip(!process.env.SHOTS || !/iphone-se|desktop-1440/.test(info.project.name));
    await open(page, `/?${FAMILY}#${route}`);
    await page.waitForTimeout(400);
    fs.mkdirSync("tests/screens", { recursive: true });
    await page.screenshot({ path: `tests/screens/1b-${info.project.name}-${route}.png`, fullPage: true });
  });
}

import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, assertNoOverlaps, assertNoClippedText, freezeTime, runAxe } from "./helpers/layout.js";
import fs from "node:fs";

const FAMILY = "tests/fixtures/guest-family.json";
const FRIEND = "tests/fixtures/guest-friend.json";
const FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET|NAME|CONNECTION|BLOCKED)|Failed to load resource/i;

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
});

test("family fixture: greeting, 3 events, quick actions", async ({ page }) => {
  await open(page, `/?guest=${FAMILY}#home`);
  await expect(page.locator("[data-greeting]")).toHaveText("Dear Sharma Family");
  await expect(page.locator(".quick-card", { hasText: "Schedule" })).toContainText("Your 3 events");
  await expect(page.locator(".welcome-dates")).toContainText("July 23");
  await open(page, `/?guest=${FAMILY}#schedule`);
  await expect(page.locator(".event")).toHaveCount(3);
});

test("friend fixture shows exactly its event", async ({ page }) => {
  await open(page, `/?guest=${FRIEND}#schedule`);
  await expect(page.locator(".event")).toHaveCount(1);
});

test("home without a guest offers the lookup slot", async ({ page }) => {
  await open(page, "/#home");
  await expect(page.locator(".lookup-card")).toHaveCount(1);
  await expect(page.locator("[data-greeting]")).toHaveCount(0);
});

test("RSVP card shows replied state from localStorage", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("pa.rsvp.v1.FAMILY2345", "{}"); } catch {} });
  await open(page, `/?guest=${FAMILY}#home`);
  await expect(page.locator(".quick-card", { hasText: "RSVP" })).toContainText("replied");
});

test("board tags navigate", async ({ page }) => {
  await open(page, "/#home");
  await page.locator(".tag-details").click();
  await expect(page.locator('[data-page="schedule"]')).toBeVisible();
  await page.goBack();
  await page.locator(".tag-respond").click();
  await expect(page.locator('[data-page="rsvp"]')).toBeVisible();
});

test("Up next badge goes to the next event", async ({ page }) => {
  await freezeTime(page, "2027-07-24T10:00:00-04:00");
  await open(page, `/?guest=${FAMILY}#schedule`);
  await expect(page.locator(".event .badge", { hasText: "Up next" })).toHaveCount(1);
  await expect(page.locator("#event-haldi .badge--gold")).toHaveText("Up next");
  await open(page, `/?guest=${FAMILY}#home`);
  await expect(page.locator(".nextup")).toHaveCount(0); // home card hidden for now (SHOW_NEXT_UP in src/pages/home.js)
});

test("Add all to calendar yields an .ics with one VEVENT per event", async ({ page }) => {
  await open(page, `/?guest=${FAMILY}#schedule`);
  await page.locator("[data-cal-all]").click();
  await expect(page.locator("dialog.sheet")).toBeVisible();
  await expect(page.locator("dialog.sheet .cal-links a")).toHaveCount(3);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("dialog.sheet [data-ics]").click()]);
  const path = await dl.path();
  const text = fs.readFileSync(path, "utf8");
  expect((text.match(/BEGIN:VEVENT/g) || []).length).toBe(3);
});

test("deep link highlights and scrolls to the event card", async ({ page }) => {
  await open(page, `/?guest=${FAMILY}#schedule/sangeet`);
  await expect(page.locator("#event-sangeet")).toHaveClass(/is-target/);
  await expect(page.locator("#event-sangeet")).toBeInViewport();
});

test("day picker scrolls to a day and tracks the active one", async ({ page }) => {
  await open(page, `/?guest=${FAMILY}#schedule`);
  const btn = page.locator(".daynav-btn").last();
  await btn.click();
  await expect(btn).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".day").last()).toBeInViewport();
});

test("what to wear expands and swatches have names", async ({ page }) => {
  await open(page, `/?guest=${FAMILY}#schedule`);
  const card = page.locator("#event-sangeet");
  await card.locator(".wear summary").click();
  await expect(card.locator(".wear-body")).toBeVisible();
  const sw = card.locator(".swatch").first();
  await expect(sw).toHaveAttribute("title", /.+/);
});

test("story people grid and registry image layer", async ({ page }) => {
  await open(page, "/?content=tests/fixtures/stress.json#registry");
  await expect(page.locator(".registry-bg img")).toHaveCount(1);
  await expect(page.locator(".registry-link").first()).toHaveAttribute("rel", /noopener/);
});

const ROUTES = ["home", "schedule", "story", "registry"];
for (const fx of ["", "stress", "stress-empty"]) {
  test(`layout clean on ${fx || "default"} content`, async ({ page }) => {
    const routes = fx ? ROUTES : ROUTES.filter((r) => r !== "registry");
    for (const r of routes) {
      const q = fx ? `content=tests/fixtures/${fx}.json&all=1&` : `guest=${FAMILY}&`;
      await open(page, `/?${q}#${r}`);
      await page.waitForTimeout(250);
      await assertNoHorizontalOverflow(page);
      await assertNoClippedText(page);
      await assertNoOverlaps(page, `[data-page="${r}"] :is(a, button, h1, h2, h3, .btn, .chip, .badge)`);
    }
  });
}

test("axe: no serious or critical violations", async ({ page }) => {
  for (const r of ROUTES.filter((id) => id !== "registry")) {
    await open(page, `/?guest=${FAMILY}#${r}`);
    await page.waitForTimeout(250);
    const bad = (await runAxe(page)).filter((v) => ["serious", "critical"].includes(v.impact));
    expect(bad.map((v) => `${r} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  }
});

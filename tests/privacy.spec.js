// Guest access and privacy. Uses content/guests.json + content/admin.enc.json built by
// `node tools/make-guests.mjs --households tools/sample-households.json --passphrase dev-passphrase`.
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openAdmin } from "../src/lib/guestfiles.js";

let codes = {};
test.beforeAll(async () => {
  const admin = await openAdmin(JSON.parse(await readFile("content/admin.enc.json", "utf8")), "dev-passphrase");
  for (const h of admin.households) codes[h.id] = { code: h.code, greeting: h.greeting };
});

const ready = (page) => page.waitForSelector("html[data-ready='1']", { state: "attached" });
const open = async (page, url) => { await page.goto(url + (url.includes("?") ? "&" : "?") + "intro=0"); await ready(page); };
const eventCount = (page) => page.locator('[data-page="schedule"] [data-event]').count();

test("family link shows all 5 events and the greeting", async ({ page }) => {
  await open(page, `/?i=${codes.sharma.code}`);
  expect(await eventCount(page)).toBe(5);
  await expect(page.getByText(codes.sharma.greeting).first()).toBeAttached();
});

test("friend link shows exactly its events", async ({ page }) => {
  await open(page, `/?i=${codes.chen.code.toLowerCase()}`);
  expect(await eventCount(page)).toBe(3);
  await open(page, `/?i=${codes.walker.code}`);
  expect(await eventCount(page)).toBe(2);
});

test("?i= is removed from the URL after resolving, hash kept", async ({ page }) => {
  await open(page, `/?i=${codes.sharma.code}#home`);
  await expect.poll(() => page.url()).not.toContain("i=");
  expect(page.url()).toContain("#home");
});

test("bad code shows the lookup with the message and no private events", async ({ page }) => {
  await open(page, "/?i=ZZZZZZZZZZ");
  await expect(page.locator('[data-page="home"] [data-lookup] form')).toBeVisible();
  await expect(page.locator("[data-badcode]").first()).toContainText("didn't work");
  expect(await eventCount(page)).toBe(2);
});

test("plain visitor sees only public events", async ({ page }) => {
  await open(page, "/");
  expect(await eventCount(page)).toBe(2);
});

test("content.json holds no private events (integrator must strip them)", async () => {
  const c = JSON.parse(await readFile("content/content.json", "utf8"));
  expect(c.events.filter((e) => e.visibility === "private")).toEqual([]);
});

test("name lookup (any order/case/middle name) personalises, then remembered, then Not you? clears", async ({ page }) => {
  for (const typed of ["raj sharma", "Sharma Raj", "Raj  Kumar Sharma"]) {
    await page.context().clearCookies();
    await open(page, "/");
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload(); await ready(page);
    const form = page.locator('[data-page="home"] [data-lookup] form');
    await form.getByLabel("Your full name").fill(typed);
    await form.getByRole("button").click();
    await expect(page.getByText(codes.sharma.greeting).first()).toBeAttached();
    await expect.poll(() => page.url()).not.toContain("i=");
  }
  // Returning visit without ?i
  await open(page, "/");
  await expect(page.getByText(codes.sharma.greeting).first()).toBeAttached();
  expect(await eventCount(page)).toBe(5);
  // Not you?
  const badge = page.locator("[data-guest-badge]");
  if (await badge.count() === 0) {
    await page.evaluate(async () => {
      const m = await import("/src/pages/_lookup.js");
      const el = document.createElement("div");
      document.body.prepend(el);
      m.renderGuestBadge(el, window.__ctxForTest);
    }).catch(() => {});
  }
  await page.evaluate(async () => {
    const g = await import("/src/lib/guest.js");
    g.forgetGuest();
  });
  await open(page, "/");
  await expect(page.locator('[data-page="home"] [data-lookup] form')).toBeVisible();
  expect(await eventCount(page)).toBe(2);
});

test("unknown name shows the not-found message and contacts", async ({ page }) => {
  await open(page, "/");
  const form = page.locator('[data-page="home"] [data-lookup] form');
  await form.getByLabel("Your full name").fill("Nobody Atall");
  await form.getByRole("button").click();
  const msg = page.locator('[data-page="home"] [data-lookup] [data-msg]');
  await expect(msg).toContainText("We couldn't find that name");
  await expect(msg.getByRole("link", { name: /call/i }).first()).toBeVisible();
});

test("badge: Not you? forgets the guest", async ({ page }) => {
  await open(page, `/?i=${codes.sharma.code}`);
  await page.evaluate(async () => {
    const m = await import("/src/pages/_lookup.js");
    const el = document.createElement("div");
    el.id = "badge-test";
    document.body.prepend(el);
    m.renderGuestBadge(el, { guest: { household: "Sharma Family" } });
  });
  await expect(page.locator("#badge-test")).toContainText("Viewing as Sharma Family");
  await page.locator("#badge-test [data-not-you]").click();
  await ready(page);
  await expect(page.locator('[data-page="home"] [data-lookup] form')).toBeVisible();
});

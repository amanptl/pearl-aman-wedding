// Guest access and privacy. Uses content/guests.json + content/admin.enc.json built by
// `node tools/make-guests.mjs --households tools/sample-households.json --passphrase dev-passphrase`.
import { test, expect } from "./helpers/test.js";
import { readFile } from "node:fs/promises";
import { openAdmin, displayGreeting } from "../src/lib/guestfiles.js";

let codes = {};
test.beforeAll(async () => {
  const admin = await openAdmin(JSON.parse(await readFile("content/admin.enc.json", "utf8")), "dev-passphrase");
  for (const h of admin.households) codes[h.id] = { code: h.code, greeting: h.greeting };
});

const ready = (page) => page.waitForSelector("html[data-ready='1']", { state: "attached" });
const open = async (page, url) => { await page.goto(url + (url.includes("?") ? "&" : "?") + "intro=0"); await ready(page); };
const eventCount = (page) => page.locator('[data-page="schedule"] [data-event]').count();
// Name lookup is off by default (site.nameLookup). These tests switch it on to exercise the lookup itself.
const withLookup = (page) => page.route("**/content/content.json", async (r) => {
  const res = await r.fetch();
  const c = await res.json();
  c.site.nameLookup = true;
  await r.fulfill({ response: res, json: c });
});

test("name lookup is off by default: no name form, only 'open your personal link'", async ({ page }) => {
  await open(page, "/");
  const box = page.locator('[data-page="home"] [data-lookup]');
  await expect(box.locator("[data-link-only]")).toContainText("personal link");
  await expect(box.locator("form")).toHaveCount(0);
  await open(page, "/?i=ZZZZZZZZZZ");
  await expect(page.locator("[data-badcode]").first()).toContainText("didn't work");
});

test("family link shows all 3 events and the greeting", async ({ page }) => {
  await open(page, `/?i=${codes.sharma.code}`);
  expect(await eventCount(page)).toBe(3);
  await expect(page.getByText(displayGreeting(codes.sharma.greeting), { exact: true }).first()).toBeAttached();
});

test("friend link shows exactly its events", async ({ page }) => {
  await open(page, `/?i=${codes.chen.code.toLowerCase()}`);
  expect(await eventCount(page)).toBe(2);
  await open(page, `/?i=${codes.walker.code}`);
  expect(await eventCount(page)).toBe(1);
});

test("?i= is removed from the URL after resolving, hash kept", async ({ page }) => {
  await open(page, `/?i=${codes.sharma.code}#home`);
  await expect.poll(() => page.url()).not.toContain("i=");
  expect(page.url()).toContain("#home");
});

test("bad code shows the lookup with the message and no private events", async ({ page }) => {
  await withLookup(page);
  await open(page, "/?i=ZZZZZZZZZZ");
  await expect(page.locator('[data-page="home"] [data-lookup] form')).toBeVisible();
  await expect(page.locator("[data-badcode]").first()).toContainText("didn't work");
  expect(await eventCount(page)).toBe(0);
});

test("plain visitor sees only public events", async ({ page }) => {
  await open(page, "/");
  expect(await eventCount(page)).toBe(0);
});

test("content.json holds no private events (integrator must strip them)", async () => {
  const c = JSON.parse(await readFile("content/content.json", "utf8"));
  expect(c.events.filter((e) => e.visibility === "private")).toEqual([]);
});

test("name lookup (any order/case/middle name) personalises, then remembered, then forgetting clears", async ({ page }) => {
  await withLookup(page);
  for (const typed of ["raj sharma", "Sharma Raj", "Raj  Kumar Sharma"]) {
    await page.context().clearCookies();
    await open(page, "/");
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload(); await ready(page);
    const form = page.locator('[data-page="home"] [data-lookup] form');
    await form.getByLabel("Your full name").fill(typed);
    await form.getByRole("button").click();
    await expect(page.getByText(displayGreeting(codes.sharma.greeting), { exact: true }).first()).toBeAttached();
    await expect.poll(() => page.url()).not.toContain("i=");
  }
  // Returning visit without ?i
  await open(page, "/");
  await expect(page.getByText(displayGreeting(codes.sharma.greeting), { exact: true }).first()).toBeAttached();
  expect(await eventCount(page)).toBe(3);
  await page.evaluate(async () => {
    const g = await import("/src/lib/guest.js");
    g.forgetGuest();
  });
  await open(page, "/");
  await expect(page.locator('[data-page="home"] [data-lookup] form')).toBeVisible();
  expect(await eventCount(page)).toBe(0);
});

test("unknown name shows the not-found message and contacts", async ({ page }) => {
  await withLookup(page);
  await open(page, "/");
  const form = page.locator('[data-page="home"] [data-lookup] form');
  await form.getByLabel("Your full name").fill("Nobody Atall");
  await form.getByRole("button").click();
  const msg = page.locator('[data-page="home"] [data-lookup] [data-msg]');
  await expect(msg).toContainText("We couldn't find that name");
  await expect(msg.getByRole("link", { name: /call/i }).first()).toBeVisible();
});

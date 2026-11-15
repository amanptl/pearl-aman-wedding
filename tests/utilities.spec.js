import { test, expect } from "@playwright/test";
import fs from "node:fs";

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
});

test("ICS download has valid, CRLF, UTC content", async ({ page }) => {
  await open(page, "/#schedule");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(async () => {
      const { downloadIcs } = await import("/src/lib/calendar.js");
      const content = await (await fetch("/content/content.json")).json();
      downloadIcs(content.events.slice(0, 2), content.site, "my weddin?g.ics");
    }),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const text = fs.readFileSync(await download.path(), "utf8");
  expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  expect(text).toContain("UID:");
  expect(text).toContain("@pearl-aman");
  expect(text).toContain("BEGIN:VALARM");
  expect(text.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
});

test("sheet: focus moves in, is trapped, Esc closes, focus returns, scroll lock released", async ({ page }) => {
  await open(page, "/#home");
  await page.evaluate(async () => {
    const { openSheet } = await import("/src/lib/ui.js");
    const b = document.createElement("button");
    b.id = "opener";
    b.textContent = "Open test sheet";
    b.style.cssText = "position:fixed;top:0;left:0;z-index:90;min-height:44px";
    document.body.append(b);
    b.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.innerHTML = '<a href="#x" id="s-a">One</a> <button id="s-b" type="button">Two</button>';
      openSheet("Test sheet", wrap);
    });
  });
  await page.locator("#opener").focus();
  await page.locator("#opener").click();
  const dialog = page.locator("dialog.sheet[open]");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#s-a")).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  // Tab many times: focus never leaves the dialog.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement.closest("dialog.sheet"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#opener")).toBeFocused();
  // The dialog's "close" event (which unlocks scroll) fires a moment after [open] is removed, so wait for it.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
});

test("sheet: backdrop click closes, content click does not; confirmSheet resolves booleans", async ({ page }) => {
  await open(page, "/#home");
  await page.evaluate(async () => {
    const { openSheet } = await import("/src/lib/ui.js");
    openSheet("Backdrop", "<p id='in'>Hello</p>");
  });
  await expect(page.locator("dialog.sheet[open]")).toBeVisible();
  await page.locator("#in").click();
  await expect(page.locator("dialog.sheet[open]")).toBeVisible();
  await page.mouse.click(2, 2); // outside the sheet: on the backdrop
  await expect(page.locator("dialog.sheet")).toHaveCount(0);

  const p = page.evaluate(async () => {
    const { confirmSheet } = await import("/src/lib/ui.js");
    window.__r = [];
    window.__r.push(await confirmSheet("Delete?", "Really delete this?", { confirmLabel: "Delete", cancelLabel: "Keep" }));
    window.__r.push(await confirmSheet("Delete?", "Again?"));
    return window.__r;
  });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await p).toEqual([true, false]);
});

test("copyText falls back to a textarea, and reports failure", async ({ page }) => {
  await open(page, "/#home");
  const res = await page.evaluate(async () => {
    const { copyText } = await import("/src/lib/ui.js");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    let copied = null;
    document.execCommand = (cmd) => { copied = document.activeElement?.value ?? null; return cmd === "copy"; };
    const ok = await copyText("ABC-123", "group code");
    const status = document.querySelector("#toast")?.textContent;
    document.execCommand = () => false;
    await new Promise((r) => setTimeout(r, 3300));
    const bad = await copyText("nope");
    return { ok, copied, status, bad, leftover: document.querySelectorAll("textarea").length };
  });
  expect(res.ok).toBe(true);
  expect(res.copied).toBe("ABC-123");
  expect(res.status).toContain("Copied group code");
  expect(res.bad).toBe(false);
  expect(res.leftover).toBe(0);
  await expect(page.locator("#toast")).toContainText("Couldn't copy — press and hold to copy");
});

test("toast: polite live region, queued one at a time, clears, sits above the tab bar", async ({ page }) => {
  await open(page, "/#home");
  await page.evaluate(async () => {
    const { toast } = await import("/src/lib/ui.js");
    toast("First", 1500);
    toast("Second", 1500);
    toast("Third", 1500);
  });
  const region = page.locator("#toast");
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(region).toHaveAttribute("role", "status");
  await expect(region.locator(".toast")).toHaveText("First");
  expect(await region.locator(".toast").count()).toBe(1);
  const tab = page.locator("#tabbar");
  if (await tab.isVisible()) {
    const t = await region.locator(".toast").boundingBox();
    const b = await tab.boundingBox();
    expect(t.y + t.height).toBeLessThanOrEqual(b.y + 1);
  }
  await expect(region.locator(".toast")).toHaveText("Second");
  await expect(region.locator(".toast")).toHaveText("Third");
  await expect(region.locator(".toast")).toHaveCount(0);
});

test("service worker is not registered under automation by default", async ({ page }) => {
  await open(page, "/#home");
  await page.waitForTimeout(500);
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  expect(regs).toBe(0);
});

test("?sw=1: SW caches content.json and the schedule loads offline", async ({ page, context }) => {
  await open(page, "/?sw=1#schedule");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Wait until the SW controls the page and has precached the shell.
  await page.waitForFunction(async () => !!navigator.serviceWorker.controller && !!(await caches.match("content/content.json")), null, { timeout: 20000 });
  expect(await page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith("pa-shell-")))).toBe(true);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await context.setOffline(true);
  try {
    await page.reload();
    await page.waitForSelector("html[data-ready]", { timeout: 15000 });
    await expect(page.locator('[data-page="schedule"] h1')).toBeVisible();
    await expect(page.locator('[data-page="schedule"]')).toContainText(/\d{1,2}:\d{2}/);
  } finally {
    await context.setOffline(false);
  }
});

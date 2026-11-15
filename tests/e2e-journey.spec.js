import { test, expect } from "@playwright/test";
import path from "node:path";
import { MockRepo } from "./helpers/mockrepo.js";

// The couple's real workflow, end to end, against a stateful in-memory GitHub. Desktop only.
const PASS = "dev-passphrase";
const PHOTO = path.resolve("tests/fixtures/editor-photo.png");
const FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET|NAME|CONNECTION|BLOCKED)|Failed to load resource/i;
const NEW_TITLE = "The Wedding Ceremony (edited)";
const NEW_URL = "https://example.com/book-now";

test.use({ isMobile: false, hasTouch: false, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const frame = (page) => page.frameLocator("#frame");
const draft = (page) => page.evaluate(() => structuredClone(window.__editor.draft));
async function openEditor(page) {
  await page.goto("/edit/");
  await page.waitForFunction(() => window.__editor && document.querySelector("#frame")?.contentDocument?.documentElement?.dataset?.ready === "1" && !document.querySelector("#boot"));
}

test("couple's journey: edit, publish, then a guest sees exactly the published site", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop-1280", "desktop journey");
  test.setTimeout(150_000);
  const errors = [];
  const watch = (p) => {
    p.on("console", (m) => { if (m.type() === "error" && !FONT_NOISE.test(m.text())) errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push(String(e)));
  };
  watch(page);
  await page.addInitScript(() => { try { localStorage.setItem("pa.editor.coach.v1", "1"); sessionStorage.setItem("pa.intro", "1"); } catch {} });

  const repo = new MockRepo();
  await repo.install(page);
  await repo.serveSite(page);
  const commitsBefore = repo.commitCount();
  const origFaqIds = repo.json("content/content.json").faq.map((f) => f.id);
  const origHotelUrl = repo.json("content/content.json").hotels[0].bookingUrl;

  /* 1. connect GitHub */
  await openEditor(page);
  await page.click("#more");
  await page.getByRole("menuitem", { name: /Publishing settings/ }).click();
  await page.fill("#gh-owner", "o");
  await page.fill("#gh-repo", "r");
  await page.fill("#gh-token", "tok_e2e_secret");
  await page.getByRole("button", { name: "Save & test connection" }).click();
  await expect(page.locator("dialog.dlg")).toHaveCount(0);
  expect(repo.log.some((c) => c.path === "/branches/main")).toBe(true);

  /* 2. unlock */
  await page.click("#unlock-btn");
  await page.fill("#unlock-pass", PASS);
  await page.locator("dialog.dlg").getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.locator("#lock-banner")).toBeHidden();

  /* 3. edit the wedding event title inline */
  await page.selectOption("#page-select", "schedule");
  const wIdx = (await draft(page)).events.findIndex((e) => e.id === "wedding");
  const title = frame(page).locator(`[data-path="events.${wIdx}.name"]`);
  await title.scrollIntoViewIfNeeded();
  await title.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(NEW_TITLE);
  await page.keyboard.press("Enter");
  expect((await draft(page)).events[wIdx].name).toBe(NEW_TITLE);

  /* 4. hotel booking URL in the panel */
  await page.selectOption("#page-select", "travel");
  const card = frame(page).locator('[data-item="hotels.0"]');
  await card.scrollIntoViewIfNeeded();
  await card.click({ position: { x: 8, y: 260 } });
  await page.locator('[data-field="hotels.0.bookingUrl"]').fill(NEW_URL);
  expect((await draft(page)).hotels[0].bookingUrl).toBe(NEW_URL);

  /* 6 (done here while on the travel page). upload a photo */
  const img = frame(page).locator('img[data-path="hotels.0.photo"]');
  await img.scrollIntoViewIfNeeded();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), img.click({ position: { x: 20, y: 120 } })]);
  await chooser.setFiles(PHOTO);
  await expect.poll(async () => (await draft(page)).hotels[0].photo?._pending).toBe(true);
  await page.locator('[data-field="hotels.0.photo.alt"]').fill("The hotel lobby, newly photographed");
  await page.evaluate(() => window.__editor.flushRender());

  /* 5. reorder the FAQ (move the first question down) */
  await page.selectOption("#page-select", "faq");
  const q0 = frame(page).locator('[data-item="faq.0"]');
  await q0.scrollIntoViewIfNeeded();
  await q0.hover();
  await frame(page).locator('.ed-toolbar [data-act="down"]').click();
  const faqIds = (await draft(page)).faq.map((f) => f.id);
  expect(faqIds.slice(0, 2)).toEqual([origFaqIds[1], origFaqIds[0]]);

  /* 7. add a household with the Friends preset */
  await page.click('[data-tab="guests"]');
  await page.getByRole("button", { name: "Add household" }).click();
  const row = page.locator(".gm-table tbody tr:last-child");
  const hname = row.locator('input[aria-label="Household name"]');
  await hname.fill("Okonkwo Friends");
  await hname.press("Tab");
  await row.locator(".chip-add").first().fill("Ada Okonkwo");
  await row.locator(".chip-add").first().press("Enter");
  await row.getByLabel(/^Select/).check();
  await page.getByRole("button", { name: /^Friends/ }).click();
  const added = (await draft(page))._admin.households.at(-1);
  expect(added.household).toBe("Okonkwo Friends");
  expect([...added.eventIds].sort()).toEqual(["reception", "sangeet", "wedding"]);
  const NEW_CODE = added.code;

  /* 8. Sangeet public, then private again */
  await page.click('[data-tab="edit"]');
  await page.selectOption("#page-select", "schedule");
  const sIdx = (await draft(page)).events.findIndex((e) => e.id === "sangeet");
  const sCard = frame(page).locator(`[data-item="events.${sIdx}"], [data-event="sangeet"]`).first();
  await sCard.scrollIntoViewIfNeeded();
  await sCard.click({ position: { x: 6, y: 6 } });
  const vis = page.locator(`[data-field="events.${sIdx}.visibility"]`);
  await expect(vis).toBeVisible();
  await vis.selectOption("public");
  expect((await draft(page)).events[sIdx].visibility).toBe("public");
  expect((await page.evaluate(() => window.__editor.privateEvents().map((e) => e.id))).includes("sangeet")).toBe(false);
  await vis.selectOption("private");
  expect((await draft(page)).events[sIdx].visibility).toBe("private");
  expect((await page.evaluate(() => window.__editor.privateEvents().map((e) => e.id))).includes("sangeet")).toBe(true);

  /* 9. publish */
  await page.click("#publish");
  await expect(page.locator("dialog.dlg")).toContainText("updated the guest list");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.locator("dialog.dlg")).toContainText("Published", { timeout: 60_000 });
  await page.keyboard.press("Escape");

  /* the mock repo: exactly one new commit holding every changed file */
  expect(repo.commitCount()).toBe(commitsBefore + 1);
  const head = repo.headCommit;
  expect(head.message).toMatch(/^Update site content via editor/);
  const uploads = head.changed.filter((p) => /^assets\/uploads\/[0-9a-f]{16}(-600)?\.webp$/.test(p));
  expect(uploads).toHaveLength(2);
  expect(head.changed.filter((p) => !uploads.includes(p)).sort()).toEqual(["content/admin.enc.json", "content/content.json", "content/guests.json"]);
  const content = repo.json("content/content.json");
  expect(content.events.find((e) => e.id === "wedding").name).toBe(NEW_TITLE);
  expect(content.events.map((e) => e.id)).toEqual(["wedding", "reception"]); // sangeet is private again
  expect(content.hotels[0].bookingUrl).toBe(NEW_URL);
  expect(content.hotels[0].bookingUrl).not.toBe(origHotelUrl);
  expect(content.faq.map((f) => f.id).slice(0, 2)).toEqual([origFaqIds[1], origFaqIds[0]]);
  expect(JSON.stringify(content)).not.toMatch(/Okonkwo|_pending|_admin|tok_e2e_secret/);

  /* guests.json holds no plaintext */
  const guestsText = repo.text("content/guests.json");
  // Only names of 5+ letters: shorter ones (e.g. "Ada") can occur by chance in base64 ciphertext.
  for (const secret of ["Okonkwo", "Sharma", "Priya", "Sangeet", "Mehndi", "Okafor", NEW_CODE]) expect(guestsText, `guests.json leaks ${secret}`).not.toContain(secret);
  expect(repo.text("content/admin.enc.json")).not.toContain("Okonkwo");

  /* as a GUEST on the committed files (a fresh browser context serving the mock repo's versions) */
  const gctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await gctx.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
  await repo.serveSite(gctx);
  const guest = await gctx.newPage();
  watch(guest);
  await guest.goto(`/?i=${NEW_CODE}&intro=0#schedule`);
  await guest.waitForSelector("html[data-ready]");
  await expect(guest.locator("[data-guest-badge]")).toContainText("Okonkwo Friends");
  const eventNames = await guest.locator("[data-page=schedule] .event h3, [data-page=schedule] [data-event] h3").allTextContents();
  expect(eventNames.join("|")).toContain(NEW_TITLE);
  await expect(guest.locator("[data-page=schedule] .event")).toHaveCount(3); // sangeet (private, invited) + wedding + reception
  expect(await guest.locator("[data-page=schedule] .event").evaluateAll((els) => els.map((e) => e.getAttribute("data-event") || e.id))).toEqual(expect.arrayContaining([expect.stringMatching(/sangeet/), expect.stringMatching(/wedding/), expect.stringMatching(/reception/)]));
  await expect(guest.locator("[data-page=schedule]")).not.toContainText("Mehndi");
  // a public visitor does not get the private Sangeet
  const pub = await gctx.newPage();
  await pub.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem("pa.intro", "1"); } catch {} });
  await pub.goto("/?intro=0#schedule");
  await pub.waitForSelector("html[data-ready]");
  await expect(pub.locator("[data-page=schedule] .event")).toHaveCount(2);
  await pub.close();

  await guest.goto("/?intro=0#travel");
  await guest.waitForSelector("html[data-ready]");
  await expect(guest.locator(`[data-page=travel] a[href="${NEW_URL}"]`).first()).toBeVisible();
  const photo = guest.locator('[data-page=travel] img[src*="assets/uploads/"], [data-page=travel] img[srcset*="assets/uploads/"]').first();
  await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => photo.evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
  await guest.goto("/?intro=0#faq");
  await guest.waitForSelector("html[data-ready]");
  // the guest page groups by category, so check the reordered pair by its position in content.faq (data-index)
  await expect(guest.locator(`details.faq-item[data-id="${origFaqIds[1]}"]`)).toHaveAttribute("data-index", "0");
  await expect(guest.locator(`details.faq-item[data-id="${origFaqIds[0]}"]`)).toHaveAttribute("data-index", "1");
  await gctx.close();

  /* reload the editor: clean draft, History lists the commit */
  await page.reload();
  await page.waitForFunction(() => window.__editor && document.querySelector("#frame")?.contentDocument?.documentElement?.dataset?.ready === "1" && !document.querySelector("#boot"));
  await expect(page.locator("#status")).toContainText("No unpublished changes");
  expect(await page.evaluate(() => window.__editor.dirty ?? false)).toBeFalsy();
  expect((await draft(page)).events.find((e) => e.id === "wedding").name).toBe(NEW_TITLE);
  await page.click('[data-tab="history"]');
  await expect(page.locator(".hist li").first()).toContainText("Update site content via editor");
  await expect(page.locator(".hist li")).toHaveCount(2); // the publish + the initial commit
  expect(await page.evaluate(() => document.documentElement.innerHTML.includes("tok_e2e_secret"))).toBe(false);
  expect(errors).toEqual([]);
});

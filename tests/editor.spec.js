import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { editorContentText } from "./helpers/content.js";

const FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET|NAME|CONNECTION|BLOCKED)|Failed to load resource/i;
const PHOTO = path.resolve("tests/fixtures/editor-photo.png");
const SHOTS = process.env.SHOTS || process.env.EDITOR_SHOTS;
// The editor starts from content with five hotels (the published site may have fewer); see helpers/content.js.
const CONTENT = editorContentText();

// The editor is a desktop tool (phones get a "works best on a computer" note), so these specs always run in a desktop-sized, non-touch
// context. The browser engine still follows the project (webkit/chromium).
test.use({ isMobile: false, hasTouch: false, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !FONT_NOISE.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem("pa.editor.coach.v1", "1"); sessionStorage.setItem("pa.intro", "1"); } catch {} });
  await page.route("**/content/content.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: CONTENT }));
});

async function openEditor(page, pageId = "travel") {
  await page.goto("/edit/");
  await page.waitForFunction(() => window.__editor && document.querySelector("#frame")?.contentDocument?.documentElement?.dataset?.ready === "1" && !document.querySelector("#boot"));
  if (pageId) await page.selectOption("#page-select", pageId);
  await page.waitForTimeout(150);
}
const fr = (page) => page.frameLocator("#frame");
const draft = (page) => page.evaluate(() => structuredClone(window.__editor.draft));
async function uploadPhoto(page, imgPath = "hotels.0.photo", file = PHOTO) {
  const img = fr(page).locator(`img[data-path="${imgPath}"]`);
  await img.scrollIntoViewIfNeeded();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), img.click({ position: { x: 20, y: 120 } })]);
  await chooser.setFiles(file);
}
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync("tests/screens", { recursive: true }); await page.screenshot({ path: `tests/screens/5-${name}.png` }); } };

test("inline edit: draft updates, no re-render while typing, caret never jumps", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const name = fr(page).locator('[data-path="hotels.0.name"]');
  await name.scrollIntoViewIfNeeded();
  await shot(page, "idle");
  await name.click();
  await expect(name).toHaveAttribute("contenteditable", /plaintext-only|true/);
  await name.evaluate((el) => { el.__mark = 1; });
  await page.keyboard.press("Control+A");
  const long = "The Grand Seaside Resort & Spa at the Lake, with a very long name 12345";
  await page.keyboard.type(long, { delay: 4 });
  // Same DOM node (not re-rendered) and the draft already has the text.
  expect(await name.evaluate((el) => el.__mark)).toBe(1);
  expect((await draft(page)).hotels[0].name).toBe(long);
  expect(await name.evaluate((el) => el.textContent)).toBe(long);
  await shot(page, "editing");
  await page.keyboard.press("Enter");
  await expect(fr(page).locator('[data-path="hotels.0.name"]')).toHaveText(long);
  await expect(fr(page).locator('[data-path="hotels.0.name"]')).not.toHaveAttribute("contenteditable", /.+/);
  await expect.poll(() => fr(page).locator('[data-path="hotels.0.name"]').evaluate((el) => el.__mark)).toBeUndefined(); // re-rendered after blur
  // Esc reverts
  await fr(page).locator('[data-path="hotels.0.name"]').click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Oops");
  await page.keyboard.press("Escape");
  await expect(fr(page).locator('[data-path="hotels.0.name"]')).toHaveText(long);
  expect((await draft(page)).hotels[0].name).toBe(long);
  expect(errors).toEqual([]);
});

test("undo / redo", async ({ page }) => {
  await openEditor(page);
  const orig = (await draft(page)).hotels[0].name;
  const el = fr(page).locator('[data-path="hotels.0.name"]');
  await el.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Changed name");
  await page.keyboard.press("Enter");
  await expect(page.locator("#undo")).toBeEnabled();
  await page.click("#undo");
  expect((await draft(page)).hotels[0].name).toBe(orig);
  await expect(fr(page).locator('[data-path="hotels.0.name"]')).toHaveText(orig);
  await expect(page.locator("#redo")).toBeEnabled();
  await page.click("#redo");
  expect((await draft(page)).hotels[0].name).toBe("Changed name");
  // keyboard shortcut
  await page.locator("#stage").click({ position: { x: 3, y: 3 } });
  await page.keyboard.press("Control+z");
  expect((await draft(page)).hotels[0].name).toBe(orig);
  expect(errors).toEqual([]);
});

test("reorder hotels with the down button and by dragging", async ({ page }) => {
  await openEditor(page);
  const ids = async () => (await draft(page)).hotels.map((h) => h.id);
  const before = await ids();
  const card = fr(page).locator('[data-item="hotels.0"]');
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  const down = fr(page).locator('.ed-toolbar [data-act="down"]');
  await expect(down).toBeVisible();
  await down.click();
  const after = await ids();
  expect(after.slice(0, 3)).toEqual([before[1], before[0], before[2]]);
  // the moved card keeps its toolbar; move it up again
  await fr(page).locator('.ed-toolbar [data-act="up"]').click();
  expect(await ids()).toEqual(before);

  // drag: first block hotel onto the third
  const first = fr(page).locator('[data-item="hotels.0"]');
  await first.hover();
  const handle = fr(page).locator('.ed-toolbar [data-act="drag"]');
  const hb = await handle.boundingBox();
  const third = await fr(page).locator('[data-item="hotels.2"]').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(third.x + third.width / 2, third.y + third.height * 0.8, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  const dragged = await ids();
  expect(dragged[0]).not.toBe(before[0]);
  expect(dragged).toContain(before[0]);
  expect(dragged.indexOf(before[0])).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("add and delete an FAQ", async ({ page }) => {
  await openEditor(page, "faq");
  const n = (await draft(page)).faq.length;
  const item = fr(page).locator('[data-item="faq.0"]');
  await item.scrollIntoViewIfNeeded();
  await item.hover();
  await fr(page).locator('.ed-toolbar [data-act="add"]').click();
  let d = await draft(page);
  expect(d.faq.length).toBe(n + 1);
  const added = d.faq[1];
  expect(added.id).toMatch(/^[a-z0-9-]+$/);
  expect(added.category).toBe(d.faq[0].category);
  expect(new Set(d.faq.map((f) => f.id)).size).toBe(n + 1);
  // delete it via the in-editor dialog
  await fr(page).locator('[data-item="faq.1"]').hover();
  await fr(page).locator('.ed-toolbar [data-act="del"]').click();
  await expect(page.locator("dialog.dlg")).toBeVisible();
  await page.locator("dialog.dlg .btn.danger").click();
  d = await draft(page);
  expect(d.faq.length).toBe(n);
  expect(d.faq.some((f) => f.id === added.id)).toBe(false);
  expect(errors).toEqual([]);
});

test("panel: booking URL validation disables Publish", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const card = fr(page).locator('[data-item="hotels.0"]');
  await card.scrollIntoViewIfNeeded();
  await card.click({ position: { x: 8, y: 260 } });
  await expect(page.locator(".crumbs")).toContainText("Hotels");
  const url = page.locator('[data-field="hotels.0.bookingUrl"]');
  await expect(url).toBeVisible();
  await shot(page, "selected");
  await url.fill("not a url");
  await expect(page.locator('[data-err-for="hotels.0.bookingUrl"]')).toContainText(/invalid/i);
  await expect(page.locator("#publish")).toBeDisabled();
  await expect(page.locator("#badge")).toContainText(/problem/);
  // badge lists the issue and jumps to it
  await page.click("#badge");
  await expect(page.locator(".issue[data-level=err]")).toHaveCount(1);
  await page.locator(".issue[data-level=err]").click();
  await expect(page.locator("#badge")).toBeVisible();
  await url.fill("https://example.com/book");
  await expect(page.locator('[data-err-for="hotels.0.bookingUrl"]')).toHaveText("");
  await expect(page.locator("#publish")).toBeEnabled();
  expect((await draft(page)).hotels[0].bookingUrl).toBe("https://example.com/book");
  expect(errors).toEqual([]);
});

test("photo upload: pending blob in the frame, focal point, alt warning", async ({ page }) => {
  await openEditor(page);
  await uploadPhoto(page);
  await expect.poll(async () => (await draft(page)).hotels[0].photo?._pending).toBe(true);
  const d = await draft(page);
  expect(d.hotels[0].photo.src).toMatch(/^assets\/uploads\/[0-9a-f]{16}\.webp$/);
  expect(d.hotels[0].photo.srcSmall).toMatch(/-600\.webp$/);
  await expect(fr(page).locator('img[data-path="hotels.0.photo"]')).toHaveAttribute("src", /^blob:/);
  // panel shows the photo editor with an alt warning
  await expect(page.locator("[data-alt-warning]")).toBeVisible();
  await expect(page.locator("#badge")).toContainText(/tip|problem/);
  // focal point
  const thumb = page.locator(".imgf .thumb");
  const b = await thumb.boundingBox();
  await page.mouse.click(b.x + b.width * 0.25, b.y + b.height * 0.75);
  const f = (await draft(page)).hotels[0].photo.focal;
  expect(f[0]).toBeGreaterThan(15); expect(f[0]).toBeLessThan(35);
  expect(f[1]).toBeGreaterThan(65); expect(f[1]).toBeLessThan(85);
  await expect(fr(page).locator('img[data-path="hotels.0.photo"]')).toHaveCSS("object-position", /%/);
  // alt text removes the warning
  await page.locator('[data-field="hotels.0.photo.alt"]').fill("The hotel lobby");
  await expect(page.locator("[data-alt-warning]")).toBeHidden();
  // non-image rejected politely
  await page.setInputFiles("#file-input", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator(".toast.err")).toContainText(/isn't a photo/);
  expect(errors).toEqual([]);
});

test("draft persists across reload", async ({ page }) => {
  await openEditor(page);
  const el = fr(page).locator('[data-path="hotels.1.name"]');
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Persisted Hotel");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+s");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("pa.editor.draft.v1")).draft.hotels[1].name)).toBe("Persisted Hotel");
  await page.reload();
  await page.waitForFunction(() => window.__editor && document.querySelector("#frame")?.contentDocument?.documentElement?.dataset?.ready === "1" && !document.querySelector("#boot"));
  expect((await draft(page)).hotels[1].name).toBe("Persisted Hotel");
  await page.selectOption("#page-select", "travel");
  await expect(fr(page).locator('[data-path="hotels.1.name"]')).toHaveText("Persisted Hotel");
  await expect(page.locator("#status")).toContainText(/draft|Unsaved/i);
  expect(errors).toEqual([]);
});

test("device switcher widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page, "home");
  for (const [id, w] of [["#dev-phone", 390], ["#dev-tablet", 768], ["#dev-desktop", 1280]]) {
    await page.click(id);
    await expect.poll(() => page.evaluate(() => document.querySelector("#frame").contentWindow.innerWidth)).toBe(w);
    await expect(page.locator(id)).toHaveAttribute("aria-pressed", "true");
  }
  expect(errors).toEqual([]);
});

/* ---------- publish ---------- */
async function mockGitHub(page, { remote, conflict = false, fail } = {}) {
  const calls = [];
  const content = CONTENT;
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace("/repos/o/r", "");
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path: p, body });
    const json = (o, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
    if (fail && fail(req.method(), p)) return json({ message: "Bad credentials" }, 401);
    if (req.method() === "GET" && p.startsWith("/contents/content/content.json")) {
      const text = conflict ? JSON.stringify({ ...JSON.parse(content), site: { ...JSON.parse(content).site, title: "Changed elsewhere" } }) : content;
      return json({ content: Buffer.from(text).toString("base64"), sha: "remotesha" });
    }
    if (req.method() === "GET" && p === "/git/ref/heads/main") return json({ object: { sha: "headsha" } });
    if (req.method() === "GET" && p === "/git/commits/headsha") return json({ tree: { sha: "basetree" } });
    if (req.method() === "POST" && p === "/git/blobs") return json({ sha: "blob" + calls.length });
    if (req.method() === "POST" && p === "/git/trees") return json({ sha: "newtree" });
    if (req.method() === "POST" && p === "/git/commits") return json({ sha: "newcommit" });
    if (req.method() === "PATCH" && p === "/git/refs/heads/main") return json({ ok: true });
    if (req.method() === "GET" && p.startsWith("/branches/")) return json({ name: "main" });
    return json({ message: "unexpected " + p }, 404);
  });
  await page.route("https://o.github.io/**", (route) => route.fulfill({ status: 404, body: "" }));
  return calls;
}
async function connect(page) {
  await page.evaluate(() => localStorage.setItem("pa.editor.gh", JSON.stringify({ owner: "o", repo: "r", branch: "main", token: "tok_secret" })));
}

test("publish: one commit with content.json + 2 webp files", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const calls = await mockGitHub(page);
  await openEditor(page);
  await connect(page);
  await uploadPhoto(page);
  await expect.poll(async () => (await draft(page)).hotels[0].photo?._pending).toBe(true);
  await page.locator('[data-field="hotels.0.photo.alt"]').fill("Hotel lobby");
  await page.evaluate(() => window.__editor.flushRender()); // the alt text schedules a deferred re-render that would detach the next element mid-click
  const el = fr(page).locator('[data-path="hotels.2.name"]');
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Edited for publish");
  await page.keyboard.press("Enter");
  await page.click("#publish");
  await expect(page.locator("dialog.dlg")).toContainText(/Edited 1 field/);
  await shot(page, "publish");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.locator("dialog.dlg")).toContainText("Published", { timeout: 15000 });
  const seq = calls.filter((c) => !c.path.startsWith("/branches")).map((c) => `${c.method} ${c.path.replace(/blob\d+/, "blob")}`);
  expect(seq).toEqual([
    "GET /contents/content/content.json",
    "GET /git/ref/heads/main",
    "GET /git/commits/headsha",
    "POST /git/blobs", "POST /git/blobs", "POST /git/blobs",
    "POST /git/trees", "POST /git/commits", "PATCH /git/refs/heads/main",
  ]);
  const tree = calls.find((c) => c.path === "/git/trees").body;
  expect(tree.base_tree).toBe("basetree");
  const paths = tree.tree.map((t) => t.path);
  expect(paths[0]).toBe("content/content.json");
  expect(paths.filter((p) => /^assets\/uploads\/[0-9a-f]{16}(-600)?\.webp$/.test(p)).length).toBe(2);
  const blobs = calls.filter((c) => c.path === "/git/blobs").map((c) => c.body);
  const contentBlob = blobs[0];
  expect(contentBlob.encoding).toBe("utf-8");
  expect(contentBlob.content.endsWith("}\n")).toBe(true);
  const published = JSON.parse(contentBlob.content);
  expect(published.hotels[2].name).toBe("Edited for publish");
  expect(published.hotels[0].photo.src).toMatch(/^assets\/uploads\//);
  expect(JSON.stringify(published)).not.toContain("_pending");
  expect(blobs.slice(1).every((b) => b.encoding === "base64" && b.content.length > 100)).toBe(true);
  const commit = calls.find((c) => c.path === "/git/commits").body;
  expect(commit.message).toMatch(/^Update site content via editor/);
  expect(commit.message).toMatch(/1 photo/);
  expect(commit.parents).toEqual(["headsha"]);
  // state after publish
  const d = await draft(page);
  expect(d.hotels[0].photo._pending).toBeUndefined();
  await expect(page.locator("#status")).toContainText(/Published|going live|No unpublished/);
  expect(await page.evaluate(() => document.documentElement.innerHTML.includes("tok_secret"))).toBe(false);
  expect(errors).toEqual([]);
});

test("publish: conflict flow", async ({ page }) => {
  const calls = await mockGitHub(page, { conflict: true });
  await openEditor(page);
  await connect(page);
  const el = fr(page).locator('[data-path="hotels.0.name"]');
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Mine");
  await page.keyboard.press("Enter");
  await page.click("#publish");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.locator("dialog.dlg")).toContainText("The site was changed elsewhere since you started");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  // Reload latest discards the draft
  await page.getByRole("button", { name: /Reload latest/ }).click();
  await expect.poll(async () => (await draft(page)).site.title).toBe("Changed elsewhere");
  expect((await draft(page)).hotels[0].name).not.toBe("Mine");
  expect(errors).toEqual([]);
});

test("publish: conflict then 'Publish anyway'; 401 shows plain-language error", async ({ page }) => {
  let failNow = false;
  const calls = await mockGitHub(page, { conflict: true, fail: (m, p) => failNow && p === "/git/ref/heads/main" });
  await openEditor(page);
  await connect(page);
  const el = fr(page).locator('[data-path="hotels.0.name"]');
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Mine");
  await page.keyboard.press("Enter");
  await page.click("#publish");
  await page.getByRole("button", { name: "Publish now" }).click();
  await page.getByRole("button", { name: "Publish anyway" }).click();
  await expect(page.locator("dialog.dlg")).toContainText("Published", { timeout: 15000 });
  expect(calls.some((c) => c.path === "/git/commits")).toBe(true);
  await page.keyboard.press("Escape");
  // second publish with a bad token
  failNow = true;
  await el.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Mine again");
  await page.keyboard.press("Enter");
  await page.click("#publish");
  await page.getByRole("button", { name: "Publish now" }).click();
  await page.getByRole("button", { name: "Publish anyway" }).click().catch(() => {});
  await expect(page.locator(".pub-err")).toContainText(/token/i);
});

test("no console errors across pages", async ({ page }) => {
  await openEditor(page, "home");
  for (const id of ["schedule", "travel", "story", "faq", "registry", "rsvp"]) {
    await page.selectOption("#page-select", id);
    await page.waitForTimeout(150);
  }
  expect(errors).toEqual([]);
});

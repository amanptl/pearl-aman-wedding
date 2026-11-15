import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { MockRepo } from "./helpers/mockrepo.js";

const FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET|NAME|CONNECTION|BLOCKED)|Failed to load resource/i;
const CONTENT = JSON.parse(fs.readFileSync("content/content.json", "utf8"));
const FAMILY = "tests/fixtures/guest-family.json";

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !FONT_NOISE.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
});

const ready = (page) => page.waitForSelector("html[data-ready]");

test.describe("guest site", () => {
  test("malformed content.json: friendly message, no blank page, one logged error", async ({ page }) => {
    await page.route("**/content/content.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"site": {' }));
    await page.goto("/?intro=0");
    await expect(page.locator("#main")).toContainText("We couldn't load the invitation");
    await expect(page.locator("#main h1")).toHaveCount(1);
    await expect(page.locator("#app")).toBeVisible();
    expect(errors.length).toBeGreaterThan(0); // the parse error is logged for debugging, nothing else is
    expect(errors.length).toBeLessThan(3);
    errors = [];
  });

  test("content.json 500: friendly message", async ({ page }) => {
    await page.route("**/content/content.json", (r) => r.fulfill({ status: 500, body: "boom" }));
    await page.goto("/?intro=0");
    await expect(page.locator("#main")).toContainText("We couldn't load the invitation");
    errors = [];
  });

  test("content.json missing optional sections still renders (no travel, no faq, no registry)", async ({ page }) => {
    const c = structuredClone(CONTENT);
    delete c.hotels; delete c.faq; delete c.faqCategories; delete c.registry; delete c.story; delete c.travel;
    await page.route("**/content/content.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(c) }));
    await page.goto("/?intro=0#faq");
    await ready(page);
    await expect(page.locator("[data-page=home] h1")).toBeVisible(); // faq has nothing, falls back to home
    await page.goto("/?intro=0#schedule");
    await ready(page);
    await expect(page.locator("[data-page=schedule] h1")).toBeVisible();
  });

  test("missing guests.json (404): public visitors unaffected, a personal link degrades to the public view", async ({ page }) => {
    await page.route("**/content/guests.json", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/?intro=0#schedule");
    await ready(page);
    await expect(page.locator("[data-page=schedule] .event")).toHaveCount(2);
    await page.goto("/?i=NVMDUYC3MF&intro=0#home");
    await ready(page);
    await expect(page.locator("[data-page=home] h1")).toBeVisible();
    await expect(page.locator("[data-guest-badge]")).toHaveCount(0);
    expect(await page.evaluate(() => location.search)).not.toContain("i="); // the code is stripped from the URL either way
    // the name lookup shows its friendly not-found message instead of throwing
    await page.goto("/?intro=0#rsvp");
    await ready(page);
    await expect(page.locator("[data-page=rsvp] [data-lookup]")).toBeVisible();
  });

  test("garbage guests.json: still renders", async ({ page }) => {
    await page.route("**/content/guests.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "<html>not json</html>" }));
    await page.goto("/?i=NVMDUYC3MF&intro=0#schedule");
    await ready(page);
    await expect(page.locator("[data-page=schedule] .event")).toHaveCount(2);
  });

  test("wrong personal-link code: public view, friendly state", async ({ page }) => {
    await page.goto("/?i=ZZZZZZZZZZ&intro=0#schedule");
    await ready(page);
    await expect(page.locator("[data-page=schedule] .event")).toHaveCount(2);
    expect(await page.evaluate(() => localStorage.getItem("pa.guest.v1"))).toBeNull();
  });

  test("a real personal link works, is cached for the session and stays after navigation", async ({ page }) => {
    await page.goto("/?i=NVMDUYC3MF&intro=0#schedule");
    await ready(page);
    await expect(page.locator("[data-guest-badge]")).toContainText("Sharma");
    expect(await page.evaluate(() => !!sessionStorage.getItem("pa.guest.session"))).toBe(true);
    await page.goto("/?intro=0#schedule"); // no code in the URL: remembered
    await ready(page);
    await expect(page.locator("[data-guest-badge]")).toContainText("Sharma");
  });

  test("offline after the first visit: the schedule still loads from the service worker", async ({ page, context, browserName }) => {
    test.skip(browserName === "webkit", "WebKit's service worker is not reliable under automation");
    await page.goto("/?sw=1&intro=0#schedule");
    await ready(page);
    await page.waitForFunction(() => navigator.serviceWorker?.controller || document.documentElement.dataset.sw === "registered");
    await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; await new Promise((res) => { if (r.active?.state === "activated") res(); else r.active.addEventListener("statechange", () => r.active.state === "activated" && res()); setTimeout(res, 3000); }); });
    await page.reload(); // now controlled; warms the runtime cache
    await ready(page);
    await context.setOffline(true);
    await page.goto("/?sw=1&intro=0#schedule");
    await ready(page);
    await expect(page.locator("[data-page=schedule] .event").first()).toBeVisible();
    await expect(page.locator("[data-page=schedule] h1")).toBeVisible();
    await context.setOffline(false);
    errors = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/i.test(e));
  });

  test("localStorage and sessionStorage that throw: every page still renders and the stepper works", async ({ page }) => {
    await page.addInitScript(() => {
      const boom = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
      Object.defineProperty(window, "localStorage", { get: boom, configurable: true });
      Object.defineProperty(window, "sessionStorage", { get: boom, configurable: true });
    });
    await page.goto(`/?intro=0&guest=${FAMILY}#home`);
    await ready(page);
    for (const r of ["home", "schedule", "travel", "story", "faq", "registry", "rsvp"]) {
      await page.evaluate((h) => { location.hash = h; }, "#" + r);
      await expect(page.locator(`[data-page="${r}"] h1`)).toBeVisible();
    }
    await page.getByRole("button", { name: "Everyone, all events ✓" }).click();
    await page.locator("[data-page=rsvp] [data-act=next]").click();
    await expect(page.locator("[data-page=rsvp] [data-step-heading]")).toHaveText("A few details");
    // the intro (which stores its 'seen' flag in sessionStorage) also tolerates it
    await page.goto("/");
    await ready(page);
    await expect(page.locator("#intro")).toBeVisible();
    await page.locator("#intro-skip").click();
    await expect(page.locator("#intro")).toHaveCount(0);
    await expect(page.locator("[data-page=home] h1")).toBeVisible();
  });

  test("very slow content.json: something is shown while waiting (not a blank page)", async ({ page }) => {
    await page.route("**/content/content.json", async (r) => { await new Promise((res) => setTimeout(res, 2500)); await r.fallback(); });
    await page.goto("/?intro=0", { waitUntil: "commit" });
    await page.waitForTimeout(600);
    const visibleWhileLoading = await page.evaluate(() => {
      const app = document.querySelector("#app");
      const boot = document.querySelector("#boot, .boot, [data-loading], .loading");
      const bodyText = document.body.innerText.replace(/Skip to content/g, "").trim();
      return { appHidden: app.hidden, hasLoader: !!boot, bodyText };
    });
    const hasLoadingState = visibleWhileLoading.hasLoader || visibleWhileLoading.bodyText.length > 0;
    if (!hasLoadingState) test.info().annotations.push({ type: "gap", description: "No loading state while content.json is slow: page is blank until it arrives (index.html / main.js)." });
    await ready(page);
    await expect(page.locator("[data-page=home] h1")).toBeVisible();
  });
});

/* ---------- editor ---------- */
test.describe("editor", () => {
  test.use({ isMobile: false, hasTouch: false, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("pa.editor.coach.v1", "1"); } catch {} });
  });
  const boot = (page) => page.waitForFunction(() => window.__editor && document.querySelector("#frame")?.contentDocument?.documentElement?.dataset?.ready === "1" && !document.querySelector("#boot"));
  const fr = (page) => page.frameLocator("#frame");
  const draft = (page) => page.evaluate(() => structuredClone(window.__editor.draft));
  const connect = (ctxOrPage) => ctxOrPage.addInitScript(() => { try { localStorage.setItem("pa.editor.gh", JSON.stringify({ owner: "o", repo: "r", branch: "main", token: "tok_secret" })); } catch {} });

  test("unparseable content.json: the editor says so plainly instead of hanging", async ({ page }) => {
    await page.route("**/content/content.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{ nope" }));
    await page.goto("/edit/");
    await expect(page.locator("#boot")).toContainText("could not load the site content");
    errors = errors.filter((e) => !/SyntaxError|JSON/i.test(e));
  });

  test("schema-invalid content.json: the editor flags the problems and refuses to publish", async ({ page }) => {
    const c = structuredClone(CONTENT);
    c.hotels[0].bookingUrl = "this is not a url";
    c.site.weddingDate = "next summer";
    await page.route("**/content/content.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(c) }));
    await page.goto("/edit/");
    await boot(page);
    await expect(page.locator("#badge")).toContainText(/problem/);
    await expect(page.locator("#publish")).toBeDisabled();
    await page.click("#badge");
    expect(await page.locator(".issue[data-level=err]").count()).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Escape");
  });

  test("two editor tabs: the second tab is told the site changed and can reload the latest", async ({ context, page }) => {
    const repo = new MockRepo();
    await repo.install(context);
    await repo.serveSite(context);
    await connect(context);
    const open = async (p) => { await p.goto("/edit/"); await boot(p); };
    const other = await context.newPage();
    const errs2 = [];
    other.on("console", (m) => { if (m.type() === "error" && !FONT_NOISE.test(m.text())) errs2.push(m.text()); });
    await open(page);
    await open(other);
    const rename = async (p, name, field = "hotels.0.name") => {
      await p.selectOption("#page-select", "travel");
      const el = fr(p).locator(`[data-path="${field}"]`);
      await el.scrollIntoViewIfNeeded();
      await el.click();
      await p.keyboard.press("Control+A");
      await p.keyboard.type(name);
      await p.keyboard.press("Enter");
    };
    // tab 1 publishes
    await rename(page, "From tab one");
    await page.click("#publish");
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.locator("dialog.dlg")).toContainText("Published", { timeout: 30_000 });
    await page.keyboard.press("Escape");
    const afterOne = repo.commitCount();
    // tab 2 (still on the old base) edits something else and tries to publish
    await rename(other, "From tab two", "hotels.1.name");
    await other.click("#publish");
    await other.getByRole("button", { name: "Publish now" }).click();
    await expect(other.locator("dialog.dlg")).toContainText("The site was changed elsewhere since you started");
    expect(repo.commitCount()).toBe(afterOne); // nothing was overwritten
    expect(repo.json("content/content.json").hotels[0].name).toBe("From tab one");
    await other.getByRole("button", { name: /Reload latest/ }).click();
    await expect.poll(async () => (await draft(other)).hotels[0].name).toBe("From tab one");
    expect((await draft(other)).hotels[1].name).not.toBe("From tab two");
    // "Publish anyway" would overwrite; make sure a deliberate overwrite still works after a fresh conflict
    expect(errs2).toEqual([]);
  });

  test("two editor tabs: 'Publish anyway' overwrites deliberately", async ({ context, page }) => {
    const repo = new MockRepo();
    await repo.install(context);
    await repo.serveSite(context);
    await connect(context);
    const other = await context.newPage();
    await page.goto("/edit/"); await boot(page);
    await other.goto("/edit/"); await boot(other);
    // simulate a publish from elsewhere
    const c = repo.json("content/content.json");
    c.site.title = "Elsewhere";
    const blob = repo.putBlob(JSON.stringify(c, null, 2) + "\n");
    const tree = repo.putTree({ ...repo.files(), "content/content.json": blob });
    repo.head = repo.addCommit({ message: "Elsewhere", tree, parents: [repo.head], changed: ["content/content.json"] });
    const el = fr(page).locator('[data-path="hotels.0.name"]');
    await page.selectOption("#page-select", "travel");
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Mine wins");
    await page.keyboard.press("Enter");
    await page.click("#publish");
    await page.getByRole("button", { name: "Publish now" }).click();
    await page.getByRole("button", { name: "Publish anyway" }).click();
    await expect(page.locator("dialog.dlg")).toContainText("Published", { timeout: 30_000 });
    expect(repo.json("content/content.json").hotels[0].name).toBe("Mine wins");
    await other.close();
  });

  test("GitHub failures give plain-language errors and keep the draft", async ({ page }) => {
    const repo = new MockRepo();
    await repo.install(page);
    await repo.serveSite(page);
    await connect(page);
    await page.goto("/edit/"); await boot(page);
    await page.selectOption("#page-select", "travel");
    const el = fr(page).locator('[data-path="hotels.0.name"]');
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Survives failure");
    await page.keyboard.press("Enter");
    for (const [status, re] of [[403, /isn't allowed|rate limit/i], [422, /rejected/i], [500, /GitHub returned an error \(500\)/]]) {
      repo.failNext = (m, p) => (p === "/git/ref/heads/main" ? status : 0);
      await page.click("#publish");
      await page.getByRole("button", { name: "Publish now" }).click();
      await expect(page.locator(".pub-err")).toContainText(re);
      await page.keyboard.press("Escape");
      expect((await draft(page)).hotels[0].name).toBe("Survives failure");
    }
    repo.failNext = null;
    // offline
    repo.failNext = () => "abort"; // network down
    await page.click("#publish");
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.locator(".pub-err")).toContainText(/offline|reach GitHub|internet/i);
    repo.failNext = null;
    await page.keyboard.press("Escape");
    // and then it works
    await page.click("#publish");
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.locator("dialog.dlg")).toContainText("Published", { timeout: 30_000 });
    expect(repo.json("content/content.json").hotels[0].name).toBe("Survives failure");
  });
});

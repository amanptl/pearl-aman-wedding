import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTES = ["home", "schedule", "travel", "story", "faq", "rsvp"];
const FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET|NAME|CONNECTION|BLOCKED)|Failed to load resource/i;
const FAMILY = "/?guest=tests/fixtures/guest-family.json&intro=0";

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !FONT_NOISE.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
});
test.afterEach(() => { expect(errors).toEqual([]); });

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

/** Describe the focused element and whether it shows a visible focus indicator. */
const focusInfo = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { body: true };
  const has = (n) => { const c = getComputedStyle(n); return (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || (!!c.boxShadow && c.boxShadow !== "none"); };
  const own = has(el);
  // Visually-hidden inputs (radios/checkboxes) show focus on their label / wrapper.
  let alt = false;
  for (const n of [el.labels?.[0], el.closest("label, summary, .rv-opt, .rv-seg, .chip"), el.parentElement, el.nextElementSibling].filter(Boolean)) if (has(n)) alt = true;
  const r = el.getBoundingClientRect();
  return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30), own, alt, w: r.width, h: r.height, key: el.tagName + "|" + el.id + "|" + String(el.className) + "|" + (el.getAttribute("href") || el.getAttribute("name") || "") + "|" + (el.value || "") + "|" + (el.textContent || "").trim().slice(0, 20) };
});

// WebKit does not put links in the Tab order by default (Safari needs Option+Tab), so Tab-walking tests run on Chromium only.
test.describe("tab order and focus visibility", () => {
  for (const route of ROUTES) {
    test(`route ${route}: skip link first, visible focus everywhere, no trap`, async ({ page, browserName }) => {
      test.skip(browserName === "webkit", "WebKit does not Tab to links");
      await open(page, `${FAMILY}#${route}`);
      // The skip link is the first focusable element in DOM order, and it becomes visible when focused.
      expect(await page.evaluate(() => document.querySelector("a[href], button, input, select, textarea, summary, [tabindex='0']")?.classList.contains("skip-link"))).toBe(true);
      await page.locator(".skip-link").focus();
      await expect(page.locator(".skip-link")).toBeInViewport();
      expect((await focusInfo(page)).own || (await focusInfo(page)).alt, "skip link focus ring").toBe(true);
      const seen = new Set();
      const bad = [];
      let cycled = false;
      for (let i = 0; i < 200; i++) {
        await page.keyboard.press("Tab");
        const f = await focusInfo(page);
        if (f.body || seen.has(f.key)) { cycled = true; break; }
        seen.add(f.key);
        if (!f.own && !f.alt) bad.push(`${f.tag}.${f.cls} "${f.text}"`);
      }
      expect(bad, "focused elements without a visible focus indicator").toEqual([]);
      expect(seen.size).toBeGreaterThan(3);
      expect(cycled, "Tab never leaves the page (focus trap?)").toBeTruthy();
    });
  }

  test("skip link moves focus into main content", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "WebKit does not Tab to links");
    await open(page, `${FAMILY}#faq`);
    await page.locator(".skip-link").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement.closest("#main"))).toBe(true);
  });
});

test.describe("dialogs and sheets", () => {
  test("More / Help sheet: focus moves inside, stays inside, Esc closes and focus returns to the opener", async ({ page, browserName }) => {
    await open(page, `${FAMILY}#faq`);
    const opener = page.viewportSize().width < 768 ? page.locator("#tabbar [data-more]") : page.locator("#help");
    await opener.focus();
    await page.keyboard.press("Enter");
    const dlg = page.locator("dialog.sheet");
    await expect(dlg).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement.closest("dialog"))).toBe(true);
    if (browserName !== "webkit") for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement.closest("dialog"))).toBe(true); }
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("Help button sheet: Esc closes, focus returns to Help", async ({ page }) => {
    await open(page, `${FAMILY}#faq`);
    const help = page.locator("#help");
    await help.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("dialog.sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.sheet")).toHaveCount(0);
    await expect(help).toBeFocused();
  });

  test("calendar sheet: keyboard open, Esc, focus returns", async ({ page }) => {
    await open(page, `${FAMILY}#schedule`);
    const b = page.locator("[data-cal]").first();
    await b.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(b).toBeFocused();
  });
});

test("intro envelope is keyboard operable (Space opens, focus lands on the page heading)", async ({ page, browserName }) => {
  await open(page, "/");
  await expect(page.locator("#intro")).toBeVisible();
  await expect(page.locator("#intro-open")).toBeFocused();
  // The app and the skip link are inert behind the intro, so Tab only reaches the intro buttons.
  if (browserName !== "webkit") for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => { const a = document.activeElement; return a === document.body || !!a.closest("#intro"); })).toBe(true);
  }
  await page.locator("#intro-open").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#intro")).toHaveCount(0, { timeout: 5000 });
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('[data-page="home"] h1')).toBeFocused();
});

test("FAQ accordions open and close with Enter and Space", async ({ page }) => {
  await open(page, `${FAMILY}#faq`);
  const items = page.locator("details.faq-item");
  expect(await items.count()).toBeGreaterThan(2);
  await items.nth(0).locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(items.nth(0)).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(items.nth(0)).not.toHaveAttribute("open", "");
  await items.nth(1).locator("summary").focus();
  await page.keyboard.press("Space");
  await expect(items.nth(1)).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(items.nth(1)).not.toHaveAttribute("open", "");
});

test("schedule day picker: Tab between days, Enter selects and scrolls to the day", async ({ page }) => {
  await open(page, `${FAMILY}#schedule`);
  const btns = page.locator(".daynav-btn");
  expect(await btns.count()).toBeGreaterThan(1);
  await btns.first().focus();
  await page.keyboard.press("Tab");
  await expect(btns.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => btns.nth(1).getAttribute("aria-current")).toBe("true");
  const day = await btns.nth(1).getAttribute("data-day");
  await expect.poll(() => page.locator(`#day-${day}`).evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(await page.evaluate(() => innerHeight * 0.7));
});

test("RSVP stepper completes by keyboard alone (Tab / Space / Enter)", async ({ page }) => {
  test.setTimeout(150_000);
  await open(page, `${FAMILY}#rsvp`);
  const R = "[data-page=rsvp]";
  const H = page.locator(`${R} [data-step-heading]`);
  await expect(H).toHaveText("Who's coming?");
  // Tab until the focused element matches `sel`. Only Tab moves focus.
  async function tabTo(sel, max = 120) {
    for (let i = 0; i < max; i++) {
      if (await page.evaluate((s) => !!document.activeElement?.matches(s), sel)) return;
      await page.keyboard.press("Tab");
    }
    throw new Error("could not Tab to " + sel);
  }
  await tabTo(`${R} .rv-quick .btn`);
  await page.keyboard.press("Space");
  await expect(page.locator(`${R} input[data-count]:checked`).first()).toBeAttached();
  await tabTo(`${R} [data-act=next]`);
  await page.keyboard.press("Enter");
  await expect(H).toHaveText("A few details");
  await expect(H).toBeFocused();
  await tabTo(`${R} [data-act="diet+"]`);
  await page.keyboard.press("Space");
  await expect(page.locator(`${R} [data-num="diet:0"]`)).toHaveText("1");
  await tabTo(`${R} [data-act=next]`);
  await page.keyboard.press("Enter");
  await expect(H).toHaveText("Review and send");
  await expect(H).toBeFocused();
  await tabTo(`${R} [data-act=send]`);
  await page.keyboard.press("Enter");
  await expect(H).toHaveText("Thank you, Sharma Family");
  await expect(H).toBeFocused();
});

test.describe("landmarks, headings, labels", () => {
  for (const route of ROUTES) {
    test(`route ${route}: one h1, no skipped levels, names, alt, landmarks`, async ({ page }) => {
      await open(page, `${FAMILY}#${route}`);
      await page.waitForTimeout(200);
      const r = await page.evaluate((route) => {
        const root = document.querySelector(`[data-page="${route}"]`);
        const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && !el.closest("[hidden],[aria-hidden=true],dialog:not([open])");
        const hs = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis).map((h) => +h.tagName[1]);
        const unlabeled = [...document.querySelectorAll("#app input:not([type=hidden]), #app select, #app textarea")].filter(vis).filter((el) => !(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.labels?.length || el.title)).map((el) => el.outerHTML.slice(0, 80));
        const noAlt = [...document.querySelectorAll("#app img")].filter((i) => !i.hasAttribute("alt")).map((i) => i.src);
        const iconOnly = [...document.querySelectorAll("#app button, #app a[href]")].filter(vis).filter((b) => (b.textContent || "").replace(/\s+/g, "").length === 0 && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby") && !b.title).map((b) => b.outerHTML.slice(0, 80));
        return { hs, unlabeled, noAlt, iconOnly, live: document.querySelectorAll("[aria-live], [role=status], [role=alert]").length, main: document.querySelectorAll("main, [role=main]").length, navs: [...document.querySelectorAll("nav")].map((n) => n.getAttribute("aria-label") || ""), h1All: [...document.querySelectorAll("h1")].filter(vis).length };
      }, route);
      expect(r.h1All, "visible h1 count").toBe(1);
      expect(r.hs[0]).toBe(1);
      for (let i = 1; i < r.hs.length; i++) expect(r.hs[i] - r.hs[i - 1], `heading order ${r.hs.join(",")}`).toBeLessThanOrEqual(1);
      expect(r.unlabeled).toEqual([]);
      expect(r.noAlt).toEqual([]);
      expect(r.iconOnly).toEqual([]);
      expect(r.main).toBe(1);
      expect(r.live).toBeGreaterThan(0);
      expect(r.navs.every((n) => n)).toBe(true);
    });
  }

  test("toast region is a polite live region and announces a message", async ({ page }) => {
    await open(page, `${FAMILY}#faq`);
    const region = page.locator("#toast");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await page.evaluate(async () => { (await import("/src/lib/ui.js")).toast("Hello there"); });
    await expect(region).toContainText("Hello there");
  });
});

test.describe("axe: all WCAG 2.2 AA rules, every impact level", () => {
  for (const route of ROUTES) {
    test(`route ${route}`, async ({ page }) => {
      await open(page, `${FAMILY}#${route}`);
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
      const out = res.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
      expect(out).toEqual([]);
    });
  }
});

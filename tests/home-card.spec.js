import { test, expect } from "./helpers/test.js";

// The home page shows only the days a guest is invited to, and the city (never the wedding venue): not every guest is
// invited to the wedding itself.

async function card(page, query) {
  await page.goto(`/?${query}intro=0#home`);
  await page.waitForSelector("html[data-ready]");
  return {
    text: (await page.locator(".invite-text").innerText()).replace(/\s+/g, " ").trim(),
    welcome: (await page.locator(".welcome-when").innerText()).replace(/\s+/g, " ").trim(),
    h1: await page.locator('[data-page="home"] h1').textContent(),
    title: await page.title(),
  };
}

test("dates list only the invited days: single, consecutive, gaps, month ends", async ({ page }) => {
  await page.goto("/?intro=0#home");
  await page.waitForSelector("html[data-ready]");
  const out = await page.evaluate(async () => {
    const { inviteDates } = await import("/src/pages/home.js");
    const site = { weddingDate: "2027-07-25T16:00" };
    const ev = (...days) => days.map((d) => ({ start: `${d}T17:00` }));
    return [
      inviteDates(ev("2027-07-23"), site), // Mehendi only
      inviteDates(ev("2027-07-23", "2027-07-25"), site), // Mehendi + wedding
      inviteDates(ev("2027-07-24", "2027-07-25"), site), // Vidhi + wedding
      inviteDates(ev("2027-07-23", "2027-07-24", "2027-07-25"), site),
      inviteDates(ev("2027-07-23", "2027-07-24", "2027-07-26"), site),
      inviteDates(ev("2027-07-25", "2027-07-25"), site), // two events, one day
      inviteDates([{ start: "2027-07-25T18:30", end: "2027-07-26T01:00" }], site), // past midnight adds no day
      inviteDates(ev("2027-07-21", "2027-07-23", "2027-07-25"), site),
      inviteDates(ev("2027-07-31", "2027-08-01"), site),
      inviteDates(ev("2027-07-30", "2027-08-01"), site),
      inviteDates([], site), // the plain link
    ];
  });
  expect(out).toEqual([
    "July 23, 2027",
    "July 23 & 25, 2027",
    "July 24–25, 2027",
    "July 23–25, 2027",
    "July 23–24 & 26, 2027",
    "July 25, 2027",
    "July 25, 2027",
    "July 21, 23 & 25, 2027",
    "July 31 – August 1, 2027",
    "July 30 & August 1, 2027",
    "July 2027",
  ]);
});

for (const [who, query] of [["a family invite", "guest=tests/fixtures/guest-family.json&"], ["a Sangeet-only invite", "guest=tests/fixtures/guest-sangeet.json&"], ["the plain link", ""]]) {
  test(`${who}: the card shows the city, never the venue, time or wedding date text`, async ({ page }) => {
    const c = await card(page, query);
    expect(c.text).toContain("Edmonton, Canada");
    expect(c.welcome).toContain("Edmonton, Canada");
    for (const s of [c.text, c.welcome, c.h1, c.title]) {
      expect(s).not.toContain("Grand Imperial");
      expect(s).not.toContain("Alberta");
      expect(s).not.toContain("25th");
      expect(s).not.toMatch(/\d:\d\d/);
    }
  });
}

test("a Sangeet-only guest sees only the Sangeet's day", async ({ page }) => {
  const c = await card(page, "guest=tests/fixtures/guest-sangeet.json&");
  expect(c.text).toContain("for the wedding celebrations of");
  expect(c.text).toContain("July 24, 2027");
  expect(c.title).toContain("July 24, 2027");
});

test("a burgundy date tag hangs from Respond until the RSVP deadline", async ({ page }) => {
  await page.goto("/?intro=0#home");
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".due-text")).toHaveText("by Jan 31st");
  await expect(page.locator(".tag-respond")).toHaveAccessibleDescription("by Jan 31st");
  const [r, d] = await Promise.all([".tag-respond", ".due-card"].map((s) => page.locator(s).boundingBox()));
  expect(Math.abs(r.x + r.width / 2 - (d.x + d.width / 2))).toBeLessThan(4); // hung from the centre
  expect(d.y).toBeGreaterThan(r.y + r.height);
});

test("the date tag is gone once the deadline has passed", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2027-02-01T12:00:00-07:00"));
  await page.goto("/?intro=0#home");
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".tag-respond")).toBeVisible();
  await expect(page.locator(".due-tag")).toHaveCount(0);
});

test("the scroll chevron sits at the right edge on phones and tablets, centred on desktop", async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
  await page.goto("/?intro=0#home");
  await page.waitForSelector("html[data-ready]");
  const { cx, vw } = await page.evaluate(() => {
    const h = document.querySelector(".scroll-hint").getBoundingClientRect();
    return { cx: h.left + h.width / 2, vw: innerWidth };
  });
  if (vw >= 1024) expect(Math.abs(cx - vw / 2)).toBeLessThan(2);
  else expect(cx).toBeGreaterThan(vw - 60);
});

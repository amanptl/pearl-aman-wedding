import { test, expect } from "@playwright/test";

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
      inviteDates(ev("2027-07-24", "2027-07-25"), site), // Haldi & Vidhi + wedding
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

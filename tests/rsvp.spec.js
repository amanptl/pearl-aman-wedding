// RSVP by household headcount: per event "how many of you will join us?" (0..seats), optional names, food counts.
// Event lists come from content.json plus the fixture's private events, so tests read them from the page.
import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, assertNoClippedText, assertNoOverlaps, runAxe } from "./helpers/layout.js";
import fs from "node:fs";

const FAMILY = "/?guest=tests/fixtures/guest-family.json&intro=0#rsvp"; // 3 named members, no seats field: 3 seats
const FRIEND = "/?guest=tests/fixtures/guest-friend.json&intro=0#rsvp"; // 1 member + 1 plus-one: 2 seats
const SOLO = "/?guest=tests/fixtures/guest-solo.json&intro=0#rsvp"; // served below: the friend with seats: 1
const KEY = (c) => `pa.rsvp.v1.${c}`;
const R = "[data-page=rsvp]";
const EP = "https://script.example.test/macros/s/TEST/exec";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
  await page.route("**/tests/fixtures/guest-solo.json", async (route) => {
    const g = JSON.parse(fs.readFileSync("tests/fixtures/guest-friend.json", "utf8"));
    await route.fulfill({ json: { ...g, code: "SOLO234567", household: "Jordan Lee", seats: 1 } });
  });
});

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(`${R} h1`)).toBeVisible();
}
const heading = (page) => page.locator(`${R} [data-step-heading]`);
const next = (page) => page.locator(`${R} [data-act=next]`).click();
const pick = (page, e, n) => page.locator(`${R} input[name="n__${e}"][value="${n}"]`).check();
const evIds = (page) => page.locator(`${R} .rv-ev`).evaluateAll((els) => els.map((e) => e.dataset.ev));
const stored = (page, code) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY(code));
const plus = (page, kind, k) => page.locator(`${R} [data-act="${kind}+"][data-k="${k}"]`);

async function checks(page, info, tag) {
  await assertNoHorizontalOverflow(page);
  await assertNoClippedText(page);
  await assertNoOverlaps(page, `${R} .rv-card, ${R} .rv-segopt, ${R} .rv-nav .btn, ${R} .rv-opt, ${R} .rv-field, ${R} .rv-quick .btn, ${R} .rv-shuttle`);
  await page.evaluate(() => window.scrollTo(0, 0));
  const bad = (await runAxe(page)).filter((v) => ["serious", "critical"].includes(v.impact));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  if (/iphone-se|desktop-1440/.test(info.project.name)) {
    fs.mkdirSync("tests/screens", { recursive: true });
    await page.locator(R).screenshot({ path: `tests/screens/3-${info.project.name === "iphone-se" ? "375" : "1440"}-${tag}.png` });
  }
}

test("no guest: intro, deadline and lookup container", async ({ page }) => {
  await open(page, "/?intro=0#rsvp");
  await expect(page.locator(`${R} [data-lookup]`)).toHaveCount(1);
  await expect(page.locator(`${R} [data-list="rsvp.intro"] p`).first()).toBeVisible();
  await expect(page.locator(`${R} .rv-deadline`)).toContainText("June 1st, 2027");
  await expect(page.locator(`${R} [data-form]`)).toHaveCount(0);
});

test("family: headcount per event, names, food counts, review, submit, confirmation", async ({ page }, info) => {
  test.setTimeout(150_000);
  await open(page, FAMILY);
  await expect(heading(page)).toHaveText("Who's coming?");
  await expect(page.locator(`${R} .rv-count`)).toHaveText("Step 1 of 3");
  await expect(page.locator(`${R} [data-step="1"] > .rv-help`)).toContainText("up to 3 guests");
  const evs = await evIds(page);
  expect(evs.length).toBeGreaterThan(1);
  // chips: None of us, 1, 2, 3
  await expect(page.locator(`${R} input[name="n__${evs[0]}"]`)).toHaveCount(4);
  await expect(page.locator(`${R} [data-names-card]`)).toBeHidden();
  await checks(page, info, "step1-empty");
  await page.getByRole("button", { name: "All 3 of us, every event ✓" }).click();
  await expect(page.locator(`${R} input[value="3"]:checked`)).toHaveCount(evs.length);
  await pick(page, evs[0], 2);
  await expect(page.locator(`${R} [data-names-card]`)).toBeVisible();
  await page.locator("#x-names").fill("Raj, Priya, Anika");
  await checks(page, info, "step1-filled");
  await next(page);
  await expect(heading(page)).toBeFocused();
  await expect(heading(page)).toHaveText("A few details");
  // food counts are capped at the most coming to one event (3)
  for (let i = 0; i < 5; i++) if (await plus(page, "diet", 0).isEnabled()) await plus(page, "diet", 0).click();
  await expect(page.locator(`${R} [data-num="diet:0"]`)).toHaveText("3");
  await expect(plus(page, "diet", 0)).toBeDisabled();
  await plus(page, "diet", 2).click();
  await page.locator("#x-dietNote").fill("No mustard please");
  await page.locator("#x-phone").fill("416 555 0100");
  await page.locator("#x-song").fill("Kala Chashma");
  // shuttle seats (if any event has a shuttle) are capped by that event's count
  const shuttle = await page.locator(`${R} [data-act="seat+"]`).count();
  if (shuttle) { for (let i = 0; i < 5; i++) if (await page.locator(`${R} [data-act="seat+"]`).first().isEnabled()) await page.locator(`${R} [data-act="seat+"]`).first().click(); }
  await page.locator("#x-message").fill("So excited!");
  await checks(page, info, "step2");
  await next(page);
  await expect(heading(page)).toHaveText("Review and send");
  await expect(page.locator(`${R} [data-sum-event="${evs[0]}"]`)).toContainText("2 guests");
  await expect(page.locator(`${R} [data-sum-event="${evs[1]}"]`)).toContainText("3 guests");
  await expect(page.locator(`${R} .rv-dl`)).toContainText("Raj, Priya, Anika");
  await expect(page.locator(`${R} .rv-dl`)).toContainText("Vegetarian: 3");
  await checks(page, info, "step3");
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(heading(page)).toHaveText("Thank you, Sharma Family");
  const P = await stored(page, "FAMILY2345");
  expect(P).toMatchObject({ v: 2, code: "FAMILY2345", household: "Sharma Family", seats: 3, names: "Raj, Priya, Anika", dietNote: "No mustard please" });
  expect(P.submittedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(P.counts).toEqual(Object.fromEntries(evs.map((e, i) => [e, i === 0 ? 2 : 3])));
  expect(P.diet).toEqual({ Vegetarian: 3, Jain: 1 });
  expect(P.extras).toMatchObject({ phone: "416 555 0100", song: "Kala Chashma", message: "So excited!" });
  for (const n of Object.values(P.extras.shuttle)) expect(n).toBeLessThanOrEqual(3);
  const done = page.locator(`${R} [data-done]`);
  await expect(done.locator(".rv-sum-ev")).toHaveCount(evs.length);
  await expect(done.getByRole("link", { name: /Google Calendar/ })).toHaveCount(evs.length);
  await checks(page, info, "done");
  const dl = page.waitForEvent("download");
  await done.getByRole("button", { name: /calendar file/i }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.ics$/);
  await page.getByRole("button", { name: "Change my response" }).click();
  await expect(heading(page)).toHaveText("Who's coming?");
  await expect(page.locator(`${R} input[value="3"]:checked`)).toHaveCount(evs.length - 1);
  await expect(page.locator("#x-names")).toHaveValue("Raj, Priya, Anika");
});

test("validation blocks Continue and focuses the first unanswered event", async ({ page }) => {
  await open(page, FAMILY);
  const evs = await evIds(page);
  await pick(page, evs[0], 1);
  await next(page);
  await expect(heading(page)).toHaveText("Who's coming?");
  await expect(page.locator(`${R} input[name="n__${evs[1]}"]`).first()).toBeFocused();
  const err = page.locator(`#er-${evs[1]}`);
  await expect(err).toBeVisible();
  await expect(err).toContainText("how many of you are coming to");
  await expect(page.locator(`${R} [data-act=back]`)).toHaveCount(0);
  await pick(page, evs[1], 0);
  await expect(err).toBeHidden();
});

test("friend with 2 seats: counts up to 2, names optional and sent", async ({ page }, info) => {
  await open(page, FRIEND);
  const evs = await evIds(page);
  await expect(page.locator(`${R} input[name="n__${evs[0]}"]`)).toHaveCount(3);
  await page.getByRole("button", { name: "All 2 of us, every event ✓" }).click();
  await checks(page, info, "friend-step1");
  await next(page);
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(heading(page)).toHaveText("Thank you, Jordan Lee");
  const P = await stored(page, "FRIEND2345");
  expect(P.seats).toBe(2);
  expect(Object.values(P.counts)).toEqual(evs.map(() => 2));
  expect(P.names).toBe("");
});

test("one seat: accept/decline wording, no names box", async ({ page }) => {
  await open(page, SOLO);
  const evs = await evIds(page);
  const chips = page.locator(`${R} [data-ev="${evs[0]}"] .rv-segopt`);
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText("Regretfully declines");
  await expect(chips.nth(1)).toContainText("Joyfully accepts");
  await expect(page.locator(`${R} [data-names-card]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Coming to all events ✓" }).click();
  await next(page);
  await expect(page.locator(`${R} .rv-food legend`)).toHaveText("Do any of these apply to you?");
  await next(page);
  await expect(page.locator(`${R} [data-summary]`).first()).toContainText("Coming");
});

test("declining everything skips details", async ({ page }, info) => {
  await open(page, FRIEND);
  for (const e of await evIds(page)) await pick(page, e, 0);
  await expect(page.locator(`${R} [data-names-card]`)).toBeHidden();
  await next(page);
  await expect(heading(page)).toHaveText("Send your wishes");
  await expect(page.locator(`${R} .rv-food`)).toHaveCount(0);
  await page.locator("#x-message").fill("Sending love");
  await checks(page, info, "wishes");
  await next(page);
  await expect(page.locator(`${R} [data-summary]`)).toContainText("None of us");
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(page.locator(`${R} [data-done]`)).toContainText("We'll miss you");
  await expect(page.locator(`${R} [data-done]`).getByRole("button", { name: /calendar/i })).toHaveCount(0);
  const P = await stored(page, "FRIEND2345");
  expect(Object.values(P.counts).every((n) => n === 0)).toBe(true);
  expect(P.diet).toEqual({});
  expect(P.extras.message).toBe("Sending love");
});

test("reload mid-form keeps the draft", async ({ page }) => {
  await open(page, FAMILY);
  const evs = await evIds(page);
  await pick(page, evs[0], 2);
  await pick(page, evs[1], 0);
  await page.locator("#x-names").fill("Raj and Priya");
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(`${R} input[name="n__${evs[0]}"][value="2"]`)).toBeChecked();
  await expect(page.locator(`${R} input[name="n__${evs[1]}"][value="0"]`)).toBeChecked();
  await expect(page.locator("#x-names")).toHaveValue("Raj and Priya");
});

test("revisit pre-fills from the stored response", async ({ page }) => {
  await open(page, FAMILY);
  const evs = await evIds(page);
  await page.getByRole("button", { name: "All 3 of us, every event ✓" }).click();
  await next(page);
  await page.locator("#x-phone").fill("647 555 0000");
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(page.locator(`${R} [data-done]`)).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem("pa.rsvp.draft.v2.FAMILY2345"));
  await page.goto(FAMILY);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(`${R} [data-replied]`)).toContainText("You replied on");
  await expect(page.locator(`${R} [data-replied]`)).toContainText("June 1st, 2027");
  await expect(page.locator(`${R} input[value="3"]:checked`)).toHaveCount(evs.length);
  await next(page);
  await expect(page.locator("#x-phone")).toHaveValue("647 555 0000");
});

test("an older per-person reply (v1) is read back as counts, names and food", async ({ page }) => {
  const v1 = { code: "FAMILY2345", household: "Sharma Family", submittedAt: "2027-03-01T15:00:00.000Z",
    members: [{ id: "m1", name: "Raj Sharma", meal: "Vegetarian", dietary: "Nut allergy" }, { id: "m2", name: "Priya Sharma", meal: "", dietary: "No mustard" }, { id: "m3", name: "Anika Sharma", meal: "", dietary: "" }],
    responses: [{ memberId: "m1", eventId: "mehndi", attending: "yes" }, { memberId: "m2", eventId: "mehndi", attending: "yes" }, { memberId: "m3", eventId: "mehndi", attending: "no" }], extras: {} };
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, [KEY("FAMILY2345"), v1]);
  await open(page, FAMILY);
  await expect(page.locator(`${R} input[name="n__mehndi"][value="2"]`)).toBeChecked();
  await expect(page.locator("#x-names")).toHaveValue("Raj Sharma, Priya Sharma");
});

test("deadline passed shows message, contacts and what was sent", async ({ page }) => {
  await page.addInitScript((k) => { try { localStorage.setItem(k, JSON.stringify({ v: 2, code: "FAMILY2345", household: "Sharma Family", seats: 3, submittedAt: "2027-03-01T15:00:00.000Z", counts: { mehndi: 2 }, names: "Raj Sharma", diet: {}, dietNote: "", extras: {} })); } catch {} }, KEY("FAMILY2345"));
  await page.clock.setFixedTime(new Date("2027-07-01T12:00:00-04:00"));
  await open(page, FAMILY);
  const p = page.locator(`${R} [data-passed]`);
  await expect(p).toContainText("The RSVP deadline has passed");
  await expect(p).toContainText("please message us");
  await expect(p.locator("a[href^='tel:']").first()).toBeVisible();
  await expect(page.locator(`${R} [data-sum-event="mehndi"]`)).toContainText("2 guests");
  await expect(page.locator(`${R} .rv-dl`)).toContainText("Raj Sharma");
  await expect(page.locator(`${R} [data-form]`)).toHaveCount(0);
});

test("endpoint: GET prefill and POST payload; failure keeps answers and retries", async ({ page }) => {
  const posts = [];
  let fail = true;
  let saved = null; // the mock backend returns the last successfully POSTed payload, like Code.gs
  await page.route(`${EP}**`, async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*" };
    if (req.method() === "POST") {
      posts.push(req.postData());
      if (fail) return route.abort("failed");
      saved = JSON.parse(new URLSearchParams(req.postData()).get("payload"));
      return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ ok: true, P: saved }) });
  });
  const url = "/?content=tests/fixtures/content-rsvp-endpoint.json&guest=tests/fixtures/guest-friend.json&intro=0#rsvp";
  await open(page, url);
  const evs = await evIds(page);
  await page.getByRole("button", { name: "All 2 of us, every event ✓" }).click();
  await next(page);
  await page.locator("#x-song").fill("Tum Hi Ho");
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(page.locator(`${R} [data-send-err]`)).toBeVisible();
  await expect(page.locator(`${R} [data-send-err]`)).toContainText("Nothing you typed is lost");
  expect(await stored(page, "FRIEND2345")).toBeNull();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading(page)).toHaveText("Thank you, Jordan Lee");
  const P = JSON.parse(new URLSearchParams(posts[posts.length - 1]).get("payload"));
  expect(P.code).toBe("FRIEND2345");
  expect(P.extras.song).toBe("Tum Hi Ho");
  expect(Object.keys(P.counts)).toEqual(evs);
  expect(await stored(page, "FRIEND2345")).toMatchObject({ code: "FRIEND2345" });
});

test("endpoint: a POST the backend did not save shows an unconfirmed message and keeps answers", async ({ page }) => {
  // The no-cors POST "succeeds" but the backend never stores it (e.g. validation error or lock timeout), so the read-back GET returns nothing.
  await page.route(`${EP}**`, (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: route.request().method() === "POST" ? "{}" : JSON.stringify({ ok: true, P: null }) }));
  await open(page, "/?content=tests/fixtures/content-rsvp-endpoint.json&guest=tests/fixtures/guest-friend.json&intro=0#rsvp");
  await page.getByRole("button", { name: "All 2 of us, every event ✓" }).click();
  await next(page);
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(page.locator(`${R} [data-send-err]`)).toContainText("couldn't confirm your RSVP was saved", { timeout: 15000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(await stored(page, "FRIEND2345")).toBeNull();
});

test("endpoint: remote response pre-fills the form", async ({ page }) => {
  const P = { v: 2, code: "FRIEND2345", household: "Jordan Lee", seats: 2, submittedAt: "2027-02-02T10:00:00.000Z", counts: { sangeet: 2, wedding: 1, reception: 0 }, names: "Jordan, Sam", diet: { Jain: 1 }, dietNote: "", extras: {} };
  await page.route(`${EP}**`, (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ ok: true, P }) }));
  await open(page, "/?content=tests/fixtures/content-rsvp-endpoint.json&guest=tests/fixtures/guest-friend.json&intro=0#rsvp");
  await expect(page.locator(`${R} [data-replied]`)).toContainText("You replied on February 2, 2027");
  await expect(page.locator(`${R} input[name="n__sangeet"][value="2"]`)).toBeChecked();
  await expect(page.locator(`${R} input[name="n__wedding"][value="1"]`)).toBeChecked();
  await expect(page.locator(`${R} input[name="n__reception"][value="0"]`)).toBeChecked();
  await expect(page.locator("#x-names")).toHaveValue("Jordan, Sam");
});

test("count chips and buttons are at least 44px tall", async ({ page }) => {
  await open(page, FAMILY);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("[data-page=rsvp] .rv-segopt > span, [data-page=rsvp] .btn")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim()));
  expect(small).toEqual([]);
});

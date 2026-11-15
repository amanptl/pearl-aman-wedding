import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, assertNoClippedText, assertNoOverlaps, runAxe } from "./helpers/layout.js";
import fs from "node:fs";

const FAMILY = "/?guest=tests/fixtures/guest-family.json&intro=0#rsvp";
const FRIEND = "/?guest=tests/fixtures/guest-friend.json&intro=0#rsvp";
const KEY = (c) => `pa.rsvp.v1.${c}`;
const R = "[data-page=rsvp]";
const EP = "https://script.example.test/macros/s/TEST/exec";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("pa.intro", "1"); } catch {} });
});

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(`${R} h1`)).toBeVisible();
}
const heading = (page) => page.locator(`${R} [data-step-heading]`);
const next = (page) => page.locator(`${R} [data-act=next]`).click();
const answer = (page, m, e, v) => page.locator(`${R} input[name="a__${m}__${e}"][value=${v}]`).check();
const stored = (page, code) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY(code));

async function checks(page, info, tag) {
  await assertNoHorizontalOverflow(page);
  await assertNoClippedText(page);
  await assertNoOverlaps(page, `${R} .rv-card, ${R} .rv-seg, ${R} .rv-who-name, ${R} .rv-nav .btn, ${R} .rv-opt, ${R} .rv-field, ${R} .rv-quick .btn`);
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

test("family: answer all, details, review, submit, confirmation", async ({ page }, info) => {
  test.setTimeout(150_000);
  await open(page, FAMILY);
  await expect(heading(page)).toHaveText("Who's coming?");
  await expect(page.locator(`${R} .rv-count`)).toHaveText("Step 1 of 3");
  await checks(page, info, "step1-empty");
  await page.getByRole("button", { name: "Everyone, all events ✓" }).click();
  await expect(page.locator(`${R} input[value=yes]:checked`)).toHaveCount(15);
  await answer(page, "m3", "mehndi", "no");
  await checks(page, info, "step1-filled");
  await next(page);
  await expect(heading(page)).toBeFocused();
  await expect(heading(page)).toHaveText("A few details");
  await expect(page.locator(`${R} .rv-count`)).toHaveText("Step 2 of 3");
  await page.locator(`${R} input[name="meal-m1"][value=Vegan]`).check();
  await page.locator(`${R} input[data-diet=m2][value="Nut allergy"]`).check();
  await page.locator("#ot-m2").fill("No mustard");
  await page.locator("#x-phone").fill("416 555 0100");
  await page.locator("#x-song").fill("Kala Chashma");
  await page.locator(`${R} [data-act="seat+"][data-e=sangeet]`).click();
  await page.locator(`${R} [data-act="seat+"][data-e=sangeet]`).click();
  await expect(page.locator(`${R} [data-seats=sangeet]`)).toHaveText("2");
  for (let i = 0; i < 5; i++) if (await page.locator(`${R} [data-act="seat+"][data-e=wedding]`).isEnabled()) await page.locator(`${R} [data-act="seat+"][data-e=wedding]`).click();
  await expect(page.locator(`${R} [data-seats=wedding]`)).toHaveText("3");
  await expect(page.locator(`${R} [data-act="seat+"][data-e=wedding]`)).toBeDisabled();
  await page.locator("#x-message").fill("So excited!");
  await checks(page, info, "step2");
  await next(page);
  await expect(heading(page)).toHaveText("Review and send");
  await expect(page.locator(`${R} [data-summary]`)).toContainText("Anika Sharma");
  await expect(page.locator(`${R} [data-summary] li`).first()).toContainText("Anika Sharma ✗, not attending");
  await checks(page, info, "step3");
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(heading(page)).toHaveText("Thank you, Sharma Family");
  const P = await stored(page, "FAMILY2345");
  expect(P.code).toBe("FAMILY2345");
  expect(P.household).toBe("Sharma Family");
  expect(P.submittedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(P.members).toEqual([
    { id: "m1", name: "Raj Sharma", meal: "Vegan", dietary: "" },
    { id: "m2", name: "Priya Sharma", meal: "", dietary: "Nut allergy; No mustard" },
    { id: "m3", name: "Anika Sharma", meal: "", dietary: "" },
  ]);
  expect(P.responses).toHaveLength(15);
  expect(P.responses.find((r) => r.memberId === "m3" && r.eventId === "mehndi").attending).toBe("no");
  expect(P.responses.find((r) => r.memberId === "m1" && r.eventId === "haldi").attending).toBe("yes");
  expect(P.extras).toMatchObject({ phone: "416 555 0100", song: "Kala Chashma", message: "So excited!", shuttle: { sangeet: 2, wedding: 3 } });
  const done = page.locator(`${R} [data-done]`);
  for (const n of ["Mehndi", "Haldi", "Sangeet", "Wedding", "Reception"]) await expect(done).toContainText(n);
  await expect(done.getByRole("link", { name: /Google Calendar/ })).toHaveCount(5);
  await checks(page, info, "done");
  const dl = page.waitForEvent("download");
  await done.getByRole("button", { name: /calendar file/i }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.ics$/);
  await page.getByRole("button", { name: "Change my response" }).click();
  await expect(heading(page)).toHaveText("Who's coming?");
  await expect(page.locator(`${R} input[value=yes]:checked`)).toHaveCount(14);
});

test("validation blocks Continue and focuses first unanswered", async ({ page }) => {
  await open(page, FAMILY);
  await answer(page, "m1", "mehndi", "yes");
  await next(page);
  await expect(heading(page)).toHaveText("Who's coming?");
  const first = page.locator(`${R} input[name="a__m2__mehndi"]`).first();
  await expect(first).toBeFocused();
  const err = page.locator("#er-m2-mehndi");
  await expect(err).toBeVisible();
  await expect(err).toContainText("Priya Sharma at Mehndi");
  await expect(page.locator(`${R} [data-act=back]`)).toHaveCount(0);
  await answer(page, "m2", "mehndi", "yes");
  await expect(err).toBeHidden();
});

test("friend: plus-one needs a name and is included", async ({ page }, info) => {
  await open(page, FRIEND);
  await expect(page.locator(`${R} .rv-ev`)).toHaveCount(3);
  await page.getByRole("button", { name: "+ Add a guest" }).click();
  await expect(page.locator("#pn-p1")).toBeFocused();
  await page.getByRole("button", { name: "Everyone, all events ✓" }).click();
  await next(page);
  await expect(page.locator("#pn-p1")).toBeFocused();
  await expect(page.locator("#pe-p1")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add a guest" })).toHaveCount(0);
  await page.locator("#pn-p1").fill("Sam Rivera");
  await expect(page.locator(`${R} [data-pname=p1]`).first()).toHaveText("Sam Rivera");
  await checks(page, info, "friend-step1");
  await next(page);
  await expect(page.locator(`${R} .rv-person`)).toHaveCount(2);
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(heading(page)).toHaveText("Thank you, Jordan Lee");
  const P = await stored(page, "FRIEND2345");
  expect(P.members.map((m) => [m.id, m.name])).toEqual([["m1", "Jordan Lee"], ["p1", "Sam Rivera"]]);
  expect(P.responses.filter((r) => r.memberId === "p1" && r.attending === "yes")).toHaveLength(3);
  // remove plus-one
  await page.getByRole("button", { name: "Change my response" }).click();
  await page.getByRole("button", { name: /Remove guest 1/ }).click();
  await expect(page.locator("#pn-p1")).toHaveCount(0);
  await expect(page.locator(`${R} [data-pname]`)).toHaveCount(0);
});

test("declining everything skips details", async ({ page }, info) => {
  await open(page, FRIEND);
  for (const e of ["sangeet", "wedding", "reception"]) await answer(page, "m1", e, "no");
  await next(page);
  await expect(heading(page)).toHaveText("Send your wishes");
  await expect(page.locator(`${R} .rv-person`)).toHaveCount(0);
  await page.locator("#x-message").fill("Sending love");
  await checks(page, info, "wishes");
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(page.locator(`${R} [data-done]`)).toContainText("We'll miss you");
  await expect(page.locator(`${R} [data-done]`).getByRole("button", { name: /calendar/i })).toHaveCount(0);
  const P = await stored(page, "FRIEND2345");
  expect(P.responses.every((r) => r.attending === "no")).toBe(true);
  expect(P.extras.message).toBe("Sending love");
});

test("reload mid-form keeps the draft", async ({ page }) => {
  await open(page, FAMILY);
  await answer(page, "m1", "mehndi", "yes");
  await answer(page, "m2", "wedding", "no");
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(`${R} input[name="a__m1__mehndi"][value=yes]`)).toBeChecked();
  await expect(page.locator(`${R} input[name="a__m2__wedding"][value=no]`)).toBeChecked();
});

test("revisit pre-fills from the stored response", async ({ page }) => {
  await open(page, FAMILY);
  await page.getByRole("button", { name: "Everyone, all events ✓" }).click();
  await next(page);
  await page.locator("#x-phone").fill("647 555 0000");
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(page.locator(`${R} [data-done]`)).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem("pa.rsvp.draft.v1.FAMILY2345"));
  await page.goto(FAMILY);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(`${R} [data-replied]`)).toContainText("You replied on");
  await expect(page.locator(`${R} [data-replied]`)).toContainText("June 1st, 2027");
  await expect(page.locator(`${R} input[value=yes]:checked`)).toHaveCount(15);
  await next(page);
  await expect(page.locator("#x-phone")).toHaveValue("647 555 0000");
});

test("deadline passed shows message, contacts and what was sent", async ({ page }) => {
  await page.addInitScript((k) => { try { localStorage.setItem(k, JSON.stringify({ code: "FAMILY2345", household: "Sharma Family", submittedAt: "2027-03-01T15:00:00.000Z", members: [{ id: "m1", name: "Raj Sharma", meal: "", dietary: "" }], responses: [{ memberId: "m1", eventId: "mehndi", attending: "yes" }], extras: {} })); } catch {} }, KEY("FAMILY2345"));
  await page.clock.setFixedTime(new Date("2027-07-01T12:00:00-04:00"));
  await open(page, FAMILY);
  const p = page.locator(`${R} [data-passed]`);
  await expect(p).toContainText("The RSVP deadline has passed");
  await expect(p).toContainText("please message us");
  await expect(p.locator("a[href^='tel:']").first()).toBeVisible();
  await expect(page.locator(`${R} [data-summary]`)).toContainText("Raj Sharma");
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
  await page.getByRole("button", { name: "Everyone, all events ✓" }).click();
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
  const body = new URLSearchParams(posts[posts.length - 1]);
  const P = JSON.parse(body.get("payload"));
  expect(P.code).toBe("FRIEND2345");
  expect(P.extras.song).toBe("Tum Hi Ho");
  expect(P.responses).toHaveLength(3);
  expect(await stored(page, "FRIEND2345")).toMatchObject({ code: "FRIEND2345" });
});

test("endpoint: a POST the backend did not save shows an unconfirmed message and keeps answers", async ({ page }) => {
  // The no-cors POST "succeeds" but the backend never stores it (e.g. validation error or lock timeout), so the read-back GET returns nothing.
  await page.route(`${EP}**`, (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: route.request().method() === "POST" ? "{}" : JSON.stringify({ ok: true, P: null }) }));
  await open(page, "/?content=tests/fixtures/content-rsvp-endpoint.json&guest=tests/fixtures/guest-friend.json&intro=0#rsvp");
  await page.getByRole("button", { name: "Everyone, all events ✓" }).click();
  await next(page);
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(page.locator(`${R} [data-send-err]`)).toContainText("couldn't confirm your RSVP was saved", { timeout: 15000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(await stored(page, "FRIEND2345")).toBeNull();
});

test("endpoint: remote response pre-fills the form", async ({ page }) => {
  const P = { code: "FRIEND2345", household: "Jordan Lee", submittedAt: "2027-02-02T10:00:00.000Z", members: [{ id: "m1", name: "Jordan Lee", meal: "Jain", dietary: "" }], responses: [{ memberId: "m1", eventId: "sangeet", attending: "yes" }, { memberId: "m1", eventId: "wedding", attending: "no" }, { memberId: "m1", eventId: "reception", attending: "no" }], extras: {} };
  await page.route(`${EP}**`, (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ ok: true, P }) }));
  await open(page, "/?content=tests/fixtures/content-rsvp-endpoint.json&guest=tests/fixtures/guest-friend.json&intro=0#rsvp");
  await expect(page.locator(`${R} [data-replied]`)).toContainText("You replied on February 2, 2027");
  await expect(page.locator(`${R} input[name="a__m1__sangeet"][value=yes]`)).toBeChecked();
  await expect(page.locator(`${R} input[name="a__m1__wedding"][value=no]`)).toBeChecked();
});

test("segmented controls and buttons are at least 44px tall", async ({ page }) => {
  await open(page, FAMILY);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("[data-page=rsvp] .rv-segopt > span, [data-page=rsvp] .btn")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim()));
  expect(small).toEqual([]);
});

// RSVP guest book: each event is an ivory page with one line per invited seat; the names written are who's coming (and the
// count). "Tap to add" pills offer the household's names; "None of us" declines. With namesRequired off, the older
// "how many of you?" count chips come back. The details step asks for a phone number and an optional note. Event lists come from content.json plus the fixture's private events.
import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, assertNoClippedText, assertNoOverlaps, runAxe } from "./helpers/layout.js";
import fs from "node:fs";

const FAMILY = "/?guest=tests/fixtures/guest-family.json&intro=0#rsvp"; // 3 named members, no seats field: 3 seats per event
const FRIEND = "/?guest=tests/fixtures/guest-friend.json&intro=0#rsvp"; // 1 member + 1 plus-one: 2 seats per event
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
const pick = (page, e, n) => page.locator(`${R} input[name="n__${e}"][value="${n}"]`).check(); // count chips (namesRequired off)
const decline = (page, e) => page.locator(`${R} [data-act=decline][data-k="${e}"]`).click();
const lines = (page, e) => page.locator(`${R} input[data-name-slot="${e}"]`);
const vals = (page, e) => lines(page, e).evaluateAll((els) => els.map((x) => x.value));
const addPill = (page, e, name) => page.locator(`${R} .rv-ev[data-ev="${e}"]`).getByRole("button", { name: `Add ${name}` });
const evIds = (page) => page.locator(`${R} .rv-ev`).evaluateAll((els) => els.map((e) => e.dataset.ev));
const stored = (page, code) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY(code));
const everyone = (page) => page.getByRole("button", { name: /Everyone, every event|Coming to all events/ });
/** Fill Person 1..n name slots for one event. */
async function fillEventNames(page, eid, names) {
  for (let i = 0; i < names.length; i++) await page.locator(`#x-name-${eid}-${i}`).fill(names[i]);
}
/** Write a name on every line of every event that isn't declined, cycling the given names. */
async function fillComingNames(page, names) {
  for (const e of await evIds(page)) {
    const n = await lines(page, e).count();
    if (!n || !(await lines(page, e).first().isVisible())) continue;
    await fillEventNames(page, e, Array.from({ length: n }, (_, i) => names[i % names.length]));
  }
}

async function checks(page, info, tag) {
  await assertNoHorizontalOverflow(page);
  await assertNoClippedText(page);
  await assertNoOverlaps(page, `${R} .rv-card, ${R} .rv-segopt, ${R} .rv-nav .btn, ${R} .rv-opt, ${R} .rv-field, ${R} .rv-quick .btn, ${R} .rv-shuttle, ${R} .rv-line, ${R} .rv-addname, ${R} .rv-decline`);
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
  await expect(page.locator(`${R} .rv-deadline`)).toHaveText("Kindly RSVP by Jan 31st 2027");
  await expect(page.locator(`${R} .rv-warn`)).toHaveCount(0);
  await expect(page.locator(`${R} [data-form]`)).toHaveCount(0);
});

test("family: headcount per event, names, phone, review, submit, confirmation", async ({ page }, info) => {
  test.setTimeout(150_000);
  await open(page, FAMILY);
  await expect(page.locator(`${R} .rv-warn`)).toContainText("Kindly reply");
  await expect(page.locator(`${R} .rv-warn`)).toContainText("Please let us know by Jan 31st 2027. If we don't hear from you by then");
  await expect(page.locator(`${R} .rv-deadline`)).toHaveCount(0); // the note carries the date once
  await expect(page.locator(`${R} [data-list="rsvp.intro"] p`)).toHaveCount(1);
  await expect(heading(page)).toHaveText("Who's coming?");
  await expect(page.locator(`${R} .rv-count`)).toHaveText("Step 1 of 3");
  await expect(page.locator(`${R} [data-step="1"] > .rv-help`)).toContainText("Write the names of those joining us");
  const evs = await evIds(page);
  expect(evs.length).toBeGreaterThan(1);
  // one ruled line per invited seat (3), no count chips, and the household's names offered as pills
  await expect(lines(page, evs[0])).toHaveCount(3);
  await expect(page.locator(`${R} input[name="n__${evs[0]}"]`)).toHaveCount(0);
  await expect(page.locator(`${R} .rv-ev[data-ev="${evs[0]}"] .rv-addname`)).toHaveText(["+ Raj", "+ Priya", "+ Anika"]);
  await expect(page.locator(`${R} [data-count-for="${evs[0]}"]`)).toHaveText("0 of 3 coming");
  await checks(page, info, "step1-empty");
  // Tap two names onto the first event: they fill lines 1 and 2, and leave the pills
  await addPill(page, evs[0], "Raj Sharma").click();
  await addPill(page, evs[0], "Priya Sharma").click();
  await expect.poll(() => vals(page, evs[0])).toEqual(["Raj Sharma", "Priya Sharma", ""]);
  await expect(page.locator(`${R} .rv-ev[data-ev="${evs[0]}"] .rv-addname`)).toHaveText(["+ Anika"]);
  await expect(page.locator(`${R} [data-count-for="${evs[0]}"]`)).toHaveText("2 of 3 coming");
  // "Everyone" writes the household's names on every empty line of every event
  await everyone(page).click();
  for (const e of evs) await expect(page.locator(`${R} [data-count-for="${e}"]`)).toHaveText("3 of 3 coming ✓");
  await page.locator(`#x-name-${evs[0]}-2`).fill("");
  await expect(page.locator(`${R} [data-count-for="${evs[0]}"]`)).toHaveText("2 of 3 coming");
  await checks(page, info, "step1-filled");
  await next(page);
  await expect(heading(page)).toBeFocused();
  await expect(heading(page)).toHaveText("A few details");
  await expect(page.locator(`${R} .rv-food`)).toHaveCount(0);
  await expect(page.locator(`${R} #hh-h`)).toHaveCount(0);
  await page.locator("#x-phone").fill("416 555 0100");
  await page.locator("#x-message").fill("So excited!");
  await checks(page, info, "step2");
  await next(page);
  await expect(heading(page)).toHaveText("Review and send");
  await expect(page.locator(`${R} [data-sum-event="${evs[0]}"]`)).toContainText("2 guests");
  await expect(page.locator(`${R} [data-sum-event="${evs[0]}"]`)).toContainText("Raj Sharma, Priya Sharma");
  await expect(page.locator(`${R} [data-sum-event="${evs[1]}"]`)).toContainText("3 guests");
  await expect(page.locator(`${R} .rv-dl`)).toContainText("Phone");
  await expect(page.locator(`${R} .rv-dl`)).not.toContainText("names");
  await checks(page, info, "step3");
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(heading(page)).toHaveText("Your reply");
  await expect(page.locator(`${R} .rv-warn`)).toBeHidden();
  const P = await stored(page, "FAMILY2345");
  expect(P).toMatchObject({ v: 2, code: "FAMILY2345", household: "Sharma Family", seats: 3, dietNote: "" });
  expect(P.submittedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(P.counts).toEqual(Object.fromEntries(evs.map((e, i) => [e, i === 0 ? 2 : 3])));
  expect(P.namesByEvent[evs[0]]).toEqual(["Raj Sharma", "Priya Sharma"]);
  expect(P.namesByEvent[evs[1]]).toEqual(["Raj Sharma", "Priya Sharma", "Anika Sharma"]);
  expect(P.names).toContain("Raj Sharma");
  expect(P.diet).toEqual({});
  expect(P.extras).toMatchObject({ phone: "416 555 0100", message: "So excited!" });
  expect(P.extras.song || "").toBe("");
  const done = page.locator(`${R} [data-done]`);
  await expect(done.locator(".rv-sum-ev")).toHaveCount(evs.length);
  await expect(done.locator(".rv-signed")).toBeVisible(); // the signed note from the couple
  await expect(page.locator(`${R} [data-greet]`)).toHaveText("Thank you, Sharma Family");
  await expect(page.locator(`${R} .rv-warn`)).toBeHidden();
  await checks(page, info, "done");
  // One button: Apple devices get the .ics straight away; elsewhere a sheet offers the file or Google, event by event.
  const dl = page.waitForEvent("download");
  await done.getByRole("button", { name: "Add to my calendar" }).click();
  const sheetFile = page.locator(".cal-sheet [data-ics]");
  if (await sheetFile.isVisible()) {
    await expect(page.locator(".cal-sheet .cal-links a")).toHaveCount(evs.length);
    await sheetFile.click();
  }
  expect((await dl).suggestedFilename()).toMatch(/\.ics$/);
  await page.getByRole("button", { name: "Change my response" }).click();
  await expect(heading(page)).toHaveText("Who's coming?");
  // Editing an existing reply: the header keeps thanking them and shows the replied line, not "Kindly reply".
  await expect(page.locator(`${R} .rv-warn`)).toBeHidden();
  await expect(page.locator(`${R} [data-replied]`)).toContainText("Replied");
  await expect.poll(() => vals(page, evs[0])).toEqual(["Raj Sharma", "Priya Sharma", ""]);
  await expect.poll(() => vals(page, evs[1])).toEqual(["Raj Sharma", "Priya Sharma", "Anika Sharma"]);
});

test("phone is required on the details step when anyone is coming, so reminders can be sent", async ({ page }) => {
  await open(page, FAMILY);
  await everyone(page).click();
  await next(page);
  await expect(heading(page)).toHaveText("A few details");
  await expect(page.locator(`${R} .rv-food`)).toHaveCount(0);
  await expect(page.locator(`${R} #hh-h`)).toHaveCount(0);
  await expect(page.locator("#ph-help")).toContainText("reminders");
  await expect(page.locator("#x-phone")).toHaveAttribute("aria-required", "true");
  await next(page);
  await expect(heading(page)).toHaveText("A few details");
  const err = page.locator("#er-phone");
  await expect(err).toBeVisible();
  await expect(err).toContainText("reminders");
  await expect(page.locator("#x-phone")).toBeFocused();
  await page.locator("#x-phone").fill("555");
  await expect(err).toContainText("area code");
  await next(page);
  await expect(heading(page)).toHaveText("A few details");
  await page.locator("#x-phone").fill("+1 (416) 555-0199");
  await expect(err).toBeHidden();
  await next(page);
  await expect(heading(page)).toHaveText("Review and send");
  await expect(page.locator(`${R} .rv-dl`)).toContainText("Phone");
  await expect(page.locator(`${R} .rv-dl`)).toContainText("+1 (416) 555-0199");
});

test("validation blocks Continue and focuses the first unanswered event", async ({ page }) => {
  await open(page, FAMILY);
  const evs = await evIds(page);
  await fillEventNames(page, evs[0], ["Raj Sharma"]);
  await next(page);
  await expect(heading(page)).toHaveText("Who's coming?");
  await expect(page.locator(`#x-name-${evs[1]}-0`)).toBeFocused();
  const err = page.locator(`#er-${evs[1]}`);
  await expect(err).toBeVisible();
  await expect(err).toContainText("Please write who's coming to");
  await expect(err).toContainText("or choose None of us");
  await expect(page.locator(`#x-name-${evs[1]}-0`)).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(`${R} [data-act=back]`)).toHaveCount(0);
  await decline(page, evs[1]);
  await expect(page.locator(`#er-${evs[1]}`)).toBeHidden();
  await expect(page.locator(`${R} [data-act=decline][data-k="${evs[1]}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${R} [data-count-for="${evs[1]}"]`)).toHaveText("We'll miss you");
});

test("more seats on a later event: names written once are offered everywhere there is room", async ({ page }) => {
  await page.route("**/tests/fixtures/guest-mixed.json", async (route) => {
    const g = JSON.parse(fs.readFileSync("tests/fixtures/guest-family.json", "utf8"));
    await route.fulfill({ json: { ...g, code: "MIXED23456", members: [{ id: "m1", name: "Raj Sharma" }], eventSeats: { mehndi: 2, vidhi: 4, sangeet: 1 } } });
  });
  await open(page, "/?guest=tests/fixtures/guest-mixed.json&intro=0#rsvp");
  await expect(lines(page, "mehndi")).toHaveCount(2);
  await expect(lines(page, "vidhi")).toHaveCount(4);
  await expect(lines(page, "sangeet")).toHaveCount(1);
  // A name typed on the 4-seat event becomes a pill on the 2-seat one
  await page.locator("#x-name-vidhi-0").fill("Nani Kapoor");
  await page.locator("#x-name-vidhi-0").blur();
  await addPill(page, "mehndi", "Nani Kapoor").click();
  await addPill(page, "mehndi", "Raj Sharma").click();
  await expect.poll(() => vals(page, "mehndi")).toEqual(["Nani Kapoor", "Raj Sharma"]);
  await expect(page.locator(`${R} .rv-ev[data-ev="mehndi"] .rv-addname`)).toHaveCount(0); // full: no pills
  await expect(page.locator(`${R} [data-count-for="mehndi"]`)).toHaveText("2 of 2 coming ✓");
  await addPill(page, "vidhi", "Raj Sharma").click();
  await expect.poll(() => vals(page, "vidhi")).toEqual(["Nani Kapoor", "Raj Sharma", "", ""]);
  await expect(page.locator(`${R} [data-act=decline][data-k="sangeet"]`)).toHaveText("Regretfully declines");
});
test("friend with 2 seats: counts up to 2, names required and sent", async ({ page }, info) => {
  await open(page, FRIEND);
  const evs = await evIds(page);
  await expect(lines(page, evs[0])).toHaveCount(2);
  await next(page);
  await expect(heading(page)).toHaveText("Who's coming?");
  const err = page.locator(`#er-${evs[0]}`);
  await expect(err).toBeVisible();
  await expect(page.locator(`#x-name-${evs[0]}-0`)).toBeFocused();
  // "Everyone" writes the one known name; the plus-one's line stays for them to write
  await everyone(page).click();
  await expect.poll(() => vals(page, evs[0])).toEqual(["Jordan Lee", ""]);
  await expect(page.locator(`${R} [data-count-for="${evs[0]}"]`)).toHaveText("1 of 2 coming");
  await checks(page, info, "friend-step1");
  await fillComingNames(page, ["Jordan Lee", "Sam Lee"]);
  await expect(err).toBeHidden();
  await next(page);
  await expect(heading(page)).toHaveText("A few details");
  await page.locator("#x-phone").fill("416 555 0100");
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(heading(page)).toHaveText("Your reply");
  const P = await stored(page, "FRIEND2345");
  expect(P.seats).toBe(2);
  expect(Object.values(P.counts)).toEqual(evs.map(() => 2));
  expect(P.namesByEvent[evs[0]]).toEqual(["Jordan Lee", "Sam Lee"]);
  expect(P.names).toContain("Jordan Lee");
});

test("names stay optional when namesRequired is off", async ({ page }) => {
  await page.route("**/content/content.json", async (route) => {
    const j = JSON.parse(fs.readFileSync("content/content.json", "utf8"));
    j.rsvp.namesRequired = false;
    await route.fulfill({ json: j });
  });
  await open(page, FRIEND);
  const evs = await evIds(page);
  await everyone(page).click();
  await expect(page.locator(`${R} .rv-names-label`).first()).toContainText("(optional)");
  await expect(page.locator(`#x-name-${evs[0]}-0`)).not.toHaveAttribute("aria-required", "true");
  await next(page);
  await expect(heading(page)).toHaveText("A few details");
  await page.locator("#x-phone").fill("416 555 0100");
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(heading(page)).toHaveText("Your reply");
  expect((await stored(page, "FRIEND2345")).names).toBe("");
});

test("one seat: one line, the guest's own name to tap, and Regretfully declines", async ({ page }) => {
  await open(page, SOLO);
  const evs = await evIds(page);
  await expect(lines(page, evs[0])).toHaveCount(1);
  await expect.poll(() => vals(page, evs[0])).toEqual([""]);
  await expect(page.locator(`${R} [data-step="1"] > .rv-help`)).toContainText("Write your name at each event you can join");
  await expect(page.locator(`${R} [data-act=decline][data-k="${evs[0]}"]`)).toHaveText("Regretfully declines");
  await addPill(page, evs[0], "Jordan Lee").click();
  await expect.poll(() => vals(page, evs[0])).toEqual(["Jordan Lee"]);
  await expect(page.locator(`${R} [data-count-for="${evs[0]}"]`)).toHaveText("Coming ✓");
  await everyone(page).click();
  await next(page);
  await expect(heading(page)).toHaveText("A few details");
  await expect(page.locator("#ph-help")).toContainText("reminders");
  await expect(page.locator(`${R} .rv-food`)).toHaveCount(0);
  await page.locator("#x-phone").fill("416 555 0100");
  await next(page);
  await expect(page.locator(`${R} [data-summary]`).first()).toContainText("Coming");
});
test("declining everything skips details", async ({ page }, info) => {
  await open(page, FRIEND);
  for (const e of await evIds(page)) await decline(page, e);
  await expect(page.locator(`${R} [data-names-for]`).first()).toBeHidden();
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
  await decline(page, evs[1]);
  await fillEventNames(page, evs[0], ["Raj Sharma", "Priya Sharma"]);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect.poll(() => vals(page, evs[0])).toEqual(["Raj Sharma", "Priya Sharma", ""]);
  await expect(page.locator(`${R} [data-count-for="${evs[0]}"]`)).toHaveText("2 of 3 coming");
  await expect(page.locator(`${R} [data-act=decline][data-k="${evs[1]}"]`)).toHaveAttribute("aria-pressed", "true");
});

test("a saved food or hotel answer stays off the details step and the review", async ({ page }) => {
  const events = ["mehndi", "vidhi", "sangeet", "wedding", "reception"];
  const namesByEvent = Object.fromEntries(events.map((id) => [id, ["Raj Sharma"]]));
  const draft = {
    phase: "form", step: 2, counts: Object.fromEntries(events.map((id) => [id, 1])), namesByEvent,
    diet: { Vegetarian: 1 }, dietNote: "no onion",
    x: { hotel: "local", arrival: "2027-07-22", departure: "2027-07-26", flight: "AC 123", flightTime: "14:05", address: "1 Main St", phone: "416 555 0100", song: "September", message: "See you there", shuttle: { wedding: 1 } },
  };
  await page.addInitScript(([k, saved]) => { try { sessionStorage.setItem(k, JSON.stringify(saved)); } catch {} }, ["pa.rsvp.draft.v2.FAMILY2345", draft]);
  await open(page, FAMILY);
  await expect(heading(page)).toHaveText("A few details");
  const step2 = page.locator(`${R} [data-step="2"]`);
  await expect(step2.locator(".rv-food, #hh-h")).toHaveCount(0);
  await expect(step2).not.toContainText(/Food|For your household|The family|No, we're local/);
  await next(page);
  await expect(heading(page)).toHaveText("Review and send");
  const review = page.locator(`${R} .rv-dl`);
  await expect(review).toContainText("Phone");
  await expect(review).toContainText("416 555 0100");
  await expect(review).toContainText("See you there");
  await expect(review).not.toContainText(/Food|Hotel|No, we're local|Vegetarian|no onion|AC 123|September|1 Main St/);
});

test("revisit pre-fills from the stored response", async ({ page }) => {
  await open(page, FAMILY);
  const evs = await evIds(page);
  await everyone(page).click();
  await next(page);
  await page.locator("#x-phone").fill("647 555 0000");
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(page.locator(`${R} [data-done]`)).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem("pa.rsvp.draft.v2.FAMILY2345"));
  await page.goto(FAMILY);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(`${R} [data-replied]`)).toContainText("Replied");
  await expect(page.locator(`${R} [data-replied]`)).toContainText("You can update it until Jan 31st 2027");
  await expect(page.locator(`${R} [data-greet]`)).toHaveText("Thank you, Sharma Family");
  for (const e of evs) await expect.poll(() => vals(page, e)).toEqual(["Raj Sharma", "Priya Sharma", "Anika Sharma"]);
  await next(page);
  await expect(page.locator("#x-phone")).toHaveValue("647 555 0000");
});

test("an older per-person reply (v1) is read back as counts, names and food", async ({ page }) => {
  const v1 = { code: "FAMILY2345", household: "Sharma Family", submittedAt: "2027-03-01T15:00:00.000Z",
    members: [{ id: "m1", name: "Raj Sharma", meal: "Vegetarian", dietary: "Nut allergy" }, { id: "m2", name: "Priya Sharma", meal: "", dietary: "No mustard" }, { id: "m3", name: "Anika Sharma", meal: "", dietary: "" }],
    responses: [{ memberId: "m1", eventId: "mehndi", attending: "yes" }, { memberId: "m2", eventId: "mehndi", attending: "yes" }, { memberId: "m3", eventId: "mehndi", attending: "no" }], extras: {} };
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, [KEY("FAMILY2345"), v1]);
  await open(page, FAMILY);
  await expect.poll(() => vals(page, "mehndi")).toEqual(["Raj Sharma", "Priya Sharma", ""]);
  await expect(page.locator(`${R} [data-count-for="mehndi"]`)).toHaveText("2 of 3 coming");
});

test("deadline passed shows message, contacts and what was sent", async ({ page }) => {
  await page.addInitScript((k) => { try { localStorage.setItem(k, JSON.stringify({ v: 2, code: "FAMILY2345", household: "Sharma Family", seats: 3, submittedAt: "2027-03-01T15:00:00.000Z", counts: { mehndi: 2 }, names: "Raj Sharma", diet: {}, dietNote: "", extras: {} })); } catch {} }, KEY("FAMILY2345"));
  await page.clock.setFixedTime(new Date("2027-07-01T12:00:00-04:00"));
  await open(page, FAMILY);
  const p = page.locator(`${R} [data-passed]`);
  await expect(p).toContainText("The RSVP deadline has passed");
  await expect(page.locator(`${R} .rv-warn`)).toHaveCount(0);
  await expect(p).toContainText("please message us");
  await expect(p.locator("a[href^='tel:']").first()).toBeVisible();
  await expect(page.locator(`${R} [data-sum-event="mehndi"]`)).toContainText("2 guests");
  await expect(page.locator(`${R} [data-sum-event="mehndi"]`)).toContainText("Raj Sharma");
  await expect(page.locator(`${R} .rv-dl`)).toHaveCount(0);
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
  await everyone(page).click();
  await fillComingNames(page, ["Jordan Lee", "Sam Lee"]);
  await next(page);
  await page.locator("#x-phone").fill("416 555 0100");
  await next(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(page.locator(`${R} [data-send-err]`)).toBeVisible();
  await expect(page.locator(`${R} [data-send-err]`)).toContainText("Nothing you typed is lost");
  expect(await stored(page, "FRIEND2345")).toBeNull();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading(page)).toHaveText("Your reply");
  const P = JSON.parse(new URLSearchParams(posts[posts.length - 1]).get("payload"));
  expect(P.code).toBe("FRIEND2345");
  expect(P.extras.phone).toBe("416 555 0100");
  expect(Object.keys(P.counts)).toEqual(evs);
  expect(P.namesByEvent[evs[0]]).toEqual(["Jordan Lee", "Sam Lee"]);
  expect(await stored(page, "FRIEND2345")).toMatchObject({ code: "FRIEND2345" });
});

test("endpoint: a POST the backend did not save shows an unconfirmed message and keeps answers", async ({ page }) => {
  // The no-cors POST "succeeds" but the backend never stores it (e.g. validation error or lock timeout), so the read-back GET returns nothing.
  await page.route(`${EP}**`, (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: route.request().method() === "POST" ? "{}" : JSON.stringify({ ok: true, P: null }) }));
  await open(page, "/?content=tests/fixtures/content-rsvp-endpoint.json&guest=tests/fixtures/guest-friend.json&intro=0#rsvp");
  await everyone(page).click();
  await fillComingNames(page, ["Jordan Lee", "Sam Lee"]);
  await next(page);
  await page.locator("#x-phone").fill("416 555 0100");
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
  await expect(page.locator(`${R} [data-replied]`)).toContainText("Feb 2, 2027");
  await expect.poll(() => vals(page, "sangeet")).toEqual(["Jordan", "Sam"]);
  await expect.poll(() => vals(page, "wedding")).toEqual(["Jordan", ""]);
  await expect(page.locator(`${R} [data-act=decline][data-k="reception"]`)).toHaveAttribute("aria-pressed", "true");
});

test("name pills, lines and buttons are at least 44px tall", async ({ page }) => {
  await open(page, FAMILY);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("[data-page=rsvp] .rv-segopt > span, [data-page=rsvp] .btn, [data-page=rsvp] .rv-addname, [data-page=rsvp] .rv-decline, [data-page=rsvp] .rv-line input")].filter((e) => e.offsetParent && e.offsetHeight < 44).map((e) => e.textContent.trim())); // layout size: the page-enter scale must not count
  expect(small).toEqual([]);
});

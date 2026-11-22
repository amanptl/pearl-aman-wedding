import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { workbookBuffer } from "./helpers/xlsx.js";

// Guest manager + private-event editing. Uses the dev sample guest list (passphrase "dev-passphrase").
const PASS = "dev-passphrase";
const FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET|NAME|CONNECTION|BLOCKED)|Failed to load resource/i;
const SHOTS = process.env.SHOTS || process.env.EDITOR_SHOTS;
const CODES = { sharma: "NVMDUYC3MF", mehta: "CNZQ84QGEE", chen: "J2GHYEUAXG", garcia: "6QZ6KD8KTT", walker: "GMARP356WB", patel: "B6NA7XEEU3" };

// The editor is a desktop tool (phones get a "works best on a computer" note), so these specs always run in a desktop-sized, non-touch
// context. The browser engine still follows the project (webkit/chromium).
test.use({ isMobile: false, hasTouch: false, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !FONT_NOISE.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem("pa.editor.coach.v1", "1"); sessionStorage.setItem("pa.intro", "1"); } catch {} });
});

async function openEditor(page) {
  await page.goto("/edit/");
  await page.waitForFunction(() => window.__editor && document.querySelector("#frame")?.contentDocument?.documentElement?.dataset?.ready === "1" && !document.querySelector("#boot"));
}
async function unlock(page, pass = PASS) {
  await page.click("#unlock-btn");
  await page.fill("#unlock-pass", pass);
  await page.locator("dialog.dlg").getByRole("button", { name: "Unlock", exact: true }).click();
}
async function openGuests(page) {
  await openEditor(page);
  await unlock(page);
  await expect(page.locator("#lock-banner")).toBeHidden();
  await page.click('[data-tab="guests"]');
  await expect(page.locator(".gm-table tbody tr")).toHaveCount(6);
}
const draft = (page) => page.evaluate(() => structuredClone(window.__editor.draft));
const fr = (page) => page.frameLocator("#frame");
const row = (page, code) => page.locator(`tr[data-code="${code}"]`);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync("tests/screens", { recursive: true }); await page.screenshot({ path: `tests/screens/p2-${name}.png` }); } };

async function mockGitHub(page) {
  const calls = [];
  const content = fs.readFileSync("content/content.json", "utf8");
  const admin = fs.readFileSync("content/admin.enc.json", "utf8");
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace("/repos/o/r", "");
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path: p, body });
    const json = (o, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
    if (req.method() === "GET" && p.startsWith("/contents/content/content.json")) return json({ content: Buffer.from(content).toString("base64"), sha: "c1" });
    if (req.method() === "GET" && p.startsWith("/contents/content/admin.enc.json")) return json({ content: Buffer.from(admin).toString("base64"), sha: "a1" });
    if (req.method() === "GET" && p === "/git/ref/heads/main") return json({ object: { sha: "headsha" } });
    if (req.method() === "GET" && p === "/git/commits/headsha") return json({ tree: { sha: "basetree" } });
    if (req.method() === "POST" && p === "/git/blobs") return json({ sha: "blob" + calls.length });
    if (req.method() === "POST" && p === "/git/trees") return json({ sha: "newtree" });
    if (req.method() === "POST" && p === "/git/commits") return json({ sha: "newcommit" });
    if (req.method() === "PATCH" && p === "/git/refs/heads/main") return json({ ok: true });
    return json({ message: "unexpected " + p }, 404);
  });
  await page.route("https://o.github.io/**", (route) => route.fulfill({ status: 404, body: "" }));
  return calls;
}
const connect = (page) => page.evaluate(() => localStorage.setItem("pa.editor.gh", JSON.stringify({ owner: "o", repo: "r", branch: "main", token: "tok_secret" })));

test.describe("unlock", () => {
  test("banner, wrong passphrase, then private events and households appear in the draft", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    await expect(page.locator("#lock-banner")).toContainText("Unlock guest list to edit private events and guests");
    let d = await draft(page);
    expect(d.events.map((e) => e.id)).toEqual([]); // events are private, so the public file has none
    expect(d._admin).toBeUndefined();

    await page.click("#unlock-btn");
    await page.fill("#unlock-pass", "not the passphrase");
    await page.locator("dialog.dlg").getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.locator("dialog .dlg-note")).toContainText("Wrong passphrase");
    await page.fill("#unlock-pass", PASS);
    await page.keyboard.press("Enter");
    await expect(page.locator("#lock-banner")).toBeHidden();
    d = await draft(page);
    expect(d.events.map((e) => e.id).sort()).toEqual(["mehendi", "vidhi", "wedding"]);
    expect(d.events.filter((e) => e.visibility === "private").map((e) => e.id).sort()).toEqual(["mehendi", "vidhi", "wedding"]);
    expect(d._admin.households).toHaveLength(6);
    // nothing is dirty just because we unlocked
    await expect(page.locator("#status")).toContainText("No unpublished changes");
    // the passphrase lives in sessionStorage only
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => /pass/i.test(k)))).toBe(false);
    // a reload in the same tab unlocks silently
    await page.reload();
    await page.waitForFunction(() => window.__editor && !document.querySelector("#boot"));
    await expect.poll(() => page.evaluate(() => window.__editor.unlocked)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("editing private events: the schedule preview shows all three, and the autosaved draft keeps private data out of localStorage", async ({ page }) => {
    await openEditor(page);
    await unlock(page);
    await expect(page.locator("#lock-banner")).toBeHidden();
    await page.selectOption("#page-select", "schedule");
    await expect(fr(page).locator("[data-event]")).toHaveCount(3);
    await page.evaluate(() => { window.__editor.commit("_admin.households.0.household", "Sharma Family (edited)", "t"); window.__editor.commit("events.0.name", "Mehendi Afternoon", "t"); });
    await page.waitForTimeout(700); // autosave debounce
    const local = await page.evaluate(() => localStorage.getItem("pa.editor.draft.v1"));
    expect(local).toBeTruthy();
    expect(local).not.toContain("_admin");
    expect(local).not.toContain("Sharma Family");
    expect(local).not.toContain("Mehendi Afternoon");
    expect(local).not.toContain('"id":"mehendi"');
    const session = await page.evaluate(() => sessionStorage.getItem("pa.editor.draft.private.v1"));
    expect(session).toContain("Sharma Family (edited)");
  });
});

test.describe("guest manager", () => {
  test("add a household: the name field is focused, codes stay stable, the preview menu lists it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGuests(page);
    const before = (await draft(page))._admin.households.map((x) => x.code);
    expect(before).toEqual(Object.values(CODES));
    await page.getByRole("button", { name: "Add household" }).click();
    const name = page.locator('.gm-table tbody tr:last-child input[aria-label="Household name"]');
    await expect(name).toBeFocused();
    await expect(page.locator(".gm-table tbody tr")).toHaveCount(7);
    // an empty household is a problem until it has a name and a guest
    await expect(page.locator("#badge")).toContainText(/problem/);
    await name.fill("Ibrahim Family");
    await name.press("Tab");
    const last = page.locator(".gm-table tbody tr:last-child");
    await last.locator(".chip-add").first().fill("Omar Ibrahim");
    await last.locator(".chip-add").first().press("Enter");
    const weddingSeats = page.locator(".gm-table tbody tr:last-child").getByLabel("Ibrahim Family: guests invited to Wedding Ceremony");
    await weddingSeats.fill("1");
    await weddingSeats.blur();
    const d = await draft(page);
    const added = d._admin.households.at(-1);
    expect(added.household).toBe("Ibrahim Family");
    expect(added.greeting).toBe("Dear Ibrahim Family");
    expect(added.members.map((m) => m.name)).toEqual(["Omar Ibrahim"]);
    expect(added.eventIds).toEqual(["wedding"]);
    expect(added.eventSeats).toEqual({ wedding: 1 });
    expect(added.code).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
    expect(d._admin.households.slice(0, 6).map((x) => x.code)).toEqual(before);
    await expect(page.locator("#badge")).not.toContainText(/problem/);
    await expect(page.locator('#preview-as option', { hasText: "Ibrahim Family" })).toHaveCount(1);
    // undo walks back through guest edits too
    await page.keyboard.press("Control+Z");
    expect(errors).toEqual([]);
  });

  test("group preset applies to ticked households in bulk", async ({ page }) => {
    await openGuests(page);
    await expect(page.getByRole("button", { name: /Close family/ })).toBeDisabled();
    await row(page, CODES.walker).getByLabel(/^Select/).check();
    await row(page, CODES.patel).getByLabel(/^Select/).check();
    await page.getByRole("button", { name: /Close family/ }).click();
    const d = await draft(page);
    for (const code of [CODES.walker, CODES.patel]) {
      const hh = d._admin.households.find((x) => x.code === code);
      expect([...hh.eventIds].sort()).toEqual(["mehendi", "vidhi", "wedding"]);
      expect(hh.tags).toContain("close-family");
    }
    // untouched households keep what they had
    expect(d._admin.households.find((x) => x.code === CODES.chen).eventIds).toEqual(["vidhi", "wedding"]);
    await page.getByRole("button", { name: "Edit groups…" }).click();
    await expect(page.locator("dialog").getByLabel("Group name").nth(1)).toHaveValue("Friends");
    await page.keyboard.press("Escape");
  });

  test("search and filters", async ({ page }) => {
    await openGuests(page);
    await page.getByLabel("Search households").fill("okafor");
    await expect(page.locator(".gm-table tbody tr")).toHaveCount(1);
    await page.getByLabel("Search households").fill("");
    await page.getByLabel("Filter by event").selectOption("mehendi");
    await expect(page.locator(".gm-table tbody tr")).toHaveCount(2);
    await page.getByLabel("Filter by group").selectOption("friends");
    await expect(page.locator(".gm-table tbody tr")).toHaveCount(0);
  });

  test("copy link and WhatsApp message", async ({ page, context, browserName }) => {
    if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openGuests(page);
    await page.getByRole("button", { name: "Copy link for Sharma Family" }).click();
    await expect.poll(() => page.evaluate(() => window.__editor.lastCopied)).toMatch(new RegExp(`/\\?i=${CODES.sharma}$`));
    await expect(page.locator(".toast").last()).toContainText("Link for Sharma Family copied");
    await page.getByRole("button", { name: "Copy WhatsApp message for Sharma Family" }).click();
    const msg = await page.evaluate(() => window.__editor.lastCopied);
    expect(msg).toMatch(/^Dear Sharma Family,/);
    expect(msg).toContain(`?i=${CODES.sharma}`);
    expect(msg).not.toContain("Dear Dear");
    // the template is editable and kept with the guest list
    await page.getByRole("button", { name: "Message text" }).click();
    await page.getByLabel("Invitation message").fill("Hi {greeting}! {link}");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Copy WhatsApp message for Maria Garcia" }).click();
    expect(await page.evaluate(() => window.__editor.lastCopied)).toMatch(new RegExp(`^Hi Maria Garcia! .*\\?i=${CODES.garcia}$`));
    expect((await draft(page))._admin.waTemplate).toBe("Hi {greeting}! {link}");
  });

  test("QR code opens in a sheet with a PNG download", async ({ page }) => {
    await openGuests(page);
    await page.getByRole("button", { name: "QR code for Mehta Family" }).click();
    const dlg = page.locator("dialog.dlg");
    await expect(dlg).toContainText("Mehta Family");
    await expect(dlg.locator(".gm-qr img, .gm-qr canvas").first()).toBeAttached();
    await expect(dlg.getByRole("button", { name: "Download PNG" })).toBeVisible();
    await expect(dlg.locator(".gm-qrlink")).toContainText(`?i=${CODES.mehta}`);
  });

  test("preview as a household shows its events; public visitor shows public events only", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGuests(page);
    await page.selectOption("#page-select", "schedule");
    await expect(fr(page).locator("[data-event]")).toHaveCount(3); // everyone
    await page.getByRole("button", { name: "Preview as for Mehta Family" }).click();
    await expect(page.locator("#preview-as")).toHaveValue(`g:${CODES.mehta}`);
    await expect(fr(page).locator("[data-event]")).toHaveCount(3);
    await page.getByRole("button", { name: "Preview as for Jordan & Sam Walker" }).click();
    await expect(fr(page).locator("[data-event]")).toHaveCount(1);
    await page.selectOption("#page-select", "home");
    await expect(fr(page).locator("[data-greeting]")).toContainText("Dear Jordan & Sam Walker");
    // a household's invitations change what its preview shows
    await page.locator('[data-tab="guests"]').click();
    const mehendiSeats = row(page, CODES.walker).getByLabel("Jordan & Sam Walker: guests invited to Mehendi");
    await mehendiSeats.fill("2");
    await mehendiSeats.blur();
    await page.selectOption("#page-select", "schedule");
    await expect(fr(page).locator("[data-event]")).toHaveCount(2);
    await page.selectOption("#preview-as", "public");
    await expect(fr(page).locator("[data-event]")).toHaveCount(0);
    await page.selectOption("#page-select", "home");
    await expect(fr(page).locator("[data-greeting]")).toHaveCount(0);
    await page.selectOption("#preview-as", "all");
    await page.selectOption("#page-select", "schedule");
    await expect(fr(page).locator("[data-event]")).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test("CSV import: preview shows parsed rows and problems before anything is added", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGuests(page);
    await page.getByRole("button", { name: "Import CSV / Excel" }).click();
    const csv = [
      "household,members,tags,events,plusOnes",
      "Kapoor Family,Anil Kapoor; Rita Kapoor,family,wedding;vidhi,1",
      "Lee & Park,Jin Lee; Su Park,friends,Friends,0",
      "Bad Row,,friends,nonsense,0",
      "Sharma Family,Raj Sharma; Priya Sharma; Anika Sharma; Dev Sharma,close-family,all,0",
    ].join("\n");
    await page.getByLabel("Paste CSV text").fill(csv);
    const prev = page.locator(".gm-prev");
    await expect(prev).toContainText("2 households to add, 1 to update");
    await expect(prev).toContainText("1 row with problems");
    await expect(prev.locator('tr[data-action="error"]')).toContainText('Unknown event "nonsense"');
    await shot(page, "csv-preview");
    // nothing is written until we confirm
    expect((await draft(page))._admin.households).toHaveLength(6);
    await page.getByRole("button", { name: "Import 3 households" }).click();
    const d = await draft(page);
    expect(d._admin.households).toHaveLength(8);
    const lee = d._admin.households.find((x) => x.household === "Lee & Park");
    expect(lee.eventIds).toEqual(["vidhi", "wedding"]); // preset name resolved
    expect(lee.tags).toContain("friends");
    const sharma = d._admin.households.find((x) => x.household === "Sharma Family");
    expect(sharma.code).toBe(CODES.sharma); // existing code never changes
    expect(sharma.members.map((m) => m.name)).toContain("Dev Sharma");
    expect(sharma.members[0].id).toBe("m1");
    // export includes personal links
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    const text = fs.readFileSync(await dl.path(), "utf8");
    expect(text).toContain("household,guests,members,tags,events,code,link");
    const kapoor = d._admin.households.find((x) => x.household === "Kapoor Family");
    expect(kapoor.seats).toBe(3); // an older file: 2 names + 1 plus-one
    expect(text).toContain(`?i=${CODES.sharma}`);
  });

  test("Excel template downloads .xlsx; importing a workbook adds households with event seats", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGuests(page);
    const [tpl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Excel template" }).click(),
    ]);
    expect(tpl.suggestedFilename()).toBe("households-template.xlsx");
    const tplBytes = fs.readFileSync(await tpl.path());
    expect(tplBytes.slice(0, 2).toString()).toBe("PK");

    const xlsx = workbookBuffer({
      Households: [
        ["household", "members", "tags", "mehendi", "vidhi", "wedding"],
        ["Nguyen Family", "Lan Nguyen; Minh Nguyen", "close-family", "3", "2", "4"],
        ["Only Wedding", "", "friends", "0", "0", "2"],
      ],
      "How to fill": [["Delete the example rows before you import."]],
    });
    await page.getByRole("button", { name: "Import CSV / Excel" }).click();
    await page.getByLabel("Choose a CSV or Excel file").setInputFiles({
      name: "invite.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx,
    });
    const prev = page.locator(".gm-prev");
    await expect(prev).toContainText("2 households to add");
    await expect(prev).toContainText("Nguyen Family");
    expect((await draft(page))._admin.households).toHaveLength(6);
    await page.getByRole("button", { name: "Import 2 households" }).click();
    const d = await draft(page);
    expect(d._admin.households).toHaveLength(8);
    const nguyen = d._admin.households.find((x) => x.household === "Nguyen Family");
    expect(nguyen.eventSeats).toEqual({ mehendi: 3, "vidhi": 2, wedding: 4 });
    expect(nguyen.eventIds.sort()).toEqual(["mehendi", "vidhi", "wedding"]);
    expect(nguyen.members.map((m) => m.name)).toEqual(["Lan Nguyen", "Minh Nguyen"]);
    const only = d._admin.households.find((x) => x.household === "Only Wedding");
    expect(only.eventSeats).toEqual({ wedding: 2 });
    expect(only.eventIds).toEqual(["wedding"]);
  });

  test("delete asks first", async ({ page }) => {
    await openGuests(page);
    await page.getByRole("button", { name: "Delete for Maria Garcia" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".gm-table tbody tr")).toHaveCount(6);
    await page.getByRole("button", { name: "Delete for Maria Garcia" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator(".gm-table tbody tr")).toHaveCount(5);
  });
});

test.describe("publishing", () => {
  test("unlocked publish: content.json, guests.json and admin.enc.json in one commit, no plaintext names", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const calls = await mockGitHub(page);
    await openGuests(page);
    await connect(page);
    // make a guest-list change and turn a public event private -> both directions are handled below
    await page.getByRole("button", { name: "Add household" }).click();
    const name = page.locator('.gm-table tbody tr:last-child input[aria-label="Household name"]');
    await name.fill("Zhang Family");
    await name.press("Tab");
    await page.locator(".gm-table tbody tr:last-child .chip-add").first().fill("Wei Zhang");
    await page.locator(".gm-table tbody tr:last-child .chip-add").first().press("Enter");
    const zhangMehendi = page.locator(".gm-table tbody tr:last-child").getByLabel("Zhang Family: guests invited to Mehendi");
    await zhangMehendi.fill("2");
    await zhangMehendi.blur();
    await page.evaluate(() => {
      const i = window.__editor.draft.events.findIndex((e) => e.id === "mehendi");
      window.__editor.commit(`events.${i}.visibility`, "public", "Make Mehendi public");
    });
    await page.click("#publish");
    await expect(page.locator("dialog.dlg")).toContainText("updated the guest list");
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.locator("dialog.dlg")).toContainText("Published", { timeout: 60000 });

    const trees = calls.filter((c) => c.path === "/git/trees");
    expect(trees).toHaveLength(1);
    expect(calls.filter((c) => c.path === "/git/commits")).toHaveLength(1);
    const paths = trees[0].body.tree.map((t) => t.path);
    expect(paths).toEqual(["content/content.json", "content/guests.json", "content/admin.enc.json"]);
    const blobs = calls.filter((c) => c.path === "/git/blobs").map((c) => c.body.content);
    const [contentText, guestsText, adminText] = blobs;

    const content = JSON.parse(contentText);
    expect(content.events.map((e) => e.id)).toEqual(["mehendi"]); // the one event made public
    for (const id of ["vidhi", "wedding"]) expect(content.events.map((e) => e.id)).not.toContain(id);
    expect(contentText).not.toContain("Zhang");
    expect(contentText).not.toContain("_admin");

    // guests.json: opaque. No names, no household names, no event details
    for (const secret of ["Sharma", "Priya", "Okafor", "Zhang", "Mehndi", "Maple Grove", "Reception", "close-family"]) expect(guestsText).not.toContain(secret);
    expect(adminText).not.toContain("Sharma");
    const guests = JSON.parse(guestsText);
    expect(Object.keys(guests)).toEqual(["v", "kdf", "records", "names"]);
    expect(Object.keys(guests.records)).toHaveLength(7);

    // the admin file opens with the passphrase and has the new household + all private events
    const bundle = await page.evaluate(async ([text, pass]) => {
      const m = await import("/src/lib/guestfiles.js");
      const b = await m.openAdmin(JSON.parse(text), pass);
      return { hh: b.households.map((h) => h.household), codes: b.households.map((h) => h.code), priv: b.privateEvents.map((e) => e.id), key: b.rsvpAdminKey };
    }, [adminText, PASS]);
    expect(bundle.hh).toContain("Zhang Family");
    expect(bundle.codes.slice(0, 6)).toEqual(Object.values(CODES));
    expect(bundle.priv.sort()).toEqual(["vidhi", "wedding"]);

    // a guest record decrypts with its code, and now includes the (formerly public) private reception
    const g = await page.evaluate(async ([text, code]) => {
      const c = await import("/src/lib/crypto.js");
      const gj = JSON.parse(text);
      const rec = gj.records[await c.sha256Hex(code)];
      return c.decryptJSON(await c.deriveKey(code, gj.kdf.salt, gj.kdf.iter), rec);
    }, [guestsText, CODES.sharma]);
    expect(g.privateEvents.map((e) => e.id).sort()).toEqual(["vidhi", "wedding"]);

    expect(calls.find((c) => c.path === "/git/commits").body.message).toMatch(/guest list/);
    await expect(page.locator("#status")).toContainText(/Published|going live|No unpublished/);
    expect(await page.evaluate(() => document.documentElement.innerHTML.includes("tok_secret"))).toBe(false);
    expect(errors).toEqual([]);
  });

  test("locked publish with a private event is refused", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => window.__editor.mutate((d) => {
      d.events.push({ id: "trial", name: "Trial", start: "2027-07-26T12:00", visibility: "private", rsvp: false, shuttle: false });
    }, "Add a private event"));
    await page.click("#publish");
    await expect(page.locator("dialog.dlg")).toContainText("Unlock to publish private events");
    await expect(page.getByRole("button", { name: "Publish now" })).toHaveCount(0);
  });

  test("changing visibility works both ways", async ({ page }) => {
    await openGuests(page);
    await page.evaluate(() => {
      const e = window.__editor;
      const i = e.draft.events.findIndex((x) => x.id === "mehendi");
      e.commit(`events.${i}.visibility`, "public", "Mehendi public");
    });
    let d = await draft(page);
    expect(d.events.find((x) => x.id === "mehendi").visibility).toBe("public");
    expect(await page.evaluate(() => window.__editor.privateEvents().map((e) => e.id).sort())).toEqual(["vidhi", "wedding"]);
    await page.evaluate(() => {
      const e = window.__editor;
      const i = e.draft.events.findIndex((x) => x.id === "mehendi");
      e.commit(`events.${i}.visibility`, "private", "Mehendi private");
    });
    expect(await page.evaluate(() => window.__editor.privateEvents().map((e) => e.id).sort())).toEqual(["mehendi", "vidhi", "wedding"]);
  });
});

test.describe("RSVP dashboard", () => {
  const SUMMARY = {
    ok: true,
    households: [
      { code: CODES.sharma, household: "Sharma Family", invited: "3", names: "Raj, Priya", dietary: "Vegetarian: 2; Nut allergy: 1", dietNote: "No mustard", hotel: "need", arrival: "2027-07-22", departure: "2027-07-26", flight: "AC 123", flightTime: "14:05", shuttle: "{}", phone: "", song: "", message: "", submittedAt: "2027-01-02" },
      { code: CODES.mehta, household: "Mehta Family", invited: "2", names: "", dietary: "Vegetarian: 1; Gluten free: 1", dietNote: "", hotel: "booked", arrival: "2027-07-23", departure: "", flight: "", flightTime: "", shuttle: "{}", phone: "", song: "", message: "", submittedAt: "2027-01-03" },
    ],
    responses: [
      { code: CODES.sharma, household: "Sharma Family", eventId: "wedding", invited: "3", attending: "2", updatedAt: "" },
      { code: CODES.mehta, household: "Mehta Family", eventId: "wedding", invited: "2", attending: "2", updatedAt: "" },
    ],
  };

  async function openResponses(page, handler) {
    await page.route("https://script.google.com/**", handler);
    await openGuests(page);
    await page.evaluate(() => window.__editor.commit("site.rsvpEndpoint", "https://script.google.com/macros/s/TEST/exec", "Set endpoint"));
    await page.getByRole("tab", { name: "Responses" }).click();
  }

  test("renders headcounts, food, reminders, hotel and arrivals from a mocked summary", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let requested;
    await openResponses(page, (route) => { requested = route.request().url(); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SUMMARY) }); });
    const key = (await draft(page))._admin.rsvpAdminKey;
    await page.getByRole("button", { name: "Refresh responses" }).click();
    const wedding = page.locator('tr[data-event="wedding"]');
    await expect(wedding.locator("td").nth(0)).toHaveText("4"); // coming: 2 Sharmas + 2 Mehtas
    await expect(wedding.locator("td").nth(1)).toHaveText("1"); // not coming: the Sharmas' third seat
    await expect(wedding.locator("td").nth(2)).toHaveText("7"); // awaiting: 12 seats invited - 5 replied
    await expect(wedding.locator("td").nth(3)).toHaveText("12"); // invited seats
    await expect(page.locator('tr[data-event="mehendi"] td').nth(2)).toHaveText("5"); // invited seats without any reply
    expect(requested).toContain("action=summary");
    expect(requested).toContain(`key=${key}`);
    await expect(page.locator(".gm-tile").first()).toContainText("2 of 6");
    const food = page.locator(".gm-sec", { hasText: "Food preferences" }).locator(".gm-counts");
    await expect(food).toContainText("Vegetarian3");
    await expect(food).toContainText("Nut allergy1");
    await expect(page.locator(".gm-sec", { hasText: "Allergies and food notes" })).toContainText("No mustard");
    await expect(page.locator(".gm-sec", { hasText: "Names given (1)" })).toContainText("Raj, Priya");
    await expect(page.locator(".gm-sec", { hasText: "Not replied yet (4)" })).toContainText("Maria Garcia");
    await expect(page.locator(".gm-sec", { hasText: "Hotel" })).toContainText("1 need a room");
    await expect(page.locator(".gm-sec", { hasText: "Arrivals" })).toContainText("AC 123");
    await page.getByRole("button", { name: "Copy WhatsApp reminder for Maria Garcia" }).click();
    expect(await page.evaluate(() => window.__editor.lastCopied)).toMatch(/gentle reminder/);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    expect(fs.readFileSync(await dl.path(), "utf8")).toContain("Sharma Family");
    await shot(page, "dashboard");
    expect(errors).toEqual([]);
  });

  test("a rejected key and a missing endpoint are explained, not thrown", async ({ page }) => {
    await openResponses(page, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unauthorized" }) }));
    await page.getByRole("button", { name: "Refresh responses" }).click();
    await expect(page.locator(".gm-note.err")).toContainText("didn't accept the admin key");
    await expect(page.getByRole("button", { name: "Generate admin key" })).toBeVisible();
    await expect(page.locator(".gm-steps")).toContainText("ADMIN_KEY");
    await expect(page.locator(".gm-steps")).toContainText("Script properties");
    // network failure
    await page.unroute("https://script.google.com/**");
    await page.route("https://script.google.com/**", (r) => r.abort());
    await page.getByRole("button", { name: "Refresh responses" }).click();
    await expect(page.locator(".gm-note.err")).toContainText("Couldn't reach the RSVP sheet");
    // no endpoint
    await page.evaluate(() => window.__editor.commit("site.rsvpEndpoint", "", "Clear endpoint"));
    await page.getByRole("tab", { name: "Households" }).click();
    await page.getByRole("tab", { name: "Responses" }).click();
    await expect(page.locator(".gm-note.info")).toContainText("aren't connected yet");
  });

  test("generating an admin key changes it and explains where to paste it", async ({ page }) => {
    await openResponses(page, (route) => route.fulfill({ status: 200, body: "{}" }));
    const before = (await draft(page))._admin.rsvpAdminKey;
    await page.getByRole("button", { name: "Generate admin key" }).click();
    await page.getByRole("button", { name: "Generate new key" }).click();
    const after = (await draft(page))._admin.rsvpAdminKey;
    expect(after).not.toBe(before);
    expect(after).toMatch(/^[A-Z2-9]{24}$/);
    await expect(page.locator('[data-testid="admin-key"]')).toHaveText(after);
  });
});

test("guest screenshots", async ({ page }) => {
  test.skip(!SHOTS, "screenshots only with SHOTS=1");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuests(page);
  await page.selectOption("#page-select", "schedule");
  await shot(page, "guests");
  await row(page, CODES.walker).getByLabel(/^Select/).check();
  await shot(page, "guests-selected");
});

test("content fields: board labels and schedule intro come from content; hotels without a photo render no image box for guests", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pa.intro", "1"));
  await page.goto("/?content=tests/fixtures/content-board.json#home");
  await page.waitForSelector("html[data-ready='1']", { state: "attached" });
  await expect(page.locator(".tag-respond")).toHaveText("Reply");
  await expect(page.locator(".kindly")).toHaveText("Please");
  await expect(page.locator(".rsvp-word")).toHaveText("Reply");
  await page.goto("/#schedule");
  await expect(page.locator('[data-page="schedule"] .lede').first()).toHaveText("We would love to have you with us for these days in Edmonton.");
  await page.goto("/?content=tests/fixtures/content-board.json#schedule");
  await expect(page.locator('[data-page="schedule"] .lede').first()).toHaveText("Custom intro sentence.");
  await page.goto("/#travel");
  const cards = page.locator('[data-page="travel"] article.hotel');
  expect(await cards.count()).toBeGreaterThan(0);
  const withPhoto = await page.evaluate(async () => (await (await fetch("/content/content.json")).json()).hotels.filter((h) => h.type === "block" && h.photo?.src).length);
  await expect(page.locator('[data-page="travel"] .hotel-photo')).toHaveCount(withPhoto);
  await expect(page.locator('[data-page="travel"] .hotel-photo img')).toHaveCount(withPhoto);
});

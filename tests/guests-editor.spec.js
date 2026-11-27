import { test, expect } from "./helpers/test.js";
import fs from "node:fs";
import { workbookBuffer, loadXlsx } from "./helpers/xlsx.js";

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
  // Five households on both sides: Family (sent), Friends (not sent yet) and one with no wave.
  const seatsAt = (m, v, w) => Object.fromEntries(Object.entries({ mehendi: m, vidhi: v, wedding: w }).filter(([, n]) => n));
  const hh = (code, household, side, wave, eventSeats) => ({ id: `hh-${code}`, code, household, greeting: `Dear ${household}`, members: [], seats: Math.max(...Object.values(eventSeats)), eventIds: Object.keys(eventSeats), eventSeats, tags: [], side, ...(wave ? { wave } : {}) });
  const HOUSEHOLDS = [
    hh("SHAH222222", "Shah Family", "Pearl", "w1", seatsAt(4, 4, 4)),
    hh("MEHTA22222", "Mehta Family", "Pearl", "w1", seatsAt(2, 2, 2)),
    hh("JOSHI22222", "Joshi Family", "Aman", "w1", seatsAt(3, 3, 3)),
    hh("RAO2222222", "Rao Family", "Aman", "w2", seatsAt(0, 0, 2)),
    hh("KIM2222222", "Kim Family", "Aman", "", seatsAt(0, 0, 2)),
  ];
  const WAVES = [{ id: "w1", name: "Family", deadline: "2027-01-31", sent: true, sentOn: "2026-11-10" }, { id: "w2", name: "Friends", deadline: "2027-02-15", sent: false }];
  const SUMMARY = {
    ok: true,
    households: [
      { code: "SHAH222222", household: "Shah Family", invited: "4", names: "Wedding: Raj, Priya, Anil", message: "So excited!", submittedAt: "2026-11-20T10:00:00Z" },
      { code: "JOSHI22222", household: "Joshi Family", invited: "3", names: "", message: "", submittedAt: "2026-11-22T10:00:00Z" },
    ],
    responses: [
      ...[["mehendi", 4], ["vidhi", 4], ["wedding", 3]].map(([eventId, n]) => ({ code: "SHAH222222", household: "Shah Family", eventId, invited: "4", attending: String(n), updatedAt: "" })),
      ...["mehendi", "vidhi", "wedding"].map((eventId) => ({ code: "JOSHI22222", household: "Joshi Family", eventId, invited: "3", attending: "0", updatedAt: "" })),
    ],
  };

  async function openResponses(page, handler) {
    await page.route("https://script.google.com/**", handler);
    await openEditor(page);
    await unlock(page);
    await expect(page.locator("#lock-banner")).toBeHidden();
    await page.click('[data-tab="guests"]');
    await page.evaluate(({ households, waves }) => {
      const e = window.__editor;
      e.commit("_admin.waves", waves, "Waves");
      e.commit("_admin.households", households, "Households");
      e.commit("site.rsvpEndpoint", "https://script.google.com/macros/s/TEST/exec", "Set endpoint");
    }, { households: HOUSEHOLDS, waves: WAVES });
    await page.getByRole("tab", { name: "Responses" }).click();
  }
  const cells = (row) => row.locator("td.n .gm-tot");
  const split = (row, i) => row.locator("td.n").nth(i).locator(".gm-split > span");

  test("loads on open and shows waves, events, both sides and who to remind", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let requested;
    await openResponses(page, (route) => { requested = route.request().url(); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SUMMARY) }); });
    const key = (await draft(page))._admin.rsvpAdminKey;
    // Loaded without pressing Refresh.
    const wedding = page.locator('tr[data-event="wedding"]');
    await expect(cells(wedding)).toHaveText(["11", "3", "4", "4"]); // invited, coming, can't come, waiting (Rao's wave isn't sent)
    await expect(split(wedding, 0)).toHaveText(["Pearl's side: 6", "Aman's side: 5"]);
    await expect(cells(page.locator('tr[data-event="mehendi"]'))).toHaveText(["9", "4", "3", "2"]);
    expect(requested).toContain("action=summary");
    expect(requested).toContain(`key=${key}`);

    // Waves: households invited, replied, waiting; the unsent wave shows dashes.
    await expect(cells(page.locator('tr[data-wave="w1"]'))).toHaveText(["3", "2", "1"]);
    await expect(page.locator('tr[data-wave="w1"]')).toContainText("Sent Nov 10");
    await expect(page.locator('tr[data-wave="w1"]')).toContainText("Jan 31, 2027");
    await expect(page.locator('tr[data-wave="w2"]')).toContainText("Not sent yet");
    await expect(page.locator('tr[data-wave="w2"] td.n.muted')).toHaveCount(2);
    await expect(cells(page.locator('tr[data-wave="none"]'))).toHaveText(["1", "0", "1"]);
    await expect(cells(page.locator('tr[data-wave="total"]'))).toHaveText(["4", "2", "2"]);
    await expect(page.locator(".gm-foot", { hasText: "Not counted yet" })).toHaveText("Not counted yet: 1 household (2 guests) in Friends, not sent yet.");

    // One side at a time.
    await page.getByRole("button", { name: "Pearl", exact: true }).click();
    await expect(cells(wedding)).toHaveText(["6", "3", "1", "2"]);
    await expect(wedding.locator(".gm-split")).toHaveCount(0);
    await expect(page.locator(".gm-foot", { hasText: "Not counted yet" })).toHaveCount(0);
    await page.getByRole("button", { name: "Both" }).click();

    // Waiting, grouped by wave, with reminders; Replied, newest first, with notes and counts.
    await expect(page.getByRole("tab", { name: "Waiting (2)" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".gm-rrow strong")).toHaveText(["Mehta Family", "Kim Family"]);
    await page.getByRole("button", { name: "Copy WhatsApp reminder for Kim Family" }).click();
    expect(await page.evaluate(() => window.__editor.lastCopied)).toMatch(/reminder/i);
    await page.getByRole("tab", { name: "Replied (2)" }).click();
    await expect(page.locator(".gm-rrow strong")).toHaveText(["Joshi Family", "Shah Family"]);
    await expect(page.locator('.gm-rrow[data-code="SHAH222222"]')).toContainText("So excited!");
    await expect(page.locator('.gm-rrow[data-code="SHAH222222"] .gm-counts')).toHaveText("Mehendi 4/4Vidhi 4/4Wedding Ceremony 3/4");

    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    const csv = fs.readFileSync(await dl.path(), "utf8");
    const [headRow, ...lines] = csv.trim().split(/\r?\n/);
    expect(headRow).toMatch(/^household,guests,side,wave,replied,.*,names,message$/);
    expect(lines.find((l) => l.startsWith("Rao Family"))).toMatch(/^Rao Family,2,Aman,Friends,no,/);
    if (SHOTS) { await page.getByRole("tab", { name: /^Waiting/ }).click(); fs.mkdirSync("tests/screens", { recursive: true }); await page.locator(".gm-resp").screenshot({ path: "tests/screens/p2-dashboard.png" }); }
    expect(errors).toEqual([]);
  });

  test("a rejected key and a missing endpoint are explained, not thrown", async ({ page }) => {
    await openResponses(page, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unauthorized" }) }));
    await expect(page.locator(".gm-note.err")).toContainText("didn't accept the admin key");
    await expect(page.getByRole("button", { name: "Generate admin key" })).toBeVisible();
    await expect(page.locator(".gm-steps")).toContainText("ADMIN_KEY");
    await expect(page.locator(".gm-steps")).toContainText("Script properties");
    // network failure
    await page.unroute("https://script.google.com/**");
    await page.route("https://script.google.com/**", (r) => r.abort());
    await page.getByRole("button", { name: "Refresh" }).click();
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

test.describe("invitation waves", () => {
  test("make a wave, move a household into it; until it's sent it's left out of guests.json, and records never name the wave", async ({ page }) => {
    const calls = await mockGitHub(page);
    await openEditor(page);
    await unlock(page);
    await expect(page.locator("#lock-banner")).toBeHidden();
    await page.click('[data-tab="guests"]');
    await connect(page);
    const all = (await draft(page))._admin.households;
    expect(all.length).toBeGreaterThan(1);
    const [first] = all;
    await page.getByRole("button", { name: "Waves" }).click();
    const dlg = page.locator("dialog.dlg");
    await dlg.getByRole("button", { name: "Add wave" }).click();
    await dlg.getByLabel("Wave name").fill("Second round");
    await dlg.getByLabel(/reply by$/).fill("2027-03-15");
    await dlg.getByRole("button", { name: "Save waves" }).click();
    await expect(dlg).toBeHidden();

    await expect(page.getByRole("button", { name: /Second round/ })).toBeDisabled();
    await row(page, first.code).getByLabel(/^Select/).check();
    await page.getByRole("button", { name: /Second round/ }).click();
    const d = await draft(page);
    const id = d._admin.waves[0].id;
    expect(d._admin.waves[0]).toMatchObject({ name: "Second round", deadline: "2027-03-15", sent: false });
    expect(d._admin.households.filter((x) => x.wave === id).map((x) => x.code)).toEqual([first.code]);
    await expect(row(page, first.code).getByLabel(/: wave$/)).toHaveValue(id);
    await page.getByLabel("Filter by wave").selectOption(id);
    await expect(page.locator(".gm-table tbody tr")).toHaveCount(1);
    await page.getByLabel("Filter by wave").selectOption("");

    // previewing as that household shows their own date
    await row(page, first.code).getByRole("button", { name: /Preview as/ }).click();
    await page.evaluate(() => { document.querySelector("#frame").contentWindow.location.hash = "#rsvp"; });
    await expect(fr(page).locator("[data-page=rsvp] .rv-warn")).toContainText("March 15th, 2027");

    await page.click("#publish");
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.locator("dialog.dlg")).toContainText("Published", { timeout: 60000 });
    const blobs = calls.filter((c) => c.path === "/git/blobs").map((c) => c.body.content);
    const guests = JSON.parse(blobs[1]);
    expect(Object.keys(guests.records)).toHaveLength(all.length - 1);
    expect(blobs[1]).not.toContain("Second round");
    expect(errors).toEqual([]);
  });
});

test.describe("Excel by side", () => {
  test("each side downloads its own list, edits it and uploads it back; replace only touches that side", async ({ page }) => {
    await openEditor(page);
    await unlock(page);
    await page.click('[data-tab="guests"]');
    const start = (await draft(page))._admin.households;
    expect(start.length).toBeGreaterThan(1);
    const [mine, theirs] = start;
    await row(page, mine.code).getByLabel(/: side$/).selectOption("Pearl");
    await row(page, theirs.code).getByLabel(/: side$/).selectOption("Aman");
    const evs = (await draft(page)).events;

    // Download Pearl's list
    await page.getByRole("button", { name: "Download Excel" }).click();
    const dlg = page.locator("dialog.dlg");
    await dlg.getByRole("radio", { name: /Pearl's side list/ }).check();
    const [dl] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "Download", exact: true }).click()]);
    expect(dl.suggestedFilename()).toBe("guest-list-pearl.xlsx");
    const XLSX = loadXlsx();
    const wb = XLSX.read(fs.readFileSync(await dl.path()), { type: "buffer" });
    const grid = XLSX.utils.sheet_to_json(wb.Sheets.Households, { header: 1, defval: "" });
    expect(grid[0].slice(0, 5)).toEqual(["household", "members", "side", "wave", "tags"]);
    expect(grid.slice(1).map((r) => r[grid[0].indexOf("code")])).toEqual([mine.code]); // only Pearl's side
    expect(wb.SheetNames).toEqual(["Households", "How to fill"]);

    // Edit it: rename the household (same code) and add a new one, then upload as "add and update"
    const ci = grid[0].indexOf("code");
    const first = evs[0];
    const ei = grid[0].indexOf(first.name || first.id);
    const edited = [grid[0], grid[1].map((v, i) => (i === 0 ? "Renamed Family" : v)), grid[0].map((hd, i) => (i === 0 ? "Mehta Family" : i === ei ? "2" : i === ci || hd === "personal link" ? "" : ["side", "wave", "tags", "members"].includes(hd) ? "" : "0"))];
    const upload = async (rows, name) => {
      await page.getByRole("button", { name: "Import CSV / Excel" }).click();
      await dlg.getByLabel("Whose list is this?").selectOption("Pearl");
      await dlg.getByLabel("Choose a CSV or Excel file").setInputFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbookBuffer({ Households: rows }) });
    };
    await upload(edited, "guest-list-pearl.xlsx");
    const prev = page.locator(".gm-prev");
    await expect(prev).toContainText("1 household to add, 1 to update");
    await expect(prev).toContainText(`renamed from ${mine.household}`);
    await dlg.getByRole("button", { name: "Import 2 households" }).click();
    let d = await draft(page);
    expect(d._admin.households.find((x) => x.code === mine.code).household).toBe("Renamed Family"); // same link
    const mehta = d._admin.households.find((x) => x.household === "Mehta Family");
    expect(mehta.side).toBe("Pearl");
    expect(mehta.eventSeats[first.id]).toBe(2);

    // Replace Pearl's list with a file that only has Mehta: Renamed Family is removed (after ticking the warning), Aman's stays
    await upload([edited[0], [...edited[2].slice(0, ci), mehta.code, ""]], "pearl.xlsx");
    await dlg.getByRole("radio", { name: /Replace Pearl's side list/ }).check();
    await expect(prev).toContainText("1 to remove");
    const go = dlg.getByRole("button", { name: /^Import .* and remove 1$/ });
    await expect(go).toBeDisabled();
    await dlg.getByText(/I understand/).click();
    await go.click();
    d = await draft(page);
    expect(d._admin.households.map((x) => x.code).sort()).toEqual([theirs.code, mehta.code, ...start.slice(2).map((x) => x.code)].sort());
    await page.getByLabel("Filter by side").selectOption("Aman");
    await expect(page.locator(".gm-table tbody tr")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});

#!/usr/bin/env node
// Build content/guests.json and content/admin.enc.json.
// Usage: node tools/make-guests.mjs --households tools/sample-households.json --passphrase <p> [--iter 150000]
// Existing codes are kept (matched by household id, then name) so links already sent keep working.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildGuestFiles, openAdmin, reuseCodes } from "../src/lib/guestfiles.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const fail = (m) => { console.error(m); process.exit(1); };

if (!args.households || !args.passphrase) fail("Usage: node tools/make-guests.mjs --households <file.json> --passphrase <p> [--iter N]");

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const content = await readJson(path.join(root, "content/content.json"));
const input = await readJson(path.resolve(args.households));
let households = Array.isArray(input) ? input : input.households;
if (!Array.isArray(households)) fail("households file must be an array or { households: [] }");

let privateEvents = content.events.filter((e) => e.visibility === "private");
let rsvpAdminKey, presets, waTemplate, waReminder;
const adminPath = path.join(root, "content/admin.enc.json");
if (existsSync(adminPath)) {
  try {
    const prev = await openAdmin(await readJson(adminPath), args.passphrase);
    households = reuseCodes(households, prev.households);
    rsvpAdminKey = prev.rsvpAdminKey;
    presets = prev.presets;
    waTemplate = prev.waTemplate;
    waReminder = prev.waReminder;
    if (!privateEvents.length) privateEvents = prev.privateEvents;
  } catch {
    fail("content/admin.enc.json exists but the passphrase does not open it. Refusing to overwrite (that would change every code). Delete it to start over.");
  }
}

const iter = args.iter ? Number(args.iter) : undefined;
const { guestsJson, adminJson } = await buildGuestFiles({ households, privateEvents, passphrase: args.passphrase, nameLookup: content.site?.nameLookup === true, rsvpAdminKey, iter, presets, waTemplate, waReminder });
await writeFile(path.join(root, "content/guests.json"), JSON.stringify(guestsJson) + "\n");
await writeFile(adminPath, JSON.stringify(adminJson) + "\n");

const bundle = await openAdmin(adminJson, args.passphrase);
const site = (content.site?.siteUrl || "http://127.0.0.1:5173/").replace(/\/?$/, "/");
console.log(`\nPrivate events: ${privateEvents.map((e) => e.id).join(", ") || "(none)"}\n`);
const w = Math.max(...bundle.households.map((h) => h.household.length), 9);
console.log("Household".padEnd(w), " Link");
for (const h of bundle.households) console.log(h.household.padEnd(w), "", `${site}?i=${h.code}`);
console.log(`\nWrote content/guests.json and content/admin.enc.json (${bundle.households.length} households).`);

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build, ORDER } from "../../tools/bundle-css.mjs";

const root = path.resolve(import.meta.dirname, "../..");
test("src/styles/site.css is up to date (run: node tools/bundle-css.mjs)", () => {
  const cur = fs.readFileSync(path.join(root, "src/styles/site.css"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, build());
});
test("every stylesheet under src/styles is bundled, and index.html links only site.css", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const all = walk(path.join(root, "src/styles")).map((f) => path.relative(path.join(root, "src/styles"), f).split(path.sep).join("/")).filter((f) => f.endsWith(".css") && f !== "site.css");
  assert.deepEqual([...all].sort(), [...ORDER].sort());
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(src\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ["src/styles/site.css"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const start = sw.indexOf("const SHELL = [");
const shell = sw.slice(start, sw.indexOf("];", start)).match(/"([^"]+)"/g).map((s) => s.slice(1, -1));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}
test("sw.js SHELL lists every src js/css file and nothing stale", () => {
  const actual = walk(path.join(root, "src")).filter((f) => /\.(js|css)$/.test(f)).map((f) => path.relative(root, f).split(path.sep).join("/"));
  for (const f of actual) assert.ok(shell.includes(f), `sw.js SHELL is missing ${f}`);
  for (const f of shell.filter((s) => s.startsWith("src/"))) assert.ok(actual.includes(f), `sw.js SHELL lists non-existent ${f}`);
});
test("manifest is well-formed", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "./#home");
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, i.src)), i.src);
  assert.ok(m.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
});

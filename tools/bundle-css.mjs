// Concatenates the stylesheets into one render-blocking file (no build step otherwise).
// Run: node tools/bundle-css.mjs         (writes src/styles/site.css)
//      node tools/bundle-css.mjs --check (exits 1 if site.css is stale)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const stylesDir = path.join(root, "src/styles");
export const ORDER = ["fonts.css", "tokens.css", "base.css", "pages/home.css", "pages/schedule.css", "pages/travel.css", "pages/story.css", "pages/faq.css", "pages/registry.css", "pages/rsvp.css", "pages/lookup.css"];

/** Re-point relative url(...) references from the source file's folder to src/styles/. */
function rebase(css, file) {
  return css.replace(/url\(\s*(["']?)(\.{1,2}\/[^"')]+)\1\s*\)/g, (m, q, u) => {
    const abs = path.resolve(path.dirname(file), u);
    return `url(${q}${path.relative(stylesDir, abs).split(path.sep).join("/")}${q})`;
  });
}

export function build() {
  const parts = ORDER.map((f) => {
    const file = path.join(stylesDir, f);
    return `/* ===== ${f} ===== */\n${rebase(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trimEnd(), file)}\n`;
  });
  return `/* GENERATED — edit sources, then run: node tools/bundle-css.mjs\n   Sources: ${ORDER.join(", ")} */\n\n${parts.join("\n")}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const out = path.join(stylesDir, "site.css");
  const next = build();
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
    if (cur !== next) { console.error("src/styles/site.css is stale. Run: node tools/bundle-css.mjs"); process.exit(1); }
    console.log("site.css is up to date");
  } else {
    fs.writeFileSync(out, next);
    console.log(`wrote ${path.relative(root, out)} (${(next.length / 1024).toFixed(1)} KB)`);
  }
}

// Generates PWA icons: node tools/icons.mjs  (needs Playwright chromium; Bodoni Moda is used if reachable, else Georgia)
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "assets", "icons");
fs.mkdirSync(out, { recursive: true });

const OLIVE = "#2e3522", IVORY = "#ece8df", GOLD = "#e6cf94";
const FONT = "'Bodoni Moda', Didot, 'Bodoni 72', Georgia, serif";

/** @param {{border:boolean, scale:number, rounded:boolean}} o scale shrinks the monogram (maskable safe zone) */
function svg({ border = true, scale = 1, rounded = false } = {}) {
  const r = rounded ? 96 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${r}" fill="${OLIVE}"/>
  ${border ? `<rect x="28" y="28" width="456" height="456" rx="${Math.max(0, r - 28)}" fill="none" stroke="${IVORY}" stroke-width="3" opacity="0.9"/>
  <rect x="40" y="40" width="432" height="432" rx="${Math.max(0, r - 40)}" fill="none" stroke="${GOLD}" stroke-width="1.5" opacity="0.7"/>` : ""}
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <text x="256" y="328" text-anchor="middle" font-family="${FONT}" font-size="190" font-weight="500" letter-spacing="2" fill="${IVORY}">P<tspan fill="${GOLD}" font-style="italic" font-size="130" dx="6" dy="-8">&amp;</tspan><tspan dx="6" dy="8">A</tspan></text>
  </g>
</svg>`;
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${OLIVE}"/><text x="32" y="43" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="30" fill="${IVORY}">P<tspan fill="${GOLD}" font-style="italic" font-size="22">&amp;</tspan>A</text></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(markup, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,500;1,500&display=swap"><style>html,body{margin:0;background:${OLIVE}}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${markup}</body></html>`, { waitUntil: "load", timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.screenshot({ path: path.join(out, file), clip: { x: 0, y: 0, width: size, height: size } });
  console.log("wrote assets/icons/" + file);
}

await render(svg({ border: true }), 192, "icon-192.png");
await render(svg({ border: true }), 512, "icon-512.png");
await render(svg({ border: false, scale: 0.72 }), 192, "maskable-192.png");
await render(svg({ border: false, scale: 0.72 }), 512, "maskable-512.png");
await render(svg({ border: true }), 180, "apple-touch-icon.png"); // iOS rounds corners itself, so keep it square
fs.writeFileSync(path.join(out, "favicon.svg"), favicon);
console.log("wrote assets/icons/favicon.svg");
await browser.close();

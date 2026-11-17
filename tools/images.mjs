// Image pipeline: node tools/images.mjs
// assets/*.jpg -> assets/img/<name>.webp (max 2000w) and <name>-600.webp; plus assets/img/og.jpg (1200x630 from banner.jpg).
// Originals are never modified or deleted.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "assets");
const dest = path.join(src, "img");
fs.mkdirSync(dest, { recursive: true });

const kb = (n) => (n / 1024).toFixed(0).padStart(6) + " KB";
let totalIn = 0, totalOut = 0;
const mapping = {};

const files = fs.readdirSync(src).filter((f) => /\.jpe?g$/i.test(f)).sort();
for (const f of files) {
  const name = path.parse(f).name;
  const input = path.join(src, f);
  const inSize = fs.statSync(input).size;
  const big = path.join(dest, `${name}.webp`);
  const small = path.join(dest, `${name}-600.webp`);
  // rotate() applies EXIF orientation; sharp strips metadata by default on output.
  await sharp(input).rotate().resize({ width: 2000, withoutEnlargement: true }).webp({ quality: 78 }).toFile(big);
  await sharp(input).rotate().resize({ width: 600, withoutEnlargement: true }).webp({ quality: 78 }).toFile(small);
  const o = fs.statSync(big).size, s = fs.statSync(small).size;
  totalIn += inSize; totalOut += o;
  mapping[`assets/${f}`] = { full: `assets/img/${name}.webp`, small: `assets/img/${name}-600.webp` };
  console.log(`${f.padEnd(22)} ${kb(inSize)} -> ${kb(o)} (-${(100 - (o / inSize) * 100).toFixed(0)}%)  600w ${kb(s)}`);
}

// Open Graph image from the banner. Set caption to burn a line into the JPEG; leave empty for the photo alone
// (og:title already carries the names and date). Escape & < > in the caption for the SVG.
const W = 1200, H = 630;
const caption = "";
const og = path.join(dest, "og.jpg");
let ogPipe = sharp(path.join(src, "banner.jpg")).rotate().resize(W, H, { fit: "cover", position: "attention" });
if (caption) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#232a1a" stop-opacity="0"/><stop offset="1" stop-color="#232a1a" stop-opacity="0.82"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="${W / 2}" y="${H - 70}" text-anchor="middle" font-family="Bodoni Moda, Didot, Georgia, serif" font-size="58" fill="#ece8df" letter-spacing="3">${esc(caption)}</text>
</svg>`);
  ogPipe = ogPipe.composite([{ input: overlay }]);
}
await ogPipe.jpeg({ quality: 82, mozjpeg: true }).toFile(og);
console.log(`og.jpg ${kb(fs.statSync(og).size)}${caption ? ` ("${caption}")` : ""}`);

console.log(`\nTotal (full-size only): ${kb(totalIn)} -> ${kb(totalOut)} (saved ${((1 - totalOut / totalIn) * 100).toFixed(0)}%)`);
console.log("\nPath mapping:\n" + JSON.stringify(mapping, null, 2));

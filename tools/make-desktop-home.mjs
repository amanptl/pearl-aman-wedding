// Desktop home artwork (≥768px). Source: assets/source/flatlay-desktop.jpg (portrait 3:4 flat lay with a clear centre).
//   assets/img/flatlay-desktop.webp       the flat lay (plus a 1200px-wide variant)
//   assets/img/flatlay-desktop-felt.webp  seamless felt tile cut from its plain centre, so the page felt matches exactly
// Re-run after replacing the source (e.g. a higher-resolution export):  node tools/make-desktop-home.mjs
// If the new image's objects move, update the --u positions in src/styles/pages/home.css (desktop section).
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "assets/source/flatlay-desktop.jpg");
const out = (n) => path.join(root, "assets/img", n);
const { width: W, height: H } = await sharp(src).metadata();
const s = W / 864; // positions below are in the 864-wide reference image

await sharp(src).webp({ quality: 86 }).toFile(out("flatlay-desktop.webp"));
if (W > 1200) await sharp(src).resize({ width: 1200 }).webp({ quality: 84 }).toFile(out("flatlay-desktop-1200.webp"));

// Plain felt patch (between the bouquet and the lace, above the card area), mirrored both ways → seamless tile.
const n = Math.round(220 * s);
const patch = await sharp(src).extract({ left: Math.round(400 * s), top: Math.round(270 * s), width: n, height: n }).median(3).toBuffer();
const [fx, fy, fxy] = await Promise.all([sharp(patch).flop().toBuffer(), sharp(patch).flip().toBuffer(), sharp(patch).flip().flop().toBuffer()]);
await sharp({ create: { width: n * 2, height: n * 2, channels: 3, background: "#000" } })
  .composite([{ input: patch, left: 0, top: 0 }, { input: fx, left: n, top: 0 }, { input: fy, left: 0, top: n }, { input: fxy, left: n, top: n }])
  .resize({ width: 440 }).webp({ quality: 82 }).toFile(out("flatlay-desktop-felt.webp"));
console.log(`flat lay ${W}x${H} → assets/img/flatlay-desktop*.webp`);

// Wide desktop artwork (the current desktop home): a 16:9 flat lay that runs off every edge, with an open centre for
// the invitation stack. Source: assets/source/flatlay-desktop-v2.png.
const wide = path.join(root, "assets/source/flatlay-desktop-v2.png");
await sharp(wide).removeAlpha().webp({ quality: 88 }).toFile(out("flatlay-desktop-v2.webp"));
const wm = await sharp(wide).metadata();
console.log(`desktop flat lay v2 ${wm.width}x${wm.height} → assets/img/flatlay-desktop-v2.webp`);
// The site shows a slightly lighter version of this image. This script writes the dark original, so afterwards copy
// assets/img/flatlay-desktop-v2.webp into assets/source/home-original-dark/ and run: python tools/relight-home.py
console.log("Note: now copy it into assets/source/home-original-dark/ and run python tools/relight-home.py");

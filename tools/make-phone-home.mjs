// Phone/tablet home artwork (<1024px). Source: assets/source/flatlay-phone.jpg (tall 9:16 flat lay, 720 wide reference).
//   assets/img/flatlay-phone.webp       the flat lay with its centre column (rings + bow) moved down by D, on its own felt,
//                                       so the card, Details and "Kindly Rsvp" fit above the rings (template order)
//   assets/img/flatlay-phone-felt.webp  seamless felt tile from its plain centre, for the page behind the board
// Re-run after replacing the source:  node tools/make-phone-home.mjs
// If the new image's objects move, update the cqw positions in src/styles/pages/home.css (phone section).
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "assets/source/flatlay-phone.jpg");
const out = (n) => path.join(root, "assets/img", n);
const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, s = W / 720; // positions below are in the 720-wide reference image
const D = Math.round(245 * s);                         // how far the rings + bow move down (34cqw)
const SEAM = Math.round(900 * s);                      // top of the moved column (plain felt above the rings)
const X0 = Math.round(230 * s), X1 = Math.round(480 * s), F = Math.round(30 * s); // column, with feathered sides
const OH = H + D, o = Buffer.alloc(W * OH * 3);
const px = (y, x) => (y * W + x) * 3;
const ramp = (t) => Math.min(1, Math.max(0, t));
for (let y = 0; y < OH; y++) {
  const by = y < H ? y : 2 * H - 1 - y; // below the photo: mirrored plain felt
  for (let x = 0; x < W; x++) {
    let w = 0;
    if (y >= SEAM) w = ramp((x - X0) / F) * ramp((X1 - x) / F) * ramp((y - SEAM) / F);
    const a = px(by, x), b = px(Math.min(H - 1, y - D < 0 ? 0 : y - D), x), k = px(y, x) / 1; // column = shifted down by D
    for (let c = 0; c < 3; c++) o[k + c] = Math.round(data[a + c] * (1 - w) + (w ? data[b + c] * w : 0));
  }
}
await sharp(o, { raw: { width: W, height: OH, channels: 3 } }).webp({ quality: 86 }).toFile(out("flatlay-phone.webp"));

// Plain felt patch (open centre, right of the envelope), mirrored both ways → seamless tile.
const n = Math.round(160 * s);
const patch = await sharp(src).extract({ left: Math.round(290 * s), top: Math.round(420 * s), width: n, height: n }).median(3).toBuffer();
const [fx, fy, fxy] = await Promise.all([sharp(patch).flop().toBuffer(), sharp(patch).flip().toBuffer(), sharp(patch).flip().flop().toBuffer()]);
await sharp({ create: { width: n * 2, height: n * 2, channels: 3, background: "#000" } })
  .composite([{ input: patch, left: 0, top: 0 }, { input: fx, left: n, top: 0 }, { input: fy, left: 0, top: n }, { input: fxy, left: n, top: n }])
  .resize({ width: 320 }).webp({ quality: 82 }).toFile(out("flatlay-phone-felt.webp"));
console.log(`phone flat lay ${W}x${H} → ${W}x${OH} (column moved ${D}px) → assets/img/flatlay-phone*.webp`);

// Phone artwork (the current phone home): a full-bleed 853 × 1844 flat lay with an open centre column.
// Source: assets/source/flatlay-phone-v2.png.
const v2 = path.join(root, "assets/source/flatlay-phone-v2.png");
await sharp(v2).removeAlpha().webp({ quality: 88 }).toFile(out("flatlay-phone-v2.webp"));
const vm = await sharp(v2).metadata();
console.log(`phone flat lay v2 ${vm.width}x${vm.height} → assets/img/flatlay-phone-v2.webp`);
// The site shows a slightly lighter version of this image. This script writes the dark original, so afterwards copy
// assets/img/flatlay-phone-v2.webp into assets/source/home-original-dark/ and run: python tools/relight-home.py
console.log("Note: now copy it into assets/source/home-original-dark/ and run python tools/relight-home.py");

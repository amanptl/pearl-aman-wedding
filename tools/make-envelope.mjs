// Envelope artwork for the home board and the opening film. Sources in assets/source/ (generated on pure white):
//   envelope-open.png   back of the envelope, flap open (gives the pocket, the inside back and the flap liner)
//   envelope-closed.png same envelope, flap closed (gives the outside of the flap)
//   card-paper.png      blank ivory cotton sheet (gives the invitation card's paper texture)
// Outputs (assets/img/), all in one frame: the envelope body is 1000 x 732 (the closed envelope's proportions).
//   env-back.webp       inside of the envelope (liner), the full body
//   env-pocket.webp     the front pocket (side + bottom flaps), transparent where the inside shows
//   env-flap-out.webp   outside of the flap, 1000 x 512, tip pointing down (closed)
//   env-flap-in.webp    inside of the flap (liner), 1000 x 512, tip pointing up (as it lies when open)
//   card-paper.webp     paper texture for the invitation card
// The sources have torn (deckled) paper edges with a white rim. Every outer edge is cut just inside that deckle, on a
// straight line with slightly rounded corners, so the envelope reads as clean-cut stock on the dark felt; colour is
// bled outward from the paper before resizing so no white from the background leaks into the softened edges.
// Re-run after replacing a source:  node tools/make-envelope.mjs
// If a new source moves the envelope, update the measured boxes and lines below (see the comments).
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const src = (n) => path.join(root, "assets/source", n);
const out = (n) => path.join(root, "assets/img", n);
const BW = 1000, BH = 732, FH = 512; // body and flap size in the output frame
const CORNER = 6; // corner radius of the envelope, in output pixels

async function raw(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}
const lum = (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3;

/** Paint over the deckle: a light pixel within `depth` of a cut edge (sides "L", "R", "T", "B") takes the colour
 *  of the pixel `depth` further in, so the cut edge is solid paper. */
function cleanEdges(img, box, sides, depth = 14, light = 125) {
  const { data, W } = img, d = Buffer.from(data);
  const { left, top, width, height } = box, right = left + width - 1, bottom = top + height - 1;
  const fix = (x, y, ix, iy) => {
    const i = (y * W + x) * 3;
    if (lum(data, i) <= light) return;
    const j = (iy * W + ix) * 3;
    d[i] = data[j]; d[i + 1] = data[j + 1]; d[i + 2] = data[j + 2];
  };
  for (let k = 0; k < depth; k++) {
    for (let y = top; y <= bottom; y++) {
      if (sides.includes("L")) fix(left + k, y, left + k + depth, y);
      if (sides.includes("R")) fix(right - k, y, right - k - depth, y);
    }
    for (let x = left; x <= right; x++) {
      if (sides.includes("T")) fix(x, top + k, x, top + k + depth);
      if (sides.includes("B")) fix(x, bottom - k, x, bottom - k - depth);
    }
  }
  return { ...img, data: d };
}

/** False inside the rounded-off corners ("tl", "tr", "bl", "br") of a box, radius r (source pixels). */
const rounded = (box, r, corners) => (x, y) => {
  const right = box.left + box.width - 1, bottom = box.top + box.height - 1;
  for (const c of corners) {
    const cx = c[1] === "l" ? box.left + r : right - r, cy = c[0] === "t" ? box.top + r : bottom - r;
    const out = (c[1] === "l" ? x < cx : x > cx) && (c[0] === "t" ? y < cy : y > cy);
    if (out && (x - cx) ** 2 + (y - cy) ** 2 > r * r) return false;
  }
  return true;
};

/** Spread the colour of opaque pixels into the transparent ones next to them (up to `reach` pixels), so resizing and
 *  softening the matte mixes in paper colour rather than the white the source was shot on. */
function bleed(rgba, w, h, reach = 8) {
  const seen = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) if (rgba[k * 4 + 3]) seen[k] = 1;
  const nb = (k) => { const x = k % w; return [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k >= w ? k - w : -1, k < w * (h - 1) ? k + w : -1]; };
  let front = [];
  for (let k = 0; k < w * h; k++) if (seen[k] && nb(k).some((n) => n >= 0 && !seen[n])) front.push(k);
  for (let step = 0; step < reach && front.length; step++) {
    const next = [];
    for (const k of front) for (const n of nb(k)) if (n >= 0 && !seen[n]) {
      seen[n] = 1; rgba[n * 4] = rgba[k * 4]; rgba[n * 4 + 1] = rgba[k * 4 + 1]; rgba[n * 4 + 2] = rgba[k * 4 + 2]; next.push(n);
    }
    front = next;
  }
}

/** Crop a box to RGBA with the given alpha function, resize to w x h, soften the matte by a pixel. */
async function layer(img, box, alpha, w, h, name) {
  const { data, W } = img, { left, top, width, height } = box, rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = x + left, sy = y + top, i = (sy * W + sx) * 3, o = (y * width + x) * 4;
    rgba[o] = data[i]; rgba[o + 1] = data[i + 1]; rgba[o + 2] = data[i + 2]; rgba[o + 3] = alpha(sx, sy) ? 255 : 0;
  }
  bleed(rgba, width, height);
  const a = await sharp(rgba, { raw: { width, height, channels: 4 } }).resize(w, h, { fit: "fill" }).raw().toBuffer();
  const m = await sharp(a, { raw: { width: w, height: h, channels: 4 } }).extractChannel(3).blur(0.6).raw().toBuffer();
  for (let k = 0; k < w * h; k++) a[k * 4 + 3] = m[k];
  await sharp(a, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 90, alphaQuality: 100 }).toFile(out(name));
}

// ---- Open envelope (2400 x 1600 source). The paper's deckle ends by x 577 / x 1820 / y 1527; the body is cut a few
// pixels inside it: x 582..1815, hinge y 680 .. bottom y 1518. ----
const open = await raw(src("envelope-open.png"));
const BODY = { left: 582, top: 680, width: 1234, height: 839 };
const openClean = cleanEdges(open, BODY, "LRB");
const bodyShape = rounded(BODY, (CORNER * BODY.width) / BW, ["bl", "br"]);
const isGreen = (x, y) => { const i = (y * open.W + x) * 3, d = openClean.data, r = d[i], g = d[i + 1], b = d[i + 2]; return r < 118 && g < 128 && g > b + 18; };
// A thin olive strip runs across the liner just above the pocket (an inner card slot). It belongs to the inside,
// not the pocket, so it is painted out of the back with the liner just above it.
const STRIP = { y0: 822, y1: 870 };
const linerEdge = (y) => [813 + ((y - 816) * (881 - 813)) / (872 - 816), 1586 - ((y - 816) * (1586 - 1516)) / (872 - 816)];
const inStrip = (x, y) => { if (y < STRIP.y0 || y > STRIP.y1) return false; const [l, r] = linerEdge(y); return x > l - 12 && x < r + 12; };
{
  const fixed = Buffer.from(openClean.data);
  for (let y = STRIP.y0; y <= STRIP.y1; y++) for (let x = 0; x < open.W; x++) if (inStrip(x, y)) {
    const sy = y - (STRIP.y1 - STRIP.y0 + 6), i = (y * open.W + x) * 3, j = (sy * open.W + x) * 3;
    fixed[i] = openClean.data[j]; fixed[i + 1] = openClean.data[j + 1]; fixed[i + 2] = openClean.data[j + 2];
  }
  await layer({ ...open, data: fixed }, BODY, bodyShape, BW, BH, "env-back.webp");
}
await layer(openClean, BODY, (x, y) => bodyShape(x, y) && isGreen(x, y) && !inStrip(x, y), BW, BH, "env-pocket.webp");

// Flap liner, tip up (y 52 .. 680). Its torn edges were fitted as straight lines (x = m*y + c) and moved in past the
// deckle (the fit's residuals reach +10 / -13 px); the tip is rounded off where the two lines meet.
{
  const L = (y) => -1.0636 * y + 1237 + 12, R = (y) => 1.0675 * y + 1162.3 - 15;
  const apexY = (1237 + 12 - (1162.3 - 15)) / (1.0675 + 1.0636), apexX = R(apexY);
  const alpha = Math.atan((1.0636 + 1.0675) / 2), r = 40; // half-angle from vertical; tip radius
  const d = r / Math.sin(alpha), cy = apexY + d, ty = apexY + d * Math.cos(alpha) ** 2;
  const inLiner = (x, y) => x >= L(y) && x <= R(y) && (y >= ty || (x - apexX) ** 2 + (y - cy) ** 2 <= r * r);
  await layer(openClean, { left: BODY.left, top: 52, width: BODY.width, height: 628 }, inLiner, BW, FH, "env-flap-in.webp");
}

// ---- Closed envelope: paper x 249..2155, y 101..1497, deckle up to x 262 / x 2140 / y 113; cut at x 266..2137,
// top y 117. Flap edges traced along their shadow line, tip at y 1072 ----
const closed = await raw(src("envelope-closed.png"));
const CB = { left: 266, top: 117, width: 1872, height: 1363 };
const FLAP_H = Math.round((CB.height * FH) / BH); // the flap box in source pixels (same proportion as the output)
const FLAP_BOX = { left: CB.left, top: CB.top, width: CB.width, height: FLAP_H };
const closedClean = cleanEdges(closed, FLAP_BOX, "LRT");
// Flap outline (source coords): straight edges from the rounded top corners to a rounded tip.
const leftX = (y) => 331 + (y - 280) * ((1117 - 331) / (1040 - 280)) + 2;
const rightX = (y) => 2074 - (y - 280) * ((2074 - 1304) / (1040 - 280)) - 2;
const TIP = { x: 1208, y: 1072, r: 120 };
const flapCorners = rounded(FLAP_BOX, (CORNER * CB.width) / BW, ["tl", "tr"]);
const inFlap = (x, y) => {
  if (y < CB.top || y > TIP.y) return false;
  if (y > TIP.y - TIP.r) { // rounded tip
    const cy = TIP.y - TIP.r, half = Math.sqrt(Math.max(0, TIP.r * TIP.r - (y - cy) ** 2));
    if (Math.abs(x - TIP.x) > half * 1.02) return false;
  }
  if (y < 280) return flapCorners(x, y); // full width near the hinge
  return x >= leftX(y) && x <= rightX(y);
};
await layer(closedClean, FLAP_BOX, inFlap, BW, FH, "env-flap-out.webp");

// ---- Card paper: the sheet's inside (no deckle), stretched over the card shape as its fill ----
await sharp(src("card-paper.png")).extract({ left: 220, top: 250, width: 1080, height: 1512 }).resize(600, 840).webp({ quality: 80 }).toFile(out("card-paper.webp"));
console.log("envelope + card paper → assets/img/env-*.webp, card-paper.webp");

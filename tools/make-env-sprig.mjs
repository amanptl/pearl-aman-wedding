// Cut the envelope's corner bouquet out of assets/source/bouquet-sky-blue.jpg (an overhead shot on a plain sky-blue
// backdrop; the composition follows inspiration/envolope-insp.PNG, bottom-left corner).
//
// The flowers hold no blue, so the matte keys on how far each pixel's colour strays from the backdrop *in hue*, not in
// brightness: the backdrop's own soft shadows (a darker blue) drop out, while the white calla and the near-black folds of
// the roses stay solid. Edge pixels are then un-mixed from the backdrop so no blue fringe is left, and the colours are
// toned a little darker and softer to sit on the dark olive envelope.
// Re-run: node tools/make-env-sprig.mjs
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "assets/source/bouquet-sky-blue.jpg");
const out = (n) => path.join(root, "assets/img", n);

const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;

/* 1. The backdrop, as a smooth field: average the clearly-blue pixels in coarse cells, fill the cells the bouquet
      covers from their neighbours, then blur and scale back up. */
const isBackdrop = (r, g, b) => b > r + 30 && b >= g + 8 && (r + g + b) / 3 > 150;
const C = 24, cw = Math.ceil(W / C), ch = Math.ceil(H / C);
const sum = new Float64Array(cw * ch * 3), cnt = new Float64Array(cw * ch);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 3;
  if (!isBackdrop(data[i], data[i + 1], data[i + 2])) continue;
  const c = ((y / C) | 0) * cw + ((x / C) | 0);
  sum[c * 3] += data[i]; sum[c * 3 + 1] += data[i + 1]; sum[c * 3 + 2] += data[i + 2]; cnt[c]++;
}
const cell = new Float64Array(cw * ch * 3), known = new Uint8Array(cw * ch);
for (let c = 0; c < cw * ch; c++) if (cnt[c] > C * C * 0.5) { known[c] = 1; for (let k = 0; k < 3; k++) cell[c * 3 + k] = sum[c * 3 + k] / cnt[c]; }
for (let pass = 0, missing = 1; missing && pass < 200; pass++) {
  missing = 0;
  const next = new Uint8Array(known);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const c = cy * cw + cx;
    if (known[c]) continue;
    let n = 0; const acc = [0, 0, 0];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch || !known[ny * cw + nx]) continue;
      for (let k = 0; k < 3; k++) acc[k] += cell[(ny * cw + nx) * 3 + k];
      n++;
    }
    if (n) { for (let k = 0; k < 3; k++) cell[c * 3 + k] = acc[k] / n; next[c] = 1; } else missing = 1;
  }
  known.set(next);
}
const bg = await sharp(Buffer.from(Uint8Array.from(cell, (v) => Math.round(v))), { raw: { width: cw, height: ch, channels: 3 } })
  .blur(2).resize(W, H, { kernel: "cubic" }).raw().toBuffer();

/* 2. Matte. q = pixel / backdrop per channel: a shadow scales all three alike (low spread); a flower does not. */
const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const alpha = new Float32Array(N);
for (let p = 0; p < N; p++) {
  const i = p * 3;
  const q = [data[i] / bg[i], data[i + 1] / bg[i + 1], data[i + 2] / bg[i + 2]];
  const spread = Math.max(...q) - Math.min(...q), mean = (q[0] + q[1] + q[2]) / 3;
  // Deep shadows between blooms are dark enough to pass the brightness test, but they stay blue; no flower does.
  const blueness = (data[i + 2] - data[i]) / (data[i + 2] + 1);
  alpha[p] = Math.min(Math.max(smooth(0.14, 0.34, spread), smooth(0.5, 0.36, mean)), smooth(0.26, 0.12, blueness));
}

/* 3. Keep the bouquet (every solid cluster of real size: sprigs of baby's breath and orchid buds hang on thin stems)
      and fill any pin-holes inside it. */
const solid = new Uint8Array(N);
for (let p = 0; p < N; p++) solid[p] = alpha[p] > 0.5 ? 1 : 0;
const label = new Int32Array(N).fill(-1);
const sizes = [];
for (let s = 0, id = 0; s < N; s++) {
  if (!solid[s] || label[s] >= 0) continue;
  const stack = [s]; label[s] = id; let n = 0;
  while (stack.length) {
    const k = stack.pop(); n++;
    const x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nk = ny * W + nx;
      if (solid[nk] && label[nk] < 0) { label[nk] = id; stack.push(nk); }
    }
  }
  sizes[id++] = n;
}
// Grow the kept clusters by a few pixels so their soft edges survive, and drop specks and dust.
const keep = new Uint8Array(N);
for (let p = 0; p < N; p++) if (label[p] >= 0 && sizes[label[p]] >= 25) keep[p] = 1;
for (let r = 0; r < 3; r++) {
  const grown = new Uint8Array(keep);
  for (let p = 0; p < N; p++) {
    if (keep[p]) continue;
    const x = p % W, y = (p / W) | 0;
    if ((x > 0 && keep[p - 1]) || (x < W - 1 && keep[p + 1]) || (y > 0 && keep[p - W]) || (y < H - 1 && keep[p + W])) grown[p] = 1;
  }
  keep.set(grown);
}
// Holes: low-alpha regions not reachable from the image border. Small ones are pin-holes in petals; fill them.
const outside = new Uint8Array(N), q = [];
const seed = (p) => { if (!outside[p] && alpha[p] <= 0.5) { outside[p] = 1; q.push(p); } };
for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
while (q.length) {
  const k = q.pop(), x = k % W, y = (k / W) | 0;
  if (x > 0) seed(k - 1); if (x < W - 1) seed(k + 1); if (y > 0) seed(k - W); if (y < H - 1) seed(k + W);
}
const seen = new Uint8Array(N);
let filled = 0;
for (let s = 0; s < N; s++) {
  if (outside[s] || alpha[s] > 0.5 || seen[s]) continue;
  const comp = [s], stack = [s]; seen[s] = 1;
  while (stack.length) {
    const k = stack.pop(), x = k % W, y = (k / W) | 0;
    for (const nk of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1]) {
      if (nk < 0 || seen[nk] || outside[nk] || alpha[nk] > 0.5) continue;
      seen[nk] = 1; stack.push(nk); comp.push(nk);
    }
  }
  if (comp.length <= 40) { for (const k of comp) alpha[k] = 1; filled += comp.length; }
}

/* 4. Un-mix edge pixels from the backdrop (no blue fringe), clamp any blue cast, and tone toward the mock. */
const rgba = Buffer.alloc(N * 4);
for (let p = 0; p < N; p++) {
  const a = keep[p] ? alpha[p] : 0;
  if (a < 0.02) continue;
  const i = p * 3;
  let c = [0, 1, 2].map((k) => (data[i + k] - (1 - a) * bg[i + k]) / a);
  c = c.map((v) => Math.min(255, Math.max(0, v)));
  c[2] = Math.min(c[2], Math.max(c[0], c[1]) + 6); // nothing in the bouquet is bluer than it is red or green
  rgba[p * 4] = c[0]; rgba[p * 4 + 1] = c[1]; rgba[p * 4 + 2] = c[2]; rgba[p * 4 + 3] = Math.round(a * 255);
}

// A shade darker and softer than the studio shot, to sit on the dark olive envelope without glowing.
const graded = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .modulate({ brightness: 0.9, saturation: 0.9 })
  .linear([1.0, 0.99, 0.95], [2, 1, 0])
  .raw().toBuffer({ resolveWithObject: true });

const base = sharp(graded.data, { raw: { width: W, height: H, channels: 4 } })
  .trim({ threshold: 1 })
  .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } });
const buf = await base.png().toBuffer();
const meta = await sharp(buf).metadata();
await sharp(buf).webp({ quality: 90, alphaQuality: 100, smartSubsample: true }).toFile(out("env-sprig.webp"));
console.log(`env-sprig.webp ${meta.width}x${meta.height}; filled ${filled}px of pin-holes`);

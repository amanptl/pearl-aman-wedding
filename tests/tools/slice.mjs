// node tests/tools/slice.mjs file.png [sliceHeight] -> file-sN.png in same dir
import sharp from "sharp";
const f = process.argv[2]; const h = +(process.argv[3] || 1100);
const m = await sharp(f).metadata();
let n = 0;
for (let y = 0; y < m.height; y += h, n++) {
  await sharp(f).extract({ left: 0, top: y, width: m.width, height: Math.min(h, m.height - y) }).toFile(f.replace(".png", `-s${n}.png`));
}
console.log(n);

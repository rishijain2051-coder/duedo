// Regenerates the PWA icon set:  node scripts/generate-icons.mjs
//
// The "P" is drawn as stroked paths rather than <text> so rasterising never
// depends on a font being installed on the machine running this.

import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const OUT = "public/icons";

/** The wordmark glyph, as a stroked path in a 512x512 box. */
const GLYPH = "M180 392 V120 H288 a70 70 0 0 1 0 140 H180";

/** @param {number} inset  Padding as a fraction, for the maskable variant's safe zone. */
function svg(inset = 0) {
  const s = 1 - inset * 2;
  const t = `translate(${512 * inset} ${512 * inset}) scale(${s})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#60a5fa"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="${t}" stroke="#ffffff" stroke-width="56" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="${GLYPH}"/>
  </g>
</svg>`;
}

/** Monochrome glyph for the Android notification badge (iOS ignores this). */
const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 512 512">
  <g stroke="#ffffff" stroke-width="64" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="${GLYPH}"/>
  </g>
</svg>`;

const targets = [
  { name: "icon-192.png", size: 192, source: svg(0) },
  { name: "icon-512.png", size: 512, source: svg(0) },
  // iOS Home Screen. No transparency and no rounding — iOS applies its own mask.
  { name: "apple-touch-icon.png", size: 180, source: svg(0) },
  // Android adaptive icons crop to a circle, so the glyph needs a safe margin.
  { name: "maskable-512.png", size: 512, source: svg(0.16) },
  { name: "badge-96.png", size: 96, source: badgeSvg },
];

await mkdir(OUT, { recursive: true });
for (const { name, size, source } of targets) {
  const png = await sharp(Buffer.from(source)).resize(size, size).png().toBuffer();
  await writeFile(`${OUT}/${name}`, png);
  console.log(`${name}  ${size}x${size}  ${png.length} bytes`);
}

// A favicon the browser tab can use as well.
await writeFile("public/icons/icon.svg", svg(0));
console.log("icon.svg");

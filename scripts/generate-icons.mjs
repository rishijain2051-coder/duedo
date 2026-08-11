// Regenerates the PWA icon set:  node scripts/generate-icons.mjs
//
// The "D" is drawn as stroked paths rather than <text> so rasterising never
// depends on a font being installed on the machine running this.

import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const OUT = "public/icons";

/**
 * The wordmark glyph, as a stroked path in a 512x512 box.
 *
 * Stem at x=143, bowl starting 90 to its right, arced with r=136 — half the 272 of
 * vertical travel, so the curve is a true semicircle rather than an approximation.
 *
 * The x is not a round number because the stroke is: at width 56 the ink reaches 28
 * beyond the path on every side, so the drawn glyph spans 115..397 and centring the
 * *path* would have left it visibly right-of-centre in the tile. Optical centre, not
 * arithmetic centre.
 */
const GLYPH = "M143 392 V120 H233 a136 136 0 0 1 0 272 H143";

/**
 * The tile gradient, blue into violet.
 *
 * The violet end is the brand's, not this script's: it is what assets/logo.svg strokes
 * the letter with and what the marketing site's own favicon fills its tile with. This
 * file used to stop at #60a5fa, a lighter blue, so the product's icon and the brand
 * mark were two different objects at a glance. One palette.
 */
const FROM = "#2563eb";
const TO = "#8b5cf6";

/**
 * @param {number} inset   Padding as a fraction, for the maskable variant's safe zone.
 * @param {number} radius  Corner radius in the 512 box. Only the tab icon takes one —
 *   every other consumer applies its own mask, and rounding a tile that iOS or Android
 *   is about to round again leaves the corners cut out of the shape twice.
 */
function svg(inset = 0, radius = 0) {
  const s = 1 - inset * 2;
  const t = `translate(${512 * inset} ${512 * inset}) scale(${s})`;
  const rx = radius ? ` rx="${radius}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${FROM}"/>
      <stop offset="100%" stop-color="${TO}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512"${rx} fill="url(#g)"/>
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

// The tab icon, declared explicitly by metadata.icons in app/layout.tsx.
//
// There is deliberately no app/favicon.ico and no app/icon.svg. Both are App Router
// file conventions, and metadata.icons overrides them — so a file there is served but
// never linked, which is how app/favicon.ico survived the DueDo rename untouched and
// went on showing the old "P" in every browser tab while every icon here had changed.
// One source, generated, linked from one place.
//
// Rounded, unlike every PNG above: this one is drawn as-is in a browser tab and in a
// bookmark list, with nothing applying a mask on top. 112 of 512 is the radius the
// marketing site's favicon uses, kept the same so the tab looks identical whichever
// of the two a visitor happens to be on.
await writeFile("public/icons/icon.svg", svg(0, 112));
console.log("icon.svg");

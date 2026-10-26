/**
 * Rasterise the transparent favicon mark from the authored SVG.
 *
 * ★ THE SVG IS THE SOURCE OF TRUTH.
 *
 * `public/favicon.svg` carries one closed path per bracket. Forward-projecting
 * those arcs by hand into a raster produced rotated wedges, and no SVG
 * rasteriser is installed for Python. `sharp` renders the actual SVG through
 * librsvg, so what ships is what was drawn — no re-derived geometry to drift.
 *
 * ★ TRANSPARENCY IS THE POINT OF THIS SCRIPT.
 *
 * The old PNG/ICO siblings had an opaque `#120A07` backdrop baked in, which is
 * why the mark read as a black tile on a browser tab strip. The SVG now has no
 * backdrop rect, and every raster is rendered from it with alpha preserved.
 *
 * Usage:
 *   NODE_PATH="$MIMO_NODE_MODULES" node scripts/build/render-favicons.mjs
 */

import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const SVG = readFileSync(join(ROOT, 'public', 'favicon.svg'));

/** PNG targets: the tab icon, its 16px sibling, and the iOS home-screen tile. */
const PNG_TARGETS = [
  ['public/favicon-16.png', 16],
  ['public/favicon-32.png', 32],
  ['public/apple-touch-icon.png', 180],
  ['web/icons/apple-touch-icon.png', 180],
];

async function renderPng(target, size) {
  const out = join(ROOT, target);
  // `density` lifts the SVG's raster resolution before the resize, so the
  // lanczos downsample has real detail to work with at 16px.
  const buffer = await sharp(SVG, { density: Math.max(384, size * 8) })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await sharp(buffer).toFile(out);
  console.log(`wrote ${relative(ROOT, out)} (${size}x${size})`);
}

async function main() {
  for (const [target, size] of PNG_TARGETS) {
    await renderPng(target, size);
  }

  // ★ THE ICO IS GENERATED HERE TOO, SO THIS SCRIPT IS THE ONLY PATH.
  //
  // `sharp` has no ICO encoder, so the container is written by hand: an ICO is a
  // 6-byte header plus one 16-byte directory entry per image, each pointing at
  // an embedded PNG. Browsers have accepted PNG-in-ICO since Vista, and every
  // current one does, so the payloads are the same renders used above.
  const icoOut = join(ROOT, 'web', 'icons', 'favicon.ico');
  const sizes = [16, 32, 48];
  const images = [];

  for (const size of sizes) {
    images.push(
      await sharp(SVG, { density: Math.max(384, size * 8) })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
  }

  await writeFile(icoOut, buildIco(sizes, images));
  console.log(`wrote ${relative(ROOT, icoOut)} (${sizes.join('/')})`);
}

/**
 * Assemble PNG payloads into an ICO container.
 *
 * Layout: ICONDIR (6 bytes) then ICONDIRENTRY (16 bytes) per image, then the
 * image blobs in order. A `0` in the width/height byte means 256, which is why
 * only sizes below that are handled here.
 */
function buildIco(sizes, images) {
  const HEADER = 6;
  const ENTRY = 16;

  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(sizes.length, 4);

  const directory = Buffer.alloc(ENTRY * sizes.length);
  let offset = HEADER + ENTRY * sizes.length;

  sizes.forEach((size, index) => {
    const entry = index * ENTRY;
    const image = images[index];

    directory.writeUInt8(size, entry + 0); // width
    directory.writeUInt8(size, entry + 1); // height
    directory.writeUInt8(0, entry + 2); // palette size
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);

    offset += image.length;
  });

  return Buffer.concat([header, directory, ...images]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * The web favicon must have a TRANSPARENT background.
 *
 * ★ WHY THIS IS A TEST AND NOT A PREFERENCE.
 *
 * The shipped `favicon.svg` opened with a full-bleed
 * `<rect width="256" height="256" fill="#120A07"/>`. On a browser tab strip
 * that already draws its own chrome, a dark opaque tile renders as a small
 * black square with no relationship to the mark — the glyph is inset and the
 * surrounding fill reads as a separate shape.
 *
 * A backgroundless mark composites onto whatever surface it is placed on: a
 * light tab strip, a dark one, a bookmark bar, a pinned-tile. That is the whole
 * point of an SVG favicon over a raster one.
 *
 * The assertion is structural rather than pixel-based: no rectangle may cover
 * the full viewBox. A small decorative rect inside the mark stays legal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const FAVICON = 'public/favicon.svg';

function source(): string {
  return readFileSync(FAVICON, 'utf8');
}

test('no rect covers the whole favicon canvas', () => {
  // Arrange
  const svg = source();

  // Act — a full-bleed backdrop is a <rect> whose width and height match the
  // viewBox. That is the only node that can produce an opaque tile.
  const fullBleed = /<rect[^>]*width="256"[^>]*height="256"[^>]*\/?>/.test(svg);

  // Assert
  assert.equal(
    fullBleed,
    false,
    'the favicon still paints a full-canvas rect; the tab tile will render as a solid block',
  );
});

test('the mark survives the backdrop removal', () => {
  // Arrange
  const svg = source();

  // Act — the brand paths and the centre dot ARE the icon; a transparent
  // background must not be achieved by deleting the artwork.
  const paths = svg.match(/<path\b/g) ?? [];

  // Assert
  assert.ok(paths.length >= 2, 'the brand paths are missing — the favicon has no mark left');
  assert.match(svg, /<circle\b/, 'the centre dot is missing');
});

test('the mark still declares its brand fill', () => {
  // Arrange
  const svg = source();

  // Act / Assert — transparency is about the BACKDROP, not about dropping
  // colour from the glyph itself.
  assert.match(svg, /#FF7A2F/i, 'the brand orange is gone from the mark');
});

test('every multi-size PNG sibling is still declared for older surfaces', () => {
  // Arrange — older browsers and Windows shortcuts ignore SVG favicons.
  const html = readFileSync('app/+html.tsx', 'utf8');

  // Act / Assert
  assert.match(html, /favicon-32\.png/, 'the 32px PNG fallback is not linked');
  assert.match(html, /favicon-16\.png/, 'the 16px PNG fallback is not linked');
});

test('the raster siblings carry no opaque backdrop either', () => {
  // Arrange — fixing only the SVG left the bug in place for every browser that
  // prefers the PNG/ICO sibling, which is most of them.
  const pngs = ['public/favicon-16.png', 'public/favicon-32.png', 'public/apple-touch-icon.png'];

  // Act / Assert — a transparent corner pixel is the property that matters: an
  // opaque one means a backdrop was baked into the raster.
  for (const file of pngs) {
    const cornerAlpha = readCornerAlpha(file);
    assert.equal(cornerAlpha, 0, `${file} has an opaque background (corner alpha ${cornerAlpha})`);
  }
});

/**
 * The alpha value of a PNG's top-left pixel.
 *
 * ★ DECODED IN NODE, NOT VIA AN EXTERNAL TOOL.
 *
 * Shelling out to Pillow worked locally but would have failed the whole suite on
 * a CI runner without it — a test that only passes on the author's machine is
 * worse than no test. PNG is simple enough to read directly: walk the chunks,
 * concatenate the IDAT payload, inflate, and read the first pixel of the first
 * scanline (the filter byte is first, then RGBA).
 *
 * The images are 8-bit RGBA produced by our own render script, so only colour
 * type 6 / bit depth 8 needs supporting; anything else fails loudly.
 */
function readCornerAlpha(file: string): number {
  const buffer = readFileSync(file);

  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${file} is not a PNG`);
  }

  let offset = 8;
  let width = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      bitDepth = data.readUInt8(8);
      colourType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    // 4 length + 4 type + data + 4 CRC
    offset += 12 + length;
  }

  if (bitDepth !== 8 || colourType !== 6) {
    throw new Error(`${file}: expected 8-bit RGBA, got depth ${bitDepth} colour type ${colourType}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  // Scanline 0: one filter byte, then `width` RGBA pixels.
  const stride = 1 + width * 4;
  if (raw.length < stride) {
    throw new Error(`${file}: truncated image data`);
  }

  // Bytes 1..4 of scanline 0 are R,G,B,A of the top-left pixel.
  return raw.readUInt8(4);
}

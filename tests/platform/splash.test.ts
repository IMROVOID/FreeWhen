/**
 * The splash screen must exist, and must not be a white rectangle.
 *
 * ★ THE DEFECT THIS PINS, REPRODUCED ON THE EMULATOR.
 *
 * Cold-starting the release APK and screenshotting at 0.7 s and again at 1.5 s
 * produced no brand frame at all: the app was already on the Home skeleton. The
 * native splash resource WAS wired up — `Theme.App.SplashScreen` sets
 * `android:windowBackground` to `@drawable/splashscreen_logo` — but that PNG was a
 * FULLY OPAQUE WHITE SQUARE, so the launch frame was a full-screen white flash on
 * a dark app, over in a few frames. "The app is missing the splash screen" is
 * exactly what that looks like.
 *
 * The asset is the one thing here a human cannot check by reading code, so it is
 * decoded and measured rather than trusted:
 *
 *  - no fully-opaque white at the corners (that white square),
 *  - the pixels outside the mark are TRANSPARENT, so the window's own background
 *    colour is what the reader sees,
 *  - the app holds the splash long enough to be seen at all.
 *
 * PNG decoding is done here rather than by adding a dependency: the properties
 * needed are the colour type (alpha channel present) and the pixels, and the
 * codebase already avoids an image library in the test tree.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import { SPLASH_MIN_VISIBLE_MS } from '@/src/platform/splash-hold';

/** A decoded RGBA PNG: width, height and straight RGBA bytes. */
interface Decoded {
  width: number;
  height: number;
  data: Buffer;
}

/**
 * Decodes a non-interlaced PNG of bit depth 8 in colour types 2 (RGB) or 6
 * (RGBA) — which is what every asset in this repo is. Palette and 16-bit images
 * throw rather than being decoded wrongly.
 */
function decodePng(path: string): Decoded {
  const buf = readFileSync(path);
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${path} is not a PNG`,
  );

  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      colorType = body[9] ?? 0;
      const interlace = body[12];
      assert.equal(bitDepth, 8, `${path} must be 8-bit`);
      assert.equal(interlace, 0, `${path} must not be interlaced`);
      assert.ok(colorType === 2 || colorType === 6, `${path} must be RGB or RGBA`);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }

    pos += 12 + length;
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);

  // Undo the per-scanline filters (PNG spec §9). The previous scanline is the
  // one already reconstructed, which is why this runs top to bottom.
  let prev = new Uint8Array(stride);
  const at = (buf: Uint8Array, i: number): number => buf[i] ?? 0;

  for (let y = 0; y < height; y += 1) {
    const filter = at(raw, y * (stride + 1));
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));

    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? at(line, i - channels) : 0;
      const b = at(prev, i);
      const c = i >= channels ? at(prev, i - channels) : 0;
      const x = at(line, i);

      switch (filter) {
        case 0: break;
        case 1: line[i] = (x + a) & 0xff; break;
        case 2: line[i] = (x + b) & 0xff; break;
        case 3: line[i] = (x + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[i] = (x + pred) & 0xff;
          break;
        }
        default: assert.fail(`${path}: unknown filter ${filter}`);
      }
    }

    for (let x = 0; x < width; x += 1) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = at(line, s);
      out[d + 1] = at(line, s + 1);
      out[d + 2] = at(line, s + 2);
      out[d + 3] = channels === 4 ? at(line, s + 3) : 255;
    }

    prev = line;
  }

  return { width, height, data: out };
}

const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

function logoPath(density: string): string {
  return `android/app/src/main/res/drawable-${density}/splashscreen_logo.png`;
}

test('the splash logo exists at every density', () => {
  for (const density of DENSITIES) {
    const path = logoPath(density);
    assert.ok(existsSync(path), `${path} is missing`);
    assert.ok(statSync(path).size > 0, `${path} is empty`);
  }
});

test('the splash logo is not the opaque white square that shipped', () => {
  for (const density of DENSITIES) {
    const path = logoPath(density);
    const { width, height, data } = decodePng(path);

    const at = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
    };

    // The corners are outside the mark by construction, so they must be
    // transparent — that is what lets the window's own colour show through, and
    // it is precisely what the white square failed.
    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ] as const) {
      const [, , , alpha] = at(x, y);
      assert.equal(alpha, 0, `${path}: corner (${x},${y}) is opaque — a white flash on launch`);
    }

    // And the mark itself must be present: a fully transparent image is a blank
    // splash, which is the other way this can look broken.
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 32) opaque += 1;
    const coverage = opaque / (width * height);
    assert.ok(coverage > 0.02, `${path}: only ${(coverage * 100).toFixed(1)}% of the image is drawn`);
    assert.ok(coverage < 0.9, `${path}: ${(coverage * 100).toFixed(1)}% is drawn — that is a fill, not a mark`);
  }
});

test('the launch window is the splash colour, so no frame is white', () => {
  // Arrange
  const styles = readFileSync('android/app/src/main/res/values/styles.xml', 'utf8');
  const app = readFileSync('app.json', 'utf8');

  // Act — the configured background, and the colour the splash layer-list paints.
  const configured = /"splash"\s*:\s*\{[^}]*"backgroundColor"\s*:\s*"(#[0-9A-Fa-f]{6})"/.exec(app);
  const colors = readFileSync('android/app/src/main/res/values/colors.xml', 'utf8');

  // Assert — the theme's window background is the splash colour, not a drawable
  // that could carry its own (white) fill.
  assert.ok(configured, 'app.json declares no splash background colour');
  assert.match(
    styles,
    /Theme\.App\.SplashScreen/,
    'the splash theme is gone; the launch window would use the app theme',
  );
  assert.match(
    styles,
    /splashscreen_background|splash_background|windowSplashScreenBackground/,
    'the splash theme does not paint the splash colour',
  );
  assert.match(colors, /splash_background|splashscreen_background/, 'no splash colour resource');
});

test('the app holds the splash long enough to be seen', () => {
  // Arrange
  const layout = readFileSync('app/_layout.tsx', 'utf8');

  // Assert — a hold of zero is "there is no splash", whatever the asset says.
  assert.ok(SPLASH_MIN_VISIBLE_MS >= 300, 'the minimum hold is too short to register');
  assert.match(layout, /SPLASH_MIN_VISIBLE_MS/, 'the root layout does not apply the minimum hold');
  assert.match(layout, /splashHeldUntil|holdSplash/, 'the hold is not measured from module scope');
});

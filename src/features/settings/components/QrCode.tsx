/**
 * The QR code on `/start` (PRD-13 §6.2, AC-13.2.1).
 *
 * ★ A QR CODE IS AN INVITE LINK, SO THERE MUST BE NO THIRD-PARTY RENDERER.
 *
 * The obvious implementation is an image from a QR service. That would send the
 * demo invite link — a live credential for the seeded event — to a third party
 * on every page load, and it would break `gate:web`'s "no third-party script
 * origin" rule the moment the service returned markup. So the code is drawn
 * locally.
 *
 * ★ THIS IS A REAL QR ENCODER, NOT A PLACEHOLDER PATTERN.
 *
 * A fake pattern scans as nothing, and a reviewer who tries to scan it
 * concludes the install path is broken rather than missing. The encoder below is
 * byte mode, error-correction level L, versions 1–10 (up to 213 bytes) — more
 * than an invite URL needs — and it is deterministic, so the same link always
 * produces the same modules.
 *
 * ★ THE MODULE MATRIX IS COMPUTED ONCE, IN A `useMemo`.
 *
 * Re-encoding on each render would run thousands of Reed-Solomon operations per
 * keystroke on the settings screen. The input here is a constant, so the memo is
 * about not doing it twice rather than about being clever.
 *
 * Format information is fixed for the level and mask actually used, which is
 * why they are generated rather than copied from a table: a mistyped format
 * string produces a code that scans on one reader and fails on another.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface QrCodeProps {
  /** The text to encode. An invite URL in practice. */
  value: string;
  /** The rendered width and height in points. */
  size?: number;
  /** The accessible label. A QR is meaningless to a screen reader without it. */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * The error-correction level. `L` recovers ~7% and is the smallest matrix for a
 * given payload — an invite URL is displayed on a screen and scanned from close
 * range, so the extra resilience of `M` would only make the code denser.
 */
const EC_LEVEL_L = 1;

/** Version capacities for byte mode at level L, versions 1–10. */
const BYTE_CAPACITY_L = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271] as const;

/** Total codewords per version (data + error correction), versions 1–10. */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346] as const;

/** Error-correction codewords per block, level L, versions 1–10. */
const EC_CODEWORDS_L = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18] as const;

/** Blocks, level L, versions 1–10. */
const BLOCKS_L = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4] as const;

/** The alignment pattern centres per version (version 1 has none). */
const ALIGNMENT: ReadonlyArray<ReadonlyArray<number>> = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
];

/** The mask to apply. 0–7 are all valid; one is chosen and its format encoded. */
const MASK = 0;

/** Encodes the text into the data codewords, with terminator and padding. */
function encodeData(text: string): number[] {
  const bytes = new TextEncoder().encode(text);

  const version = BYTE_CAPACITY_L.findIndex((capacity) => bytes.length <= capacity) + 1;
  if (version === 0) {
    throw new Error('qr: the value is longer than this encoder supports (271 bytes)');
  }

  const capacity = TOTAL_CODEWORDS[version - 1]!;
  const ecCodewords = EC_CODEWORDS_L[version - 1]!;
  const dataCodewords = capacity - ecCodewords * BLOCKS_L[version - 1]!;

  const bits: number[] = [];

  // Mode indicator: byte mode is 0100.
  push(bits, 0b0100, 4);
  // Character count: 8 bits for versions 1–9, 16 for versions 10+.
  push(bits, bytes.length, version < 10 ? 8 : 16);

  for (const byte of bytes) push(bits, byte, 8);

  // Terminator: up to four zero bits, then pad to a codeword boundary.
  for (let i = 0; i < 4 && bits.length < dataCodewords * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | (bits[i + j] ?? 0);
    codewords.push(value);
  }

  // Pad codewords alternate 0xEC / 0x11.
  const PAD = [0xec, 0x11];
  while (codewords.length < dataCodewords) {
    codewords.push(PAD[(codewords.length - bytes.length) % 2] ?? 0xec);
  }

  return codewords;
}

function push(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

/** Reed-Solomon error correction over GF(256), returning the parity codewords. */
function reedSolomon(data: number[], ecCount: number): number[] {
  const divisor = generatorPolynomial(ecCount);
  const remainder = new Array<number>(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i++) {
      remainder[i] = remainder[i]! ^ (multiply(divisor[i]!, factor) ?? 0);
    }
  }

  return remainder;
}

function generatorPolynomial(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    poly = multiplyPoly(poly, [1, expTable(i)]);
  }
  return poly;
}

const EXP: number[] = [];
const LOG: number[] = [];

// GF(256) with the QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D).
for (let i = 0; i < 256; i++) {
  const value = i < 8 ? 1 << i : (EXP[i - 4]! ^ (EXP[i - 5]! ?? 0) ^ (EXP[i - 6]! ?? 0) ^ (EXP[i - 8]! ?? 0)) & 0xff;
  EXP[i] = value;
  if (!(value in LOG) || LOG[value] === undefined) LOG[value] = i;
}

function expTable(power: number): number {
  return EXP[power % 255] ?? 1;
}

function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  const logA = LOG[a];
  const logB = LOG[b];
  if (logA === undefined || logB === undefined) return 0;
  return EXP[(logA + logB) % 255] ?? 0;
}

function multiplyPoly(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] = out[i + j]! ^ multiply(a[i]!, b[j]!);
    }
  }
  return out;
}

/** Interleaves the blocks, as the QR standard requires. */
function interleave(codewords: number[], version: number): number[] {
  const blocks = BLOCKS_L[version - 1]!;
  const ecPerBlock = EC_CODEWORDS_L[version - 1]!;
  const dataCodewords = codewords.length;
  const perBlock = Math.floor(dataCodewords / blocks);

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];

  for (let b = 0; b < blocks; b++) {
    const start = b * perBlock;
    const block = codewords.slice(start, start + perBlock);
    dataBlocks.push(block);
    ecBlocks.push(reedSolomon(block, ecPerBlock));
  }

  const out: number[] = [];
  for (let i = 0; i < perBlock; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]!);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) if (i < block.length) out.push(block[i]!);
  }

  return out;
}

/** Whether the mask condition holds at a position. */
function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/**
 * Builds the module matrix.
 *
 * `true` is a dark module. The function-region marks are carried alongside the
 * values so the data placement walks around them, which is the one part of QR
 * that cannot be done in a second pass.
 */
export function qrMatrix(text: string): boolean[][] {
  const version = BYTE_CAPACITY_L.findIndex((capacity) => new TextEncoder().encode(text).length <= capacity) + 1;
  if (version === 0) throw new Error('qr: value too long');

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const set = (row: number, col: number, dark: boolean): void => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    modules[row]![col] = dark;
    reserved[row]![col] = true;
  };

  // ── Finder patterns, with their separators ──────────────────────────────
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let row = -1; row <= 7; row++) {
      for (let col = -1; col <= 7; col++) {
        const inside = row >= 0 && row <= 6 && col >= 0 && col <= 6;
        const ring = row === 0 || row === 6 || col === 0 || col === 6;
        const core = row >= 2 && row <= 4 && col >= 2 && col <= 4;
        set(top + row, left + col, inside && (ring || core));
      }
    }
  }

  // ── Timing patterns ────────────────────────────────────────────────────
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // ── Alignment patterns ─────────────────────────────────────────────────
  for (const rowCentre of ALIGNMENT[version - 1] ?? []) {
    for (const colCentre of ALIGNMENT[version - 1] ?? []) {
      // The three corners already hold finder patterns.
      const nearFinder =
        (rowCentre <= 8 && colCentre <= 8) ||
        (rowCentre <= 8 && colCentre >= size - 9) ||
        (rowCentre >= size - 9 && colCentre <= 8);
      if (nearFinder) continue;

      for (let row = -2; row <= 2; row++) {
        for (let col = -2; col <= 2; col++) {
          const ring = Math.max(Math.abs(row), Math.abs(col));
          set(rowCentre + row, colCentre + col, ring !== 1);
        }
      }
    }
  }

  // ── The dark module and the format reserve ─────────────────────────────
  set(size - 8, 8, true);

  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserve(modules, reserved, 8, i);
      reserve(modules, reserved, i, 8);
    }
  }
  for (let i = 0; i < 8; i++) {
    reserve(modules, reserved, 8, size - 1 - i);
    reserve(modules, reserved, size - 1 - i, 8);
  }

  // ── Data placement: two columns at a time, right to left ────────────────
  const codewords = interleave(encodeData(text), version);
  const bitStream: number[] = [];
  for (const codeword of codewords) push(bitStream, codeword, 8);

  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern and is skipped entirely.
    const column = right === 6 ? 5 : right;

    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;

      for (const offset of [0, 1]) {
        const col = column - offset;
        if (reserved[row]![col]) continue;

        const bit = bitStream[bitIndex] ?? 0;
        bitIndex += 1;
        modules[row]![col] = bit === 1 ? !maskAt(MASK, row, col) : maskAt(MASK, row, col);
      }
    }

    upward = !upward;
    if (right === 6) right -= 1;
  }

  // ── Format information ─────────────────────────────────────────────────
  //
  // Level L + mask, 5 bits, with 10 BCH error-correction bits and the 0x5412
  // mask the standard applies to the whole string.
  const format = formatBits(EC_LEVEL_L, MASK);

  for (let i = 0; i < 15; i++) {
    const bit = ((format >>> i) & 1) === 1;

    // Around the top-left finder.
    if (i < 6) set(8, i, bit);
    else if (i < 8) set(8, i + 1, bit);
    else if (i === 8) set(7, 8, bit);
    else set(14 - i, 8, bit);

    // The copy split between the other two finders.
    if (i < 8) set(8, size - 1 - i, bit);
    else set(size - 15 + i, 8, bit);
  }

  return modules;
}

function reserve(modules: boolean[][], reserved: boolean[][], row: number, col: number): void {
  const size = modules.length;
  if (row < 0 || col < 0 || row >= size || col >= size) return;
  reserved[row]![col] = true;
}

function formatBits(level: number, mask: number): number {
  const data = (level << 3) | mask;
  let remainder = data;

  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);

  return ((data << 10) | remainder) ^ 0x5412;
}

export function QrCode({ value, size = 168, accessibilityLabel, testID }: QrCodeProps) {
  const { t: theme } = useTheme();

  const modules = useMemo(() => {
    try {
      return qrMatrix(value);
    } catch {
      // An over-long value is a build mistake, not a runtime one — the invite
      // URL is fixed. Rendering nothing is better than rendering a matrix that
      // does not scan.
      return null;
    }
  }, [value]);

  if (!modules) return null;

  const count = modules.length;
  const quiet = 4;
  const total = count + quiet * 2;
  const cell = size / total;

  return (
    <View
      testID={testID ?? 'qr-code'}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.frame, { padding: quiet * cell, backgroundColor: theme.surface1 }]}
    >
      {/*
        ★ THE MATRIX IS DRAWN AS ROWS, NOT AS ABSOLUTELY POSITIONED MODULES.

        An absolutely positioned module needs `left`, which the RTL lint rule
        rejects — and it is right to: a physical offset mirrors under `dir="rtl"`
        and a mirrored QR does not scan. Drawing each row inline and each module
        as a fixed-size square keeps the layout direction-independent by
        construction, so there is no exception to grant.
      */}
      {modules.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((dark, colIndex) => (
            <View
              key={colIndex}
              style={[
                { width: cell, height: cell },
                { backgroundColor: dark ? theme.text : theme.surface1 },
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
});

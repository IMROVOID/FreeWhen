/**
 * What the bridge actually delivers to the map document.
 *
 * ★ TWO REPORTED DEFECTS, ONE ROOT CAUSE: `data` WAS NEVER AN OBJECT.
 *
 * The app sends `JSON.stringify(JSON.stringify(payload))` inside injected source, so
 * the document's `__apply` receives JSON TEXT. It used to open with a bare
 * `JSON.parse(payload)` — and that parse SUCCEEDED, because `"{\"lines\":…}"` is a
 * valid JSON string literal. It returned the inner string instead of the object, so
 * `data.lines`, `data.markers`, `data.circles`, `data.accent` and `data.camera` were
 * all `undefined` and every guarded write was skipped.
 *
 * On a device that read as:
 *
 *  - the route line drawn in the casing's near-black instead of the origin's teal,
 *    because `setData` was never called with the new feature collection;
 *  - the picker's pin drawn black instead of the theme's colour, because the marker's
 *    `color` never arrived;
 *  - and a map that only ever showed what the document was built with.
 *
 * The browser was always fine: it shares no bridge.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { ORIGIN_COLOR } from '@/src/features/map/origin';
import { linesFeatureCollection } from '@/src/features/map/projection';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const NATIVE = code('src/components/ui/InteractiveMap.native.tsx');
const WEB = code('src/components/ui/InteractiveMap.web.tsx');

/**
 * The document's `__apply`, transcribed.
 *
 * Kept in step with the source by the assertions below, which is what makes this an
 * executable specification rather than a copy someone will forget to update.
 */
function applyAsDocument(payload: string): Record<string, unknown> | null {
  let data: unknown = payload;

  for (let depth = 0; depth < 2 && typeof data === 'string'; depth += 1) {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }

  if (!data || typeof data !== 'object') return null;
  return data as Record<string, unknown>;
}

/** The argument the injected script actually passes. */
function bridged(payload: unknown): string {
  const script = `window.__apply(${JSON.stringify(JSON.stringify(payload))}); true;`;
  return script.slice('window.__apply('.length, script.length - '); true;'.length);
}

/* ── The defect ───────────────────────────────────────────────────────────── */

test('a double-encoded payload now arrives as an object', () => {
  // Arrange — exactly what the app sends.
  const payload = {
    lines: linesFeatureCollection([
      { id: 'route', points: [[51.39, 35.68], [51.41, 35.75]], color: ORIGIN_COLOR },
    ]),
    markers: [{ id: 'origin', color: ORIGIN_COLOR, shape: 'circle' }],
    accent: '#D4FF3A',
  };

  // Act
  const data = applyAsDocument(bridged(payload));

  // Assert — the object, not the string it was carried in.
  assert.notEqual(data, null);
  assert.equal(typeof data, 'object');
  assert.deepEqual(data!.lines, payload.lines);
  assert.deepEqual(data!.markers, payload.markers);
  assert.equal(data!.accent, '#D4FF3A');
});

test('a bare parse of the same payload yields a STRING, which was the bug', () => {
  // Arrange
  const payload = { lines: { type: 'FeatureCollection', features: [] } };

  // Act — the old `var data = JSON.parse(payload);`, verbatim.
  const naive = JSON.parse(bridged(payload)) as unknown;

  // Assert — it does not throw; it quietly hands back a string, so every
  // `data.lines && …` guard downstream was false.
  assert.equal(typeof naive, 'string');
  assert.equal((naive as Record<string, unknown>).lines, undefined);
});

test('a single-encoded payload also works, so neither caller can be wrong', () => {
  // Act
  const data = applyAsDocument(JSON.stringify({ accent: '#0E7C86' }));

  // Assert
  assert.equal(data?.accent, '#0E7C86');
});

test('a malformed payload is refused rather than half-applied', () => {
  assert.equal(applyAsDocument('{not json'), null);
  assert.equal(applyAsDocument('"a string that is not json"'), null);
  assert.equal(applyAsDocument('42'), null);
});

test('the document unwraps the string instead of parsing once', () => {
  // Assert — the mechanism, in the source.
  assert.match(NATIVE, /typeof data === 'string'/, 'the string payload is never unwrapped');
  assert.match(NATIVE, /for \(var depth = 0; depth < 2 && typeof data === 'string'/);
  assert.match(NATIVE, /if \(!data \|\| typeof data !== 'object'\) return;/);
});

test('a payload that will not parse is REPORTED, not swallowed', () => {
  // Assert — a silent return here is how the original defect stayed invisible.
  assert.match(NATIVE, /type: 'unavailable', reason: 'payload: '/);
});

/* ── The two things the report saw ────────────────────────────────────────── */

test('the route line is set from the payload, in the origin colour', () => {
  // Arrange
  const payload = {
    lines: linesFeatureCollection([
      { id: 'route', points: [[51.39, 35.68], [51.41, 35.75]], color: ORIGIN_COLOR },
    ]),
  };

  // Act
  const data = applyAsDocument(bridged(payload)) as {
    lines: { features: Array<{ properties: { color: string } }> };
  };

  // Assert — a colour on the feature, not the casing's near-black.
  assert.equal(data.lines.features.length, 1);
  assert.equal(data.lines.features[0]!.properties.color, ORIGIN_COLOR);
});

test('the picker’s pin carries the theme colour through the bridge', () => {
  // Arrange — the marker `LocationMapPicker` emits.
  const payload = {
    markers: [{ id: 'picked', color: '#D4FF3A', selected: true, label: 'x' }],
  };

  // Act
  const data = applyAsDocument(bridged(payload)) as {
    markers: Array<{ color: string }>;
  };

  // Assert
  assert.equal(data.markers[0]!.color, '#D4FF3A');
});

test('both renderers paint a marker from its own colour first', () => {
  // Assert — the fallback exists for a marker that names no colour; it must never
  // take precedence over one that does.
  assert.match(NATIVE, /marker\.color \|\| accent/);
  assert.match(WEB, /marker\.color \?\? accent/);
});

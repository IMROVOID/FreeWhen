/**
 * The external-map link for a proposal's venue (Plan 49 T15).
 *
 * ★ `geo:` IS THE SCHEME THAT RESPECTS THE DEVICE'S MAP APP.
 *
 * An https Google link forces one vendor and, on a phone without the app, opens a
 * browser rather than a map. `geo:` routes to whichever application the person
 * actually uses, with https kept as a fallback for a platform with no handler.
 *
 * ★ COORDINATES, NOT A NAME.
 *
 * `share-plan.ts` searches by venue NAME because the share text carries only a
 * name. A proposal carries `lat`/`lng`, so the pin lands on the exact place rather
 * than on whatever a name search ranks first.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { geoUri, httpsMapUrl, isPlausible } from '@/src/features/proposals/services/map-uri';

const TEHRAN = { name: 'Café Nezam', lat: 35.7, lng: 51.4 };

test('the geo URI carries the coordinates and a label', () => {
  // Act
  const uri = geoUri(TEHRAN);

  // Assert — `geo:lat,lng?q=lat,lng(label)` is the documented form.
  assert.equal(uri, 'geo:35.7,51.4?q=35.7,51.4(Caf%C3%A9%20Nezam)');
});

test('a name with a comma or parenthesis is still encoded', () => {
  // Arrange — a venue name is free text, and both characters are structural in
  // the geo URI's label component.
  const awkward = { name: 'Café (down, stairs)', lat: 35.7, lng: 51.4 };

  // Act
  const uri = geoUri(awkward);

  // Assert — the parentheses and comma in the label are escaped, so the URI does
  // not become malformed.
  assert.ok(uri.includes('%2C'), 'the comma is not encoded');
  assert.ok(uri.includes('%28'), 'the opening parenthesis is not encoded');
  assert.ok(uri.includes('%29'), 'the closing parenthesis is not encoded');
  assert.ok(uri.endsWith(')'), 'the label group is not closed');
});

test('the https fallback pins the coordinate pair, not a search phrase', () => {
  // Act
  const url = httpsMapUrl(TEHRAN);

  // Assert
  assert.equal(url, 'https://maps.google.com/?q=35.7,51.4');
});

test('a plausible coordinate is accepted', () => {
  // Act / Assert
  assert.equal(isPlausible(TEHRAN), true);
  assert.equal(isPlausible({ name: 'x', lat: -33.86, lng: 151.21 }), true);
});

test('null island is not a place', () => {
  // ★ (0, 0) is what a missing coordinate becomes when it is coerced to a number.
  // Opening a map in the Gulf of Guinea is worse than not opening one.
  assert.equal(isPlausible({ name: 'x', lat: 0, lng: 0 }), false);
});

test('a coordinate outside the valid range is rejected', () => {
  // Act / Assert
  assert.equal(isPlausible({ name: 'x', lat: 91, lng: 0 }), false);
  assert.equal(isPlausible({ name: 'x', lat: 0, lng: 181 }), false);
});

test('a non-finite coordinate is rejected rather than rendered as NaN', () => {
  // Act / Assert — a `NaN` in a URL produces `geo:NaN,NaN`, which no handler
  // accepts and which reads as a broken button.
  assert.equal(isPlausible({ name: 'x', lat: Number.NaN, lng: 51.4 }), false);
});


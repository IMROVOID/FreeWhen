import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  digitLocale,
  fontScaleCap,
  resolveColor,
  resolveType,
  resolveWeight,
  SCALE,
} from '@/src/theme/type-scale';
import { digits } from '@/src/lib/format';

const PALETTE = {
  text: '#FFF6EF',
  textMuted: '#C2AEA2',
  primary: '#D4FF3A',
};

test('zeroes letterSpacing for Persian content', () => {
  // Act
  const persian = resolveType('سلام دنیا', 'h1');
  const latin = resolveType('Hello world', 'h1');

  // Assert
  assert.equal(persian.letterSpacing, 0);
  assert.equal(latin.letterSpacing, SCALE.h1.tracking);
});

test('applies the +1px size adjustment to Persian', () => {
  // Act
  const persian = resolveType('سلام', 'body');
  const latin = resolveType('hello', 'body');

  // Assert
  assert.equal(persian.fontSize, SCALE.body.size + 1);
  assert.equal(latin.fontSize, SCALE.body.size);
});

test('applies the +0.12 Persian line-height ratio to the base RATIO', () => {
  // Arrange — the rule is "+0.12 to line height ratio", so the base ratio
  // is adjusted, not the base line height.
  const base = SCALE.body;
  const baseRatio = base.lineHeight / base.size;

  // Act
  const persian = resolveType('سلام', 'body');

  // Assert
  assert.equal(persian.lineHeight, Math.round(base.size * (baseRatio + 0.12)));
  assert.equal(persian.lineHeight, 24);
});

test('uses the base line height unchanged for Latin content', () => {
  // Act / Assert
  assert.equal(resolveType('hello', 'body').lineHeight, SCALE.body.lineHeight);
});

test('reports the content script', () => {
  // Act / Assert
  assert.equal(resolveType('سلام').isPersian, true);
  assert.equal(resolveType('hello').isPersian, false);
  // Mixed content takes the dominant script.
  assert.equal(resolveType('hello سلام').isPersian, true);
});

test('caps the font scale at 1.3 for headings and 1.5 for body', () => {
  // Act / Assert
  assert.equal(fontScaleCap('display'), 1.3);
  assert.equal(fontScaleCap('h1'), 1.3);
  assert.equal(fontScaleCap('h2'), 1.3);
  assert.equal(fontScaleCap('h3'), 1.3);
  assert.equal(fontScaleCap('numeral'), 1.3);
  assert.equal(fontScaleCap('body'), 1.5);
  assert.equal(fontScaleCap('bodyL'), 1.5);
  assert.equal(fontScaleCap('caption'), 1.5);
  assert.equal(fontScaleCap('button'), 1.5);
});

test('resolves the weight from the variant unless overridden', () => {
  // Act / Assert
  assert.equal(resolveWeight('h1'), 800);
  assert.equal(resolveWeight('body'), 500);
  assert.equal(resolveWeight('h1', 500), 500);
});

test('resolves a theme colour key against the palette', () => {
  // Act / Assert
  assert.equal(resolveColor('textMuted', PALETTE, PALETTE.text), PALETTE.textMuted);
  assert.equal(resolveColor('primary', PALETTE, PALETTE.text), PALETTE.primary);
});

test('passes a literal colour through unchanged', () => {
  // Act / Assert
  assert.equal(resolveColor('#FF0000', PALETTE, PALETTE.text), '#FF0000');
});

test('falls back to the default colour when none is given', () => {
  // Act / Assert
  assert.equal(resolveColor(undefined, PALETTE, PALETTE.text), PALETTE.text);
});

test('the digit locale follows the language, not the content script', () => {
  // Act / Assert
  assert.equal(digitLocale('en'), 'en');
  assert.equal(digitLocale('fa'), 'fa');
  assert.equal(digitLocale('fr'), 'fa');

  // A Persian string in an English app still shows Latin digits.
  assert.equal(digits('۱۸', 'en'), '۱۸');
  assert.equal(digits('۱۸', 'fa'), '۱۸');
  assert.equal(digits('18', 'en'), '18');
});

test('a numeric child is rendered, not swallowed', () => {
  // Arrange — the content is stringified, so a number is not empty
  const content = String(18);

  // Act / Assert
  assert.equal(content, '18');
  assert.equal(digits(content, 'fa'), '۱۸');
});

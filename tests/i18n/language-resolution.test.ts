import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveLanguageFrom } from '@/src/i18n/resolve';
import { initI18n } from '@/src/i18n';

initI18n('fa');

test('defaults to Persian when no preference is stored', () => {
  // Arrange
  const input = { stored: null, deviceLanguageCode: undefined };

  // Act
  const resolved = resolveLanguageFrom(input);

  // Assert
  assert.equal(resolved, 'fa');
});

test('never infers English from an English device', () => {
  // Arrange — an English phone
  const input = { stored: null, deviceLanguageCode: 'en' };

  // Act
  const resolved = resolveLanguageFrom(input);

  // Assert — an Iranian user with an English phone starts in Persian
  // (PRD-10 D11, OQ-15.4)
  assert.equal(resolved, 'fa');
});

test('uses Persian when the device is Persian', () => {
  // Arrange
  const input = { stored: null, deviceLanguageCode: 'fa' };

  // Act / Assert
  assert.equal(resolveLanguageFrom(input), 'fa');
});

test('honours a stored English preference', () => {
  // Arrange
  const input = { stored: 'en' as const, deviceLanguageCode: 'fa' };

  // Act
  const resolved = resolveLanguageFrom(input);

  // Assert — the preference wins over the device
  assert.equal(resolved, 'en');
});

test('honours a stored Persian preference on an English device', () => {
  // Arrange
  const input = { stored: 'fa' as const, deviceLanguageCode: 'en' };

  // Act / Assert
  assert.equal(resolveLanguageFrom(input), 'fa');
});

test('tolerates a device with no readable locale', () => {
  // Arrange
  const input = { stored: null, deviceLanguageCode: undefined };

  // Act / Assert
  assert.equal(resolveLanguageFrom(input), 'fa');
});

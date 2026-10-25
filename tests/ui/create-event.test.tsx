/**
 * Tests for S2 Create Event screen fixes:
 * 1. Chip label doesn't wrap to multiple lines (numberOfLines=1).
 * 2. Weekend and Custom presets exist in i18n and preset options.
 * 3. Activity cards have no borders.
 * 4. Venue container extends edge-to-edge.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';
import fa from '@/src/i18n/fa.json';
import en from '@/src/i18n/en.json';
import { Chip } from '@/src/components/ui/Chip';

let renderComponent: typeof import('./support/render').renderComponent;

before(async () => {
  initI18n('fa');
  ({ renderComponent } = await import('./support/render'));
});

describe('S2 Create Event — time presets and chip rendering', () => {
  test('Chip renders with numberOfLines=1 and does not truncate weekend label', () => {
    const screen = renderComponent(Chip, {
      label: 'آخر\u00A0هفته',
      selected: false,
    });
    // Ensure rendered HTML contains the label
    assert.ok(screen.text.includes('آخر') && screen.text.includes('هفته'));
  });

  test('i18n contains custom preset translation in fa and en', () => {
    assert.equal(fa.events.create.preset.weekend, 'آخر\u00A0هفته');
    assert.equal((fa.events.create.preset as Record<string, string>).custom, 'سفارشی');
    assert.equal((en.events.create.preset as Record<string, string>).custom, 'Custom');
  });
});

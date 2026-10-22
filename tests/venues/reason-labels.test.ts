/**
 * Reasons and enum labels, per locale (Plan 08 Task 9a, PRD-05 §11.1).
 *
 * ★ THE ASSERTION THAT MATTERS: NO PAYLOAD STRING IS EVER DISPLAYED RAW.
 *
 * A reason arrives as `{templateId, params}`. Printed as a string it says
 * `[object Object]`, and rendered with a pre-baked number it can never be
 * re-localised. These tests pin the only supported path.
 *
 * ★ NAMES ARE DATA. They stay identical in both locales.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatCost,
  formatMinutesWithUnit,
  formatRangeWithUnit,
  hasReason,
  renderExclusion,
  renderReason,
  renderReasonOrEmpty,
} from '../../src/features/venues/services/reason-render';
import {
  ACCESSIBILITY_KEY,
  labelKey,
  LENS_MEANING_KEY,
  LENS_ORDER,
  lensKey,
  MODE_KEY,
  UNKNOWN_KEY,
} from '../../src/features/venues/services/labels';
import { initI18n, translatorFor } from '../../src/i18n';

// The catalogue is read through i18next, which must be initialised before the
// fixed translators resolve — `initAsync: false` makes it synchronous.
initI18n('fa');

describe('reason rendering', () => {
  test('a balanced_floor reason renders the minute figure in the locale digit set', () => {
    // Arrange
    const reason = { templateId: 'balanced_floor' as const, params: { floorMinutes: 18 } };

    // Act
    const fa = renderReason(reason, 'fa');
    const en = renderReason(reason, 'en');

    // Assert — the same number, two digit sets, one source.
    assert.match(fa, /۱۸/);
    assert.match(en, /18/);
    assert.doesNotMatch(fa, /\[object Object\]/);
    assert.doesNotMatch(en, /\[object Object\]/);
  });

  test('a nested reason resolves recursively', () => {
    // Arrange — `with_coverage_gap` wraps a base reason in `{{base}}`.
    const reason = {
      templateId: 'with_coverage_gap' as const,
      params: {
        n: 2,
        base: { templateId: 'balanced_floor' as const, params: { floorMinutes: 18 } },
      },
    };

    // Act
    const rendered = renderReason(reason, 'fa');

    // Assert — both halves are present, and neither printed an object.
    assert.match(rendered, /۱۸/);
    assert.match(rendered, /۲/);
    assert.doesNotMatch(rendered, /\[object Object\]/);
  });

  test('an unknown template degrades without throwing', () => {
    // Arrange — a template id from a newer server.
    const reason = {
      templateId: 'a_template_that_does_not_exist' as never,
      params: {},
    };

    // Act
    const rendered = renderReason(reason, 'fa');

    // Assert — the fallback sentence, not a crash and not the raw key.
    assert.ok(rendered.length > 0);
    assert.doesNotMatch(rendered, /^reason\./);
  });

  test('a null cost parameter renders the unknown word, not a zero', () => {
    // Arrange — an unknown cost must never read as free (PRD-05 §8).
    const reason = { templateId: 'cheapest_total' as const, params: { totalCostIrr: null } };

    // Act
    const rendered = renderReason(reason, 'fa');

    // Assert
    assert.match(rendered, /نامشخص/);
    assert.doesNotMatch(rendered, /۰ تومان/);
  });

  test('participant names pass through unchanged in both locales', () => {
    // Arrange — a name is data.
    const reason = {
      templateId: 'accessibility_no_confirm' as const,
      params: { participantName: 'داریا' },
    };

    // Act
    const fa = renderReason(reason, 'fa');
    const en = renderReason(reason, 'en');

    // Assert
    assert.match(fa, /داریا/);
    assert.match(en, /داریا/);
  });
});

describe('exclusions name the person', () => {
  test('an accessibility exclusion names who it affected', () => {
    // Arrange
    const exclusion = {
      venueId: 'v1',
      reason: 'accessibility' as const,
      participantId: 'p1',
      detail: {
        templateId: 'excluded' as const,
        params: { participantName: 'داریا' },
      },
    };

    // Act
    const rendered = renderExclusion(exclusion, 'fa');

    // Assert — plain language naming the person, not a code (AC-4.3.1).
    assert.match(rendered, /داریا/);
    assert.match(rendered, /حذف/);
  });

  test('a venue-scoped exclusion takes the caller-supplied name', () => {
    // Arrange — the template has no name, so the caller's fills in.
    const exclusion = {
      venueId: 'v1',
      reason: 'travel_budget' as const,
      participantId: 'p1',
      detail: {
        templateId: 'accessibility_no_confirm' as const,
        params: {},
      },
    };

    // Act
    const rendered = renderExclusion(exclusion, 'fa', 'بهار');

    // Assert
    assert.match(rendered, /بهار/);
  });
});

describe('hasReason', () => {
  test('null and an empty template both mean "no reason"', () => {
    assert.equal(hasReason(null), false);
    assert.equal(hasReason(undefined), false);
    assert.equal(renderReasonOrEmpty(null, 'fa'), '');
    assert.equal(hasReason({ templateId: 'balanced_mean', params: {} }), true);
  });
});

describe('figures carry their unit', () => {
  test('a single figure and a range both name the unit from the catalogue', () => {
    // Act
    const single = formatMinutesWithUnit(18, 'fa');
    const range = formatRangeWithUnit(22, 35, 'fa');
    const singleEn = formatMinutesWithUnit(18, 'en');

    // Assert
    assert.match(single, /۱۸/);
    assert.match(single, /دقیقه/);
    assert.match(range, /۲۲/);
    assert.match(range, /۳۵/);
    // The range is a range — never collapsed to one number.
    assert.match(range, /–/);
    assert.match(singleEn, /18/);
  });

  test('a null cost renders the unknown word, a known one renders the amount', () => {
    // Act
    const unknown = formatCost(null, 'fa');
    const known = formatCost(15000, 'fa');

    // Assert
    assert.match(unknown, /نامشخص/);
    assert.match(known, /۱۵٬۰۰۰/);
  });
});

describe('enum labels are localised, tokens are not translated server-side', () => {
  test('every transport mode has a key in both catalogues', () => {
    for (const mode of ['car', 'transit', 'walk', 'cycle', 'taxi'] as const) {
      const key = MODE_KEY[mode];
      const fa = translatorFor('fa')(key);
      const en = translatorFor('en')(key);

      assert.notEqual(fa, key, `${key} missing from fa`);
      assert.notEqual(en, key, `${key} missing from en`);
      assert.notEqual(fa, en, `${key} is identical in both locales`);
    }
  });

  test('every lens has a name and a plain meaning in both locales', () => {
    for (const lens of LENS_ORDER) {
      const nameKey = lensKey(lens);
      const meaningKey = LENS_MEANING_KEY[lens];

      assert.notEqual(translatorFor('fa')(nameKey), nameKey);
      assert.notEqual(translatorFor('en')(nameKey), nameKey);
      // The meaning is a separate sentence, not a repeat of the name.
      assert.notEqual(translatorFor('fa')(meaningKey), translatorFor('fa')(nameKey));
      assert.notEqual(translatorFor('en')(meaningKey), meaningKey);
    }
  });

  test('accessibility is tri-state, and unknown never reads as accessible', () => {
    // Arrange
    const faUnknown = translatorFor('fa')(ACCESSIBILITY_KEY.unknown);
    const faConfirmed = translatorFor('fa')(ACCESSIBILITY_KEY.confirmed_yes);

    // Assert — the two must not be the same word.
    assert.notEqual(faUnknown, faConfirmed);
    assert.ok(faUnknown.length > 0);
  });

  test('an unknown token degrades to the unknown key, never undefined', () => {
    // A token from the network is not type-checked.
    assert.equal(labelKey(MODE_KEY, 'hovercraft'), UNKNOWN_KEY);
    assert.equal(labelKey(MODE_KEY, null), UNKNOWN_KEY);
    assert.equal(labelKey(MODE_KEY, 'car'), MODE_KEY.car);
  });
});

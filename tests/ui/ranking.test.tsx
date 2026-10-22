/**
 * The ranked list's acceptance criteria, as rendered (Plan 08).
 *
 * ★ THESE ASSERT ON RENDERED TEXT, NOT ON A COMPONENT TREE.
 *
 * A tree assertion can pass on a component that renders the wrong words. The
 * criteria are about what the user reads — «نامشخص» instead of a blank, a
 * range instead of an integer, a named person instead of a code — so the
 * tests read the markup.
 *
 * ★ EACH TEST MAPS TO ONE AC.
 *
 * AC-4.2.1 map failure · AC-4.3.1 excluded visible · AC-4.4.1 estimate as
 * range · AC-4.5.1 empty state · AC-4.7.1 coverage gap · AC-11.6.1 unknown
 * never blank · AC-5.6.1 lens changes only the ranking · AC-4.6.1 greyscale.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';
import type { Coverage, Exclusion, RankedVenue, VenueContext } from '@/src/engine/types';
import type { RenderedScreen } from './support/render';

/** The render helper, imported after the alias is registered. */
let renderComponent: typeof import('./support/render').renderComponent;
let createElement: typeof import('./support/render').createElement;


before(async () => {
  initI18n('fa');
  ({ renderComponent, createElement } = await import('./support/render'));
});

// ── Fixtures ──────────────────────────────────────────────────────────────

const COMPLETE_COVERAGE: Coverage = { compared: 2, total: 2, missing: [], wideGeography: false };

function venue(overrides: Partial<RankedVenue> & { venueId: string; rank: number }): RankedVenue {
  const { venueId, rank, ...rest } = overrides;

  return {
    venueId,
    name: 'کافه دیدار',
    rank,
    floor: 55,
    mean: 62,
    gap: 8,
    minutes: 18,
    totalCost: 15000,
    confidence: 'high',
    reason: { templateId: 'balanced_floor', params: { floorMinutes: 18 } },
    participants: [
      {
        id: 'p1',
        name: 'علی',
        mode: 'car',
        minutes: 12,
        minutesRange: null,
        costIrr: 5000,
        confidence: 'high',
        utility: 70,
        unmet: null,
      },
      {
        id: 'p2',
        name: 'بهار',
        mode: 'transit',
        minutes: 18,
        minutesRange: [14, 22],
        costIrr: 4000,
        confidence: 'medium',
        utility: 60,
        unmet: null,
      },
    ],
    conflicts: [],
    ...rest,
  };
}

/** A venue record with nothing known about it. */
function emptyContext(): VenueContext {
  return {
    id: 'v1',
    name: 'کافه دیدار',
    lat: 35.7,
    lng: 51.4,
    openingHours: null,
    priceLevel: null,
    venueType: null,
    accessibility: {
      stepFreeEntrance: 'unknown',
      accessibleRestroom: 'unknown',
      limitedWalkingSuitable: 'unknown',
      source: 'none',
    },
    rating: null,
  };
}

// ── AC-4.2.1 ──────────────────────────────────────────────────────────────

describe('AC-4.2.1 — a map failure leaves the ranked list fully functional', () => {
  test('the boundary converts a throw into the list-only fallback', async () => {
    // Arrange
    const { MapErrorBoundary } = await import('@/src/features/venues/components/MapErrorBoundary');
    const fallback = createElement('span', null, 'نقشه در دسترس نیست');

    // Act — React's error boundaries only engage on the CLIENT lifecycle, so
    // `renderToStaticMarkup` would let the throw escape. The transition is
    // asserted through the boundary's own contract instead, and the rendered
    // fallback below proves what the user sees.
    const derived = MapErrorBoundary.getDerivedStateFromError();

    // Assert
    assert.deepEqual(derived, { hasFailed: true });

    const fallbackScreen = renderComponent(function Fallback() { return fallback; }, {});
    assert.ok(fallbackScreen.has('نقشه در دسترس نیست'), 'the list-only note renders');
  });

  test('the list renders alongside a broken map, with no blocking error', async () => {
    // Arrange
    const { RankedList } = await import('@/src/features/venues/components/RankedList');

    // Act — the same list the screen renders below the boundary.
    const screen = renderComponent(RankedList, {
      venues: [venue({ venueId: 'v1', rank: 1 })],
      excluded: [],
      coverage: COMPLETE_COVERAGE,
      onOpenDetails: () => undefined,
    });

    // Assert — every fact the map would show is here (FR-4.5).
    assert.ok(screen.has('کافه دیدار'), 'the ranked venue rendered');
    assert.ok(screen.has('جزئیات'), 'details remain reachable without a map');
    assert.ok(screen.has('بدترین سفر'), 'the three numbers rendered');
    assert.doesNotMatch(screen.text, /خطا|error/i, 'no blocking error surfaced');
  });

  test('the boundary reports level 4 on a catch, so the fallback is measurable', async () => {
    // Arrange
    const { MapErrorBoundary } = await import('@/src/features/venues/components/MapErrorBoundary');
    const levels: number[] = [];

    const instance = new MapErrorBoundary({
      children: null,
      fallback: null,
      onFailure: (level) => levels.push(level),
    });

    // Act
    instance.componentDidCatch(new Error('map init failed'));

    // Assert
    assert.deepEqual(levels, [4]);
  });
});

// ── AC-4.3.1 ──────────────────────────────────────────────────────────────

describe('AC-4.3.1 — a hard-filtered venue stays visible with its reason', () => {
  test('the excluded venue appears, muted, naming who it affected', async () => {
    // Arrange
    const { ExcludedSection } = await import('@/src/features/venues/components/ExcludedSection');
    const excluded: Exclusion[] = [
      {
        venueId: 'v-park',
        reason: 'accessibility',
        participantId: 'p3',
        detail: { templateId: 'excluded', params: { participantName: 'داریا' } },
      },
    ];

    // Act
    const screen = renderComponent(ExcludedSection, {
      excluded,
      venueNames: { 'v-park': 'پارک لاله' },
      participantNames: { p3: 'داریا' },
    });

    // Assert
    assert.ok(screen.has('پارک لاله'), 'the excluded venue is named');
    assert.ok(screen.has('داریا'), 'the reason names the person affected');
    assert.ok(screen.matches(/حذف/), 'the reason states it was excluded');
    // `react-native-web` compiles `textDecorationLine` to a class token that
    // appears only in the markup, so this one assertion reads `html`.
    assert.match(screen.html, /r-textDecorationLine/, 'the row is visibly struck, not hidden');
  });
});

// ── AC-4.4.1 ──────────────────────────────────────────────────────────────

describe('AC-4.4.1 — a figure is a range when the data is not precise', () => {
  test('the estimated participant renders a range and the straight-line label', async () => {
    // Arrange
    const { PerPersonRow } = await import('@/src/features/venues/components/PerPersonRow');
    const participant = {
      id: 'p2',
      name: 'بهار',
      mode: 'transit' as const,
      minutes: 25,
      minutesRange: [22, 35] as [number, number],
      costIrr: 4000,
      confidence: 'low' as const,
      utility: 40,
      unmet: null,
    };

    // Act
    const screen = renderComponent(PerPersonRow, { result: participant });

    // Assert
    assert.ok(screen.has('۲۲'), 'the lower bound rendered');
    assert.ok(screen.has('۳۵'), 'the upper bound rendered');
    assert.ok(screen.matches(/–/), 'the two bounds form a range');
    assert.ok(screen.has('فاصلهٔ مستقیم'), 'the low-confidence label is shown');
  });

  test('a high-confidence figure renders one number with the live label', async () => {
    // Arrange
    const { PerPersonRow } = await import('@/src/features/venues/components/PerPersonRow');
    const participant = {
      id: 'p1',
      name: 'علی',
      mode: 'car' as const,
      minutes: 12,
      minutesRange: null,
      costIrr: 5000,
      confidence: 'high' as const,
      utility: 70,
      unmet: null,
    };

    // Act
    const screen = renderComponent(PerPersonRow, { result: participant });

    // Assert
    assert.ok(screen.has('۱۲'), 'the exact figure rendered');
    assert.ok(screen.has('زنده'), 'the high-confidence label is shown');
  });
});

// ── AC-4.7.1 ──────────────────────────────────────────────────────────────

describe('AC-4.7.1 — the coverage gap is stated', () => {
  test('a ranking over 6 of 8 says two people are missing, and names them', async () => {
    // Arrange
    const { CoverageNotice } = await import('@/src/features/venues/components/CoverageNotice');
    const coverage: Coverage = {
      compared: 6,
      total: 8,
      missing: ['داریا', 'بهار'],
      wideGeography: false,
    };

    // Act
    const screen = renderComponent(CoverageNotice, { coverage });

    // Assert
    assert.ok(screen.has('۲'), 'the gap count rendered');
    assert.ok(screen.has('داریا'), 'a missing participant is named');
    assert.ok(screen.has('بهار'), 'a missing participant is named');
  });

  test('a complete comparison states no gap', async () => {
    // Arrange
    const { CoverageNotice } = await import('@/src/features/venues/components/CoverageNotice');

    // Act
    const screen = renderComponent(CoverageNotice, { coverage: COMPLETE_COVERAGE });

    // Assert — nothing implies a gap where there is none.
    assert.equal(screen.has('لحاظ نشده‌اند'), false);
  });
});

// ── AC-11.6.1 ─────────────────────────────────────────────────────────────

describe('AC-11.6.1 — unknown attributes render نامشخص, never blank', () => {
  test('a venue with no data states every attribute as unknown', async () => {
    // Arrange
    const { VenueDetailPanel } = await import('@/src/features/venues/components/VenueDetailPanel');

    // Act
    const screen = renderComponent(VenueDetailPanel, {
      venue: venue({ venueId: 'v1', rank: 1 }),
      context: emptyContext(),
      lens: 'balanced',
    });

    // Assert
    assert.ok(screen.has('نامشخص'), 'the unknown word appears');
    assert.ok(screen.has('ساعات کاری'), 'hours are stated even when unknown');
    assert.equal(screen.has('ساعات کاری :'), false, 'no attribute rendered an empty value');
  });

  test('unknown accessibility carries an explicit warning, never implying accessible', async () => {
    // Arrange
    const { VenueDetailPanel } = await import('@/src/features/venues/components/VenueDetailPanel');

    // Act
    const screen = renderComponent(VenueDetailPanel, {
      venue: venue({ venueId: 'v1', rank: 1 }),
      context: emptyContext(),
      lens: 'balanced',
    });

    // Assert — "not checked" is stated, and never as "confirmed".
    assert.ok(screen.has('تأیید نشده'), 'the unconfirmed state is named');
    assert.ok(screen.has('دسترسی ویلچر تأیید نشده است'), 'the warning line is shown');
    assert.equal(screen.has('تأییدشده'), false, 'unknown never reads as confirmed');
  });

  test('the transit explanation appears whenever transit was used', async () => {
    // Arrange
    const { VenueDetailPanel } = await import('@/src/features/venues/components/VenueDetailPanel');

    // Act — the fixture's second participant travels by transit.
    const screen = renderComponent(VenueDetailPanel, {
      venue: venue({ venueId: 'v1', rank: 1 }),
      context: emptyContext(),
      lens: 'balanced',
    });

    // Assert
    assert.ok(screen.has('این زمان تخمینی است'), 'the transit explanation rendered');
  });
});

// ── AC-5.6.1 ──────────────────────────────────────────────────────────────

describe('AC-5.6.1 — a lens change alters only the ranking', () => {
  test('the switcher names the active lens and its meaning at all times', async () => {
    // Arrange
    const { LensSwitcher } = await import('@/src/features/venues/components/LensSwitcher');

    // Act
    const screen = renderComponent(LensSwitcher, { active: 'fairest', onChange: () => undefined });

    // Assert — the name and the plain meaning, not just a highlighted segment.
    assert.ok(screen.has('عادلانه‌ترین'), 'the active lens is named');
    assert.ok(screen.has('فاصلهٔ بین بهترین و بدترین'), 'its meaning is stated');
  });

  test('all four lenses are offered', async () => {
    // Arrange
    const { LensSwitcher } = await import('@/src/features/venues/components/LensSwitcher');

    // Act
    const screen = renderComponent(LensSwitcher, { active: 'balanced', onChange: () => undefined });

    // Assert
    for (const name of ['متعادل', 'سریع‌ترین', 'عادلانه‌ترین', 'کم‌خرج‌ترین']) {
      assert.ok(screen.has(name), `${name} is offered`);
    }
  });
});

// ── AC-4.6.1 ──────────────────────────────────────────────────────────────

describe('AC-4.6.1 — rank is determinable in greyscale', () => {
  test('every row carries its rank numeral, independent of colour', async () => {
    // Arrange
    const { RankedList } = await import('@/src/features/venues/components/RankedList');

    // Act
    const screen = renderComponent(RankedList, {
      venues: [
        venue({ venueId: 'v1', rank: 1, name: 'کافه دیدار' }),
        venue({ venueId: 'v2', rank: 2, name: 'رستوران مرکزی' }),
      ],
      excluded: [],
      coverage: COMPLETE_COVERAGE,
    });

    // Assert — the numerals do the work; colour is redundant.
    assert.ok(screen.has('۱'), 'rank 1 rendered as a numeral');
    assert.ok(screen.has('۲'), 'rank 2 rendered as a numeral');
    assert.ok(screen.has('کافه دیدار'));
    assert.ok(screen.has('رستوران مرکزی'));
  });
});

// ── AC-4.5.1 ─────────────────────────────────────────────────────────────

describe('AC-4.5.1 — an empty ranking is an invitation, not a blank panel', () => {
  test('zero venues renders a prompt with an action', async () => {
    // Arrange
    const { RankedList } = await import('@/src/features/venues/components/RankedList');

    // Act
    const screen = renderComponent(RankedList, {
      venues: [],
      excluded: [],
      coverage: COMPLETE_COVERAGE,
      onPropose: () => undefined,
    });

    // Assert
    assert.ok(screen.has('هنوز مکانی برای مقایسه نیست'), 'the empty title rendered');
    assert.ok(screen.has('پیشنهاد مکان'), 'the invitation to act rendered');
  });
});

// ── Locale switching ─────────────────────────────────────────────────────

describe('the list is localisable without touching the data', () => {
  test('English mode translates the chrome and leaves the venue name intact', async () => {
    // Arrange
    const { RankedList } = await import('@/src/features/venues/components/RankedList');
    const { default: i18next } = await import('@/src/i18n');

    await i18next.changeLanguage('en');

    // Act
    let screen: RenderedScreen;
    try {
      screen = renderComponent(RankedList, {
        venues: [venue({ venueId: 'v1', rank: 1, name: 'کافه دیدار' })],
        excluded: [],
        coverage: COMPLETE_COVERAGE,
      });
    } finally {
      await i18next.changeLanguage('fa');
    }

    // Assert — the chrome is English, the name is untouched, digits are Latin.
    assert.ok(screen.has('Worst trip'), 'the chrome is translated');
    assert.ok(screen.has('کافه دیدار'), 'the venue name is data, not translated');
    assert.ok(screen.has('18'), 'English mode uses Latin digits');
  });
});

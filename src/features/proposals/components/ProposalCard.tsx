/**
 * One proposal, as the event screens render it (Plan 06 Task 9).
 *
 * ★ EVERY CARD STATES WHAT IT IS AND WHEN IT WAS MADE.
 *
 * A list of options that does not say how it is ordered reads as a ranking, and
 * a user who reads creation order as a ranking will argue with the group about
 * a score nobody computed. The order is therefore stated by the list, and each
 * card carries only facts: type, time in Jalali with Gregorian beneath it, the
 * proposer, and notes.
 *
 * ★ A WITHDRAWN PROPOSAL IS STRUCK THROUGH, NOT REMOVED (PRD-02 E4).
 *
 * The row survives so the history survives. Removing the card would erase the
 * fact that somebody suggested it and changed their mind — which is precisely
 * the context the group needs when they wonder why a place is no longer on the
 * table.
 */

import { StyleSheet, View } from 'react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowSquareOut } from 'phosphor-react-native';

import { Card } from '@/src/components/ui/Card';
import { ProposalMapPreview } from './ProposalMapPreview';
import { VoteShareBar } from './VoteShareBar';
import { Chip } from '@/src/components/ui/Chip';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { formatDate } from '@/src/lib/format';
import { toPersianDigits } from '@/src/lib/jalali';
import { colorForNickname } from '@/src/features/profile/services/nickname-color';
import { openInMaps } from '@/src/features/proposals/services/map-link';
import { trackOpeningHoursWarningShown } from '@/src/features/proposals/services/analytics';
import {
  ADVISORY_KEY_BY_VERDICT,
  openingHoursAdvisory,
} from '@/src/features/proposals/services/opening-hours';
import { endsNextDay, formatLocalTime } from '@/src/features/proposals/services/slot-time';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Proposal } from '@/src/types/proposal';
import type { Language } from '@/src/i18n/types';

export interface ProposalCardProps {
  proposal: Proposal;
  /** The event's home timezone — the slot is rendered in it, not the device's. */
  homeTz: string;
  /**
   * This proposal's share of all answers across the list (0–1).
   *
   * ★ THE BAR IS PART OF THE BOX, NOT A SEPARATE STRIP.
   *
   * It used to render as a sibling BELOW the card — a hairline floating in the list's
   * gap with nothing tying it to the proposal it described. It is now drawn inside
   * the card's own bottom edge, clipped by the card's radius, so it reads as a gauge
   * belonging to the box rather than as a divider between two boxes.
   *
   * Omit it and no bar is drawn, which is what the "Suggested times" list does.
   */
  share?: number;
  onPress?: () => void;
  /** Opens the comment sheet for this proposal. Absent = no affordance. */
  onOpenComments?: () => void;
  /** How many comments the proposal carries, when the caller knows. */
  commentCount?: number;
  testID?: string;
}

/**
 * The transparent band under the gauge.
 *
 * It lets the slot's own bottom radii land BELOW the visible bar, so the card's
 * corner curve is finished without the bar's fill or top edge crossing it — see
 * `shareSlot`.
 *
 * ★ IT IS GONE, AND SO IS THE DEAD BAND UNDER THE BAR.
 *
 * It was `space[3]` of transparent padding below a `space[1]` bar, inside a card
 * whose foot reserved `space[5] + space[3]` to clear it: four pixels of gauge
 * floating eleven pixels above a strip of nothing. That is the reported "there
 * is padding under the votes bar on the proposal box". The card's `overflow:
 * 'hidden'` already clips the bar to the card's own radius, so neither the tail
 * nor the tail's reservation is needed — see `shareSlot` and `cardWithShare`.
 */
const shareBarTail = 0;

/** The digits rule: Persian numerals in `fa`, Latin in `en` (AC-3.1.1). */
function localiseDigits(value: string, language: string): string {
  return language === 'en' ? value : toPersianDigits(value);
}

/**
 * The instant the hours advisory is computed at.
 *
 * A timed proposal is checked at its own start — that is the moment the group
 * cares about. A place-only proposal has no start, so `now` is the honest
 * question ("is it open if we went today?"), and `openingHoursAdvisory` treats
 * an unparseable start the same way.
 */
function advisoryInstant(proposal: Proposal): Date {
  if (proposal.start_utc && Number.isFinite(Date.parse(proposal.start_utc))) {
    return new Date(proposal.start_utc);
  }

  return new Date();
}

export function ProposalCard({
  proposal,
  homeTz,
  share,
  onPress,
  onOpenComments,
  commentCount,
  testID,
}: ProposalCardProps) {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();

  const language = (i18n.language === 'en' ? 'en' : 'fa') as Language;
  const isWithdrawn = proposal.status === 'WITHDRAWN';

  const date = proposal.start_utc ? formatDate(proposal.start_utc, language) : null;
  const startTime = proposal.start_utc ? formatLocalTime(proposal.start_utc, homeTz) : null;
  const endTime = proposal.end_utc ? formatLocalTime(proposal.end_utc, homeTz) : null;
  const crossesMidnight =
    proposal.start_utc !== null &&
    proposal.end_utc !== null &&
    endsNextDay(proposal.start_utc, proposal.end_utc, homeTz);

  // The struck-through treatment for a withdrawn row.
  const struck = isWithdrawn ? { textDecorationLine: 'line-through' as const } : undefined;

  // Absence of hours is a data-quality signal, so it is measured when shown.
  const hoursUnknown = proposal.venue != null && proposal.venue.opening_hours == null;

  // ★ THE ADVISORY REPORTS; IT NEVER REFUSES (AC-3.3.1).
  //
  // Nothing below gates a button, a vote or the card's presence — the verdict
  // only chooses which line to print and which colour to print it in. A closed
  // verdict is a warning on a proposal that stays exactly as votable as before.
  const hoursVerdict =
    proposal.venue != null
      ? openingHoursAdvisory(proposal.venue.opening_hours, advisoryInstant(proposal), homeTz)
          .advisory
      : null;

  const hoursAdvisory = hoursVerdict ? ADVISORY_KEY_BY_VERDICT[hoursVerdict] : null;

  useEffect(() => {
    if (hoursUnknown) trackOpeningHoursWarningShown(false);
  }, [hoursUnknown]);

  return (
    <Card
      variant="surface"
      onPress={onPress}
      testID={testID}
      style={[styles.card, share !== undefined ? styles.cardWithShare : null]}
    >
      <View style={styles.header}>
        <Text
          variant="h3"
          color={isWithdrawn ? theme.textFaint : undefined}
          style={struck}
          numberOfLines={2}
        >
          {proposal.title}
        </Text>

        <Chip
          label={t(`proposals.type.${proposal.type}`)}
          testID={testID ? `${testID}-type` : undefined}
        />
      </View>

      {date && (
        <View style={styles.timeBlock}>
          <Text variant="body" color={isWithdrawn ? theme.textFaint : theme.text} style={struck}>
            {t('proposals.card.timeLine', {
              date: date.primary,
              start: localiseDigits(startTime ?? '', language),
              end: localiseDigits(endTime ?? '', language),
            })}
          </Text>

          {/* The other calendar, always present, always secondary (PRD-03 §3.2). */}
          <Text variant="caption" color={theme.textMuted}>
            {t('time.secondaryCalendar', {
              calendar: t(language === 'fa' ? 'time.gregorian' : 'time.jalali'),
            })}
            {': '}
            {date.secondary}
          </Text>

          {/* E4 — a slot must say when it runs into the next day. */}
          {crossesMidnight && (
            <Text variant="caption" color={theme.warning}>
              {t('proposals.card.endsNextDay')}
            </Text>
          )}
        </View>
      )}

      {proposal.venue && (
        <View
          style={[styles.venueBlock, { backgroundColor: theme.surface2 }]}
          testID={testID ? `${testID}-venue` : undefined}
        >
          {/* ★ THE VENUE IS DRAWN, NOT DESCRIBED.
              This block had no picture at all — only a button whose label is
              «بازکردن در برنامه دیگر», which the reader reported as the map being
              missing. The preview puts the venue's own coordinates on screen; see
              `ProposalMapPreview.tsx`. It is absent for a withdrawn proposal,
              because a place nobody is going does not need a map. */}
          {!isWithdrawn && (
            <ProposalMapPreview
              lat={proposal.venue.lat}
              lng={proposal.venue.lng}
              label={proposal.venue.name}
              testID={testID ? `${testID}-map` : undefined}
            />
          )}

          <View style={styles.venueText}>
            <View style={styles.venueNameRow}>
              <Text
                variant="body"
                color={isWithdrawn ? theme.textFaint : theme.text}
                style={[styles.venueName, struck]}
              >
                {proposal.venue.name}
              </Text>

              {/* ★ THE ACTION IS THE MAP AFFORDANCE, NOT A SENTENCE ABOUT ONE.
                  It was a labelled button reading "open in another app" where a map
                  belonged. A pin glyph beside the place's name says the same thing
                  without pretending to be the picture, and it keeps its accessible
                  name for a screen reader. */}
              {!isWithdrawn && (
                <Pressy
                  onPress={() => void openInMaps({
                    name: proposal.venue!.name,
                    lat: proposal.venue!.lat,
                    lng: proposal.venue!.lng,
                  })}
                  haptic="light"
                  accessibilityRole="button"
                  accessibilityLabel={t('proposals.card.openInMaps')}
                  testID={testID ? `${testID}-open-maps` : undefined}
                  style={styles.openMaps}
                >
                  <ArrowSquareOut size={18} color={theme.textMuted} weight="bold" />
                </Pressy>
              )}
            </View>

            {proposal.venue.address && (
              <Text variant="caption" color={theme.textMuted} numberOfLines={2}>
                {proposal.venue.address}
              </Text>
            )}
            {/* ★ ABSENCE OF HOURS IS NOT "CLOSED" (E9).
                The advisory resolves `null` to «نامشخص» rather than to a blank
                line, which would read as "open". */}
            {hoursAdvisory && (
              <Text
                variant="caption"
                color={hoursVerdict === 'closed' ? theme.warning : theme.textFaint}
                testID={testID ? `${testID}-hours-advisory` : undefined}
              >
                {t(hoursAdvisory)}
              </Text>
            )}
          </View>
        </View>
      )}

      {proposal.notes && (
        <Text
          variant="body"
          color={theme.textMuted}
          numberOfLines={4}
          style={isWithdrawn ? struck : undefined}
        >
          {proposal.notes}
        </Text>
      )}

      <View style={styles.footer}>
        {/* ★ THE NAME IS ITS OWN TEXT NODE SO IT CAN CARRY A COLOUR.
            The sentence used to interpolate the name into one string, which left
            no way to colour just the person — and the colour is how a reader
            tracks who said what across a list of proposals. */}
        <View style={styles.proposer}>
          <Text variant="caption" color={theme.textFaint}>
            {t('proposals.card.proposedByPrefix')}
          </Text>
          <Text variant="caption" color={colorForNickname(proposal.proposer_name)}>
            {proposal.proposer_name}
          </Text>
        </View>

        {/* FR-2.9 — a proposal that arrived after voting began says so. */}
        {proposal.is_late && (
          <Text variant="caption" color={theme.warning}>
            {t('proposals.card.lateMarker')}
          </Text>
        )}

        {isWithdrawn && (
          <Text variant="caption" color={theme.textFaint}>
            {t('proposals.status.WITHDRAWN')}
          </Text>
        )}

        {/* ★ COMMENTS ARE AN AFFORDANCE, NOT A GATE.
            Opening the sheet is optional and never required to vote, propose or
            see the decision — that is the P14 constraint, and the reason this is
            a plain button on the card rather than a step in a flow. */}
        {onOpenComments && (
          <Pressy
            onPress={onOpenComments}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('comments.open')}
            testID={testID ? `${testID}-comments` : undefined}
          >
            <Text variant="caption" color={theme.textMuted}>
              {typeof commentCount === 'number' && commentCount > 0
                ? t('comments.count', { count: commentCount })
                : t('comments.action')}
            </Text>
          </Pressy>
        )}
      </View>

      {/* ★ THE SHARE GAUGE SITS INSIDE THE BOX, ALONG ITS BOTTOM EDGE.
          Absolutely placed and clipped by the card so it takes the card's own radius,
          with the card body padded to clear it — see `cardWithShare`. */}
      {share !== undefined && (
        <View style={styles.shareSlot}>
          <VoteShareBar share={share} position="bottom" testID={testID ? `${testID}-share` : undefined} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
    // The gauge is drawn against the card's own edge, so it must not escape it.
    overflow: 'hidden',
  },
  /**
   * Room for the gauge at the foot of the card.
   *
   * ★ THE RESERVATION IS THE BAR, NOT THE BAR PLUS A TAIL.
   *
   * `cardWithShare` used to reserve `space[5] + shareBarTail` — the card's own
   * bottom padding, plus sixteen pixels of clearance for a transparent strip that
   * existed only to finish the corner curve. Between them they left a visible dead
   * band under a four-pixel gauge. `overflow: 'hidden'` on the card already clips
   * the bar to the card's radius, so the foot is now the card's padding plus the
   * bar itself.
   */
  cardWithShare: {
    paddingBottom: space[4] + space[1],
  },
  /**
   * ★ THE STRIP TAKES THE CARD'S OWN CURVE.
   *
   * The slot is full-bleed along the card's bottom edge. The card clips it (see
   * `card`), so the bar's fill cannot cross the corner — which is what the old
   * `shareBarTail` was compensating for by pushing the radii into transparent
   * space BELOW the bar, i.e. by adding the padding the report asks to remove.
   */
  shareSlot: {
    position: 'absolute',
    bottom: 0,
    left: 0, // rtl-ok: full-bleed strip on the card's own edge, spans both sides
    right: 0,
    paddingBottom: shareBarTail,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  timeBlock: {
    gap: space[1],
  },
  venueBlock: {
    // NOTE: the venue box needs air above it. The card's own gap is uniform, so this
    // bordered box sat the same distance from the time block as two lines of text sit
    // from each other, and it read as welded to the element above. The separation is
    // local to this block rather than raised on the card, because loosening the card
    // would loosen every pair of lines in it.
    marginTop: space[3],
    borderRadius: radius.md,
    // ★ NO BORDER.
    //
    // A hairline around this box drew a second rectangle inside a card that no
    // longer has one of its own, so the proposal read as a box inside a box. The
    // `surface2` fill is the separation.
    padding: space[3],
    gap: space[2],
  },
  venueNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  venueName: {
    // The name takes what the map affordance does not, so a long place name wraps
    // instead of pushing the pin off the row.
    flexShrink: 1,
  },
  openMaps: {
    padding: space[1],
    // The affordance is never the part that gives way.
    flexShrink: 0,
  },
  venueText: {
    gap: space[1],
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[3],
    marginTop: space[2],
    borderRadius: radius.sm,
  },
  proposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
});

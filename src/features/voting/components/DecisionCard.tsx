/**
 * The Decision Card (Plan 07 Task 9, PRD-11 S12, Style Guide §1, §7.6.1).
 *
 * ★ CATEGORICALLY DIFFERENT, NOT A RANKED LIST WITH A BADGE (§15.4).
 *
 * This is the central product promise: the moment the group has decided must
 * look like nothing else in the app. So the card is a VOLT BLOCK — a saturated
 * fill with `display` numerals — not a tinted row. A participant who glances at
 * it should never mistake "leading" for "decided" again.
 *
 * ★ THE MEET POINT FIRES HERE AND NOWHERE ELSE (§7.6.1).
 *
 * Avatars converge, the pill flashes Volt, a success haptic, then the card takes
 * the status area's place. It is deliberately not fired on a vote or a lens
 * change — those are not the group converging, and animating them would spend
 * the moment's meaning.
 *
 * ★ IT REPLACES THE STATUS AREA IN PLACE (FR-2.26, AC-11.5.1).
 *
 * Not a separate destination to hunt for. That is why this component renders
 * wherever `DecisionStatus` was, rather than on a route of its own.
 *
 * ★ IT ANNOUNCES ITSELF (Style Guide §8).
 *
 * The result goes into a live region: the confirmed state arrives by replacing
 * content, which is invisible to a screen-reader user without an announcement.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/src/components/ui/Avatar';
import { Button } from '@/src/components/ui/Button';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { renderReason } from '@/src/lib/format';
import { haptics } from '@/src/platform/haptics';
import { dur } from '@/src/theme/motion';
import { border, palette, radius, size, space } from '@/src/theme/tokens';
import { useMotion } from '@/src/theme/useMotion';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

import type { DecisionCard as CardModel, ViewerTrip } from '../services/decision-card';

export interface DecisionCardProps {
  card: CardModel;
  /** The viewer's own travel line. The ONLY per-participant field. */
  viewerTrip?: ViewerTrip | null;
  /** Fires the Meet Point once. The screen sets this on the OPEN → CONFIRMED edge. */
  celebrate?: boolean;
  onAddToCalendar?: () => void;
  onShare?: () => void;
  onViewActivity?: () => void;
  testID?: string;
}

/**
 * The travel mode names.
 *
 * The engine sends a mode id (`transit`, `walk`, …), which is data; the word a
 * reader sees is copy. The vocabulary belongs to another namespace, so the key
 * is derived here and rendered through a guarded `t`: when the catalogue has the
 * entry the real word appears, and when it does not the mode id is shown rather
 * than the raw key.
 */
const MODE_KEY: Record<string, string> = {
  transit: 'time.modes.transit',
  walk: 'time.modes.walk',
  car: 'time.modes.car',
  cycle: 'time.modes.cycle',
  taxi: 'time.modes.taxi',
};

/** The mode name, or the mode id when no catalogue entry exists yet. */
function modeLabel(mode: string, t: (key: string) => string): string {
  const key = MODE_KEY[mode];
  if (!key) return mode;

  const translated = t(key);
  return translated === key ? mode : translated;
}

export function DecisionCard({
  card,
  viewerTrip,
  celebrate = false,
  onAddToCalendar,
  onShare,
  onViewActivity,
  testID,
}: DecisionCardProps) {
  const { t: theme } = useTheme();
  const { t, i18n } = useTranslation();
  const motion = useMotion();

  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  // ★ THE MEET POINT. One flash, once, on the transition into CONFIRMED.
  const flash = useSharedValue(0);

  useEffect(() => {
    if (!celebrate) return;

    // The success haptic is part of the Meet Point's feedback, and it fires even
    // under Reduce Motion — only the movement is dropped, never the feedback.
    haptics.impact('success');

    if (motion.reduce) {
      // Reduce Motion: the colour flash is retained as a fade; the travel is
      // dropped. The feedback is required, only the movement is removed (§7.7).
      flash.value = withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 120 }));
      return;
    }

    flash.value = withSequence(
      withTiming(1, { duration: dur.fast }),
      withTiming(0, { duration: dur.slow }),
    );
  }, [celebrate, flash, motion.reduce]);

  const overlay = useAnimatedStyle(() => ({ opacity: flash.value }));

  const attendeeNames = card.attendees.map((attendee) => attendee.name);

  return (
    <View testID={testID} style={styles.wrapper}>
      {/* ★ THE VOLT BLOCK. A saturated fill, not a tinted list row. */}
      <View style={[styles.card, { backgroundColor: palette.volt }]}>
        <Animated.View
          pointerEvents="none"
          style={[styles.flash, { backgroundColor: palette.volt }, overlay]}
        />

        <Text variant="caption" color={palette.espresso}>
          {t('decisionCard.eyebrow')}
        </Text>

        <Text variant="display" color={palette.espresso} numberOfLines={3} testID={testID ? `${testID}-venue` : undefined}>
          {card.venueName || t('decisionCard.noVenue')}
        </Text>

        {card.datePrimary !== '' && (
          <View style={styles.dateBlock}>
            <Text
              variant="h3"
              color={palette.espresso}
              numeric
              testID={testID ? `${testID}-date` : undefined}
            >
              {[card.datePrimary, card.timeRange].filter(Boolean).join(' · ')}
            </Text>
            {/* The other calendar, always present (PRD-03 §3.2). */}
            <Text variant="caption" color={palette.espresso} numeric>
              {card.dateSecondary}
            </Text>
          </View>
        )}

        {card.venueAddress && (
          <Text variant="body" color={palette.espresso} numberOfLines={2}>
            {card.venueAddress}
          </Text>
        )}

        {/* ★ THE VIEWER'S PERSONAL LINE, AND THE ONLY ONE.
            It is additive: it never replaces or reorders what the group sees. */}
        {viewerTrip && (
          <View style={styles.trip} testID={testID ? `${testID}-trip` : undefined}>
            <Text variant="body" color={palette.espresso} numeric>
              {viewerTrip.minutes === null
                ? t('decisionCard.yourTripUnknown')
                : viewerTrip.mode
                  ? t('decisionCard.yourTrip', {
                      minutes: viewerTrip.minutes,
                      mode: modeLabel(viewerTrip.mode, t),
                    })
                  : t('decisionCard.yourTripInLine', { minutes: viewerTrip.minutes })}
            </Text>
          </View>
        )}

        {/* The winning lens, named, with its locale-rendered reason. */}
        <View style={styles.reason} testID={testID ? `${testID}-reason` : undefined}>
          <Text variant="caption" color={palette.espresso}>
            {t('decisionCard.winningReason')}
          </Text>
          <Text variant="body" color={palette.espresso}>
            {renderReason(card.reason, locale)}
          </Text>
        </View>

        {/* Attendance, with the same list on every device. */}
        <View style={styles.attendees}>
          <Text variant="body" color={palette.espresso} numeric>
            {card.going > 0
              ? card.maybe > 0
                ? t('decisionCard.attendeeCounts', { going: card.going, maybe: card.maybe })
                : t('decisionCard.attendeeOnly', { going: card.going })
              : t('decisionCard.attendeeNone')}
          </Text>

          {attendeeNames.length > 0 && (
            <View style={styles.avatarRow}>
              {card.attendees.slice(0, 8).map((attendee, index) => (
                <Avatar
                  key={attendee.name}
                  name={attendee.name}
                  colorIndex={index}
                  size={28}
                  status={
                    attendee.rsvp === 'going'
                      ? 'in'
                      : attendee.rsvp === 'maybe'
                        ? 'maybe'
                        : 'none'
                  }
                />
              ))}
            </View>
          )}
        </View>

        {/* Actions live on the block, in the block's own ink. */}
        <View style={styles.actions}>
          <Pressy
            onPress={onAddToCalendar}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('decisionCard.addToCalendar')}
            testID={testID ? `${testID}-calendar` : undefined}
          >
            <View style={[styles.action, { borderColor: palette.espresso }]}>
              <Text variant="caption" color={palette.espresso}>
                {t('decisionCard.addToCalendar')}
              </Text>
            </View>
          </Pressy>

          <Pressy
            onPress={onShare}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('decisionCard.share')}
            testID={testID ? `${testID}-share` : undefined}
          >
            <View style={[styles.action, { borderColor: palette.espresso }]}>
              <Text variant="caption" color={palette.espresso}>
                {t('decisionCard.share')}
              </Text>
            </View>
          </Pressy>
        </View>
      </View>

      {/* ★ THE ANNOUNCEMENT. The card arrives in place, so it must say so. */}
      <Text
        variant="caption"
        color={theme.textMuted}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={styles.srOnly}
        testID={testID ? `${testID}-announcement` : undefined}
      >
        {t('decision.confirmedAnnouncement', {
          venue: card.venueName,
          date: card.datePrimary,
        })}
      </Text>

      {onViewActivity && (
        <Button
          label={t('decisionCard.viewActivity')}
          onPress={onViewActivity}
          variant="ghost"
          size="medium"
          testID={testID ? `${testID}-activity` : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: space[3],
  },
  card: {
    borderRadius: radius.xl,
    padding: space[5],
    gap: space[3],
    overflow: 'hidden',
  },
  flash: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
    height: size.meetPointFlash,
    opacity: 0,
  },
  dateBlock: {
    gap: space[1],
  },
  trip: {
    borderTopWidth: border.hairline,
    borderTopColor: palette.espresso,
    paddingTop: space[3],
  },
  reason: {
    gap: space[1],
  },
  attendees: {
    gap: space[2],
  },
  avatarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[1],
  },
  actions: {
    flexDirection: 'row',
    gap: space[2],
  },
  action: {
    borderWidth: border.strong,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    minHeight: size.buttonSmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Present for a screen reader, out of the visual flow. Not `display: none`,
  // which would remove it from the accessibility tree as well — and not a
  // zero size, which some platforms treat as "not rendered".
  srOnly: {
    position: 'absolute',
    width: border.hairline,
    height: border.hairline,
    opacity: 0,
  },
});

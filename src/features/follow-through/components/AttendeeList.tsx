/**
 * The attendee list (Plan 10 Task 2, FR-6.5).
 *
 * ★ `going` AND `maybe` ARE REPORTED SEPARATELY AND NEVER SUMMED (FR-6.5).
 *
 * `maybe` is the number that decides whether a reservation is needed. Folding it
 * into `going` produces a total that looks better and destroys the one actionable
 * figure on the card — an organizer who reads "9 coming" books a table for nine
 * when the honest answer is "7 coming, 2 unsure".
 *
 * ★ NUMBERS ARE RENDERED THROUGH `Text numeric`, SO THE LOCALE DECIDES ITS DIGITS.
 *
 * `۷` in Persian and `7` in English, from one call site. Writing Persian digits
 * into the copy would make the English build show Persian numerals.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/src/components/ui/Avatar';
import { Text } from '@/src/components/ui/Text';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import type { Attendance } from '../services/rsvp';

export interface AttendeeListProps {
  attendance: Attendance;
  /** How many avatars to show before the list stops being a list. */
  maxAvatars?: number;
  testID?: string;
}

export function AttendeeList({ attendance, maxAvatars = 8, testID }: AttendeeListProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const hasAny = attendance.going + attendance.maybe > 0;

  return (
    <View style={styles.wrapper} testID={testID}>
      <Text variant="body" color={theme.text} numeric testID={testID ? `${testID}-counts` : undefined}>
        {hasAny
          ? attendance.maybe > 0
            ? t('followThrough.attendees.counts', {
                going: attendance.going,
                maybe: attendance.maybe,
              })
            : t('followThrough.attendees.goingOnly', { going: attendance.going })
          : t('followThrough.attendees.noneYet')}
      </Text>

      {hasAny && (
        <View style={styles.avatarRow}>
          {attendance.names.going.slice(0, maxAvatars).map((name, index) => (
            <Avatar key={`going-${name}`} name={name} colorIndex={index} size={28} status="in" />
          ))}
          {attendance.names.maybe.slice(0, maxAvatars).map((name, index) => (
            <Avatar
              key={`maybe-${name}`}
              name={name}
              colorIndex={attendance.names.going.length + index}
              size={28}
              status="maybe"
            />
          ))}
        </View>
      )}

      {/* The count that decides the reservation, named plainly rather than
          implied by an avatar tint a user has to learn. */}
      {attendance.maybe > 0 && (
        <Text
          variant="caption"
          color={theme.textMuted}
          numeric
          testID={testID ? `${testID}-reservation-hint` : undefined}
        >
          {t('followThrough.attendees.reservationHint', { maybe: attendance.maybe })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: space[2],
  },
  avatarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[1],
  },
});

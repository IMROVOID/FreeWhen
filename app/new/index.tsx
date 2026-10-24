/**
 * S2 — create an event (Plan 05 Task 7, PRD-11 S2).
 *
 * ★ DATES COME FROM PRESETS AND STEPPERS, NEVER FROM TYPING.
 *
 * RTL date entry on Android is error-prone enough that free text is a bug
 * generator, not a feature (PRD-03 R2). The window is chosen as "which day" plus
 * "how many days long", and the deadline as one of three presets — so no string
 * ever has to be parsed, in either direction or either calendar.
 *
 * ★ THE DEADLINE CAN NEVER LAND OUTSIDE THE WINDOW.
 *
 * The rule is enforced by construction here rather than by a 422: the presets
 * are derived from the chosen window end, so the invalid combination the schema
 * rejects has no way to be expressed on this screen.
 */

import { useState } from 'react';
import { I18nManager, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { Input } from '@/src/components/ui/Input';
import { Pressy } from '@/src/components/ui/Pressy';
import { Stepper } from '@/src/components/ui/Stepper';
import { Text } from '@/src/components/ui/Text';
import { createEvent } from '@/src/features/events/services/create-event';
import { formatDate } from '@/src/lib/format';
import { getStoredUserId } from '@/src/lib/session';
import { isApiFailure } from '@/src/lib/api';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import { ACTIVITY_TYPES, TITLE_MAX, type ActivityType } from '@/src/types/event';
import type { Language } from '@/src/i18n/types';

const DAY_MS = 86_400_000;

/** The start-hour of an evening meetup. Late afternoon, so the window is real. */
const START_HOUR = 17;

/** The maximum window length offered. */
const MAX_WINDOW_DAYS = 14;

/** Iran's weekend starts on Thursday; `getDay()` gives 4 for it. */
const THURSDAY = 4;

type DayPreset = 'today' | 'tomorrow' | 'weekend' | 'nextWeek';
type DeadlinePreset = 'none' | '24h' | '48h';

/** Local midnight for the given offset in days, at the window's start hour. */
function dayStart(offsetDays: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(START_HOUR, 0, 0, 0);
  return date;
}

/** The offset from today to the coming Thursday (today, if it is Thursday). */
function offsetToThursday(): number {
  const today = new Date().getDay();
  return (THURSDAY - today + 7) % 7;
}

const PRESET_OFFSET: Record<DayPreset, () => number> = {
  today: () => 0,
  tomorrow: () => 1,
  weekend: offsetToThursday,
  nextWeek: () => 7,
};

export default function CreateEventScreen() {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [activity, setActivity] = useState<ActivityType | null>(null);
  const [preset, setPreset] = useState<DayPreset>('tomorrow');
  const [windowDays, setWindowDays] = useState(3);
  const [deadlinePreset, setDeadlinePreset] = useState<DeadlinePreset>('none');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const start = dayStart(PRESET_OFFSET[preset]());
  const end = new Date(start.getTime() + windowDays * DAY_MS);

  const deadlineHours = deadlinePreset === '24h' ? 24 : deadlinePreset === '48h' ? 48 : 0;
  const deadline = deadlineHours > 0 ? new Date(end.getTime() - deadlineHours * 3_600_000) : null;

  const submit = async () => {
    const trimmed = title.trim();

    if (trimmed === '') {
      setErrorKey('events.validation.titleRequired');
      return;
    }

    setErrorKey(null);
    setIsSubmitting(true);

    try {
      const userId = await getStoredUserId();
      const result = await createEvent(
        {
          title: trimmed,
          description: description.trim() === '' ? null : description.trim(),
          activity_type: activity,
          date_window_start: start.toISOString(),
          date_window_end: end.toISOString(),
          voting_deadline: deadline ? deadline.toISOString() : null,
        },
        userId,
      );

      // The URL and its expiry are carried in navigation params, not refetched:
      // the server can never hand the plaintext token back again.
      router.replace({
        pathname: '/new/invite',
        params: {
          event_id: result.event.id,
          url: result.invite.url,
          expires_at: result.invite.expires_at,
        },
      });
    } catch (error) {
      setErrorKey(isApiFailure(error) ? error.messageKey : 'errors.unknown');
    } finally {
      setIsSubmitting(false);
    }
  };

  const windowLabel = `${formatDate(start.toISOString(), locale).primary} — ${formatDate(end.toISOString(), locale).primary}`;

  const BackIcon = I18nManager.isRTL ? CaretRight : CaretLeft;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="create-event"
    >
      <View style={styles.topHeader}>
        <Pressy
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'بازگشت')}
          style={styles.backButton}
        >
          <View style={[styles.backIconCircle, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
            <BackIcon size={20} color={theme.text} weight="bold" />
          </View>
        </Pressy>
        <Text variant="h1" align="start">
          {t('events.create.heading')}
        </Text>
      </View>
      <Text variant="body" color={theme.textMuted} align="start">
        {t('events.create.subheading')}
      </Text>

      <Input
        value={title}
        onChangeText={(value) => {
          setTitle(value);
          if (errorKey === 'events.validation.titleRequired') setErrorKey(null);
        }}
        label={t('events.create.titleLabel')}
        error={errorKey ? t(errorKey) : undefined}
        testID="create-title"
        style={styles.field}
      />

      <Text variant="caption" color={theme.textFaint} align="start" numeric>
        {title.length}/{TITLE_MAX}
      </Text>

      <Input
        value={description}
        onChangeText={setDescription}
        label={t('events.create.descriptionLabel')}
        testID="create-description"
        style={styles.field}
      />

      <Text variant="bodyL" align="start" style={styles.sectionTitle}>
        {t('events.create.activityLabel')}
      </Text>
      <View style={styles.chips}>
        {ACTIVITY_TYPES.map((token) => (
          <Chip
            key={token}
            label={t(`events.create.activity.${token}`)}
            selected={activity === token}
            onPress={() => setActivity(activity === token ? null : token)}
            testID={`create-activity-${token}`}
          />
        ))}
      </View>

      <Text variant="bodyL" align="start" style={styles.sectionTitle}>
        {t('events.create.windowLabel')}
      </Text>
      <View style={styles.chips}>
        {(['today', 'tomorrow', 'weekend', 'nextWeek'] as const).map((option) => (
          <Chip
            key={option}
            label={t(`events.create.preset.${option}`)}
            selected={preset === option}
            onPress={() => setPreset(option)}
            testID={`create-preset-${option}`}
          />
        ))}
      </View>

      <Card variant="raised" style={styles.windowCard}>
        <Text variant="caption" color={theme.textMuted} align="start" numeric>
          {windowLabel}
        </Text>
        <Stepper
          value={windowDays}
          onChange={setWindowDays}
          min={1}
          max={MAX_WINDOW_DAYS}
          label={t('events.create.windowLabel')}
          testID="create-window-days"
        />
        <Text variant="caption" color={theme.textFaint} align="start">
          {t('events.create.windowHint')}
        </Text>
      </Card>

      <Text variant="bodyL" align="start" style={styles.sectionTitle}>
        {t('events.create.deadlineLabel')}
      </Text>
      <View style={styles.chips}>
        {(['none', '24h', '48h'] as const).map((option) => (
          <Chip
            key={option}
            label={t(`events.create.deadline.${option}`)}
            selected={deadlinePreset === option}
            onPress={() => setDeadlinePreset(option)}
            testID={`create-deadline-${option}`}
          />
        ))}
      </View>

      <Button
        label={t('events.create.submit')}
        onPress={() => void submit()}
        loading={isSubmitting}
        disabled={isSubmitting}
        variant="primary"
        testID="create-submit"
        style={styles.action}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  backButton: {
    padding: space[1],
  },
  backIconCircle: {
    width: size.stepperButton,
    height: size.stepperButton,
    borderRadius: radius.pill,
    borderWidth: border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[2],
  },
  field: {
    marginTop: space[3],
  },
  sectionTitle: {
    marginTop: space[5],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[2],
  },
  windowCard: {
    gap: space[3],
    marginTop: space[3],
    borderRadius: radius.lg,
  },
  action: {
    marginTop: space[8],
  },
});

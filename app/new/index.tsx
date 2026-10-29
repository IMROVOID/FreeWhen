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
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BookOpen,
  Cake,
  CaretLeft,
  CaretRight,
  Coffee,
  FilmSlate,
  ForkKnife,
  GameController,
  Mountains,
  Sparkle,
  type Icon,
} from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { DateSelectionComponent } from '@/src/components/ui/DateSelectionComponent';
import { Input } from '@/src/components/ui/Input';
import { Pressy } from '@/src/components/ui/Pressy';
import { Stepper } from '@/src/components/ui/Stepper';
import { Text } from '@/src/components/ui/Text';
import { createEvent } from '@/src/features/events/services/create-event';
import { extractInviteToken } from '@/src/features/events/utils/invite-token';
import { formatDate } from '@/src/lib/format';
import { getStoredUserId } from '@/src/lib/session';
import { isApiFailure } from '@/src/lib/api';
import { isRtlLayout } from '@/src/platform/layout-direction';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import { ACTIVITY_TYPES, TITLE_MAX, type ActivityType } from '@/src/types/event';
import type { Language } from '@/src/i18n/types';

const DAY_MS = 86_400_000;

/** The start-hour of an evening meetup. Late afternoon, so the window is real. */
const START_HOUR = 17;

/**
 * The icon each activity carries on its card.
 *
 * The label alone was ambiguous once the chips became cards — «دیگر» next to a
 * fork and a mountain reads as a category rather than "something else". Pairing
 * every token with a glyph is what makes the row scannable.
 */
const ACTIVITY_ICONS: Record<ActivityType, Icon> = {
  dinner: ForkKnife,
  coffee: Coffee,
  study: BookOpen,
  birthday: Cake,
  hiking: Mountains,
  movie: FilmSlate,
  games: GameController,
  other: Sparkle,
};

/** The maximum window length offered. */
const MAX_WINDOW_DAYS = 14;

/** Iran's weekend starts on Thursday; `getDay()` gives 4 for it. */
const THURSDAY = 4;

/**
 * The activity card's dimensions.
 *
 * A tile wide enough for a 24px glyph and the longest label («کوه‌نوردی»),
 * tall enough to hold both on two lines. Style Guide §11 has no entry for a
 * selectable card, so — like the chat's empty box — it is named here rather
 * than inlined as a literal `gate:design` would reject.
 */
const ACTIVITY_CARD_WIDTH = 76;
const ACTIVITY_CARD_HEIGHT = 80;

type DayPreset = 'today' | 'tomorrow' | 'weekend' | 'custom';
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

const PRESET_OFFSET: Record<Exclude<DayPreset, 'custom'>, () => number> = {
  today: () => 0,
  tomorrow: () => 1,
  weekend: offsetToThursday,
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
  const [customStartDate, setCustomStartDate] = useState<string>(() => dayStart(0).toISOString());
  const [windowDays, setWindowDays] = useState(3);
  const [deadlinePreset, setDeadlinePreset] = useState<DeadlinePreset>('none');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const start =
    preset === 'custom'
      ? (() => {
          const d = new Date(customStartDate);
          d.setHours(START_HOUR, 0, 0, 0);
          return d;
        })()
      : dayStart(PRESET_OFFSET[preset]());
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
          code: extractInviteToken(result.invite.url) ?? '',
        },
      });
    } catch (error) {
      setErrorKey(isApiFailure(error) ? error.messageKey : 'errors.unknown');
    } finally {
      setIsSubmitting(false);
    }
  };

  const windowLabel = `${formatDate(start.toISOString(), locale).primary} — ${formatDate(end.toISOString(), locale).primary}`;

  const BackIcon = isRtlLayout(i18n.language) ? CaretRight : CaretLeft;

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
          accessibilityLabel={t('common.back')}
          style={styles.backButton}
        >
          <BackIcon size={24} color={theme.text} weight="bold" />
        </Pressy>
        {/* ★ THE TITLE IS CENTRED BY A SYMMETRIC SPACER, NOT BY `flex: 1`.
            A flexed title centres inside what is LEFT of the row, which shifts
            it by half the back button's width. The spacer is the same width as
            the button, so the title sits on the screen's centre line. */}
        <View style={styles.headerTitle} pointerEvents="none">
          <Text variant="h1" align="center" numberOfLines={1}>
            {t('events.create.heading')}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>
      <Text variant="body" color={theme.textMuted} align="center">
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
      {/* ★ A HORIZONTAL CARD ROW, NOT WRAPPED CHIPS.
          Eight wrapped chips reflowed into three ragged rows, and the label was
          the only cue to what each one meant. A card carries an icon as well as
          the word, in one row that scrolls — so the set reads as one group and
          the chosen card is a filled tile rather than a tinted chip. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.activityScrollView}
        contentContainerStyle={[
          styles.activityScroll,
          isRtlLayout(i18n.language) ? styles.activityScrollRtl : styles.activityScrollLtr,
        ]}
        testID="create-activity-scroll"
      >
        {ACTIVITY_TYPES.map((token) => {
          const Icon = ACTIVITY_ICONS[token];
          const isSelected = activity === token;

          return (
            <Pressy
              key={token}
              onPress={() => setActivity(activity === token ? null : token)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={t(`events.create.activity.${token}`)}
              testID={`create-activity-${token}`}
              style={[
                styles.activityCard,
                { backgroundColor: isSelected ? theme.primary : theme.surface2 },
              ]}
            >
              <Icon
                size={24}
                weight={isSelected ? 'fill' : 'regular'}
                color={isSelected ? theme.onPrimary : theme.textMuted}
              />
              <Text
                variant="caption"
                align="center"
                numberOfLines={1}
                color={isSelected ? theme.onPrimary : theme.textMuted}
              >
                {t(`events.create.activity.${token}`)}
              </Text>
            </Pressy>
          );
        })}
      </ScrollView>

      <Text variant="bodyL" align="start" style={styles.sectionTitle}>
        {t('events.create.windowLabel')}
      </Text>
      <View style={styles.chips}>
        {(['today', 'tomorrow', 'weekend', 'custom'] as const).map((option) => (
          <Chip
            key={option}
            label={t(`events.create.preset.${option}`)}
            selected={preset === option}
            onPress={() => setPreset(option)}
            testID={`create-preset-${option}`}
          />
        ))}
      </View>

      {preset === 'custom' && (
        <DateSelectionComponent
          value={customStartDate}
          onChange={setCustomStartDate}
          testID="create-custom-calendar"
        />
      )}

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
  },
  backButton: {
    width: size.stepperButton,
    height: size.stepperButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  headerSpacer: {
    width: size.stepperButton,
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
  activityScrollView: {
    marginHorizontal: -space[5],
    /**
     * ★ THE ROW IS A HORIZONTAL SCROLLER, SO IT KEEPS THE PHYSICAL LEFT ORIGIN.
     *
     * `direction: 'ltr'` here is NOT a statement about the interface — it is
     * scoped to this scroller's scroll origin, because on web a horizontal
     * scroller inside `dir="rtl"` starts at the RIGHT edge, and with the content's
     * own `space[5]` padding the first card sat outside the viewport.
     *
     * But it also turned the CARD ORDER left-to-right, so in Persian the activity
     * set read in the wrong direction — the reported "the Event Type list should
     * be RTL on Persian". The cards themselves are `flexDirection: 'row-reverse'`
     * under RTL, which restores the reading order while the scroll origin stays
     * sane. The card's own TEXT is unaffected: `Text` sets `dir` per node.
     */
    direction: 'ltr',
  },
  /* The card row scrolls edge-to-edge across the screen's padding, with
     space[5] on each end matching the content edge. */
  activityScroll: {
    gap: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[5],
  },
  activityScrollRtl: {
    flexDirection: 'row-reverse',
  },
  activityScrollLtr: {
    flexDirection: 'row',
  },
  activityCard: {
    width: ACTIVITY_CARD_WIDTH,
    height: ACTIVITY_CARD_HEIGHT,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[1],
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

/**
 * S11 — the time slot list (Plan 06 Task 10).
 *
 * ★ THE TIMEZONE INDICATOR IS P0 (AC-3.1.4).
 *
 * A participant in Berlin reading "19:00" for a Tehran dinner will turn up at
 * 19:00 Berlin. The indicator is the difference between a correct plan and a
 * missed meeting, so it is rendered whenever the device zone differs from the
 * event's — and suppressed when the device cannot resolve its own zone, because
 * a mismatch we cannot substantiate is a scary label over no real difference.
 *
 * ★ PAST SLOTS ARE FILTERED, NOT HIDDEN.
 *
 * They stay behind a toggle. Silently dropping them loses the context of what
 * the group already considered; blocking on them would refuse a proposal that is
 * merely early. The default view is the useful one, and the switch says what it
 * does.
 */

import { useEffect, useMemo, useState } from 'react';
import { I18nManager, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Chip, SegmentedControl } from '@/src/components/ui/Chip';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { OfflineBanner } from '@/src/components/states/OfflineBanner';
import { AvailabilityGrid } from '@/src/features/availability/AvailabilityGrid';
import { ProposalCard } from '@/src/features/proposals/components/ProposalCard';
import { useProposals } from '@/src/features/proposals/hooks/useProposals';
import { trackTimezoneMismatchShown } from '@/src/features/proposals/services/analytics';
import { deviceTimezone, timezonesDiffer } from '@/src/features/proposals/services/slot-time';
import { useOffline } from '@/src/hooks/useOffline';
import { size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';
import type { Proposal } from '@/src/types/proposal';

/** Whether a proposal's slot has already started. */
function isPast(proposal: Proposal, now: number): boolean {
  return proposal.start_utc !== null && new Date(proposal.start_utc).getTime() < now;
}

/** The window the grid spans when the route did not carry one. */
const FALLBACK_WINDOW_DAYS = 14;

function daysFrom(date: string, count: number): string {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(start + count * 86_400_000).toISOString().slice(0, 10);
}

export default function TimeSlotsScreen() {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  const params = useLocalSearchParams<{
    id?: string;
    homeTz?: string;
    windowStart?: string;
    windowEnd?: string;
    meId?: string;
  }>();
  const eventId = typeof params.id === 'string' ? params.id : '';
  const homeTz = typeof params.homeTz === 'string' ? params.homeTz : 'Asia/Tehran';

  const { proposals, isLoading, errorKey, isReconnecting, reload } = useProposals(eventId);
  const { isOffline, pendingCount } = useOffline();
  const [showPast, setShowPast] = useState(false);

  // ★ PHASE 14 — THE GRID IS A SECOND VIEW OF THE SAME LIST (FR-3.10).
  //
  // The toggle switches between two renderings of `proposals`; there is no second
  // fetch and no second store. A grid that read its own endpoint is how the two
  // views come to answer "when can people meet?" differently.
  const [view, setView] = useState<'list' | 'grid'>('list');

  // The window's calendar days, in the event's zone. The route carries them when
  // it has them; otherwise the proposal list's own span is the honest default.
  const windowStartDate = typeof params.windowStart === 'string' ? params.windowStart.slice(0, 10) : '';
  const windowEndDate =
    typeof params.windowEnd === 'string'
      ? params.windowEnd.slice(0, 10)
      : daysFrom(windowStartDate || '2026-01-01', FALLBACK_WINDOW_DAYS);

  const myProposalIds = useMemo(() => new Set<string>(), []);

  // The device zone is read once per mount: it does not change while a screen
  // is open, and re-reading it per render would be a wasted Intl lookup.
  const showsLocalTime = useMemo(
    () => timezonesDiffer(deviceTimezone(), homeTz),
    [homeTz],
  );

  // The indicator is P0, so the fact that it was needed is worth measuring.
  useEffect(() => {
    const zone = deviceTimezone();
    if (timezonesDiffer(zone, homeTz) && zone) {
      trackTimezoneMismatchShown(zone, homeTz);
    }
  }, [homeTz]);

  const timed = useMemo(
    () => proposals.filter((proposal) => proposal.start_utc !== null),
    [proposals],
  );

  const now = Date.now();
  const visible = showPast ? timed : timed.filter((proposal) => !isPast(proposal, now));
  const pastCount = timed.length - timed.filter((proposal) => !isPast(proposal, now)).length;

  if (isLoading) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.bg, paddingTop: insets.top + space[6], paddingHorizontal: space[5] },
        ]}
      >
        <ListSkeleton rows={2} testID="slots-loading" />
      </View>
    );
  }

  if (errorKey) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.bg, paddingTop: insets.top + space[6], paddingHorizontal: space[5] },
        ]}
      >
        <ErrorState
          messageKey={errorKey}
          onRetry={() => router.back()}
          retryKey="common.back"
          testID="slots-error"
        />
      </View>
    );
  }

  const BackIcon = I18nManager.isRTL ? CaretRight : CaretLeft;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: '/event/[id]', params: { id: eventId } });
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="slots-screen"
    >
      {isOffline && <OfflineBanner pendingCount={pendingCount} testID="slots-offline" />}

      <View style={styles.topHeader}>
        <Pressy
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'بازگشت')}
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
            {t('slots.heading')}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* ★ AC-3.1.4 — P0. */}
      {showsLocalTime && (
        <Chip
          label={t('slots.yourLocalTime')}
          testID="slots-timezone-indicator"
        />
      )}

      {/* A failed refresh is a status line, never a wall over the list. */}
      {isReconnecting && (
        <Text variant="caption" color={theme.textMuted} testID="slots-reconnecting">
          {t('proposals.reconnecting')}
        </Text>
      )}

      {pastCount > 0 && (
        <Button
          label={showPast ? t('slots.hidePast') : t('slots.showPast')}
          onPress={() => setShowPast((current) => !current)}
          variant="ghost"
          size="small"
          testID="slots-toggle-past"
        />
      )}

      <SegmentedControl
        options={[
          { value: 'list', label: t('availability.viewList') },
          { value: 'grid', label: t('availability.viewGrid') },
        ]}
        value={view}
        onChange={(next) => setView(next === 'grid' ? 'grid' : 'list')}
        testID="slots-view-toggle"
      />

      {view === 'grid' ? (
        <AvailabilityGrid
          eventId={eventId}
          proposals={proposals}
          windowStartDate={windowStartDate}
          windowEndDate={windowEndDate}
          homeTz={homeTz}
          locale={locale}
          onChanged={() => void reload()}
          myProposalIds={myProposalIds}
          testID="slots-grid"
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={t('slots.emptyTitle')}
          body={t('slots.emptyBody')}
          actionLabel={t('proposals.newProposal')}
          onAction={() => router.push(`/event/${eventId}/propose`)}
          testID="slots-empty"
        />
      ) : (
        <View style={styles.list}>
          {visible.map((proposal) => (
            <View key={proposal.id} style={styles.row}>
              <ProposalCard
                proposal={proposal}
                homeTz={homeTz}
                testID={`slots-card-${proposal.id}`}
              />
              {isPast(proposal, now) && (
                <Card variant="raised" style={styles.pastBadge}>
                  <Text variant="caption" color={theme.textFaint}>
                    {t('slots.pastBadge')}
                  </Text>
                </Card>
              )}
            </View>
          ))}
        </View>
      )}

      {visible.length > 0 && (
        <Button
          label={t('proposals.newProposal')}
          onPress={() => router.push(`/event/${eventId}/propose`)}
          testID="slots-new-proposal"
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[3],
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
  list: {
    gap: space[3],
    marginTop: space[2],
  },
  row: {
    gap: space[1],
  },
  pastBadge: {
    alignSelf: 'flex-start',
  },
});

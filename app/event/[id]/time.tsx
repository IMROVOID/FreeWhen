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
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityIndicator } from 'react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Text } from '@/src/components/ui/Text';
import { ProposalCard } from '@/src/features/proposals/components/ProposalCard';
import { useProposals } from '@/src/features/proposals/hooks/useProposals';
import { trackTimezoneMismatchShown } from '@/src/features/proposals/services/analytics';
import { deviceTimezone, timezonesDiffer } from '@/src/features/proposals/services/slot-time';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Proposal } from '@/src/types/proposal';

/** Whether a proposal's slot has already started. */
function isPast(proposal: Proposal, now: number): boolean {
  return proposal.start_utc !== null && new Date(proposal.start_utc).getTime() < now;
}

export default function TimeSlotsScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const params = useLocalSearchParams<{ id?: string; homeTz?: string }>();
  const eventId = typeof params.id === 'string' ? params.id : '';
  const homeTz = typeof params.homeTz === 'string' ? params.homeTz : 'Asia/Tehran';

  const { proposals, isLoading, errorKey, isReconnecting } = useProposals(eventId);
  const [showPast, setShowPast] = useState(false);

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
      <View style={[styles.centered, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <ActivityIndicator color={theme.textMuted} testID="slots-loading" />
      </View>
    );
  }

  if (errorKey) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <EmptyState
          title={t('slots.heading')}
          body={t(errorKey)}
          actionLabel={t('common.back')}
          onAction={() => router.back()}
          testID="slots-error"
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="slots-screen"
    >
      <Text variant="h1">{t('slots.heading')}</Text>

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

      {visible.length === 0 ? (
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

      <Button
        label={t('proposals.newProposal')}
        onPress={() => router.push(`/event/${eventId}/propose`)}
        testID="slots-new-proposal"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[3],
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

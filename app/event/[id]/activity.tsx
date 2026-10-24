/**
 * S14 — the event history (Plan 11 Task 6, PRD-11 §6, FR-8.44).
 *
 * ★ ACTIONS ONLY. THERE IS NO COORDINATE ON THIS SCREEN, ANYWHERE.
 *
 * The log is participant-visible, so a coordinate rendered here would undo the
 * privacy work of Phase 9 in one screen. The server already refuses to store
 * one (`detail` is enum tokens and numbers), and this screen renders only the
 * fields the sentence needs — never the raw row, so a future column cannot leak
 * into the UI by being spread onto it.
 *
 * ★ ONE SENTENCE PER LOCALE, FROM TOKENS, NOT FROM PROSE.
 *
 * Each row translates its OWN action with its `detail` tokens, so the log reads
 * correctly in whichever language is active — including entries written before
 * the language was changed. That is the whole reason `detail` is
 * `{"from":"maybe","to":"yes"}` rather than a stored sentence.
 *
 * ★ IT ANSWERS "WHO AGREED TO WHAT" AND "WHY DID THIS REOPEN".
 *
 * Both are the questions the history exists for, and the difference between a
 * group that trusts a decision and one that relitigates it.
 *
 * The route is `activity` (the catalogue namespace is `activity`, owned by
 * Phase 7, and this screen only reads it).
 */

import { useCallback, useEffect, useState } from 'react';
import { I18nManager, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { EmptyState } from '@/src/components/states/EmptyState';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { OfflineBanner } from '@/src/components/states/OfflineBanner';
import { fetchActivity } from '@/src/features/voting/services/voting-api';
import { useOffline } from '@/src/hooks/useOffline';
import { formatGregorian, formatJalali } from '@/src/lib/jalali';
import { getStoredUserId } from '@/src/lib/session';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';
import type { ActivityEntry } from '@/src/types/vote';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; entries: ActivityEntry[] };

export default function ActivityScreen() {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const params = useLocalSearchParams<{ id?: string }>();
  const eventId = typeof params.id === 'string' ? params.id : '';

  const { isOffline, pendingCount } = useOffline();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  const load = useCallback(async () => {
    setState({ kind: 'loading' });

    try {
      const userId = await getStoredUserId();
      const entries = await fetchActivity(eventId, userId);
      setState({ kind: 'ready', entries });
    } catch {
      setState({ kind: 'error' });
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      testID="activity-screen"
    >
      {isOffline && <OfflineBanner pendingCount={pendingCount} testID="activity-offline" />}

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
        <View style={styles.header}>
          <Text variant="h1">{t('activity.title')}</Text>
          {/* ★ The absence of coordinates is STATED, not merely true. */}
          <Text variant="caption" color={theme.textMuted} testID="activity-subheading">
            {t('activity.subheading')}
          </Text>
        </View>
      </View>

      {state.kind === 'loading' && <ListSkeleton rows={4} testID="activity-loading" />}

      {state.kind === 'error' && (
        <ErrorState
          messageKey="activity.loadFailed"
          onRetry={() => void load()}
          testID="activity-error"
        />
      )}

      {state.kind === 'ready' && state.entries.length === 0 && (
        <EmptyState
          prompt={t('activity.empty')}
          action={
            <Button
              label={t('common.back')}
              variant="secondary"
              size="medium"
              onPress={() => router.back()}
              testID="activity-empty-back"
            />
          }
          testID="activity-empty"
        />
      )}

      {state.kind === 'ready' && state.entries.length > 0 && (
        <View style={styles.list} testID="activity-list">
          {state.entries.map((entry) => (
            <Card key={entry.id} variant="surface" testID={`activity-row-${entry.id}`}>
              <View style={styles.row}>
                <Text variant="body">{describe(entry, t, locale)}</Text>
                <Text variant="caption" color={theme.textFaint} numeric>
                  {entry.created_at
                    ? locale === 'fa'
                      ? formatJalali(entry.created_at, 'fa')
                      : formatGregorian(entry.created_at)
                    : t('states.unknown')}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * One activity row as a sentence in the active language.
 *
 * A model without a name still gets a sentence — `actor_name` is null when the
 * participant was deleted, and rendering nothing would hide that the action
 * happened at all. The unknown-actor wording is the honest option: the event
 * occurred, we no longer know who.
 */
function describe(entry: ActivityEntry, t: Translate, locale: Language): string {
  const actor = entry.actor_name ?? t('a11y.roles.visitor');
  const detail = entry.detail;

  const detailText = (key: string): string => {
    const value = detail[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  };

  switch (entry.action) {
    case 'proposal_created':
      return t('activity.actions.proposal_created', {
        actor,
        title: detailText('title') || t('states.unknown'),
      });

    case 'proposal_withdrawn':
      return t('activity.actions.proposal_withdrawn', {
        actor,
        title: detailText('title') || t('states.unknown'),
      });

    case 'vote_cast':
      return t('activity.actions.vote_cast', {
        actor,
        value: voteWord(detailText('value'), t, locale),
      });

    case 'vote_changed':
      return t('activity.actions.vote_changed', {
        actor,
        from: voteWord(detailText('from'), t, locale),
        to: voteWord(detailText('to'), t, locale),
      });

    case 'confirmed':
      return t('activity.actions.confirmed', { actor });

    case 'reopened':
      return t('activity.actions.reopened', { actor });

    default:
      return t('activity.actions.unknown', { actor });
  }
}

/** A vote token as the word the voting controls use. */
function voteWord(value: string, t: Translate, _locale: Language): string {
  return value === 'yes' || value === 'maybe' || value === 'no'
    ? t(`voting.${value}`)
    : t('states.unknown');
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[4],
  },
  header: {
    gap: space[1],
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
  list: {
    gap: space[2],
  },
  row: {
    gap: space[1],
  },
});

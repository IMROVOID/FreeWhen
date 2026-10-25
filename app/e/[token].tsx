/**
 * S4 — the join screen. **This is the funnel.** (Plan 05 Task 9, PRD-11 S4)
 *
 * One field, one button, one warning line, and no permission prompt of any kind.
 * A stranger taps a link in WhatsApp, types a name, and is in — that is the
 * whole competitive advantage over an app that makes them create an account
 * first, and every element added here spends it.
 *
 * ★ AN INVALID LINK NEVER REVEALS WHETHER THE EVENT EXISTS.
 *
 * The message is generic and the offered action is "create your own", not
 * "contact the organizer" — anything more specific would confirm the event to
 * someone holding a dead token (FR-1.13). `EVENT_FULL` is different on purpose:
 * it is reachable only with a valid token, so naming it helps and leaks nothing.
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from 'react-native';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { LanguageToggle } from '@/src/features/events/components/LanguageToggle';
import { JoinForm } from '@/src/features/participants/components/JoinForm';
import { joinEvent } from '@/src/features/participants/services/join';
import { resolveInvite } from '@/src/features/events/services/invite';
import { isApiFailure, isNetworkError } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { InviteResolution } from '@/src/types/event';

type Phase = 'loading' | 'ready' | 'invalid' | 'full' | 'error';

export default function JoinScreen() {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();

  const token = typeof params.token === 'string' ? params.token : '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [event, setEvent] = useState<InviteResolution | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  // Captured once, at mount, so `guest_joined.seconds_from_open` measures the
  // funnel from the link tap — not from app launch (PRD-12 §8.1).
  const [openedAt] = useState(() => new Date().toISOString());
  const [userId, setUserId] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    setPhase('loading');
    const stored = await getStoredUserId();
    setUserId(stored);

    try {
      const resolved = await resolveInvite(token, stored);
      setEvent(resolved);
      setPhase('ready');
    } catch (error) {
      if (isNetworkError(error)) {
        setPhase('error');
        return;
      }
      setPhase(isApiFailure(error) && error.code === 'EVENT_FULL' ? 'full' : 'invalid');
    }
  }, [token]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const submit = useCallback(async () => {
    const trimmed = name.trim();

    if (trimmed === '') {
      setNameError('events.validation.nameRequired');
      return;
    }

    setNameError(null);
    setIsSubmitting(true);

    try {
      const result = await joinEvent(token, trimmed, { openedAt, userId });

      // A returning identity is routed to its existing participant row rather
      // than a second one (FR-1.20); the screen says so, briefly.
      if (!result.created) setIsReturning(true);

      router.replace({
        pathname: '/e/[token]/location',
        params: { token, event_id: result.event.event_id },
      });
    } catch (error) {
      if (isApiFailure(error)) {
        if (error.code === 'EVENT_FULL') {
          setPhase('full');
          return;
        }
        if (error.code === 'INVITE_INVALID') {
          setPhase('invalid');
          return;
        }
        setNameError(error.fieldError('display_name') ?? error.messageKey);
        return;
      }

      // A transport failure keeps the form and its input: the join may still
      // succeed on a retry, and losing the typed name would be a worse outcome
      // than the failed request itself.
      if (isNetworkError(error)) {
        setNameError('states.serverConnectionBody');
      } else {
        setNameError('errors.unknown');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [name, openedAt, router, token, userId]);

  const switchLanguage = () => {
    // The direction is decided at start-up, so a switch needs a restart
    // (PRD-10 D11). The catalogue is NOT changed in place: English
    // text in a Persian layout is worse than either language alone.
    //
    // The preference has ALREADY been persisted by the toggle — this is the
    // prompt that tells the guest what to expect, and it is the only
    // thing the join screen does with the choice.
    Alert.alert(
      t('app.language'),
      t('app.restartRequired'),
      [{ text: t('common.ok'), onPress: () => router.replace('/') }],
    );
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[10], paddingBottom: insets.bottom + space[8] },
      ]}
      keyboardShouldPersistTaps="handled"
      testID="join-screen"
    >
      {/* ★ A SKELETON, NOT A SPINNER (§6) — the form's shape is what arrives. */}
      {phase === 'loading' && <ListSkeleton rows={2} testID="join-loading" />}

      {phase === 'error' && (
        <ErrorState
          titleKey="states.serverConnectionTitle"
          messageKey="states.serverConnectionBody"
          onRetry={() => void resolve()}
          testID="join-error"
        />
      )}

      {phase === 'invalid' && (
        <EmptyState
          title={t('join.invalidTitle')}
          body={t('join.invalidBody')}
          actionLabel={t('join.createOwn')}
          onAction={() => router.replace('/new')}
          testID="join-invalid"
        />
      )}

      {phase === 'full' && (
        <EmptyState
          title={t('join.fullTitle')}
          body={t('join.fullBody')}
          actionLabel={t('join.createOwn')}
          onAction={() => router.replace('/new')}
          testID="join-full"
        />
      )}

      {phase === 'ready' && event && (
        <>
          <JoinForm
            title={event.title}
            participantCount={event.participant_count}
            name={name}
            onChangeName={(value) => {
              setName(value);
              if (nameError) setNameError(null);
            }}
            onSubmit={() => void submit()}
            isSubmitting={isSubmitting}
            errorKey={nameError}
            isReturning={isReturning}
            testID="join-form"
          />

          <LanguageToggle
            current={i18n.language === 'en' ? 'en' : 'fa'}
            onChange={() => switchLanguage()}
            testID="join-language-toggle"
          />
        </>
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
    flexGrow: 1,
  },
});

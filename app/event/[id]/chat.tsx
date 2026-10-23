/**
 * D23 — the in-room chat (PRD-06 FR-6.7b).
 *
 * ★ THE BACKEND WAS ALREADY COMPLETE; THIS IS THE SCREEN THAT WAS MISSING.
 *
 * `event_message` and `message_report` have existed since migration 009, RLS has
 * scoped both to `is_event_participant` since 011 §12, and `event_message` has
 * been on the realtime publication with `chat` as its channel kind. Without a
 * screen, all of that was unreachable — a half-feature with a live schema.
 *
 * ★ A NON-PARTICIPANT GETS A REFUSAL, NOT AN EMPTY THREAD.
 *
 * The route answers `NOT_PARTICIPANT`, and this screen renders that as an honest
 * error. An empty thread would read as "nobody has spoken", which is a different
 * and false statement — exactly the confusion `EmptyState` exists to avoid.
 *
 * ★ THE BODY IS NEVER LOGGED, NEVER PUT IN AN ERROR, NEVER IN ANALYTICS.
 *
 * A failed send reports a catalogue key. The sentence the participant typed
 * stays in the composer so they can retry, and it goes nowhere else — the same
 * rule `src/lib/redact.ts` enforces on the server side.
 *
 * ★ THE THREAD UPDATES FROM TWO PATHS AND DEDUPLICATES.
 *
 * The POST result and the realtime `chat` change both deliver the same message.
 * `appendMessage` keys on id, so a sender sees one bubble rather than two, and
 * ordering is by `created_at` with an id tiebreak so two devices agree.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { EmptyState } from '@/src/components/states/EmptyState';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { ReportSheet } from '@/src/features/events/components/ReportSheet';
import {
  MESSAGE_BODY_MAX,
  appendMessage,
  canSend,
  listMessages,
  postMessage,
  type ChatMessage,
} from '@/src/features/events/services/chat';
import { useRealtime } from '@/src/features/voting/hooks/useRealtime';
import { isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export default function ChatScreen() {
  const { t: theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const params = useLocalSearchParams<{ id?: string }>();
  const eventId = typeof params.id === 'string' ? params.id : '';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [reporting, setReporting] = useState<ChatMessage | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const userId = await getStoredUserId();
      const loaded = await listMessages(eventId, userId);

      if (mounted.current) {
        setMessages(loaded);
        setErrorKey(null);
      }
    } catch (error) {
      if (!mounted.current) return;

      // A 403 is the honest "you are not in this event" state, distinct from a
      // transport failure the user can retry.
      setErrorKey(isApiFailure(error) ? error.messageKey : 'chat.loadFailed');
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The `chat` channel carries `event_message`; any change refetches. The
  // polling floor lives in the engine, so a dead socket still shows new messages.
  useRealtime({ eventId, refetch: () => void load() });

  const send = useCallback(async () => {
    if (!canSend(draft) || sending) return;

    setSending(true);
    setSendError(null);

    try {
      const userId = await getStoredUserId();
      const created = await postMessage(eventId, draft, userId);

      if (!mounted.current) return;

      // Deduplicated against the realtime echo, so the sender sees one bubble.
      setMessages((current) => appendMessage(current, created));
      setDraft('');
    } catch {
      // ★ THE DRAFT SURVIVES A FAILED SEND.
      //
      // Clearing the composer would destroy the sentence the participant just
      // typed — the one thing they cannot get back. The key names the failure;
      // the text stays where they can retry it.
      if (mounted.current) setSendError('chat.sendFailed');
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [draft, eventId, sending]);

  if (isLoading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, padding: space[5] }]}>
        <ListSkeleton rows={4} testID="chat-loading" />
      </View>
    );
  }

  if (errorKey !== null) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, padding: space[5] }]}>
        <ErrorState
          messageKey={errorKey}
          onRetry={() => void load()}
          testID="chat-unavailable"
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[6], paddingBottom: space[6] },
        ]}
        testID="chat-screen"
      >
        <Text variant="h1">{t('chat.title')}</Text>

        <Text variant="caption" color={theme.textMuted}>
          {t('chat.hint')}
        </Text>

        {messages.length === 0 ? (
          <EmptyState prompt={t('chat.empty')} testID="chat-empty" />
        ) : (
          messages.map((message) => (
            <Card key={message.id} variant="raised" style={styles.bubble} testID={`chat-${message.id}`}>
              <Text variant="caption" color={theme.textMuted}>
                {message.sender_name}
              </Text>
              <Text variant="body">{message.body}</Text>

              {/* ★ THE REPORT ACTION IS THE APPLE §1.2 OBLIGATION.
                  It is present on every message, not behind a menu: a UGC
                  surface where reporting is hard to find is the one that gets
                  rejected, and the one a harassed participant cannot use. */}
              <Button
                label={t('chat.report')}
                variant="ghost"
                size="small"
                onPress={() => setReporting(message)}
                testID={`chat-report-${message.id}`}
              />
            </Card>
          ))
        )}
      </ScrollView>

      <View
        style={[
          styles.composer,
          {
            paddingBottom: insets.bottom + space[3],
            borderTopColor: theme.line,
            backgroundColor: theme.bg,
          },
        ]}
      >
        <Input
          value={draft}
          onChangeText={setDraft}
          label={t('chat.placeholder')}
          testID="chat-input"
        />

        <Text variant="caption" color={theme.textFaint}>
          {t('chat.remaining', { count: Math.max(0, MESSAGE_BODY_MAX - draft.trim().length) })}
        </Text>

        {sendError !== null && (
          <Text variant="caption" color={theme.danger} accessibilityLiveRegion="polite">
            {t(sendError)}
          </Text>
        )}

        <View style={styles.composerActions}>
          <Button
            label={t('chat.send')}
            onPress={() => void send()}
            disabled={!canSend(draft)}
            loading={sending}
            testID="chat-send"
          />
          <Button
            label={t('common.back')}
            variant="ghost"
            size="medium"
            onPress={() => router.back()}
            testID="chat-back"
          />
        </View>
      </View>

      <ReportSheet
        messageId={reporting?.id ?? null}
        visible={reporting !== null}
        onDismiss={() => setReporting(null)}
        testID="chat-report-sheet"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[5], gap: space[3] },
  bubble: { gap: space[2] },
  composer: {
    paddingHorizontal: space[5],
    paddingTop: space[3],
    borderTopWidth: 1,
    gap: space[2],
  },
  composerActions: { flexDirection: 'row', gap: space[3] },
});

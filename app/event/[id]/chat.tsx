/**
 * D23 — the in-room chat (PRD-06 FR-6.7b).
 *
 * Requirements:
 * - Back button beside page title.
 * - User messages on right, other's on left with username & datetime.
 * - Long-press menu with Edit and Delete options for own messages, Report for others.
 * - Icon send button inside the text input box.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  I18nManager,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowUp,
  CaretLeft,
  CaretRight,
  PencilSimple,
  Trash,
  Warning,
  X,
} from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { EmptyState } from '@/src/components/states/EmptyState';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { ReportSheet } from '@/src/features/events/components/ReportSheet';
import {
  appendMessage,
  canSend,
  deleteMessage,
  editMessage,
  listMessages,
  postMessage,
  type ChatMessage,
} from '@/src/features/events/services/chat';
import { useRealtime } from '@/src/features/voting/hooks/useRealtime';
import { isApiFailure } from '@/src/lib/api';
import { toPersianDigits } from '@/src/lib/jalali';
import { getStoredUserId } from '@/src/lib/session';
import { fonts } from '@/src/theme/fonts';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

function formatTime(iso: string, isFa: boolean): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;
    return isFa ? toPersianDigits(timeStr) : timeStr;
  } catch {
    return '';
  }
}

export default function ChatScreen() {
  const { t: theme } = useTheme();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const isFa = i18n.language === 'fa';
  const BackIcon = I18nManager.isRTL ? CaretRight : CaretLeft;

  const params = useLocalSearchParams<{ id?: string }>();
  const eventId = typeof params.id === 'string' ? params.id : '';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
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
      const result = await listMessages(eventId, userId);

      if (mounted.current) {
        setMessages(result.messages);
        if (result.myParticipantId) {
          setMyParticipantId(result.myParticipantId);
        }
        setErrorKey(null);
      }
    } catch (error) {
      if (!mounted.current) return;
      setErrorKey(isApiFailure(error) ? error.messageKey : 'chat.loadFailed');
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime({ eventId, refetch: () => void load() });

  const handleSend = useCallback(async () => {
    if (!canSend(draft) || sending) return;

    setSending(true);
    setSendError(null);

    try {
      const userId = await getStoredUserId();

      if (editingMessage) {
        const updated = await editMessage(editingMessage.id, draft, userId);
        if (mounted.current) {
          setMessages((current) =>
            current.map((m) => (m.id === updated.id ? updated : m)),
          );
          setEditingMessage(null);
          setDraft('');
        }
      } else {
        const created = await postMessage(eventId, draft, userId);
        if (mounted.current) {
          setMessages((current) => appendMessage(current, created));
          setDraft('');
        }
      }
    } catch {
      if (mounted.current) setSendError('chat.sendFailed');
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [draft, editingMessage, eventId, sending]);

  const handleDelete = useCallback((message: ChatMessage) => {
    setSelectedMessage(null);
    Alert.alert(
      t('chat.deleteTitle', 'حذف پیام'),
      t('chat.deleteConfirm', 'آیا از حذف این پیام اطمینان دارید؟'),
      [
        { text: t('common.cancel', 'انصراف'), style: 'cancel' },
        {
          text: t('common.delete', 'حذف'),
          style: 'destructive',
          onPress: async () => {
            try {
              const userId = await getStoredUserId();
              await deleteMessage(message.id, userId);
              setMessages((current) => current.filter((m) => m.id !== message.id));
            } catch {
              Alert.alert(t('common.error', 'خطا'), t('chat.deleteFailed', 'حذف پیام ناموفق بود.'));
            }
          },
        },
      ],
    );
  }, [t]);

  const startEdit = useCallback((message: ChatMessage) => {
    setSelectedMessage(null);
    setEditingMessage(message);
    setDraft(message.body);
  }, []);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: '/event/[id]', params: { id: eventId } });
    }
  };

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
        <ErrorState messageKey={errorKey} onRetry={() => void load()} testID="chat-unavailable" />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {/* Top Header Row with Back Button */}
      <View style={[styles.topHeader, { paddingTop: insets.top + space[3] }]}>
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
        <View style={styles.headerTitle}>
          <Text variant="h1">{t('chat.title')}</Text>
          <Text variant="caption" color={theme.textMuted}>
            {t('chat.hint')}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: space[4] }]}
        testID="chat-screen"
      >
        {messages.length === 0 ? (
          <EmptyState prompt={t('chat.empty')} testID="chat-empty" />
        ) : (
          messages.map((message) => {
            const isMe = myParticipantId ? message.participant_id === myParticipantId : false;
            return (
              <Pressy
                key={message.id}
                onLongPress={() => setSelectedMessage(message)}
                accessibilityRole="button"
                accessibilityLabel={`${message.sender_name}: ${message.body}`}
                testID={`chat-${message.id}`}
                style={[styles.messageWrapper, isMe ? styles.alignToRight : styles.alignToLeft]}
              >
                <View
                  style={[
                    styles.bubble,
                    isMe
                      ? [styles.bubbleRight, { backgroundColor: theme.surface3, borderColor: theme.brand }]
                      : [styles.bubbleLeft, { backgroundColor: theme.surface2, borderColor: theme.line }],
                  ]}
                >
                  <View style={styles.bubbleHeader}>
                    <Text variant="caption" weight={700} color={isMe ? theme.brand : theme.primary}>
                      {isMe ? t('chat.you', 'شما') : message.sender_name}
                    </Text>
                    <Text variant="caption" color={theme.textFaint} numeric>
                      {formatTime(message.created_at, isFa)}
                    </Text>
                  </View>
                  <Text variant="body" color={theme.text}>
                    {message.body}
                  </Text>
                </View>
              </Pressy>
            );
          })
        )}
      </ScrollView>

      {/* Composer Section with inline Send Icon */}
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
        {editingMessage && (
          <View style={[styles.editingBanner, { backgroundColor: theme.surface2 }]}>
            <View style={styles.editingInfo}>
              <PencilSimple size={16} color={theme.brand} />
              <Text variant="caption" color={theme.brand}>
                {t('chat.editing', 'در حال ویرایش پیام')}
              </Text>
            </View>
            <Pressy
              onPress={() => {
                setEditingMessage(null);
                setDraft('');
              }}
              style={styles.cancelEditBtn}
            >
              <X size={16} color={theme.textMuted} />
            </Pressy>
          </View>
        )}

        <View style={[styles.inputBox, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chat.placeholder', 'پیامی بنویسید...')}
            placeholderTextColor={theme.textFaint}
            style={[styles.textInput, { color: theme.text, fontFamily: fonts.persian[500] }]}
            multiline
            testID="chat-input"
          />
          <Pressy
            onPress={() => void handleSend()}
            disabled={!canSend(draft) || sending}
            accessibilityRole="button"
            accessibilityLabel={t('chat.send', 'ارسال')}
            testID="chat-send"
            style={styles.sendIconBtn}
          >
            <View
              style={[
                styles.sendIconCircle,
                {
                  backgroundColor: canSend(draft) ? theme.primary : theme.surface3,
                },
              ]}
            >
              <ArrowUp
                size={18}
                color={canSend(draft) ? theme.onPrimary : theme.textFaint}
                weight="bold"
              />
            </View>
          </Pressy>
        </View>

        {sendError !== null && (
          <Text variant="caption" color={theme.danger} accessibilityLiveRegion="polite">
            {t(sendError)}
          </Text>
        )}
      </View>

      {/* Message Long-Press Context Menu Modal */}
      <Modal
        visible={selectedMessage !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMessage(null)}
      >
        <Pressy
          style={[styles.modalOverlay, { backgroundColor: theme.surface1 }]}
          onPress={() => setSelectedMessage(null)}
        >
          <View style={[styles.menuSheet, { backgroundColor: theme.surface1, borderColor: theme.line }]}>
            <Text
              variant="caption"
              color={theme.textMuted}
              numberOfLines={1}
              style={[styles.menuPreview, { borderBottomColor: theme.line }]}
            >
              {selectedMessage?.body}
            </Text>

            {selectedMessage && selectedMessage.participant_id === myParticipantId ? (
              <>
                <Pressy style={styles.menuOption} onPress={() => startEdit(selectedMessage)}>
                  <PencilSimple size={20} color={theme.text} />
                  <Text variant="body" color={theme.text}>
                    {t('common.edit', 'ویرایش پیام')}
                  </Text>
                </Pressy>
                <Pressy style={styles.menuOption} onPress={() => handleDelete(selectedMessage)}>
                  <Trash size={20} color={theme.danger} />
                  <Text variant="body" color={theme.danger}>
                    {t('common.delete', 'حذف پیام')}
                  </Text>
                </Pressy>
              </>
            ) : (
              selectedMessage && (
                <Pressy
                  style={styles.menuOption}
                  onPress={() => {
                    const msg = selectedMessage;
                    setSelectedMessage(null);
                    setReporting(msg);
                  }}
                >
                  <Warning size={20} color={theme.warning} />
                  <Text variant="body" color={theme.warning}>
                    {t('chat.report', 'گزارش پیام')}
                  </Text>
                </Pressy>
              )
            )}

            <Button
              label={t('common.cancel', 'انصراف')}
              variant="ghost"
              size="medium"
              onPress={() => setSelectedMessage(null)}
            />
          </View>
        </Pressy>
      </Modal>

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
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingBottom: space[2],
  },
  backButton: { padding: space[1] },
  backIconCircle: {
    width: size.stepperButton,
    height: size.stepperButton,
    borderRadius: radius.pill,
    borderWidth: border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, gap: space[1] },
  content: { paddingHorizontal: space[5], gap: space[3] },
  messageWrapper: { maxWidth: '82%' },
  alignToRight: {
    alignSelf: I18nManager.isRTL ? 'flex-start' : 'flex-end',
  },
  alignToLeft: {
    alignSelf: I18nManager.isRTL ? 'flex-end' : 'flex-start',
  },
  bubble: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.lg,
    borderWidth: border.hairline,
    gap: space[1],
  },
  bubbleRight: {
    borderTopRightRadius: radius.xs,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  bubbleLeft: {
    borderTopLeftRadius: radius.xs,
    borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  composer: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    borderTopWidth: border.hairline,
    gap: space[2],
  },
  editingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.sm,
  },
  editingInfo: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  cancelEditBtn: { padding: space[1] },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: border.hairline,
    paddingStart: space[4],
    paddingEnd: space[1],
    paddingVertical: space[1],
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    minHeight: 40,
    maxHeight: 100,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  sendIconBtn: { padding: space[1] },
  sendIconCircle: {
    width: size.buttonSmall,
    height: size.buttonSmall,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: space[4],
  },
  menuSheet: {
    borderRadius: radius.xl,
    borderWidth: border.hairline,
    padding: space[4],
    gap: space[3],
  },
  menuPreview: {
    paddingBottom: space[2],
    borderBottomWidth: border.hairline,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[2],
  },
});

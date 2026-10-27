/**
 * D23 — the in-room chat (PRD-06 FR-6.7b).
 *
 * Requirements:
 * - Transparent back button beside a centred title.
 * - User messages on right, other's on left with username & datetime.
 * - Long-press menu with Edit and Delete options for own messages, Report for others.
 * - Icon send button inside the text input box, morphing into an edit icon.
 *
 * ★ NO NATIVE OS DIALOGS ON THIS SCREEN.
 *
 * Deleting used to raise `Alert.alert`. A system modal is a second, differently
 * styled window over a screen that already asked the question — the user opened
 * the context menu deliberately and chose Delete. The action now runs directly
 * and its failure is reported in the composer's own error line.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowUp,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  Check,
  PencilSimple,
  Trash,
  Warning,
  X,
} from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
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
import {
  bubbleAlignment,
  startsNewDay,
} from '@/src/features/events/services/chat-rules';
import { useRealtime } from '@/src/features/voting/hooks/useRealtime';
import { isApiFailure } from '@/src/lib/api';
import { formatDate } from '@/src/lib/format';
import { toPersianDigits } from '@/src/lib/jalali';
import { getStoredUserId } from '@/src/lib/session';
import { fonts } from '@/src/theme/fonts';
import { spring } from '@/src/theme/motion';
import { radius, size, space, border } from '@/src/theme/tokens';
import { isRtlLayout } from '@/src/platform/layout-direction';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

/**
 * The empty-state card.
 *
 * Style Guide §11 sizes buttons, chips and steppers; it has no entry for this
 * box, and a raw literal in a style object is what `gate:design` rejects.
 */
const EMPTY_BOX_WIDTH = 180;
const EMPTY_BOX_HEIGHT = 160;

/** The scroll mask's band, in px. Roughly one text line — enough to dissolve. */
const MASK_HEIGHT = 26;

/**
 * How many slices the mask's fade is drawn in.
 *
 * ★ A STEPPED FADE, NOT A BLUR LAYER.
 *
 * `expo-linear-gradient` is not a dependency, and `GlassSurface` is restricted
 * by Style Guide §11.12 to the tab bar, floating map controls and sheets over
 * imagery — so the mask is drawn the way the plan allows: stacked slices of
 * `theme.bg`, each fading a step further. Eight steps over 26px is ~3px each,
 * which reads as a gradient rather than a band.
 */
const MASK_STEPS = 8;

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

/**
 * The soft edge at the top or bottom of the message list.
 *
 * Non-interactive on purpose: it sits over the scroll area, and a mask that
 * swallowed a tap would make the first and last visible messages untouchable —
 * which is exactly where a long-press to edit is most likely to land.
 */
function ScrollEdgeMask({ edge }: { edge: 'top' | 'bottom' }) {
  const { t: theme } = useTheme();

  return (
    <View
      pointerEvents="none"
      style={[styles.mask, edge === 'top' ? styles.maskTop : styles.maskBottom]}
    >
      {Array.from({ length: MASK_STEPS }, (_, index) => (
        <View
          key={`mask-${index}`}
          style={[
            styles.maskSlice,
            {
              backgroundColor: theme.bg,
              // Fully opaque where the band meets the header/composer, clear
              // where it meets the messages — so the two edges mirror.
              opacity: edge === 'top' ? 1 - index / MASK_STEPS : (index + 1) / MASK_STEPS,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function ChatScreen() {
  const { t: theme } = useTheme();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const isFa = i18n.language === 'fa';
  const locale: Language = isFa ? 'fa' : 'en';
  const isRtl = isRtlLayout(i18n.language);
  const BackIcon = isRtl ? CaretRight : CaretLeft;

  const params = useLocalSearchParams<{ id?: string }>();
  const eventId = typeof params.id === 'string' ? params.id : '';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  // ★ THE SEND CONTROL MORPHS INSTEAD OF REPLACING.
  //
  // Swapping the node would blink: the button would lose its press animation
  // and the icon would pop. One shared value drives both icons — the arrow
  // rotating and shrinking out as the pencil rotates and scales in — so the
  // control reads as one affordance changing meaning.
  const editProgress = useSharedValue(0);

  useEffect(() => {
    editProgress.value = withSpring(editingMessage ? 1 : 0, spring.snappy);
  }, [editProgress, editingMessage]);

  const sendIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - editProgress.value,
    transform: [
      { scale: 1 - editProgress.value * 0.4 },
      { rotate: `${-90 * editProgress.value}deg` },
    ],
  }));

  const editIconStyle = useAnimatedStyle(() => ({
    opacity: editProgress.value,
    transform: [
      { scale: editProgress.value },
      { rotate: `${90 * (1 - editProgress.value)}deg` },
    ],
  }));

  const handleSend = useCallback(async () => {
    if (!canSend(draft) || sending) return;

    setSending(true);
    setActionError(null);

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
    } catch (error) {
      if (mounted.current) {
        setActionError(isApiFailure(error) ? error.messageKey : 'chat.sendFailed');
      }
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [draft, editingMessage, eventId, sending]);

  /**
   * Delete, without a system modal.
   *
   * The row is removed only after the server confirms it, so a failed delete
   * cannot leave a message that looks gone and comes back on the next realtime
   * tick. The failure is a sentence under the composer, next to the send
   * failure, rather than a second window over the room.
   */
  const handleDelete = useCallback(async (message: ChatMessage) => {
    setSelectedMessage(null);
    setActionError(null);

    try {
      const userId = await getStoredUserId();
      await deleteMessage(message.id, userId);
      if (mounted.current) {
        setMessages((current) => current.filter((m) => m.id !== message.id));
      }
    } catch (error) {
      if (mounted.current) {
        setActionError(isApiFailure(error) ? error.messageKey : 'chat.deleteFailed');
      }
    }
  }, []);

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

  /** Each message with the decision that a date pill precedes it. */
  const rows = useMemo(
    () =>
      messages.map((message, index) => ({
        message,
        showDay: startsNewDay(messages, index),
      })),
    [messages],
  );

  if (isLoading) {
    return (
      // ★ `padding: space[5]` alone put the rows flush under the status bar;
      // the top inset has to be added to it, not replaced by it.
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.bg, paddingHorizontal: space[5], paddingBottom: space[5] },
          { paddingTop: insets.top + space[3] },
        ]}
      >
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

  const canSubmit = canSend(draft) && !sending;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {/* ★ TRANSPARENT BACK BUTTON, CENTRED TITLE.
          The back control lost its circle and hairline border: on a header with
          nothing behind it, an outlined disc reads as a button competing with
          the title. The spacer mirrors the button's width so the title centres
          on the SCREEN's axis, not on the space the button left over. */}
      <View style={[styles.topHeader, { paddingTop: insets.top + space[3] }]}>
        <Pressy
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'بازگشت')}
          style={styles.backButton}
        >
          <BackIcon size={24} color={theme.text} weight="bold" />
        </Pressy>
        <View style={styles.headerTitle} pointerEvents="none">
          <Text variant="h1" align="center" numberOfLines={1}>
            {t('chat.title')}
          </Text>
          <Text variant="caption" color={theme.textMuted} align="center" numberOfLines={1}>
            {t('chat.hint')}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.listArea}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            rows.length === 0 && styles.contentEmpty,
          ]}
          keyboardShouldPersistTaps="handled"
          testID="chat-screen"
        >
          {rows.length === 0 ? (
            /* ★ CENTRED, BOXED, AND ONLY AS WIDE AS IT NEEDS.
               The prompt used to stretch the full width and stick to the top of
               the list, which read as a broken message rather than a state. */
            <View
              style={[styles.emptyBox, { backgroundColor: theme.surface2 }]}
              testID="chat-empty"
            >
              <ChatCircleDots size={40} color={theme.brand} weight="duotone" />
              <Text variant="body" align="center" color={theme.textMuted}>
                {t('chat.empty')}
              </Text>
            </View>
          ) : (
            rows.map(({ message, showDay }) => {
              const isMe = myParticipantId
                ? message.participant_id === myParticipantId
                : false;

              return (
                <Fragment key={message.id}>
                  {showDay && (
                    <View style={styles.datePillWrap}>
                      <View style={[styles.datePill, { backgroundColor: theme.surface2 }]}>
                        <Text variant="caption" color={theme.textMuted} numeric>
                          {formatDate(message.created_at, locale).primary}
                        </Text>
                      </View>
                    </View>
                  )}

                  <Pressy
                    onLongPress={() => setSelectedMessage(message)}
                    accessibilityRole="button"
                    accessibilityLabel={`${message.sender_name}: ${message.body}`}
                    testID={`chat-${message.id}`}
                    style={[
                      styles.messageWrapper,
                      { alignSelf: bubbleAlignment(isMe, isRtl) },
                    ]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        isMe ? styles.bubbleRight : styles.bubbleLeft,
                        { backgroundColor: isMe ? theme.surface2 : theme.surface1 },
                      ]}
                    >
                      <View style={styles.bubbleHeader}>
                        <Text
                          variant="caption"
                          weight={700}
                          color={isMe ? theme.brand : theme.primary}
                        >
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
                </Fragment>
              );
            })
          )}
        </ScrollView>

        <ScrollEdgeMask edge="top" />
        <ScrollEdgeMask edge="bottom" />
      </View>

      {/* Composer — no divider line, no box border, send control on the right. */}
      <View
        style={[
          styles.composer,
          { paddingBottom: insets.bottom + space[3], backgroundColor: theme.bg },
        ]}
      >
        {editingMessage && (
          <View style={styles.editingBanner}>
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
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel', 'انصراف')}
              style={styles.cancelEditBtn}
            >
              <X size={16} color={theme.textMuted} />
            </Pressy>
          </View>
        )}

        <View style={styles.inputRow}>
          {/* ★ THE FIELD SITS ON A SURFACE, LIKE EVERY OTHER INPUT.
              The bare `TextInput` had no fill, so on web it rendered as loose
              text with a hard focus rectangle around it. This wrapper gives it
              the same `surface2` pill the shared `Input` primitive uses, which
              is what makes the composer match the app. */}
          <View style={[styles.inputSurface, { backgroundColor: theme.surface2 }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('chat.placeholder', 'پیامی بنویسید...')}
              placeholderTextColor={theme.textFaint}
              style={[
                styles.textInput,
                {
                  color: theme.text,
                  fontFamily: fonts.persian[500],
                  // RTL for a Persian composer, so the caret and the alignment
                  // follow the text instead of sitting on the left.
                  textAlign: 'start',
                  writingDirection: 'rtl',
                },
              ]}
              multiline
              testID="chat-input"
            />
          </View>
          <Pressy
            onPress={() => void handleSend()}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel={t('chat.send', 'ارسال')}
            testID="chat-send"
            style={styles.sendIconBtn}
          >
            <View
              style={[
                styles.sendIconCircle,
                { backgroundColor: canSubmit ? theme.primary : theme.surface3 },
              ]}
            >
              <Animated.View pointerEvents="none" style={[styles.iconLayer, sendIconStyle]}>
                <ArrowUp
                  size={18}
                  color={canSubmit ? theme.onPrimary : theme.textFaint}
                  weight="bold"
                />
              </Animated.View>
              <Animated.View pointerEvents="none" style={[styles.iconLayer, editIconStyle]}>
                <Check
                  size={18}
                  color={canSubmit ? theme.onPrimary : theme.textFaint}
                  weight="bold"
                />
              </Animated.View>
            </View>
          </Pressy>
        </View>

        {actionError !== null && (
          <Text variant="caption" color={theme.danger} accessibilityLiveRegion="polite">
            {t(actionError)}
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
        <View style={styles.modalRoot}>
          {/* ★ THE SCRIM IS A TOKEN, NOT A LITERAL BLACK.
              This used to be a half-transparent black. A literal black scrim
              dims wrongly in light mode, where the surface behind it is nearly
              white; the theme's `bg` at reduced opacity is correct in both. */}
          <View
            pointerEvents="none"
            style={[styles.scrim, { backgroundColor: theme.bg }]}
          />
          <Pressy style={styles.modalTouch} onPress={() => setSelectedMessage(null)}>
            <View
              style={[
                styles.menuSheet,
                { backgroundColor: theme.surface1, borderColor: theme.line },
              ]}
            >
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
                <Pressy style={styles.menuOption} onPress={() => void handleDelete(selectedMessage)}>
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
        </View>
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
    paddingHorizontal: space[5],
    paddingBottom: space[4],
  },
  backButton: {
    width: size.stepperButton,
    height: size.stepperButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, alignItems: 'center', gap: space[1] },
  headerSpacer: { width: size.stepperButton },
  listArea: { flex: 1 },
  content: { paddingHorizontal: space[5], gap: space[3] },
  contentEmpty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  /* The masks sit over the list's first and last visible line. */
  mask: { position: 'absolute', width: '100%', height: MASK_HEIGHT },
  maskTop: { top: 0 },
  maskBottom: { bottom: 0 },
  maskSlice: { flex: 1 },
  emptyBox: {
    width: EMPTY_BOX_WIDTH,
    height: EMPTY_BOX_HEIGHT,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    padding: space[4],
  },
  datePillWrap: { alignItems: 'center' },
  datePill: {
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  messageWrapper: { maxWidth: '82%' },
  bubble: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.lg,
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
    paddingTop: space[3],
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
  },
  inputSurface: {
    flex: 1,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    minHeight: 40,
    maxHeight: 100,
    // ★ A FILLED FIELD, NOT A BARE LINE.
    //
    // The input had no surface of its own, so on web it read as loose text
    // floating on the page — and `:focus-visible` drew a hard rectangle around
    // it, because there was no styled border for focus to belong to. The pill
    // below matches the shared `Input` primitive's surface so the composer
    // looks the same on both platforms.
    backgroundColor: 'transparent',
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  sendIconBtn: { padding: space[1] },
  sendIconCircle: {
    width: size.buttonSmall,
    height: size.buttonSmall,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Both icons occupy the same box so the crossfade reads as one control. */
  iconLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: space[4],
  },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
    opacity: 0.7,
  },
  modalTouch: {
    flex: 1,
    justifyContent: 'flex-end',
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

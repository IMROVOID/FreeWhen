/**
 * The per-proposal comment sheet (Plan 14 Task 5, PRD-02 §4.3, PRD-06 E5).
 *
 * ★ THIS IS NOT THE DECISION STATUS AREA (FR-6.11).
 *
 * Reading comments must never be how anyone learns the current state of the
 * decision. The sheet says so in its own copy (`comments.notDecision`) and it
 * renders no status, no tally and no confirm affordance. The Decision Status
 * area is where that lives; this is a place to argue about one proposal.
 *
 * ★ COMMENTS NEVER BLOCK THE MAIN FLOW.
 *
 * A failed load shows an inline retry and leaves the rest of the screen alone. A
 * failed post keeps what the user typed in the field so nothing is lost. Nothing
 * here disables voting, proposing or confirming.
 *
 * ★ WITHDRAWN PROPOSALS ARE READ-ONLY (E5).
 *
 * The composer is replaced by a note, and the existing comments stay on screen.
 * The server refuses the write too; this is the visible half of the same rule.
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { ApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { COMMENT_MAX_CHARS } from '@/src/types/comment';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import { deleteComment, fetchComments, postComment, type WireComment } from '../services/comments';

export interface CommentSheetProps {
  visible: boolean;
  onDismiss: () => void;
  proposalId: string;
  /** Blocks the composer and says why, for a withdrawn proposal (E5). */
  readOnly?: boolean;
  /** The proposal's title, so the sheet is obvious in a stack of them. */
  title: string;
  testID?: string;
}

export function CommentSheet({
  visible,
  onDismiss,
  proposalId,
  readOnly = false,
  title,
  testID,
}: CommentSheetProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [comments, setComments] = useState<WireComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const userId = await getStoredUserId();
      setComments(await fetchComments(proposalId, userId));
    } catch (error) {
      // A load failure is inline and retryable — it never blocks the screen.
      setLoadError(error instanceof ApiFailure ? error.messageKey : 'comments.loadFailed');
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  const submit = async () => {
    const trimmed = draft.trim();

    // ★ THE BUTTON STAYS ENABLED AND ANSWERS UNDER THE FIELD.
    //
    // A disabled button that never says what would enable it is the worse
    // pattern: the user taps, nothing happens, and they have to work it out.
    if (trimmed.length === 0) {
      setFieldError('comments.validation.bodyRequired');
      return;
    }
    if (trimmed.length > COMMENT_MAX_CHARS) {
      setFieldError('comments.validation.bodyTooLong');
      return;
    }

    setFieldError(null);
    setPosting(true);

    try {
      const userId = await getStoredUserId();
      const created = await postComment(proposalId, trimmed, userId);

      setComments((current) => [...current, created]);
      setDraft('');
    } catch (error) {
      // The draft is NOT cleared: the text is the user's, and losing it on a
      // failed post is the one outcome worth avoiding.
      setFieldError(error instanceof ApiFailure ? error.messageKey : 'errors.validationFailed');
    } finally {
      setPosting(false);
    }
  };

  const remove = async (commentId: string) => {
    setDeleting(commentId);

    try {
      const userId = await getStoredUserId();
      await deleteComment(commentId, userId);
      setComments((current) => current.filter((entry) => entry.id !== commentId));
    } catch {
      // A failed delete leaves the row where it is; the next open refetches.
      setLoadError('comments.loadFailed');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} snapPoints={['75%']} testID={testID}>
      <View style={styles.content}>
        <Text variant="h2" numberOfLines={2}>
          {title}
        </Text>

        <Text variant="caption" color={theme.textFaint}>
          {t('comments.count', { count: comments.length })}
        </Text>

        {/* ★ NOT A SUBSTITUTE FOR THE DECISION STATUS (FR-6.11). */}
        <Text variant="caption" color={theme.textFaint}>
          {t('comments.notDecision')}
        </Text>

        {loadError && (
          <View style={styles.errorRow}>
            <Text variant="caption" color={theme.danger}>
              {t(loadError)}
            </Text>
            <Button
              label={t('comments.retry')}
              onPress={() => void load()}
              variant="ghost"
              size="small"
              testID={testID ? `${testID}-retry` : undefined}
            />
          </View>
        )}

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {!loading && comments.length === 0 && !loadError && (
            <View style={styles.empty}>
              <Text variant="body" color={theme.textMuted}>
                {t('comments.empty')}
              </Text>
              <Text variant="caption" color={theme.textFaint}>
                {t('comments.emptyBody')}
              </Text>
            </View>
          )}

          {comments.map((comment) => (
            <View key={comment.id} style={styles.comment} testID={testID ? `${testID}-${comment.id}` : undefined}>
              <Text variant="caption" color={theme.textMuted}>
                {comment.display_name}
              </Text>

              <Text variant="body">{comment.body}</Text>

              {comment.can_delete && (
                <Button
                  label={t('comments.delete')}
                  onPress={() => void remove(comment.id)}
                  variant="ghost"
                  size="small"
                  loading={deleting === comment.id}
                  testID={testID ? `${testID}-delete-${comment.id}` : undefined}
                />
              )}
            </View>
          ))}
        </ScrollView>

        {readOnly ? (
          <Text variant="caption" color={theme.warning} testID={testID ? `${testID}-readonly` : undefined}>
            {t('comments.readOnly')}
          </Text>
        ) : (
          <>
            <Input
              value={draft}
              onChangeText={(value) => {
                setDraft(value);
                setFieldError(null);
              }}
              label={t('comments.placeholder')}
              error={fieldError ? t(fieldError) : undefined}
              multiline
              testID={testID ? `${testID}-input` : undefined}
            />

            <Text variant="caption" color={theme.textFaint}>
              {`${draft.length} / ${COMMENT_MAX_CHARS}`}
            </Text>

            <Button
              label={posting ? t('comments.submitting') : t('comments.submit')}
              onPress={() => void submit()}
              variant="brand"
              loading={posting}
              testID={testID ? `${testID}-submit` : undefined}
            />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space[5],
    gap: space[2],
    flex: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: space[3],
    paddingVertical: space[2],
  },
  empty: {
    gap: space[1],
    paddingVertical: space[4],
  },
  comment: {
    gap: space[1],
  },
});

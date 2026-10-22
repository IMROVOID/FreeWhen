/**
 * The paste-chat tab on the propose screen (Plan 14 Task 4, PRD-07 §4.2).
 *
 * ★ NOTHING IS CREATED UNTIL A CANDIDATE IS CONFIRMED (AC-7.1.1, AC-7.2.1).
 *
 * The parse endpoint writes nothing; this sheet writes nothing either. Confirming
 * N candidates runs the ordinary create path N times, so two of three selected
 * produces exactly two proposals — the acceptance criterion, achieved by having
 * no second write path at all.
 *
 * ★ A PARSE FAILURE SHOWS THE PASTED TEXT AND A MANUAL ENTRY (FR-7.9).
 *
 * "Nothing recognised" is a normal outcome, not an error screen. The user keeps
 * their text, sees the raw version of what was read, and is offered the form
 * they already know instead of a message telling them something broke.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { PASTE_MAX_CHARS, type ParsedCandidate } from '@/src/features/parser/types';
import { parseChatText } from '@/src/features/parser/services/parse-service';
import { formatJalali } from '@/src/lib/jalali';
import { isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

export interface ChatParserTabProps {
  eventId: string;
  locale: Language;
  /** Confirms one candidate through the normal create path. */
  onConfirm: (candidate: ParsedCandidate) => Promise<void>;
  /** Switches to the manual form when nothing was recognised. */
  onManualEntry: () => void;
  testID?: string;
}

export function ChatParserTab({
  eventId,
  locale,
  onConfirm,
  onManualEntry,
  testID,
}: ChatParserTabProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [text, setText] = useState('');
  const [candidates, setCandidates] = useState<ParsedCandidate[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isParsing, setIsParsing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const parse = useCallback(async () => {
    setIsParsing(true);
    setErrorKey(null);

    try {
      const userId = await getStoredUserId();
      const payload = await parseChatText(eventId, text, userId);

      setCandidates(payload.candidates);
      // ★ ALL CANDIDATES START SELECTED, AND THAT IS THE POINT.
      //
      // The user pasted a conversation because they want its options. Starting
      // empty would make them re-do the parser's work by hand; starting selected
      // makes the review a confirmation, which is what FR-7.1 describes.
      setSelected(new Set(payload.candidates.map((candidate) => candidate.id)));
    } catch (error) {
      setErrorKey(isApiFailure(error) ? error.messageKey : 'errors.unknown');
    } finally {
      setIsParsing(false);
    }
  }, [eventId, text]);

  const confirm = useCallback(async () => {
    if (!candidates) return;

    setIsConfirming(true);
    setErrorKey(null);

    try {
      for (const candidate of candidates) {
        if (!selected.has(candidate.id)) continue;
        await onConfirm(candidate);
      }
    } catch (error) {
      setErrorKey(isApiFailure(error) ? error.messageKey : 'errors.unknown');
    } finally {
      setIsConfirming(false);
    }
  }, [candidates, onConfirm, selected]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <View style={styles.container} testID={testID}>
      <Text variant="body" color={theme.textMuted}>
        {t('parser.body')}
      </Text>

      <Input
        value={text}
        onChangeText={(value) => {
          setText(value);
          setCandidates(null);
        }}
        label={t('parser.label')}
        error={errorKey ? t(errorKey) : undefined}
        testID={testID ? `${testID}-text` : undefined}
      />

      <Text variant="caption" color={theme.textFaint}>
        {`${text.length} / ${PASTE_MAX_CHARS}`}
      </Text>

      <Button
        label={t('parser.submit')}
        onPress={() => void parse()}
        loading={isParsing}
        disabled={text.trim() === ''}
        testID={testID ? `${testID}-parse` : undefined}
      />

      {candidates !== null && candidates.length === 0 && (
        <Card variant="surface" style={styles.empty} testID={testID ? `${testID}-empty` : undefined}>
          <Text variant="h3">{t('parser.nothingTitle')}</Text>
          <Text variant="body" color={theme.textMuted}>
            {t('parser.nothingBody')}
          </Text>

          {/* ★ THE RAW TEXT STAYS ON SCREEN (FR-7.9). */}
          {text.trim() !== '' && (
            <Text variant="caption" color={theme.textFaint} numberOfLines={4}>
              {text}
            </Text>
          )}

          <Button
            label={t('parser.manualEntry')}
            onPress={onManualEntry}
            variant="secondary"
            size="medium"
            testID={testID ? `${testID}-manual` : undefined}
          />
        </Card>
      )}

      {candidates !== null && candidates.length > 0 && (
        <View style={styles.list} testID={testID ? `${testID}-candidates` : undefined}>
          <Text variant="h3">{t('parser.recognisedTitle')}</Text>

          {candidates.map((candidate) => {
            const isSelected = selected.has(candidate.id);

            return (
              <Card
                key={candidate.id}
                variant={isSelected ? 'raised' : 'surface'}
                style={styles.candidate}
                testID={testID ? `${testID}-candidate-${candidate.id}` : undefined}
              >
                <Text variant="body" numberOfLines={2}>
                  {candidate.title}
                </Text>

                {candidate.local && (
                  <Text variant="caption" color={theme.textMuted}>
                    {`${candidate.local.weekday} · ${formatJalali(`${candidate.local.date}T00:00:00Z`, locale)} · ${candidate.local.time}`}
                  </Text>
                )}

                {/* ★ AN AMBIGUOUS WEEKDAY IS RESOLVED AND SHOWN (E4). */}
                {candidate.local?.resolvedFromWeekday && (
                  <Text variant="caption" color={theme.brand}>
                    {t('parser.weekdayResolved', {
                      weekday: candidate.local.weekday,
                      date: formatJalali(`${candidate.local.date}T00:00:00Z`, locale),
                    })}
                  </Text>
                )}

                <Text variant="caption" color={theme.textFaint}>
                  {`${t('parser.confidence', { percent: Math.round(candidate.confidence * 100) })} · ${t('parser.sourceDeterministic')}`}
                </Text>

                <Button
                  label={isSelected ? t('parser.deselect') : t('parser.select')}
                  onPress={() => toggle(candidate.id)}
                  variant="ghost"
                  size="small"
                  testID={testID ? `${testID}-toggle-${candidate.id}` : undefined}
                />
              </Card>
            );
          })}

          <Button
            label={t('parser.confirmSelected', { count: selected.size })}
            onPress={() => void confirm()}
            loading={isConfirming}
            disabled={selected.size === 0}
            testID={testID ? `${testID}-confirm` : undefined}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[3],
  },
  empty: {
    gap: space[3],
  },
  list: {
    gap: space[3],
  },
  candidate: {
    gap: space[2],
  },
});

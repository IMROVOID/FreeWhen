/**
 * S7 — a new proposal (Plan 06 Task 7).
 *
 * ★ ONE FLOW, ONE TYPE FIELD.
 *
 * The segmented choice at the top decides which sections below are relevant. It
 * is one screen rather than three because the user's real question is "what do I
 * want to suggest?", and splitting it into a type-first wizard asks them the
 * same question twice.
 *
 * ★ THE DUPLICATE OFFER APPEARS AFTER A SUCCESSFUL CREATE, NOT BEFORE IT.
 *
 * The proposal exists by the time the offer renders, so there is no state in
 * which a hint can prevent it. "Create anyway" therefore does not need to
 * perform a second insert — it simply dismisses the offer and returns.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { DuplicateOffer } from '@/src/features/proposals/components/DuplicateOffer';
import { ProposalTypeSegment } from '@/src/features/proposals/components/ProposalTypeSegment';
import { TimeSlotPicker, defaultEndFor } from '@/src/features/proposals/components/TimeSlotPicker';
import { useProposals } from '@/src/features/proposals/hooks/useProposals';
import { createProposal } from '@/src/features/proposals/services/create-proposal';
import { trackDuplicateResolution } from '@/src/features/proposals/services/analytics';
import { PlaceSearchSheet } from '@/src/features/venues/components/PlaceSearchSheet';
import { isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { DuplicateHint, ProposalType, VenueRef } from '@/src/types/proposal';

export default function ProposeScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const params = useLocalSearchParams<{
    id?: string;
    windowStart?: string;
    windowEnd?: string;
    homeTz?: string;
  }>();

  const eventId = typeof params.id === 'string' ? params.id : '';
  const windowStart = typeof params.windowStart === 'string' ? params.windowStart : '';
  const windowEnd = typeof params.windowEnd === 'string' ? params.windowEnd : '';
  const homeTz = typeof params.homeTz === 'string' ? params.homeTz : 'Asia/Tehran';

  const { append } = useProposals(eventId);

  const [type, setType] = useState<ProposalType>('TIME');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [startUtc, setStartUtc] = useState<string | null>(null);
  const [venue, setVenue] = useState<VenueRef | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<DuplicateHint | null>(null);

  const needsTime = type === 'TIME' || type === 'TIME_AND_PLACE';
  const needsPlace = type === 'PLACE' || type === 'TIME_AND_PLACE';

  /** The error under a field, translated. */
  const errorFor = useCallback(
    (field: string): string | undefined => {
      const key = fieldErrors[field];
      return key ? t(key) : undefined;
    },
    [fieldErrors, t],
  );

  const submit = useCallback(async () => {
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      const userId = await getStoredUserId();

      const outcome = await createProposal(
        eventId,
        {
          type,
          title: title.trim(),
          notes: notes.trim() === '' ? null : notes.trim(),
          link: link.trim() === '' ? null : link.trim(),
          start_utc: needsTime ? startUtc : null,
          end_utc: needsTime && startUtc ? defaultEndFor(startUtc) : null,
          venue: needsPlace ? venue : null,
        },
        userId,
      );

      append(outcome.proposal);

      // A hint, not a refusal: the proposal has already been created.
      if (outcome.duplicate) {
        setDuplicate(outcome.duplicate);
        return;
      }

      router.back();
    } catch (error) {
      if (isApiFailure(error)) {
        setFieldErrors(error.fields);
        return;
      }

      setFieldErrors({ _: 'errors.unknown' });
    } finally {
      setIsSubmitting(false);
    }
  }, [append, eventId, link, needsPlace, needsTime, notes, router, startUtc, title, type, venue]);

  if (duplicate) {
    return (
      <ScrollView
        style={[styles.screen, { backgroundColor: theme.bg }]}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[10] },
        ]}
        testID="propose-duplicate"
      >
        <DuplicateOffer
          duplicate={duplicate}
          onUseExisting={() => {
            trackDuplicateResolution('voted_existing', duplicate.reason);
            router.replace(`/event/${eventId}`);
          }}
          onCreateAnyway={() => {
            trackDuplicateResolution('created_anyway', duplicate.reason);
            setDuplicate(null);
            router.back();
          }}
          testID="propose-duplicate-offer"
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="propose-screen"
    >
      <Text variant="h1">{t('proposals.newProposal')}</Text>

      <ProposalTypeSegment value={type} onChange={setType} testID="propose-type" />

      <Input
        value={title}
        onChangeText={setTitle}
        label={t('proposals.form.titleLabel')}
        error={errorFor('title')}
        testID="propose-title"
      />

      {needsTime && (
        <Card variant="surface" style={styles.section}>
          <Text variant="h3">{t('proposals.form.timeSection')}</Text>
          {errorFor('start_utc') && (
            <Text variant="caption" color={theme.danger}>
              {errorFor('start_utc')}
            </Text>
          )}
          <TimeSlotPicker
            windowStart={windowStart}
            windowEnd={windowEnd}
            homeTz={homeTz}
            value={startUtc}
            onChange={setStartUtc}
            testID="propose-time"
          />
        </Card>
      )}

      {needsPlace && (
        <Card variant="surface" style={styles.section}>
          <Text variant="h3">{t('proposals.form.placeSection')}</Text>
          {errorFor('venue') && (
            <Text variant="caption" color={theme.danger}>
              {errorFor('venue')}
            </Text>
          )}

          {venue ? (
            <View style={styles.chosen}>
              <Text variant="body">{venue.name}</Text>
              {venue.address && (
                <Text variant="caption" color={theme.textMuted} numberOfLines={2}>
                  {venue.address}
                </Text>
              )}
              <Button
                label={t('proposals.form.changePlace')}
                onPress={() => setVenue(null)}
                variant="ghost"
                size="small"
                testID="propose-change-place"
              />
            </View>
          ) : (
            <PlaceSearchSheet
              onSelect={setVenue}
              // The map path routes back here with a chosen pin, so the sheet
              // stays a pure chooser rather than owning navigation.
              onPickOnMap={() => router.push(`/event/${eventId}/propose`)}
              testID="propose-place-search"
            />
          )}
        </Card>
      )}

      <Input
        value={notes}
        onChangeText={setNotes}
        label={t('proposals.form.notesLabel')}
        error={errorFor('notes')}
        testID="propose-notes"
      />

      <Input
        value={link}
        onChangeText={setLink}
        label={t('proposals.form.linkLabel')}
        error={errorFor('link')}
        testID="propose-link"
      />

      {errorFor('_') && (
        <Text variant="caption" color={theme.danger}>
          {errorFor('_')}
        </Text>
      )}

      <Button
        label={t('proposals.form.submit')}
        onPress={() => void submit()}
        loading={isSubmitting}
        disabled={title.trim() === '' || (needsTime && startUtc === null) || (needsPlace && venue === null)}
        testID="propose-submit"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[4],
  },
  section: {
    gap: space[3],
  },
  chosen: {
    gap: space[2],
  },
});

/**
 * S7 — New Proposal Page.
 *
 * Merged Time and Location selection into one single-page form:
 * - Removed the separate chat parser page and mode switch.
 * - Removed the broken segmented group.
 * - Integrated both Time Selection and Map Location Picker onto one form.
 * - Automatic type inference (TIME, PLACE, or TIME_AND_PLACE).
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeft, CaretRight, Check, Trash } from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Input } from '@/src/components/ui/Input';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { DuplicateOffer } from '@/src/features/proposals/components/DuplicateOffer';
import { TimeSlotPicker, defaultEndFor } from '@/src/features/proposals/components/TimeSlotPicker';
import { useProposals } from '@/src/features/proposals/hooks/useProposals';
import { createProposal } from '@/src/features/proposals/services/create-proposal';
import { trackDuplicateResolution } from '@/src/features/proposals/services/analytics';
import { LocationMapPicker } from '@/src/components/ui/LocationMapPicker';
import { isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { radius, size, space } from '@/src/theme/tokens';
import { isRtlLayout } from '@/src/platform/layout-direction';
import { useTheme } from '@/src/theme/useTheme';
import type { DuplicateHint, ProposalType, VenueRef } from '@/src/types/proposal';

export default function ProposeScreen() {
  const { t, i18n } = useTranslation();
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

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [startUtc, setStartUtc] = useState<string | null>(null);
  const [venue, setVenue] = useState<VenueRef | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<DuplicateHint | null>(null);

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

    // Infer proposal type based on provided inputs
    let inferredType: ProposalType = 'TIME';
    if (startUtc !== null && venue !== null) {
      inferredType = 'TIME_AND_PLACE';
    } else if (venue !== null) {
      inferredType = 'PLACE';
    } else if (startUtc !== null) {
      inferredType = 'TIME';
    } else {
      setFieldErrors({ _: 'proposals.form.requireTimeOrPlace' });
      setIsSubmitting(false);
      return;
    }

    try {
      const userId = await getStoredUserId();

      const outcome = await createProposal(
        eventId,
        {
          type: inferredType,
          title: title.trim(),
          notes: notes.trim() === '' ? null : notes.trim(),
          link: link.trim() === '' ? null : link.trim(),
          start_utc: startUtc,
          end_utc: startUtc ? defaultEndFor(startUtc) : null,
          venue,
        },
        userId,
      );

      append(outcome.proposal);

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
  }, [append, eventId, link, notes, router, startUtc, title, venue]);

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

  const BackIcon = isRtlLayout(i18n.language) ? CaretRight : CaretLeft;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: '/event/[id]', params: { id: eventId } });
    }
  };

  const hasOptionSelected = startUtc !== null || venue !== null;
  const isSubmitDisabled = title.trim() === '' || !hasOptionSelected || isSubmitting;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[10] },
      ]}
      nestedScrollEnabled={true}
      testID="propose-screen"
    >
      <View style={styles.topHeader}>
        <Pressy
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
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
            {t('proposals.newProposal')}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Proposal Title */}
      <Input
        value={title}
        onChangeText={setTitle}
        label={t('proposals.form.titleLabel')}
        error={errorFor('title')}
        testID="propose-title"
      />

      {/* 1. Time & Date Selection Section */}
      <Card variant="surface" style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text variant="h3">{t('proposals.form.timeSection')}</Text>
          {startUtc && (
            <Button
              label={t('common.clear')}
              onPress={() => setStartUtc(null)}
              variant="ghost"
              size="small"
              fullWidth={false}
            />
          )}
        </View>

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

      {/* 2. Location Selection Section */}
      <Card variant="surface" style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text variant="h3">{t('proposals.form.placeSection')}</Text>
        </View>

        {errorFor('venue') && (
          <Text variant="caption" color={theme.danger}>
            {errorFor('venue')}
          </Text>
        )}

        {venue && !showLocationPicker ? (
          <View style={styles.chosen}>
            <Text variant="bodyL" color={theme.text}>
              {venue.name}
            </Text>
            {venue.address && (
              <Text variant="caption" color={theme.textMuted} numberOfLines={2}>
                {venue.address}
              </Text>
            )}
          </View>
        ) : (
          <LocationMapPicker
            onSelect={(selectedVenue) => {
              setVenue(selectedVenue);
              setShowLocationPicker(false);
            }}
            onCancel={venue ? () => setShowLocationPicker(false) : undefined}
            // ★ THE TWO PLACE ACTIONS LIVE ON THE MAP'S CORNER, NOT THE HEADER.
            // Clearing and changing both act on the map, and they used to sit in
            // two unrelated places — one in the section header, one below the
            // venue name. Background-only icon buttons with no border, which is
            // what a map overlay can carry without competing with the tiles.
            cornerControls={
              venue ? (
                <>
                  <Pressy
                    onPress={() => {
                      setVenue(null);
                      setShowLocationPicker(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.clear')}
                    testID="propose-clear-place"
                    style={styles.mapControl}
                  >
                    <View style={[styles.mapControlInner, { backgroundColor: theme.surface1 }]}>
                      <Trash size={18} color={theme.text} weight="bold" />
                    </View>
                  </Pressy>

                  <Pressy
                    onPress={() => setShowLocationPicker(false)}
                    accessibilityRole="button"
                    accessibilityLabel={t('proposals.form.changePlace')}
                    testID="propose-change-place"
                    style={styles.mapControl}
                  >
                    <View style={[styles.mapControlInner, { backgroundColor: theme.surface1 }]}>
                      <Check size={18} color={theme.text} weight="bold" />
                    </View>
                  </Pressy>
                </>
              ) : null
            }
            testID="propose-map-picker"
          />
        )}
      </Card>

      {/* Notes & Links */}
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

      {/* Submit Button
          ★ THE SPACING ABOVE IS DELIBERATE.
          The submit sat directly under the previous field at the same gap every
          input uses, so the one control that commits the form read as a third
          field. The extra space separates the action from the form it submits. */}
      <View style={styles.submitBlock}>
        <Button
          label={t('proposals.form.submit')}
          onPress={() => void submit()}
          loading={isSubmitting}
          disabled={isSubmitDisabled}
          testID="propose-submit"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space[1],
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
  content: {
    paddingHorizontal: space[5],
    gap: space[4],
  },
  section: {
    gap: space[3],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chosen: {
    gap: space[2],
  },
  mapControl: {
    // The project's 44pt touch-control size, named in the tokens.
    width: size.stepperButton,
    height: size.stepperButton,
  },
  submitBlock: {
    paddingTop: space[4],
  },
  mapControlInner: {
    flex: 1,
    borderRadius: radius.md,
    // Background only, no border — a map overlay cannot carry an outline without
    // competing with the tiles behind it.
    alignItems: 'center',
    justifyContent: 'center',
  },
});

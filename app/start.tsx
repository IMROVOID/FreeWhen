/**
 * `/start` — the reviewer quick-start (PRD-13 §6, PRD-17 §7).
 *
 * ★ THIS IS AN APP ROUTE, NOT A HAND-WRITTEN PAGE.
 *
 * PRD-17 §7 asks the reviewer to read a ranked list, switch a lens, open a venue
 * and confirm a decision. A static page can show a title and a join form; it
 * cannot do any of steps 1–4. So the instructions live in the same bundle as
 * the product they describe (PRD-18 D18-1): one deploy, one i18n catalogue, no
 * second stylesheet to drift.
 *
 * ★ THE DEMO EVENT IS A STABLE ENV VAR, NEVER CREATED HERE.
 *
 * `EXPO_PUBLIC_DEMO_TOKEN` is inlined at export time. It must resolve to the
 * pre-seeded event (the PRD-05 fixture, `is_demo = true`) so the reviewer lands
 * in the middle of a decision rather than at an empty create screen. A token
 * minted through the UI would rotate on the next database reset and `/start`
 * would break silently (PRD-13 R "Demo token accidentally rotated").
 *
 * ★ STEP 1 IS THE WHOLE PRODUCT.
 *
 * The instruction exists so the reviewer knows where to look: the top venue says
 * who travels farthest and why. Without it the differentiator is a list of
 * numbers that looks like every other list.
 *
 * ★ EVERY STRING COMES FROM THE CATALOGUE.
 *
 * English is a shipping mode (PRD-10 D11A), so the instructions and the honesty
 * block are catalogue entries rather than Persian literals. Direction is already
 * in the served markup via `app/+html.tsx`; there is no page-local fix here.
 */

import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { LanguageToggle } from '@/src/features/settings/components/LanguageToggle';
import { QrCode } from '@/src/features/settings/components/QrCode';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

/** The five instruction steps, in PRD-17 §7's order. */
const STEPS = [1, 2, 3, 4, 5] as const;

/** The honesty block's four rows (PRD-17 §7, including the browser line). */
const HONESTY = ['real', 'estimated', 'missing', 'browser'] as const;

/**
 * The demo invite token.
 *
 * Absent on a developer machine with no `.env`, which is a supported state: the
 * page still renders the instructions and says the demo is not configured. A
 * throw here would make `/start` — the one page that must always load — the one
 * page that 500s.
 */
const DEMO_TOKEN = (process.env.EXPO_PUBLIC_DEMO_TOKEN ?? '').trim();

/** The public origin, for the link the QR encodes. */
const APP_BASE_URL = (process.env.EXPO_PUBLIC_APP_BASE_URL ?? '').replace(/\/$/, '');

export default function StartScreen() {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const invitePath = DEMO_TOKEN ? `/e/${DEMO_TOKEN}` : null;
  const inviteUrl = demoUrl(APP_BASE_URL, invitePath);
  const language: Language = i18n.language === 'en' ? 'en' : 'fa';

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="start-screen"
    >
      <Text variant="caption" color="textMuted">
        {t('web.start.eyebrow')}
      </Text>
      <Text variant="h1">{t('web.start.title')}</Text>
      <Text variant="body" color="textMuted">
        {t('web.start.lede')}
      </Text>

      {/* ★ Step one is the button itself: it does not explain how to look,
          it puts the reviewer in front of the thing to look at. */}
      {invitePath ? (
        <View style={styles.action}>
          <Button
            label={t('web.start.tryNow')}
            onPress={() => router.push(invitePath)}
            testID="start-try-now"
          />
          <Text variant="caption" color="textMuted" align="center">
            {t('web.start.tryNowHint')}
          </Text>
        </View>
      ) : (
        <Card variant="surface">
          <Text variant="body" color="textMuted">
            {t('web.start.tryNowUnavailable')}
          </Text>
        </Card>
      )}

      <Text variant="h3">{t('web.start.stepsTitle')}</Text>
      <View style={styles.steps}>
        {STEPS.map((step) => (
          <View key={step} style={styles.step}>
            <Text variant="h3" color="brand" numeric>
              {`${step}.`}
            </Text>
            <View style={styles.stepCopy}>
              <Text variant="bodyL" weight={700}>
                {t(`web.start.step${step}Title`)}
              </Text>
              <Text variant="body" color="textMuted">
                {t(`web.start.step${step}Body`)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Text variant="h3">{t('web.start.asParticipantTitle')}</Text>
      <Text variant="body" color="textMuted">
        {t('web.start.asParticipantBody')}
      </Text>

      {inviteUrl ? (
        <View style={styles.qr}>
          <QrCode value={inviteUrl} accessibilityLabel={t('web.start.qrLabel')} />
          <Text variant="caption" color="textFaint" align="center">
            {t('web.start.inviteLinkLabel')}
          </Text>
          <Text variant="caption" color="textMuted" align="center" selectable>
            {inviteUrl}
          </Text>
        </View>
      ) : (
        <Text variant="caption" color="textFaint">
          {t('web.start.qrUnavailable')}
        </Text>
      )}

      {/* ★ The honesty block is mandatory, and the browser line is part of it.
          An undocumented gap is discounted far more than a disclosed one. */}
      <Text variant="h3">{t('web.start.honestyTitle')}</Text>
      <View style={styles.honesty}>
        {HONESTY.map((row) => (
          <Card key={row} variant="raised">
            <Text variant="caption" color="brand">
              {t(`web.start.honesty${capitalise(row)}Label`)}
            </Text>
            <Text variant="body">{t(`web.start.honesty${capitalise(row)}Body`)}</Text>
          </Card>
        ))}
      </View>

      <Text variant="h3">{t('web.start.apkTitle')}</Text>
      <Text variant="body" color="textMuted">
        {t('web.start.apkBody')}
      </Text>
      <Button
        label={t('web.start.apkDownload')}
        variant="secondary"
        onPress={() => router.push('/dl/')}
        testID="start-apk"
      />

      <LanguageToggle
        current={language}
        testID="start-language-toggle"
      />
    </ScrollView>
  );
}

/**
 * The absolute invite URL, or `null` when the build has no demo token.
 *
 * On web the QR has to encode something a phone can open, so a relative path is
 * not enough — the public origin is required and its absence is reported rather
 * than papered over with `window.location` at render time (the static export
 * renders in Node, where there is no `window`).
 */
function demoUrl(baseUrl: string, path: string | null): string | null {
  if (!path || baseUrl === '') return null;
  return `${baseUrl}${path}`;
}

/** `real` → `Real`, for the catalogue key. */
function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[4],
  },
  action: {
    gap: space[2],
    marginTop: space[2],
  },
  steps: {
    gap: space[4],
  },
  step: {
    flexDirection: 'row',
    gap: space[3],
    alignItems: 'flex-start',
  },
  stepCopy: {
    flex: 1,
    gap: space[1],
  },
  qr: {
    alignItems: 'center',
    gap: space[2],
    borderRadius: radius.lg,
    paddingVertical: space[4],
  },
  honesty: {
    gap: space[2],
  },
});

/**
 * The event shell (Plan 05, PRD-11 §6).
 *
 * A `Stack` with a smooth blurred header band hosting:
 * - Back button to easily navigate back to event home.
 * - Decision status band showing live vote tallies.
 * - Smooth translucent blur background.
 */

import { I18nManager, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeft, CaretRight } from 'phosphor-react-native';
import { BlurView } from 'expo-blur';

import { DecisionStatusBand } from '@/src/features/voting/components/DecisionStatusBand';
import { Pressy } from '@/src/components/ui/Pressy';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export default function EventLayout() {
  const { t, name: themeName } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const segments = useSegments();

  const eventId = typeof params.id === 'string' ? params.id : '';

  // The last segment is the screen under `/event/[id]`
  const screen = segments[segments.length - 1] ?? 'index';
  const isSubscreen =
    screen === 'propose' ||
    screen === 'activity' ||
    screen === 'chat' ||
    screen === 'map' ||
    screen === 'people' ||
    screen === 'time';
  const showBand = eventId !== '' && isSubscreen;

  const BackIcon = I18nManager.isRTL ? CaretRight : CaretLeft;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: '/event/[id]', params: { id: eventId } });
    }
  };

  return (
    <View style={[styles.shell, { backgroundColor: t.bg }]}>
      {showBand && (
        <View style={styles.headerContainer}>
          <BlurView
            intensity={60}
            tint={themeName === 'dark' ? 'dark' : 'light'}
            style={[
              styles.blurHeader,
              {
                paddingTop: insets.top + space[2],
                borderBottomColor: t.line,
              },
            ]}
          >
            <View style={styles.headerRow}>
              <Pressy
                onPress={handleBack}
                accessibilityRole="button"
                accessibilityLabel="بازگشت"
                style={styles.backButton}
              >
                <View style={[styles.backIconCircle, { backgroundColor: t.surface2, borderColor: t.line }]}>
                  <BackIcon size={20} color={t.text} weight="bold" />
                </View>
              </Pressy>

              <View style={styles.bandFlex}>
                <DecisionStatusBand eventId={eventId} />
              </View>
            </View>
          </BlurView>
        </View>
      )}

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  headerContainer: {
    width: '100%',
    zIndex: 10,
  },
  blurHeader: {
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    borderBottomWidth: border.hairline,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
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
  bandFlex: {
    flex: 1,
  },
});

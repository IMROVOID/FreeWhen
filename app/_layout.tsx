import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { resolveLanguage } from '@/src/app-bootstrap';
import { initI18n } from '@/src/i18n';
import { applyDirection } from '@/src/platform/direction';
import { useStackTransition } from '@/src/platform/stack-transition';
import { vazirmatnFdFonts, vazirmatnFonts } from '@/src/theme/font-assets';
import { useTheme } from '@/src/theme/useTheme';

// Hold the splash until the fonts have loaded. A Persian screen rendered in
// a fallback font reflows visibly when Vazirmatn arrives.
void SplashScreen.preventAutoHideAsync();

/**
 * The language is resolved and the direction applied at MODULE SCOPE, before
 * any component renders.
 *
 * `I18nManager.forceRTL` only takes effect after a full app restart, so
 * calling it inside a component body or a `useEffect` is too late — the first
 * frame has already rendered LTR and the user sees a broken layout until a
 * manual reload (PRD-10 D11).
 */
const language = resolveLanguage();
const shouldBeRtl = language === 'fa';

applyDirection(shouldBeRtl ? 'fa' : 'en');

initI18n(language);

export default function RootLayout() {
  const { t, name } = useTheme();
  const transition = useStackTransition();
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    ...vazirmatnFonts,
    ...vazirmatnFdFonts,
  });

  useEffect(() => {
    // Hide the splash only once the fonts are ready — or once the load has
    // failed, so a missing font never leaves the app on the splash screen.
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaProvider>
        <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            // ★ A NAVIGATION SLIDES.
            //
            // Without this the web build swapped the page in a single frame, so
            // a route change had no visual cause: the new screen was simply the
            // only screen. The direction follows the layout (leading edge in
            // each language) and collapses to a fade under Reduce Motion.
            animation: transition.animation,
            animationDuration: transition.animationDuration,
            contentStyle: { backgroundColor: t.bg },
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

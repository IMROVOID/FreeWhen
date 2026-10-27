import { useEffect, useState } from 'react';
import { Stack, useSegments } from 'expo-router';
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
import { NicknameGate } from '@/src/features/profile/components/NicknameGate';
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
  const [nickname, setNickname] = useState<string | null>(null);
  const segments = useSegments();
  // The invite route owns its own name field — see the gate's note above.
  const onInviteRoute = segments[0] === 'e';
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
        {/* ★ THE NICKNAME GATE SITS ABOVE THE ROUTER, ON PURPOSE.
            A per-screen check would be skippable: an invite link, a deep link or
            a push notification opens a route directly, and the person would be
            inside an event with no name the others can see. Here there is no
            route to reach around it. It renders nothing once a nickname exists,
            and nothing while it is still checking — so a returning user never
            sees it flash.

            ★ EXCEPT ON THE INVITE SCREEN, WHICH ASKS THE SAME QUESTION.
            `JoinForm` there has its own name field, so mounting the sheet too
            showed two name prompts stacked — and the sheet's save failed with a
            403, because no identity exists until the join mints one. The gate
            stands down on that route and adopts the name the join collected. */}
        {nickname === null ? (
          <NicknameGate onResolved={setNickname} suspended={onInviteRoute} />
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

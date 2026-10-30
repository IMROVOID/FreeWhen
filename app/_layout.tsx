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
import { AppFrame } from '@/src/components/ui/AppFrame';
import {
  cornifyIfEligible,
  watchInstallPrompt,
} from '@/src/features/install/services/install-prompt';
import { InstallPrompt } from '@/src/features/install/components/InstallPrompt';
import { NicknameGate } from '@/src/features/profile/components/NicknameGate';
import { initI18n } from '@/src/i18n';
import { applyDirection } from '@/src/platform/direction';
import { useLayoutDirection } from '@/src/platform/use-layout-direction';
import { SPLASH_MIN_VISIBLE_MS } from '@/src/platform/splash-hold';
import { useStackTransition } from '@/src/platform/stack-transition';
import { isWeb } from '@/src/platform/environment';
import { vazirmatnFdFonts, vazirmatnFonts } from '@/src/theme/font-assets';
import { useTheme } from '@/src/theme/useTheme';

// Hold the splash until the fonts have loaded. A Persian screen rendered in
// a fallback font reflows visibly when Vazirmatn arrives.
void SplashScreen.preventAutoHideAsync();

/**
 * ★ WHEN THE SPLASH MAY GO, MEASURED FROM PROCESS START.
 *
 * Hiding as soon as the fonts resolved made the splash a two-frame flash on a
 * warm start, which reads as "there is no splash screen" — and was reported as
 * exactly that. The stamp is taken at MODULE SCOPE so the minimum covers the real
 * launch rather than starting the clock once the JS thread is already up.
 */
const splashHeldUntil = Date.now() + SPLASH_MIN_VISIBLE_MS;

/**
 * The language is resolved and the direction applied at MODULE SCOPE, before
 * any component renders.
 *
 * ★ THE RESOLUTION IS STILL MODULE SCOPE, BUT THE DIRECTION IS NOW LIVE.
 *
 * It used to be that `I18nManager.forceRTL` only took effect after a restart, so
 * the direction had to be applied this early or the first frame rendered in the
 * wrong direction (PRD-10 D11). The direction now resolves from the language
 * (`src/platform/layout-direction.ts`), and the document attribute is corrected
 * here on boot — which is what makes the statically-exported `dir` follow the
 * visitor's stored choice instead of the build's.
 */
const language = resolveLanguage();

applyDirection(language);

initI18n(language);

/**
 * ★ THE BROWSER'S INSTALL EVENT MUST BE CAUGHT BEFORE THE USER CAN ASK FOR IT.
 *
 * `beforeinstallprompt` fires once, early, and is spent if it is not captured
 * and prevented. Listening here — module scope, before the first render — is what
 * gives the offer's button something to fire later.
 */
watchInstallPrompt();

export default function RootLayout() {
  const { t, name } = useTheme();
  const rtl = useLayoutDirection();
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

  /**
   * ★ THE WHOLE APP IS REBUILT WHEN THE DIRECTION CHANGES — NOT JUST THE
   *   NAVIGATOR.
   *
   * Native views are measured once, for the direction they were laid out in, and
   * nothing in React Native re-measures a live tree when the reading direction
   * flips. `I18nManager.forceRTL` only takes effect on a fresh launch. So a switch
   * to English used to swap every string and leave every layout mirrored — titles
   * right-aligned, back chevrons pointing the RTL way, the language rail's
   * `fa` still on the right — until the app was restarted. That is exactly the
   * report: "the App is still RTL when I switch to English".
   *
   * The key used to be on `<Stack>`, which rebuilds the NAVIGATOR while the views
   * that host it — `GestureHandlerRootView`, `SafeAreaProvider`, `AppFrame` — and
   * every screen already mounted keep the measurements they were given under the
   * old direction. The key therefore belongs on the ROOT: a keyed remount is
   * React Native's supported way to rebuild a view tree, and it is what a restart
   * does, minus the process.
   *
   * The key is the DIRECTION rather than the language so a future third LTR
   * locale does not pay for a remount it does not need.
   */
  const directionKey = rtl ? 'rtl' : 'ltr';

  useEffect(() => {
    // Hide the splash only once the fonts are ready — or once the load has
    // failed, so a missing font never leaves the app on the splash screen — and
    // never before the minimum hold, which is what makes the brand frame visible
    // rather than a flicker.
    if (!fontsLoaded && !fontError) return;

    const remaining = Math.max(0, splashHeldUntil - Date.now());
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync();
    }, remaining);

    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  /**
   * The install prompt is offered once per device, after the gate resolves, and
   * only where an install is actually possible. `cornifyIfEligible` is the whole
   * decision — see `services/install-prompt.ts`.
   */
  const [installOpen, setInstallOpen] = useState(false);

  useEffect(() => {
    if (nickname === null) return;
    void cornifyIfEligible().then((eligible) => {
      if (eligible) setInstallOpen(true);
    });
  }, [nickname]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView key={directionKey} style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaProvider>
        <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
        {/* ★ THE DESKTOP FRAME IS A WEB-ONLY SHELL.
            On a phone it is a pass-through with no wrapper at all; at or above
            the tablet breakpoint it centres the app in a phone-width column at
            full height, because no screen in this product was designed to be
            1440px wide. */}
        <AppFrame>
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
        </AppFrame>
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

        {/* ★ THE INSTALL OFFER IS WEB-ONLY, AND THE APP SHOULD NOT SEE IT.
            The APK is the install path on a phone browser and the Chrome
            install prompt is the one on desktop. Neither means anything inside
            the installed app — which would be offering to install itself. */}
        {isWeb ? (
          <InstallPrompt
            visible={installOpen && nickname !== null}
            onDismiss={() => setInstallOpen(false)}
          />
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

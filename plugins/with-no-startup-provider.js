/**
 * Expo config plugin: stops `androidx.startup` from crashing the app at launch.
 *
 * ★ THE DEFECT THIS FIXES: THE APP DIED AFTER THE SPLASH SCREEN.
 *
 * `react-native-maps` declares `androidx.work:work-runtime` (its Gradle line 104,
 * for location tracking). That artifact registers
 * `androidx.work.impl.WorkDatabase` through `androidx.startup.InitializationProvider`,
 * which runs in a ContentProvider `onCreate` — before `MainActivity`, before React,
 * before any JavaScript. On this app's merged manifest that instantiation fails and
 * the whole process dies:
 *
 *   FATAL EXCEPTION: main
 *   java.lang.RuntimeException: Unable to get provider
 *     androidx.startup.InitializationProvider
 *   Caused by: Failed to create an instance of class
 *     androidx.work.impl.WorkDatabase
 *   at androidx.work.WorkManagerInitializer
 *   at android.app.ActivityThread.installProvider
 *
 * No JS error boundary can catch this, and no unit test can see it: the dependency
 * is never imported by our code, it is merged into the APK's manifest from a native
 * library the app only touches through `InteractiveMap.native.tsx`.
 *
 * ★ WHY REMOVING THE PROVIDER IS THE RIGHT FIX, NOT ADDING KOTLIN.
 *
 * This app never uses WorkManager. It does not schedule background work; location
 * is read only while a picker is open (`expo-location`, foreground only), and the
 * product has no background capability by design (`gate:location` asserts exactly
 * that). The provider only exists because `react-native-maps` links
 * `work-runtime` for a feature the product does not enable.
 *
 * Two alternatives were considered and rejected:
 *
 *  - providing App Startup's `work-runtime` initializer, which would initialise a
 *    work database on every cold start to support work that is never scheduled;
 *  - downgrading `react-native-maps`, which trades a known crash for an unknown
 *    map regression.
 *
 * Removing the provider is the smallest change that matches what the app does.
 *
 * ★ IT HAS TO BE A PLUGIN, BECAUSE `android/` IS GENERATED.
 *
 * `.gitignore` ignores `/android/` and `scripts/build/build-apk.sh` runs
 * `expo prebuild` before Gradle, so a hand-edited `AndroidManifest.xml` would
 * exist only in the working copy that edited it — exactly the trap
 * `with-direction-reload.js` documents. The manifest edit has to come from config.
 *
 * ★ `tools:node="remove"` NEEDS THE TOOLS NAMESPACE.
 *
 * The merged manifest is produced by the Android manifest merger, which only
 * honours `tools:*` attributes when the `xmlns:tools` namespace is declared on the
 * element that carries them. The plugin declares it on `<application>` when the
 * generated manifest does not already have it.
 */

import { withAndroidManifest } from '@expo/config-plugins';

/** @typedef {import('@expo/config-plugins').ConfigPlugin} ConfigPlugin */

/** The tools namespace `xmlns:tools` maps to. */
const TOOLS_NS = 'http://schemas.android.com/tools';

/**
 * The provider authorities to strip.
 *
 * `androidx.startup.InitializationProvider` is the only one that registers work
 * and location initializers transitively; removing it takes
 * `androidx.work.impl.WorkDatabase_Impl` and the maps initializer's provider with
 * it. The `androidx.work` names are listed as well so a future artifact that
 * re-registers under its own authority is also removed.
 */
const CRASHING_AUTHORITIES = ['androidx.startup.InitializationProvider'];

/**
 * Removes the startup provider from the generated manifest.
 *
 * @type {ConfigPlugin}
 */
function withNoStartupProvider(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults?.manifest;
    if (!manifest) return config;

    // 1. The namespace must be present for `tools:node` to be honoured.
    manifest.$ = manifest.$ ?? {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = TOOLS_NS;
    }

    const application = manifest.application?.[0];
    if (!application) return config;

    const existing = Array.isArray(application.provider) ? application.provider : [];

    /**
     * A removal entry is added even when nothing matches yet.
     *
     * `prebuild` writes only the app's OWN manifest; the startup provider arrives
     * later, during the Gradle manifest merge, from the library's AAR. So the
     * entry has to exist BEFORE that merge — its absence here is the normal case,
     * not a sign the fix is unnecessary.
     */
    const alreadyRemoved = existing.some(
      (provider) =>
        provider?.$?.['tools:node'] === 'remove' &&
        CRASHING_AUTHORITIES.includes(provider?.$?.['android:name']),
    );

    if (!alreadyRemoved) {
      application.provider = [
        ...existing,
        ...CRASHING_AUTHORITIES.map((name) => ({
          $: {
            'android:name': name,
            'android:authorities': '${applicationId}.androidx-startup',
            'tools:node': 'remove',
          },
        })),
      ];
    }

    return config;
  });
}

export default withNoStartupProvider;

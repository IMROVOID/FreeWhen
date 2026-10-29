/**
 * The install prompt's decisions, kept pure.
 *
 * ★ WHO IS OFFERED WHAT IS NOT A GUESS ABOUT THE USER AGENT ALONE.
 *
 * The three surfaces want three different things, and getting them mixed up is
 * how an app offers to install itself:
 *
 *  - **Already installed** (standalone display mode): nothing. The prompt would
 *    be offering to install the app the person is already inside.
 *  - **Desktop Chromium**: the browser's own install prompt, via
 *    `beforeinstallprompt`. That is the request's "the chrome install app prompt
 *    — the one that creates a webapp shortcut". It cannot be synthesised: the
 *    event is the browser's, so it is captured and held until the button is
 *    pressed.
 *  - **A phone browser**: the Android APK. The link is the project's
 *    `releases/latest`, resolved at click time, so it always points at the newest
 *    build rather than at a version frozen into the bundle.
 *  - **A browser that supports neither** (Firefox, older Safari): the APK link
 *    as well. A download is a better offer than a button that does nothing.
 *
 * ★ DISMISSAL IS PERMANENT, AND THAT IS THE REQUIREMENT.
 *
 * "If dismissed shouldn't show it anymore again." The flag lives in the same
 * guarded `localStorage` wrapper the language store uses, so a browser with
 * storage disabled shows it each visit rather than throwing — a prompt is not
 * worth breaking a page load over.
 */

export type InstallSurface = 'standalone' | 'desktop-pwa' | 'mobile-apk' | 'unsupported';

export interface InstallEnvironment {
  /** True when the page is running as an installed app. */
  standalone: boolean;
  /** True when a phone is detected (Android or iOS). */
  mobile: boolean;
  /** True when the browser fired `beforeinstallprompt` and it is still available. */
  hasDeferredPrompt: boolean;
  /** True when the browser is Chromium-based on a desktop. */
  chromiumDesktop: boolean;
}

/** The `localStorage` key. Namespaced like `freewhen.language`. */
export const INSTALL_DISMISSED_KEY = 'freewhen.install.dismissed';

/**
 * The GitHub release page, not a versioned asset URL.
 *
 * `/releases/latest` redirects to whatever is newest, so a build does not have
 * to be rebuilt to point at a newer APK. The repository is the project's own.
 */
export const ANDROID_RELEASE_URL = 'https://github.com/IMROVOID/FreeWhen/releases/latest';

/** Which offer this environment gets. */
export function installSurfaceFor(environment: InstallEnvironment): InstallSurface {
  if (environment.standalone) return 'standalone';
  if (environment.hasDeferredPrompt || environment.chromiumDesktop) return 'desktop-pwa';
  if (environment.mobile) return 'mobile-apk';
  return 'unsupported';
}

/** Whether an offer should be shown at all. */
export function shouldOfferInstall(
  environment: InstallEnvironment,
  dismissed: boolean,
): boolean {
  if (dismissed) return false;
  return installSurfaceFor(environment) !== 'standalone';
}

/** The primary action's target: an in-page prompt, or a download page. */
export function installActionFor(surface: InstallSurface): 'prompt' | 'apk' | 'none' {
  if (surface === 'standalone') return 'none';
  if (surface === 'desktop-pwa') return 'prompt';
  return 'apk';
}

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function wasInstallDismissed(): boolean {
  try {
    return storage()?.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstall(): void {
  try {
    storage()?.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch {
    // Best effort, as above: a browser with storage off re-offers the prompt.
  }
}

/** Reads the browser's own state, or a conservative default outside one. */
export function detectInstallEnvironment(): InstallEnvironment {
  // ★ THE SAME METHOD CHECK: React Native has a `window` and a `navigator`, and
  // neither behaves like the browser's. Reading `.userAgent` off RN's navigator
  // gives `undefined`, and `matchMedia` does not exist.
  if (!hasDomEvents() || typeof navigator === 'undefined') {
    return {
      standalone: false,
      mobile: false,
      hasDeferredPrompt: false,
      chromiumDesktop: false,
    };
  }

  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)').matches
    : false;
  // iOS Safari reports an installed web app through a non-standard flag.
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true;

  const ua = navigator.userAgent ?? '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const chromiumDesktop = !mobile && /Chrome\/|Edg\/|OPR\//i.test(ua);

  return {
    standalone: media || iosStandalone,
    mobile,
    hasDeferredPrompt: readDeferredPrompt() !== null,
    chromiumDesktop,
  };
}

/* ── The deferred `beforeinstallprompt` event ─────────────────────────────── */

/**
 * The browser's install prompt, parked until the user asks for it.
 *
 * It has to be captured on `beforeinstallprompt` and kept, because the event is
 * single-use and can only be fired from a user gesture. Losing it — by letting
 * the default through, or by not listening early enough — leaves the button with
 * nothing to call, which is the usual reason an "Install" button in the wild
 * does nothing.
 */
interface DeferredPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: DeferredPromptEvent | null = null;
let listening = false;

/**
 * Whether this platform actually has a DOM event target.
 *
 * ★ THE METHOD CHECK, NOT THE OBJECT CHECK.
 *
 * `typeof window !== 'undefined'` is TRUE on React Native: the runtime defines a
 * compatibility `window` with no `addEventListener`. Calling through it threw
 * `TypeError: undefined is not a function` at module scope, which killed the app
 * on launch. Testing for the method is the only guard that survives both.
 */
function hasDomEvents(): boolean {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function';
}

function readDeferredPrompt(): DeferredPromptEvent | null {
  return deferredPrompt;
}

/**
 * Starts listening once, from the root layout's boot.
 *
 * ★ `typeof window === 'undefined'` IS NOT ENOUGH, AND THE RESULT IS A HARD CRASH.
 *
 * React Native defines a global `window` object for compatibility, but it is not
 * a `Window`: it has no `addEventListener`. Guarding on `window` therefore passed
 * on Android and the next line threw
 *
 *     TypeError: undefined is not a function
 *         at watchInstallPrompt
 *
 * at module scope, from `app/_layout.tsx` — which is a fatal exception on the
 * main thread, not a caught render error. The app died before its first screen.
 * The check has to be for the METHOD that is about to be called.
 *
 * The same guard is repeated in `fireInstallPrompt` and `detectInstallEnvironment`
 * for the same reason: this module is imported by the shared layout, so every
 * one of its entry points runs on native.
 */
export function watchInstallPrompt(): void {
  if (listening || !hasDomEvents()) return;
  listening = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppressing the default is what keeps the event usable: without it the
    // browser shows its own mini-infobar immediately and the event is spent.
    event.preventDefault();
    deferredPrompt = event as DeferredPromptEvent;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

/**
 * Fires the browser's prompt, if there is one.
 *
 * Returns false when there is nothing to fire, so the caller can fall back to
 * the APK page instead of appearing to succeed.
 */
export async function fireInstallPrompt(): Promise<boolean> {
  const event = deferredPrompt;
  if (!event) return false;

  // Consumed either way: the event cannot be replayed.
  deferredPrompt = null;

  try {
    await event.prompt();
    await event.userChoice;
    return true;
  } catch {
    return false;
  }
}

/** Whether the first launch should raise the offer. */
export async function cornifyIfEligible(): Promise<boolean> {
  return shouldOfferInstall(detectInstallEnvironment(), wasInstallDismissed());
}

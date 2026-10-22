/**
 * Connectivity and queue depth (PRD-11 §6, AC-11.7.1, Plan 11 Task 7).
 *
 * ★ THE OFFLINE STATE IS WHAT A REAL USER EXPERIENCES.
 *
 * §15.4 says it plainly, and PRD-12 §16.4 names offline as one of the two most
 * commonly skipped states — because the developer is on wifi. So it gets a hook
 * rather than an ad-hoc check at each call site.
 *
 * ★ IT NEVER BLOCKS. IT REPORTS.
 *
 * The hook returns what is true (are we connected, how many writes are waiting,
 * when did the cache last hold). It does not throw, gate rendering, or clear
 * cached data. The screen decides what to keep readable; this only says whether
 * the connection is gone.
 *
 * ★ QUEUE DEPTH IS INJECTED.
 *
 * The write queue lives in the mutation layer, and duplicating it here would
 * create a second source of truth for "what is unsent". The caller passes how
 * many writes it is holding, so the banner can mark them without this hook
 * growing its own copy.
 */

import { useEffect, useRef, useState } from 'react';

export interface OfflineStatus {
  /** True once connectivity is known to be gone. */
  isOffline: boolean;
  /** Writes the caller is holding that have not reached the server. */
  pendingCount: number;
  /** When the last successful response was observed, if ever. */
  lastSyncedAt: number | null;
}

export interface UseOfflineOptions {
  /** The number of queued writes the caller is currently holding. */
  pendingCount?: number;
  /** Overrides the detector; the tests use this instead of a real radio. */
  isConnected?: boolean;
}

/**
 * Reads connectivity from the platform.
 *
 * `@react-native-community/netinfo` is not a dependency of this project, and
 * adding a native module for one boolean would be a build-surface change for a
 * status strip. The reachable signals without it are `navigator.onLine` on web
 * and the app's own request failures — so this listens to the browser events
 * where they exist and otherwise reports "online", leaving the honest signal to
 * the mutation layer, which learns the truth from a failed request.
 */
function useBrowserConnectivity(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    if (typeof nav?.onLine !== 'boolean') return;

    setOnline(nav.onLine);

    const target = globalThis as unknown as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    if (typeof target.addEventListener !== 'function') return;

    const update = () => {
      const current = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
      setOnline(current?.onLine ?? true);
    };

    target.addEventListener('online', update);
    target.addEventListener('offline', update);

    return () => {
      target.removeEventListener?.('online', update);
      target.removeEventListener?.('offline', update);
    };
  }, []);

  return online;
}

export function useOffline({ pendingCount = 0, isConnected }: UseOfflineOptions = {}): OfflineStatus {
  const detected = useBrowserConnectivity();
  const lastSyncedAt = useRef<number | null>(null);

  const connected = isConnected ?? detected;

  // ★ UNKNOWN IS ONLINE, DELIBERATELY.
  //
  // Showing the offline banner on a device whose connectivity cannot be
  // detected would put "you are offline" in front of every user on a platform
  // without the signal. A false negative costs one stale read; a false positive
  // costs trust in the banner.
  const isOffline = connected === false;

  useEffect(() => {
    if (connected === true) {
      lastSyncedAt.current = Date.now();
    }
  }, [connected]);

  return {
    isOffline,
    pendingCount,
    lastSyncedAt: lastSyncedAt.current,
  };
}

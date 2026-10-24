/**
 * Persisted appearance preferences.
 *
 * The theme follows the system by default (Style Guide §0.1 #3); the override
 * is the user's explicit choice in Settings. Kept separate from the language
 * preference because a theme change applies to a live view tree while a
 * language change does not (PRD-10 D11A).
 */

import { create } from 'zustand';

export type ThemePreference = 'system' | 'dark' | 'light';

interface AppearanceState {
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  useDeviceAccent: boolean;
  setUseDeviceAccent: (useDeviceAccent: boolean) => void;
}

export const useAppearanceStore = create<AppearanceState>((set) => ({
  themePreference: 'system',
  setThemePreference: (themePreference) => set({ themePreference }),
  useDeviceAccent: true,
  setUseDeviceAccent: (useDeviceAccent) => set({ useDeviceAccent }),
}));

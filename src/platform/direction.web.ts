import type { Language } from '@/src/i18n/types';

export function applyDirection(language: Language): void {
  if (typeof document === 'undefined') return;

  const dir = language === 'fa' ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', language);
}

// Shared theme handling for the popup and options pages. Apply the stored theme
// ASAP to avoid a flash of the wrong scheme (run from an inline head script),
// and expose applyTheme() for runtime changes driven by the settings radios.
(function (root) {
  'use strict';

  const STORAGE_KEY = 'cindra-theme';

  function resolveTheme(theme) {
    return theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
  }

  // Read the last resolved theme from localStorage and apply it before paint.
  function applyStoredTheme() {
    try {
      let theme = localStorage.getItem(STORAGE_KEY);
      if (!theme) {
        theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', theme);
    } catch (_) { /* storage unavailable */ }
  }

  // Persist + apply a theme value ('auto' | 'light' | 'dark') at runtime.
  function applyTheme(theme) {
    const resolved = resolveTheme(theme);
    document.documentElement.setAttribute('data-theme', resolved);
    try {
      localStorage.setItem(STORAGE_KEY, resolved);
    } catch (_) { /* storage unavailable */ }
  }

  root.CindraTheme = { applyStoredTheme, applyTheme };

  // These pages always want the stored theme applied before paint.
  applyStoredTheme();
})(globalThis);

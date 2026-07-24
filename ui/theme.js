// Shared theme handling for the popup and options pages. The raw preference is
// cached in localStorage so it can be applied before chrome.storage is ready.
(function (root, factory) {
  'use strict';

  const api = factory(root);
  root.CindraTheme = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  api.applyStoredTheme();
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'cindra-theme';
  const VALID_THEMES = new Set(['auto', 'light', 'dark']);
  let preference = 'auto';
  let mediaQuery = null;
  let mediaListenerInstalled = false;

  function normalizeTheme(theme) {
    return VALID_THEMES.has(theme) ? theme : 'auto';
  }

  function getMediaQuery() {
    if (!mediaQuery && typeof root.matchMedia === 'function') {
      mediaQuery = root.matchMedia('(prefers-color-scheme: dark)');
    }
    return mediaQuery;
  }

  function resolveTheme(theme, prefersDark = getMediaQuery()?.matches || false) {
    const normalized = normalizeTheme(theme);
    return normalized === 'auto' ? (prefersDark ? 'dark' : 'light') : normalized;
  }

  function setDocumentTheme(theme) {
    root.document?.documentElement?.setAttribute?.('data-theme', theme);
  }

  function handleSystemThemeChange() {
    if (preference === 'auto') {
      setDocumentTheme(resolveTheme(preference));
    }
  }

  function ensureMediaListener() {
    const query = getMediaQuery();
    if (!query || mediaListenerInstalled) return;
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handleSystemThemeChange);
    } else if (typeof query.addListener === 'function') {
      query.addListener(handleSystemThemeChange);
    }
    mediaListenerInstalled = true;
  }

  function readStoredPreference() {
    try {
      return normalizeTheme(root.localStorage?.getItem?.(STORAGE_KEY));
    } catch (error) {
      return 'auto';
    }
  }

  function applyStoredTheme() {
    preference = readStoredPreference();
    ensureMediaListener();
    const resolved = resolveTheme(preference);
    setDocumentTheme(resolved);
    return resolved;
  }

  function applyTheme(theme) {
    preference = normalizeTheme(theme);
    ensureMediaListener();
    try {
      root.localStorage?.setItem?.(STORAGE_KEY, preference);
    } catch (error) {
      // localStorage may be unavailable in hardened browser contexts.
    }
    const resolved = resolveTheme(preference);
    setDocumentTheme(resolved);
    return resolved;
  }

  function cleanup() {
    if (!mediaQuery || !mediaListenerInstalled) return;
    if (typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    } else if (typeof mediaQuery.removeListener === 'function') {
      mediaQuery.removeListener(handleSystemThemeChange);
    }
    mediaListenerInstalled = false;
  }

  return {
    STORAGE_KEY,
    applyStoredTheme,
    applyTheme,
    cleanup,
    normalizeTheme,
    resolveTheme
  };
});

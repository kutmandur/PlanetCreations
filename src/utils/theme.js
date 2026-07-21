// Dark-mode theme handling. Stored preference is one of:
//   'dark' | 'light'  -> explicit user choice
//   null (unset)      -> follow the OS (prefers-color-scheme)
// The initial class is applied by an inline script in public/index.html before React
// mounts, to avoid a flash. This module keeps it in sync at runtime.

export const THEME_KEY = 'pcTheme';

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'dark' || v === 'light' ? v : null; // null = system
  } catch (e) {
    return null;
  }
}

export function systemPrefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

// The theme actually shown right now: explicit choice, else the OS setting.
export function getEffectiveTheme() {
  const stored = getStoredTheme();
  if (stored) return stored;
  return systemPrefersDark() ? 'dark' : 'light';
}

export function applyTheme(effective) {
  const root = document.documentElement;
  if (effective === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  root.style.colorScheme = effective;
  window.dispatchEvent(new CustomEvent('pc-theme-change', { detail: effective }));
}

// Persist an explicit choice (or null to go back to following the system) and apply it.
export function setTheme(pref) {
  try {
    if (pref === null) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch (e) { /* ignore */ }
  applyTheme(pref || (systemPrefersDark() ? 'dark' : 'light'));
}

// While the user follows the system (no explicit choice), react to OS changes live.
export function watchSystemTheme() {
  if (!window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getStoredTheme() === null) applyTheme(mq.matches ? 'dark' : 'light');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

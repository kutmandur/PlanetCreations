import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import { getEffectiveTheme, setTheme } from '../../utils/theme';

const SUN = "M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z";
const MOON = "M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z";

// Navbar sun/moon button. Clicking sets an explicit light/dark choice (persisted).
// The default (no explicit choice) follows the OS setting; see src/utils/theme.js.
const ThemeToggle = () => {
  const [theme, setThemeState] = useState('light');

  useEffect(() => {
    const syncTheme = (event) => setThemeState(event.detail || getEffectiveTheme());
    syncTheme({});
    window.addEventListener('pc-theme-change', syncTheme);
    return () => window.removeEventListener('pc-theme-change', syncTheme);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-full hover:bg-gray-700 text-gray-300"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <Icon path={theme === 'dark' ? SUN : MOON} className="w-6 h-6" />
    </button>
  );
};

export default ThemeToggle;

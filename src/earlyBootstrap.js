import {
  installLegacyHashRouteBridge,
  migrateLegacyHashRoute,
} from './utils/routingMode';

migrateLegacyHashRoute();
installLegacyHashRouteBridge();

(function prepareInitialLayout() {
  try {
    if (localStorage.getItem('pcViewMode') === 'desktop') {
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) viewport.setAttribute('content', 'width=1280');
    }
  } catch (error) { /* localStorage can be unavailable in hardened contexts */ }

  try {
    const theme = localStorage.getItem('pcTheme');
    const dark = theme === 'dark' ||
      (!theme && window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (error) { /* keep the default light theme */ }
}());

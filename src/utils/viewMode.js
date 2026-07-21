// View-mode switch: lets a phone user force the full desktop layout by swapping the
// viewport meta width (like a browser's "Request Desktop Site"), and back. The native
// pinch-zoom stays intact. The initial value is applied by an inline script in
// public/index.html before React loads to avoid a layout flash.

export const VIEW_MODE_KEY = 'pcViewMode';
const DESKTOP_CONTENT = 'width=1280';
const MOBILE_CONTENT = 'width=device-width, initial-scale=1';

export function applyViewMode(mode) {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  meta.setAttribute('content', mode === 'desktop' ? DESKTOP_CONTENT : MOBILE_CONTENT);
}

export function getViewMode() {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'desktop' ? 'desktop' : 'mobile';
  } catch (e) {
    return 'mobile';
  }
}

export function setViewMode(mode) {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch (e) { /* ignore */ }
  applyViewMode(mode);
}

// Whether to offer the toggle at all. Based on the PHYSICAL screen size + a coarse
// pointer — NOT on CSS breakpoints, because those reflect the (swapped) viewport width
// and would hide the button once desktop view is active.
export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  try {
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const shortSide = Math.min(window.screen.width, window.screen.height);
    return (coarse || touch) && shortSide <= 900;
  } catch (e) {
    return false;
  }
}

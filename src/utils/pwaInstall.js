// Captures the browser's `beforeinstallprompt` event (Chromium) so the UI can
// offer a real one-click install, and provides platform detection + standalone
// checks for the install-helper. The listener attaches on module import so the
// event isn't missed if it fires before a component mounts.

let deferredPrompt = null;
const listeners = new Set();

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        listeners.forEach((l) => l(true));
    });
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        listeners.forEach((l) => l(false));
    });
}

export const canPromptInstall = () => !!deferredPrompt;

export const promptInstall = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    listeners.forEach((l) => l(false));
    return choice.outcome === 'accepted';
};

export const onInstallAvailabilityChange = (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
};

export const isStandalone = () =>
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

export const detectPlatform = () => {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/android/i.test(ua)) return 'android';
    return 'desktop';
};

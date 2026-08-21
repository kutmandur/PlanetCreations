export function shouldForceRecaptchaForElectronTest({ isDev, search, userAgent }) {
    if (!isDev || !String(userAgent || '').toLowerCase().includes('electron')) return false;
    return new URLSearchParams(search || '').get('pcAppCheck') === 'recaptcha-test-only';
}

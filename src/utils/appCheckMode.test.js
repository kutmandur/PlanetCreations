import { shouldForceRecaptchaForElectronTest } from './appCheckMode';

test('forces real reCAPTCHA only for an explicitly marked Electron development instance', () => {
    const marked = '?pcAppCheck=recaptcha-test-only';
    expect(shouldForceRecaptchaForElectronTest({ isDev: true, search: marked, userAgent: 'Electron/43' })).toBe(true);
    expect(shouldForceRecaptchaForElectronTest({ isDev: false, search: marked, userAgent: 'Electron/43' })).toBe(false);
    expect(shouldForceRecaptchaForElectronTest({ isDev: true, search: marked, userAgent: 'Chrome/150' })).toBe(false);
    expect(shouldForceRecaptchaForElectronTest({ isDev: true, search: '', userAgent: 'Electron/43' })).toBe(false);
});

import {
    ELECTRON_APP_CHECK_RECOVERY_KEY,
    recoverElectronAppCheck,
    shouldForceRecaptchaForElectronTest,
    shouldReloadElectronAfterAppCheckFailure,
} from './appCheckMode';

test('forces real reCAPTCHA only for an explicitly marked Electron development instance', () => {
    const marked = '?pcAppCheck=recaptcha-test-only';
    expect(shouldForceRecaptchaForElectronTest({ isDev: true, search: marked, userAgent: 'Electron/43' })).toBe(true);
    expect(shouldForceRecaptchaForElectronTest({ isDev: false, search: marked, userAgent: 'Electron/43' })).toBe(false);
    expect(shouldForceRecaptchaForElectronTest({ isDev: true, search: marked, userAgent: 'Chrome/150' })).toBe(false);
    expect(shouldForceRecaptchaForElectronTest({ isDev: true, search: '', userAgent: 'Electron/43' })).toBe(false);
});

test('recovers a poisoned Electron App Check provider with one programmatic reload', async () => {
    const values = new Map();
    const sessionStorage = {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
    const reload = vi.fn();
    const getToken = vi.fn().mockRejectedValue({ code: 'appCheck/initial-throttle' });
    const result = await recoverElectronAppCheck({
        appCheckInstance: {},
        getToken,
        isDev: false,
        userAgent: 'PlanetCreations/1.0.31 Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        sessionStorage,
        reload,
    });
    expect(result).toBe('reloading');
    expect(getToken).toHaveBeenCalledWith({}, true);
    expect(values.get(ELECTRON_APP_CHECK_RECOVERY_KEY)).toBe('1');
    expect(reload).toHaveBeenCalledOnce();

    const secondResult = await recoverElectronAppCheck({
        appCheckInstance: {},
        getToken: vi.fn().mockRejectedValue({ code: 'appCheck/throttled' }),
        isDev: false,
        userAgent: 'PlanetCreations/1.0.31 Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        sessionStorage,
        reload,
    });
    expect(secondResult).toBe('failed');
    expect(reload).toHaveBeenCalledOnce();
});

test('clears the reload guard after a valid Electron token is available', async () => {
    const values = new Map([[ELECTRON_APP_CHECK_RECOVERY_KEY, '1']]);
    const sessionStorage = {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
    const result = await recoverElectronAppCheck({
        appCheckInstance: {},
        getToken: vi.fn().mockResolvedValue({ token: 'valid' }),
        isDev: false,
        userAgent: 'Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        sessionStorage,
        reload: vi.fn(),
    });
    expect(result).toBe('ready');
    expect(values.has(ELECTRON_APP_CHECK_RECOVERY_KEY)).toBe(false);
});

test('does not request an eager token in a normal browser', async () => {
    const getToken = vi.fn();
    const result = await recoverElectronAppCheck({
        appCheckInstance: {},
        getToken,
        isDev: false,
        userAgent: 'Chrome/150',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        sessionStorage: window.sessionStorage,
        reload: vi.fn(),
    });
    expect(result).toBe('skipped');
    expect(getToken).not.toHaveBeenCalled();
});

test('reloads a production Electron page once after the canonical redirect poisoned App Check', () => {
    const base = {
        isDev: false,
        userAgent: 'PlanetCreations/1.0.31 Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        recoveryAttempted: false,
    };
    expect(shouldReloadElectronAfterAppCheckFailure({
        ...base,
        errorCode: 'appCheck/initial-throttle',
    })).toBe(true);
    expect(shouldReloadElectronAfterAppCheckFailure({
        ...base,
        errorCode: 'appCheck/throttled',
    })).toBe(true);
    expect(shouldReloadElectronAfterAppCheckFailure({
        ...base,
        origin: 'https://planetcreations.net',
        errorCode: 'appCheck/throttled',
    })).toBe(true);
});

test('does not loop, affect browsers or development, or reload unrelated App Check failures', () => {
    const base = {
        isDev: false,
        userAgent: 'PlanetCreations/1.0.31 Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        recoveryAttempted: false,
        errorCode: 'appCheck/initial-throttle',
    };
    expect(shouldReloadElectronAfterAppCheckFailure({ ...base, recoveryAttempted: true })).toBe(false);
    expect(shouldReloadElectronAfterAppCheckFailure({ ...base, userAgent: 'Chrome/150' })).toBe(false);
    expect(shouldReloadElectronAfterAppCheckFailure({ ...base, isDev: true })).toBe(false);
    expect(shouldReloadElectronAfterAppCheckFailure({ ...base, isGameOverlay: true })).toBe(false);
    expect(shouldReloadElectronAfterAppCheckFailure({
        ...base,
        origin: 'http://localhost:3000',
    })).toBe(false);
    expect(shouldReloadElectronAfterAppCheckFailure({
        ...base,
        errorCode: 'appCheck/fetch-status-error',
    })).toBe(false);
});

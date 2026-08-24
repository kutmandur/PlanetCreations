import {
    ELECTRON_APP_CHECK_MAX_RELOADS,
    ELECTRON_APP_CHECK_RECOVERY_KEY,
    ELECTRON_APP_CHECK_RECOVERY_WINDOW_MS,
    recoverElectronAppCheck,
    resetElectronAppCheckRecovery,
    shouldForceRecaptchaForElectronTest,
    shouldReloadElectronAfterAppCheckFailure,
} from './appCheckMode';

const createSessionStorage = (initial = []) => {
    const values = new Map(initial);
    return {
        values,
        storage: {
            getItem: (key) => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
            removeItem: (key) => values.delete(key),
        },
    };
};

test('forces real reCAPTCHA only for an explicitly marked Electron development instance', () => {
    const marked = '?pcAppCheck=recaptcha-test-only';
    expect(shouldForceRecaptchaForElectronTest({ isDev: true, search: marked, userAgent: 'Electron/43' })).toBe(true);
    expect(shouldForceRecaptchaForElectronTest({ isDev: false, search: marked, userAgent: 'Electron/43' })).toBe(false);
    expect(shouldForceRecaptchaForElectronTest({ isDev: true, search: marked, userAgent: 'Chrome/150' })).toBe(false);
    expect(shouldForceRecaptchaForElectronTest({ isDev: true, search: '', userAgent: 'Electron/43' })).toBe(false);
});

test('retries a throttled Electron App Check provider across bounded reloads', async () => {
    const { values, storage: sessionStorage } = createSessionStorage();
    const reload = vi.fn();
    const now = vi.fn(() => 1_000_000);

    for (let index = 0; index < ELECTRON_APP_CHECK_MAX_RELOADS; index += 1) {
        const getToken = vi.fn().mockRejectedValue({
            code: index === 0 ? 'appCheck/initial-throttle' : 'appCheck/throttled',
        });
        const result = await recoverElectronAppCheck({
            appCheckInstance: {},
            getToken,
            isDev: false,
            userAgent: 'PlanetCreations/1.0.35 Electron/43',
            origin: 'https://www.planetcreations.net',
            isGameOverlay: false,
            sessionStorage,
            reload,
            now,
        });
        expect(result).toBe('reloading');
        expect(getToken).toHaveBeenCalledWith({}, true);
    }

    expect(JSON.parse(values.get(ELECTRON_APP_CHECK_RECOVERY_KEY))).toEqual({
        attempts: ELECTRON_APP_CHECK_MAX_RELOADS,
        lastAttemptAt: 1_000_000,
    });
    expect(reload).toHaveBeenCalledTimes(ELECTRON_APP_CHECK_MAX_RELOADS);

    const exhaustedResult = await recoverElectronAppCheck({
        appCheckInstance: {},
        getToken: vi.fn().mockRejectedValue({ code: 'appCheck/throttled' }),
        isDev: false,
        userAgent: 'PlanetCreations/1.0.35 Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        sessionStorage,
        reload,
        now,
    });
    expect(exhaustedResult).toBe('failed');
    expect(reload).toHaveBeenCalledTimes(ELECTRON_APP_CHECK_MAX_RELOADS);
});

test('clears the reload guard after a valid Electron token is available', async () => {
    const { values, storage: sessionStorage } = createSessionStorage([[
        ELECTRON_APP_CHECK_RECOVERY_KEY,
        JSON.stringify({ attempts: 1, lastAttemptAt: 1_000_000 }),
    ]]);
    const result = await recoverElectronAppCheck({
        appCheckInstance: {},
        getToken: vi.fn().mockResolvedValue({ token: 'valid' }),
        isDev: false,
        userAgent: 'Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        sessionStorage,
        reload: vi.fn(),
        now: () => 1_000_000,
    });
    expect(result).toBe('ready');
    expect(values.has(ELECTRON_APP_CHECK_RECOVERY_KEY)).toBe(false);
});

test('starts a fresh bounded recovery window after an old failed session', async () => {
    const { values, storage: sessionStorage } = createSessionStorage([[
        ELECTRON_APP_CHECK_RECOVERY_KEY,
        JSON.stringify({ attempts: ELECTRON_APP_CHECK_MAX_RELOADS, lastAttemptAt: 1_000_000 }),
    ]]);
    const reload = vi.fn();
    const result = await recoverElectronAppCheck({
        appCheckInstance: {},
        getToken: vi.fn().mockRejectedValue({ code: 'appCheck/throttled' }),
        isDev: false,
        userAgent: 'Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        sessionStorage,
        reload,
        now: () => 1_000_000 + ELECTRON_APP_CHECK_RECOVERY_WINDOW_MS + 1,
    });
    expect(result).toBe('reloading');
    expect(JSON.parse(values.get(ELECTRON_APP_CHECK_RECOVERY_KEY)).attempts).toBe(1);
    expect(reload).toHaveBeenCalledOnce();
});

test('can explicitly reset a failed Electron recovery batch', () => {
    const { values, storage } = createSessionStorage([[
        ELECTRON_APP_CHECK_RECOVERY_KEY,
        JSON.stringify({ attempts: 2, lastAttemptAt: 1_000_000 }),
    ]]);
    resetElectronAppCheckRecovery(storage);
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

test('reloads a production Electron page while its bounded recovery budget remains', () => {
    const base = {
        isDev: false,
        userAgent: 'PlanetCreations/1.0.31 Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        recoveryAttempts: 0,
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

test('does not exceed its budget or affect browsers, development and unrelated failures', () => {
    const base = {
        isDev: false,
        userAgent: 'PlanetCreations/1.0.31 Electron/43',
        origin: 'https://www.planetcreations.net',
        isGameOverlay: false,
        recoveryAttempts: 0,
        errorCode: 'appCheck/initial-throttle',
    };
    expect(shouldReloadElectronAfterAppCheckFailure({
        ...base,
        recoveryAttempts: ELECTRON_APP_CHECK_MAX_RELOADS,
    })).toBe(false);
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

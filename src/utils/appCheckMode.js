export const ELECTRON_APP_CHECK_RECOVERY_KEY =
    'planetcreations:electron-app-check-canonical-reload-v3';
export const ELECTRON_APP_CHECK_MAX_RELOADS = 3;
export const ELECTRON_APP_CHECK_RECOVERY_WINDOW_MS = 2 * 60 * 1000;

const RECOVERABLE_APP_CHECK_ERRORS = new Set([
    'appCheck/initial-throttle',
    'appCheck/throttled',
]);
const ELECTRON_WEB_ORIGINS = new Set([
    'https://planetcreations.net',
    'https://www.planetcreations.net',
]);

export function shouldForceRecaptchaForElectronTest({ isDev, search, userAgent }) {
    if (!isDev || !String(userAgent || '').toLowerCase().includes('electron')) return false;
    return new URLSearchParams(search || '').get('pcAppCheck') === 'recaptcha-test-only';
}

export function shouldReloadElectronAfterAppCheckFailure({
    isDev,
    userAgent,
    origin,
    isGameOverlay,
    recoveryAttempts = 0,
    errorCode,
}) {
    return !isDev &&
        String(userAgent || '').toLowerCase().includes('electron') &&
        ELECTRON_WEB_ORIGINS.has(origin) &&
        isGameOverlay !== true &&
        recoveryAttempts < ELECTRON_APP_CHECK_MAX_RELOADS &&
        RECOVERABLE_APP_CHECK_ERRORS.has(String(errorCode || ''));
}

function readRecoveryState(sessionStorage, now) {
    const empty = { attempts: 0, lastAttemptAt: 0 };
    try {
        const raw = sessionStorage.getItem(ELECTRON_APP_CHECK_RECOVERY_KEY);
        if (!raw) return empty;
        const parsed = JSON.parse(raw);
        const attempts = Number(parsed?.attempts);
        const lastAttemptAt = Number(parsed?.lastAttemptAt);
        if (!Number.isInteger(attempts) || attempts < 0 ||
            !Number.isFinite(lastAttemptAt) || lastAttemptAt <= 0 ||
            now < lastAttemptAt ||
            now - lastAttemptAt > ELECTRON_APP_CHECK_RECOVERY_WINDOW_MS) {
            sessionStorage.removeItem(ELECTRON_APP_CHECK_RECOVERY_KEY);
            return empty;
        }
        return { attempts, lastAttemptAt };
    } catch (_error) {
        sessionStorage.removeItem(ELECTRON_APP_CHECK_RECOVERY_KEY);
        return empty;
    }
}

export function resetElectronAppCheckRecovery(sessionStorage) {
    sessionStorage.removeItem(ELECTRON_APP_CHECK_RECOVERY_KEY);
}

export async function recoverElectronAppCheck({
    appCheckInstance,
    getToken,
    isDev,
    userAgent,
    origin,
    isGameOverlay,
    sessionStorage,
    reload,
    now = () => Date.now(),
}) {
    const isElectron = String(userAgent || '').toLowerCase().includes('electron');
    if (isDev || !isElectron || !ELECTRON_WEB_ORIGINS.has(origin) ||
        isGameOverlay === true) return 'skipped';

    // A boolean "already tried" flag stranded users permanently when the
    // second attestation also failed. Keep a short rolling budget instead:
    // enough fresh provider instances to survive intermittent reCAPTCHA 403s,
    // without creating an unbounded reload loop.
    const recoveryState = readRecoveryState(sessionStorage, now());
    try {
        // A cached token can still look locally valid while Firebase Auth has
        // already rejected it. Electron therefore performs a real attestation
        // on startup instead of accepting IndexedDB state from an older build.
        await getToken(appCheckInstance, true);
        resetElectronAppCheckRecovery(sessionStorage);
        return 'ready';
    } catch (error) {
        if (!shouldReloadElectronAfterAppCheckFailure({
            isDev,
            userAgent,
            origin,
            isGameOverlay,
            recoveryAttempts: recoveryState.attempts,
            errorCode: error?.code,
        })) return 'failed';
        sessionStorage.setItem(ELECTRON_APP_CHECK_RECOVERY_KEY, JSON.stringify({
            attempts: recoveryState.attempts + 1,
            lastAttemptAt: now(),
        }));
        reload();
        return 'reloading';
    }
}

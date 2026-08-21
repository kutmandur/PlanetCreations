export const ELECTRON_APP_CHECK_RECOVERY_KEY =
    'planetcreations:electron-app-check-canonical-reload-v1';

const RECOVERABLE_APP_CHECK_ERRORS = new Set([
    'appCheck/initial-throttle',
    'appCheck/throttled',
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
    recoveryAttempted,
    errorCode,
}) {
    return !isDev &&
        String(userAgent || '').toLowerCase().includes('electron') &&
        origin === 'https://www.planetcreations.net' &&
        isGameOverlay !== true &&
        recoveryAttempted !== true &&
        RECOVERABLE_APP_CHECK_ERRORS.has(String(errorCode || ''));
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
}) {
    const isElectron = String(userAgent || '').toLowerCase().includes('electron');
    if (isDev || !isElectron || origin !== 'https://www.planetcreations.net' ||
        isGameOverlay === true) return 'skipped';

    const recoveryAttempted = sessionStorage.getItem(
        ELECTRON_APP_CHECK_RECOVERY_KEY,
    ) === '1';
    try {
        await getToken(appCheckInstance, false);
        if (recoveryAttempted) {
            sessionStorage.removeItem(ELECTRON_APP_CHECK_RECOVERY_KEY);
        }
        return 'ready';
    } catch (error) {
        if (!shouldReloadElectronAfterAppCheckFailure({
            isDev,
            userAgent,
            origin,
            isGameOverlay,
            recoveryAttempted,
            errorCode: error?.code,
        })) return 'failed';
        sessionStorage.setItem(ELECTRON_APP_CHECK_RECOVERY_KEY, '1');
        reload();
        return 'reloading';
    }
}

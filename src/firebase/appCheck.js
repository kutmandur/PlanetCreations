import { getToken } from 'firebase/app-check';
import { appCheck, appCheckReady } from './config';

const AUTH_APP_CHECK_INVALID = 'auth/firebase-app-check-token-is-invalid';
const HOSTED_CLIENT_ORIGINS = new Set([
    'https://planetcreations.net',
    'https://www.planetcreations.net',
]);

export const isHostedElectronAppCheckContext = ({
    electronApi = typeof window !== 'undefined' ? window.electronAPI : null,
    origin = typeof window !== 'undefined' ? window.location.origin : '',
} = {}) => Boolean(electronApi?.isElectron && HOSTED_CLIENT_ORIGINS.has(origin));

export const isFirebaseAppCheckAuthError = (error) => (
    error?.code === AUTH_APP_CHECK_INVALID ||
    String(error?.message || '').includes(AUTH_APP_CHECK_INVALID)
);

export const getAppCheckTokenIfAvailable = async () => {
    if (!appCheck) return null;
    const result = await getToken(appCheck, false);
    return result.token || null;
};

export const waitForElectronAppCheck = async () => {
    return appCheckReady;
};

export const runFirebaseAuthWithAppCheckRecovery = async (
    operation,
    context = undefined,
) => {
    await appCheckReady;
    try {
        return await operation();
    } catch (error) {
        if (!appCheck || error?.code !== AUTH_APP_CHECK_INVALID ||
            !isHostedElectronAppCheckContext(context)) {
            throw error;
        }

        // Firebase Auth asks App Check for a cached token by default. Force one
        // fresh attestation after the server rejects that token, then retry the
        // idempotent Auth operation exactly once.
        try {
            await getToken(appCheck, true);
        } catch (_refreshError) {
            throw error;
        }
        return operation();
    }
};

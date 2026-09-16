import { getToken } from 'firebase/app-check';
import { appCheck, appCheckReady } from './config';
import { createAppCheckTokenAccess } from '../utils/appCheckTokens';

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
    String(error?.code || '').startsWith('appCheck/') ||
    String(error?.message || '').includes(AUTH_APP_CHECK_INVALID)
);

const tokens = createAppCheckTokenAccess(force => getToken(appCheck, force));

async function prepareAuthToken(context) {
    if (!appCheck || !isHostedElectronAppCheckContext(context)) return null;
    try {
        return (await tokens.read()).token;
    } catch (error) {
        // Enforcement is a server decision. A provider outage must not create
        // new client-side enforcement while the project is in monitoring mode.
        console.warn('App Check preflight could not obtain a token.', {
            code: error?.code || 'unknown',
            httpStatus: error?.customData?.httpStatus,
        });
        return null;
    }
}

export const getAppCheckTokenIfAvailable = async () => {
    if (!appCheck) return null;
    const result = await tokens.read();
    return result.token || null;
};

export const waitForElectronAppCheck = async (context = undefined) => {
    const status = await appCheckReady;
    await prepareAuthToken(context);
    return status;
};

export const runFirebaseAuthWithAppCheckRecovery = async (
    operation,
    context = undefined,
) => {
    await appCheckReady;
    const recoverable = appCheck && isHostedElectronAppCheckContext(context);
    // Give SDK expiry recovery a chance before an explicit login after sleep.
    // Monitoring-mode requests remain allowed; enforced requests still fail at
    // the backend if no valid attestation can be obtained.
    const attemptedToken = await prepareAuthToken(context);
    try {
        return await operation();
    } catch (error) {
        if (!recoverable || !(error?.code === AUTH_APP_CHECK_INVALID ||
            String(error?.message || '').includes(AUTH_APP_CHECK_INVALID))) {
            throw error;
        }

        // Firebase Auth asks App Check for a cached token by default. Force one
        // fresh attestation after the server rejects that token, then retry the
        // idempotent Auth operation exactly once.
        try {
            await tokens.refreshRejected(attemptedToken);
        } catch (_refreshError) {
            console.warn('App Check recovery did not obtain a new token.', {
                code: _refreshError?.code || 'unknown',
                httpStatus: _refreshError?.customData?.httpStatus,
            });
            throw error;
        }
        return operation();
    }
};

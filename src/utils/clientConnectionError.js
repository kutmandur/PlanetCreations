import { resetElectronAppCheckRecovery } from './appCheckMode';

export const retryClientOnlineConnection = async ({
    electronApi = typeof window !== 'undefined' ? window.electronAPI : null,
    sessionStorage = typeof window !== 'undefined' ? window.sessionStorage : null,
    reload = typeof window !== 'undefined' ? () => window.location.reload() : () => {},
} = {}) => {
    if (sessionStorage) resetElectronAppCheckRecovery(sessionStorage);

    if (typeof electronApi?.retryOnlineConnection === 'function') {
        try {
            await electronApi.retryOnlineConnection();
            return;
        } catch (_error) {
            // Older or temporarily unavailable native handlers still get the
            // cache-bypassing reload path below.
        }
    }
    if (typeof electronApi?.reloadWindow === 'function') {
        try {
            await electronApi.reloadWindow();
            return;
        } catch (_error) {
            // The browser reload is the last compatible fallback.
        }
    }
    reload();
};

export const createClientConnectionErrorNotice = (context = undefined) => ({
    title: 'Connection error',
    message: 'PlanetCreations could not establish a secure connection.',
    detail: 'Reload the online version and try signing in again.',
    dismissible: false,
    actionLabel: 'Reload',
    actionPendingLabel: 'Reloading…',
    onAction: () => retryClientOnlineConnection(context),
});

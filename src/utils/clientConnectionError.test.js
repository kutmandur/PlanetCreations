import {
    createClientConnectionErrorNotice,
    retryClientOnlineConnection,
} from './clientConnectionError';
import { ELECTRON_APP_CHECK_RECOVERY_KEY } from './appCheckMode';

const createStorage = () => {
    const values = new Map([[ELECTRON_APP_CHECK_RECOVERY_KEY, 'stale']]);
    return {
        values,
        storage: {
            getItem: (key) => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
            removeItem: (key) => values.delete(key),
        },
    };
};

test('the connection notice retries the hosted client immediately', async () => {
    const retryOnlineConnection = vi.fn().mockResolvedValue(true);
    const reload = vi.fn();
    const { values, storage } = createStorage();
    const notice = createClientConnectionErrorNotice({
        electronApi: { retryOnlineConnection },
        sessionStorage: storage,
        reload,
    });

    expect(notice.title).toBe('Connection error');
    expect(notice.actionLabel).toBe('Reload');
    expect(notice.dismissible).toBe(false);

    await notice.onAction();

    expect(retryOnlineConnection).toHaveBeenCalledOnce();
    expect(values.has(ELECTRON_APP_CHECK_RECOVERY_KEY)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
});

test('falls back to the existing cache-bypassing client reload', async () => {
    const reloadWindow = vi.fn().mockResolvedValue(true);
    const reload = vi.fn();

    await retryClientOnlineConnection({
        electronApi: { reloadWindow },
        sessionStorage: createStorage().storage,
        reload,
    });

    expect(reloadWindow).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
});

import { expect, test, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck, getToken, setTokenAutoRefreshEnabled } from 'firebase/app-check';
import { createAppCheckTokenAccess } from './appCheckTokens';

test('real Firebase SDK renews an expired token after a two-hour clock jump', async () => {
    // This exercises SDK caching/expiry locally. It does not pretend to test
    // Google's reCAPTCHA assessment or contact a production project.
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(new Date('2026-09-16T10:00:00Z'));
    const app = initializeApp({apiKey: 'local-fixture', projectId: 'demo-app-check-wake', appId: 'local-wake-test'}, 'app-check-wake-test');
    const attest = vi.fn(async () => ({token: `local-token-${attest.mock.calls.length}`, expireTimeMillis: Date.now() + 3600_000}));
    const appCheck = initializeAppCheck(app, {provider: new CustomProvider({getToken: attest}), isTokenAutoRefreshEnabled: false});
    const access = createAppCheckTokenAccess(force => getToken(appCheck, force));
    try {
        const initial = await access.read();
        expect((await access.read()).token).toBe(initial.token);
        expect(attest).toHaveBeenCalledTimes(1);
        vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
        const afterSleep = await access.read();
        expect(afterSleep.token).not.toBe(initial.token);
        expect(attest).toHaveBeenCalledTimes(2);
        expect((await access.read()).token).toBe(afterSleep.token);
        expect(attest).toHaveBeenCalledTimes(2);
    } finally {
        setTokenAutoRefreshEnabled(appCheck, false);
        await deleteApp(app);
        vi.useRealTimers();
    }
});

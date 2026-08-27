import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appCheck: { name: 'app-check' },
    getToken: vi.fn(),
    readyStatus: 'ready',
    appCheckReady: {
        then: (resolve, reject) => Promise.resolve(mocks.readyStatus).then(resolve, reject),
    },
}));

vi.mock('firebase/app-check', () => ({ getToken: mocks.getToken }));
vi.mock('./config', () => ({
    appCheck: mocks.appCheck,
    appCheckReady: mocks.appCheckReady,
}));

import {
    isFirebaseAppCheckAuthError,
    isHostedElectronAppCheckContext,
    runFirebaseAuthWithAppCheckRecovery,
    waitForElectronAppCheck,
} from './appCheck';

const hostedElectronContext = {
    electronApi: { isElectron: true },
    origin: 'https://www.planetcreations.net',
};

beforeEach(() => {
    mocks.getToken.mockReset();
    mocks.readyStatus = 'ready';
});

test('recognizes Firebase Auth App Check failures for a connection notice', () => {
    expect(isFirebaseAppCheckAuthError({
        code: 'auth/firebase-app-check-token-is-invalid',
    })).toBe(true);
    expect(isFirebaseAppCheckAuthError(new Error(
        'Firebase: Error (auth/firebase-app-check-token-is-invalid).',
    ))).toBe(true);
    expect(isFirebaseAppCheckAuthError({ code: 'auth/invalid-credential' })).toBe(false);
});

test('does not reload the client when App Check startup failed', async () => {
    mocks.readyStatus = 'failed';
    const reload = vi.fn();

    await expect(waitForElectronAppCheck({
        ...hostedElectronContext,
        reload,
    })).resolves.toBe('failed');

    expect(reload).not.toHaveBeenCalled();
});

test('recognizes only the hosted desktop client as the Auth recovery context', () => {
    expect(isHostedElectronAppCheckContext(hostedElectronContext)).toBe(true);
    expect(isHostedElectronAppCheckContext({
        ...hostedElectronContext,
        electronApi: null,
    })).toBe(false);
    expect(isHostedElectronAppCheckContext({
        ...hostedElectronContext,
        origin: 'http://localhost:3000',
    })).toBe(false);
});

test('refreshes App Check and retries one rejected Electron Auth request', async () => {
    const invalidTokenError = {
        code: 'auth/firebase-app-check-token-is-invalid',
    };
    const operation = vi.fn()
        .mockRejectedValueOnce(invalidTokenError)
        .mockResolvedValueOnce('signed-in');
    mocks.getToken.mockResolvedValue({ token: 'fresh-token' });

    await expect(runFirebaseAuthWithAppCheckRecovery(
        operation,
        hostedElectronContext,
    )).resolves.toBe('signed-in');

    expect(mocks.getToken).toHaveBeenCalledWith(mocks.appCheck, true);
    expect(operation).toHaveBeenCalledTimes(2);
});

test('does not retry unrelated Auth failures or normal browser requests', async () => {
    const wrongPassword = { code: 'auth/invalid-credential' };
    const invalidToken = { code: 'auth/firebase-app-check-token-is-invalid' };
    const wrongPasswordOperation = vi.fn().mockRejectedValue(wrongPassword);
    const browserOperation = vi.fn().mockRejectedValue(invalidToken);

    await expect(runFirebaseAuthWithAppCheckRecovery(
        wrongPasswordOperation,
        hostedElectronContext,
    )).rejects.toBe(wrongPassword);
    await expect(runFirebaseAuthWithAppCheckRecovery(browserOperation, {
        electronApi: null,
        origin: 'https://www.planetcreations.net',
    })).rejects.toBe(invalidToken);

    expect(wrongPasswordOperation).toHaveBeenCalledOnce();
    expect(browserOperation).toHaveBeenCalledOnce();
    expect(mocks.getToken).not.toHaveBeenCalled();
});

test('keeps the original Auth error when token refresh itself fails', async () => {
    const invalidTokenError = {
        code: 'auth/firebase-app-check-token-is-invalid',
    };
    const operation = vi.fn().mockRejectedValue(invalidTokenError);
    mocks.getToken.mockRejectedValue({ code: 'appCheck/throttled' });

    await expect(runFirebaseAuthWithAppCheckRecovery(
        operation,
        hostedElectronContext,
    )).rejects.toBe(invalidTokenError);
    expect(operation).toHaveBeenCalledOnce();
});

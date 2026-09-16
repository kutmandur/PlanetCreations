import { expect, test, vi } from 'vitest';
import { createAppCheckTokenAccess } from './appCheckTokens';

test('shares concurrent reads but leaves expiry/cache management to Firebase', async () => {
    const fetchToken = vi.fn().mockResolvedValue({token: 'before-sleep'});
    const access = createAppCheckTokenAccess(fetchToken);
    await Promise.all([access.read(), access.read(), access.read()]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    fetchToken.mockResolvedValue({token: 'after-sleep'});
    expect((await access.read()).token).toBe('after-sleep');
    expect(fetchToken.mock.calls).toEqual([[false], [false]]);
});

test('concurrent server rejections perform one forced attestation', async () => {
    const fetchToken = vi.fn(force => Promise.resolve({token: force ? 'fresh' : 'rejected'}));
    const access = createAppCheckTokenAccess(fetchToken);
    const results = await Promise.all(Array.from({length: 10}, () => access.refreshRejected('rejected')));
    expect(results.every(r => r.token === 'fresh')).toBe(true);
    expect(fetchToken.mock.calls.filter(([force]) => force)).toHaveLength(1);
});

test('does not force another assessment if Firebase already renewed the rejected token', async () => {
    const fetchToken = vi.fn().mockResolvedValue({token: 'renewed-by-sdk'});
    const access = createAppCheckTokenAccess(fetchToken);
    expect((await access.refreshRejected('rejected')).token).toBe('renewed-by-sdk');
    expect(fetchToken.mock.calls).toEqual([[false]]);
});

test('rejects cached-token fallback after failed attestation and bounds repeated recovery', async () => {
    let time = 100_000;
    const fetchToken = vi.fn().mockResolvedValue({token: 'rejected'});
    const access = createAppCheckTokenAccess(fetchToken, () => time);
    await expect(access.refreshRejected('rejected')).rejects.toMatchObject({code: 'appCheck/token-refresh-failed'});
    await expect(access.refreshRejected('rejected')).rejects.toMatchObject({code: 'appCheck/token-refresh-failed'});
    expect(fetchToken.mock.calls.filter(([force]) => force)).toHaveLength(1);
    time += 31_000;
    fetchToken.mockImplementation(force => Promise.resolve({token: force ? 'fresh' : 'rejected'}));
    expect((await access.refreshRejected('rejected')).token).toBe('fresh');
    expect(fetchToken.mock.calls.filter(([force]) => force)).toHaveLength(2);
});

test('propagates provider throttling without resetting the provider or retrying it', async () => {
    const error = {code: 'appCheck/throttled', customData: {httpStatus: 403}};
    const fetchToken = vi.fn(force => force ? Promise.reject(error) : Promise.resolve({token: 'old'}));
    const access = createAppCheckTokenAccess(fetchToken);
    await expect(access.refreshRejected('old')).rejects.toBe(error);
    await expect(access.refreshRejected('old')).rejects.toBe(error);
    expect(fetchToken.mock.calls.filter(([force]) => force)).toHaveLength(1);
});

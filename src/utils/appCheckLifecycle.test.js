import { expect, test, vi } from 'vitest';
import { startAppCheckLifecycle } from './appCheckLifecycle';

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup({legacy = false, offline = false, hidden = false, getToken = vi.fn().mockResolvedValue({token: 'valid'})} = {}) {
    const view = new EventTarget();
    const document = Object.assign(new EventTarget(), {visibilityState: hidden ? 'hidden' : 'visible'});
    const navigator = {onLine: !offline};
    const setAutoRefresh = vi.fn();
    const unsubscribe = vi.fn();
    const onError = vi.fn();
    let power;
    let time = 100_000;
    const stop = startAppCheckLifecycle({window: view, document, navigator, getToken, setAutoRefresh, onError,
        now: () => time, electronApi: legacy ? {} : {onSystemPowerState: callback => { power = callback; return unsubscribe; }}});
    return {view, document, navigator, getToken, setAutoRefresh, unsubscribe, onError, stop,
        power: state => power(state), advance: duration => {time += duration;}};
}

test('checks cached tokens on startup and after a long suspend without forcing reCAPTCHA', async () => {
    const s = setup(); await settle();
    s.power('suspend');
    expect(s.setAutoRefresh).toHaveBeenLastCalledWith(false);
    s.advance(2 * 3600_000);
    s.power('resume'); await settle();
    expect(s.getToken.mock.calls).toEqual([[false], [false]]);
    expect(s.setAutoRefresh).toHaveBeenLastCalledWith(true);
    s.stop();
});

test('does not attest offline or hidden; online wake coalesces with focus and resume', async () => {
    const s = setup({offline: true}); await settle();
    expect(s.getToken).not.toHaveBeenCalled();
    s.navigator.onLine = true;
    s.view.dispatchEvent(new Event('online'));
    s.view.dispatchEvent(new Event('focus'));
    s.power('resume'); await settle();
    expect(s.getToken).toHaveBeenCalledTimes(1);
    s.document.visibilityState = 'hidden';
    s.document.dispatchEvent(new Event('visibilitychange'));
    s.advance(3600_000);
    s.view.dispatchEvent(new Event('focus')); await settle();
    expect(s.getToken).toHaveBeenCalledTimes(1);
    expect(s.setAutoRefresh).toHaveBeenLastCalledWith(false);
    s.document.visibilityState = 'visible';
    s.document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(s.getToken).toHaveBeenCalledTimes(2);
    s.stop();
});

test('legacy bridges recover through browser events and rapid focus changes are cheap', async () => {
    const s = setup({legacy: true}); await settle();
    for (let i = 0; i < 20; i++) s.view.dispatchEvent(new Event('focus'));
    await settle(); expect(s.getToken).toHaveBeenCalledTimes(1);
    s.advance(3600_000);
    s.view.dispatchEvent(new Event('pageshow')); await settle();
    expect(s.getToken).toHaveBeenCalledTimes(2);
    s.stop();
});

test('a failed wake does not reload or loop; network return can retry immediately', async () => {
    const error = {code: 'appCheck/fetch-network-error'};
    const getToken = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({token: 'fresh'});
    const s = setup({getToken}); await settle();
    expect(s.onError).toHaveBeenCalledWith(error);
    expect(getToken).toHaveBeenCalledTimes(1);
    s.view.dispatchEvent(new Event('online')); await settle();
    expect(getToken).toHaveBeenCalledTimes(2);
    s.stop();
    s.advance(3600_000);
    s.view.dispatchEvent(new Event('online'));
    s.document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(s.unsubscribe).toHaveBeenCalledOnce();
    expect(s.setAutoRefresh).toHaveBeenLastCalledWith(false);
});

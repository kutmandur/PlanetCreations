// The SDK handles token expiry. Resume events make it check again after its
// timers were suspended; they must not force a new reCAPTCHA assessment.
export function startAppCheckLifecycle({
    window: view,
    document,
    navigator,
    electronApi,
    getToken,
    setAutoRefresh,
    now = Date.now,
    onError = () => {},
}) {
    let stopped = false;
    let suspended = false;
    let enabled;
    let pending = null;
    let lastAttemptAt = -Infinity;
    const active = () => !stopped && !suspended &&
        navigator.onLine !== false && document.visibilityState !== 'hidden';

    function synchronize(priority = false) {
        const shouldRefresh = active();
        if (enabled !== shouldRefresh) {
            enabled = shouldRefresh;
            setAutoRefresh(shouldRefresh);
        }
        if (!shouldRefresh || pending || (!priority && now() >= lastAttemptAt &&
            now() - lastAttemptAt < 30_000)) return;
        lastAttemptAt = now();
        pending = Promise.resolve().then(() => getToken(false))
            .catch(error => { if (!stopped) onError(error); })
            .finally(() => { pending = null; });
    }

    const onFocus = () => synchronize();
    const onOnline = () => synchronize(true);
    const onOffline = () => synchronize();
    const onVisibility = () => synchronize();
    const onPower = (state) => {
        if (state !== 'suspend' && state !== 'resume') return;
        suspended = state === 'suspend';
        synchronize(state === 'resume');
    };
    view.addEventListener('focus', onFocus);
    view.addEventListener('pageshow', onFocus);
    view.addEventListener('online', onOnline);
    view.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    // Optional capability: released bridges still use focus/online/visibility.
    const unsubscribe = electronApi?.onSystemPowerState?.(onPower);
    synchronize();
    return () => {
        stopped = true;
        synchronize();
        view.removeEventListener('focus', onFocus);
        view.removeEventListener('pageshow', onFocus);
        view.removeEventListener('online', onOnline);
        view.removeEventListener('offline', onOffline);
        document.removeEventListener('visibilitychange', onVisibility);
        unsubscribe?.();
    };
}

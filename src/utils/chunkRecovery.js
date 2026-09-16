const RELOAD_KEY = 'chunkReloadAt';
const RELOAD_WINDOW_MS = 10000;

export function reloadAfterChunkFailure({browserWindow = window, now = Date.now()} = {}) {
    try {
        const storage = browserWindow.sessionStorage;
        const last = Number(storage.getItem(RELOAD_KEY) || 0);
        if (Number.isFinite(last) && now - last < RELOAD_WINDOW_MS) return false;
        storage.setItem(RELOAD_KEY, String(now));
        // If storage is blocked, a reload would lose the only cross-page guard.
        if (storage.getItem(RELOAD_KEY) !== String(now)) return false;
        browserWindow.location.reload();
        return true;
    } catch {
        return false;
    }
}

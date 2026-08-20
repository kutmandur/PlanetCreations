const STREAM_SESSION_KEY = 'pc.streamSession';
const GENERAL_OVERLAY_PREFS_KEY = 'pc.generalOverlayNotificationPrefs';
const STREAM_CHANNEL = 'pc-stream-management';

const publish = (type) => {
    try {
        const channel = new BroadcastChannel(STREAM_CHANNEL);
        channel.postMessage({ type });
        channel.close();
    } catch (error) { /* BroadcastChannel is optional */ }
};

export function readStreamSession() {
    try {
        const raw = localStorage.getItem(STREAM_SESSION_KEY);
        if (!raw) return null;
        const value = JSON.parse(raw);
        return value?.sessionId && value?.status === 'active' ? value : null;
    } catch (error) {
        return null;
    }
}

export function setStreamSession(session) {
    try {
        if (session?.sessionId && session?.status === 'active') {
            localStorage.setItem(STREAM_SESSION_KEY, JSON.stringify(session));
        } else {
            localStorage.removeItem(STREAM_SESSION_KEY);
        }
        window.dispatchEvent(new CustomEvent('pc-stream-session-changed'));
        publish('stream-session-changed');
    } catch (error) { /* localStorage may be unavailable */ }
}

export function subscribeStreamSession(callback) {
    const emit = () => callback(readStreamSession());
    let channel = null;
    try {
        channel = new BroadcastChannel(STREAM_CHANNEL);
        channel.onmessage = (event) => {
            if (event.data?.type === 'stream-session-changed') emit();
        };
    } catch (error) { /* optional */ }
    window.addEventListener('storage', emit);
    window.addEventListener('pc-stream-session-changed', emit);
    return () => {
        channel?.close();
        window.removeEventListener('storage', emit);
        window.removeEventListener('pc-stream-session-changed', emit);
    };
}

export function readGeneralOverlayNotificationPrefs() {
    const fallback = { enabled: true, mutedUntil: 0, permanentlyMuted: false, mutedForStreamSessionId: null };
    try {
        const parsed = JSON.parse(localStorage.getItem(GENERAL_OVERLAY_PREFS_KEY) || 'null');
        return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
    } catch (error) {
        return fallback;
    }
}

export function setGeneralOverlayNotificationPrefs(prefs) {
    const next = { ...readGeneralOverlayNotificationPrefs(), ...prefs };
    try {
        localStorage.setItem(GENERAL_OVERLAY_PREFS_KEY, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('pc-overlay-notification-prefs-changed'));
        publish('general-notification-prefs-changed');
    } catch (error) { /* noop */ }
    return next;
}

export function subscribeGeneralOverlayNotificationPrefs(callback) {
    const emit = () => callback(readGeneralOverlayNotificationPrefs());
    let channel = null;
    try {
        channel = new BroadcastChannel(STREAM_CHANNEL);
        channel.onmessage = (event) => {
            if (event.data?.type === 'general-notification-prefs-changed') emit();
        };
    } catch (error) { /* optional */ }
    window.addEventListener('storage', emit);
    window.addEventListener('pc-overlay-notification-prefs-changed', emit);
    return () => {
        channel?.close();
        window.removeEventListener('storage', emit);
        window.removeEventListener('pc-overlay-notification-prefs-changed', emit);
    };
}

export function generalOverlayNotificationsMuted(prefs, now = Date.now(), activeSessionId = null) {
    return prefs?.enabled === false || prefs?.permanentlyMuted === true ||
        Boolean(activeSessionId && prefs?.mutedForStreamSessionId === activeSessionId) ||
        Number(prefs?.mutedUntil || 0) > now;
}

export const __streamSessionKeys = {
    STREAM_SESSION_KEY,
    GENERAL_OVERLAY_PREFS_KEY,
};

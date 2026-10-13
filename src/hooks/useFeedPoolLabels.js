import { useSyncExternalStore } from 'react';
const eventName = 'pcn-feed-pool-labels';
const keyFor = uid => `pcn_feed_pool_labels:${uid || 'guest'}`;
export function getFeedPoolLabels(uid) {
    try { return localStorage.getItem(keyFor(uid)) === 'true'; } catch { return false; }
}
export function setFeedPoolLabels(uid, enabled) {
    localStorage.setItem(keyFor(uid), String(enabled === true));
    window.dispatchEvent(new Event(eventName));
}
function subscribe(callback) {
    window.addEventListener(eventName, callback);
    window.addEventListener('storage', callback);
    return () => {
        window.removeEventListener(eventName, callback);
        window.removeEventListener('storage', callback);
    };
}
export function useFeedPoolLabels(uid) {
    return useSyncExternalStore(subscribe, () => getFeedPoolLabels(uid), () => false);
}

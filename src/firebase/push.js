import { getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc, updateDoc, arrayRemove, arrayUnion } from 'firebase/firestore';
import { db, getMessagingIfSupported } from './config';

// Web Push (FCM) client helpers. All guarded so the app runs fine where push is
// unavailable (Electron, iOS Safari before add-to-home-screen, private windows).

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

// The messaging service worker is env-driven: we pass the (non-secret) web config
// to it as query params so it doesn't need to be hard-coded in public/.
const swConfigQuery = new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
}).toString();

let swRegistration = null;
const registerMessagingSW = async () => {
    if (!('serviceWorker' in navigator)) return null;
    if (swRegistration) return swRegistration;
    swRegistration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${swConfigQuery}`);
    return swRegistration;
};

export const getPushPermission = () =>
    (typeof Notification !== 'undefined' ? Notification.permission : 'denied');

export const isPushSupported = async () => {
    const messaging = await getMessagingIfSupported();
    return !!messaging && 'serviceWorker' in navigator && typeof Notification !== 'undefined';
};

const inboxRef = (uid) => doc(db, 'users', uid, 'meta', 'inbox');

/**
 * Requests notification permission (must be called from a user gesture),
 * registers the messaging service worker, obtains an FCM token and stores it on
 * the user's inbox doc. Returns { ok, reason?, token? }.
 */
export const enablePush = async (uid) => {
    if (!uid) return { ok: false, reason: 'not-logged-in' };
    const messaging = await getMessagingIfSupported();
    if (!messaging) return { ok: false, reason: 'unsupported' };
    if (!VAPID_KEY) {
        console.warn('Push disabled: VITE_FIREBASE_VAPID_KEY is not set.');
        return { ok: false, reason: 'no-vapid-key' };
    }
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return { ok: false, reason: 'denied' };

        const registration = await registerMessagingSW();
        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration || undefined,
        });
        if (!token) return { ok: false, reason: 'no-token' };

        await setDoc(inboxRef(uid), { pushTokens: arrayUnion(token) }, { merge: true });
        return { ok: true, token };
    } catch (err) {
        console.error('Error enabling push notifications:', err);
        return { ok: false, reason: 'error', error: err };
    }
};

/** Removes this device's token (best-effort) — e.g. on an explicit opt-out. */
export const disablePush = async (uid) => {
    try {
        const messaging = await getMessagingIfSupported();
        if (!messaging || !VAPID_KEY) return;
        const token = await getToken(messaging, { vapidKey: VAPID_KEY });
        if (token && uid) {
            await updateDoc(inboxRef(uid), { pushTokens: arrayRemove(token) });
        }
    } catch (err) {
        console.warn('Could not remove push token:', err);
    }
};

/**
 * Foreground message hook. The bell already live-updates via the inbox Firestore
 * listener, so this is optional (e.g. to show a toast). Returns an unsubscribe fn.
 */
export const onForegroundMessage = async (callback) => {
    const messaging = await getMessagingIfSupported();
    if (!messaging) return () => {};
    return onMessage(messaging, callback);
};

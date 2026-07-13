/* global importScripts, firebase, clients */
// Firebase Cloud Messaging background service worker.
//
// The Firebase web config is NOT secret (it is shipped in the client bundle by
// design). To keep it driven by the same env vars as the app instead of
// hard-coding it here, push.js registers this worker with the config appended as
// query params (e.g. /firebase-messaging-sw.js?apiKey=...&projectId=...) and we
// read them back below. This worker only handles BACKGROUND messages; the server
// sends DATA-ONLY messages (no `notification` field) so the browser does not also
// auto-display them — we build the notification here to avoid duplicates.

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);
firebase.initializeApp({
    apiKey: params.get('apiKey'),
    authDomain: params.get('authDomain'),
    projectId: params.get('projectId'),
    messagingSenderId: params.get('messagingSenderId'),
    appId: params.get('appId'),
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const d = payload.data || {};
    self.registration.showNotification(d.title || 'PlanetCreations', {
        body: d.body || '',
        icon: '/android-chrome-192x192.png',
        badge: '/favicon-32x32.png',
        data: { link: d.link || '/' },
        // Same tag collapses repeated notifications for the same target.
        tag: d.tag || undefined,
    });
});

// Clicking the notification focuses an open tab (navigating it) or opens a new one.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = (event.notification.data && event.notification.data.link) || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) {
                    if ('navigate' in client) { try { client.navigate(link); } catch (e) { /* cross-origin guard */ } }
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(link);
            return undefined;
        })
    );
});

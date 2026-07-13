const { admin, db } = require('./firebase');

// Bot-side mirror of functions/notify.js: append to a user's capped inbox doc and
// send web push, respecting prefs. Also fans a community event out to members who
// have event notifications enabled. (Duplicated because the bot and Cloud
// Functions are separate deploy targets.)

const INBOX_CAP = 30;

function prefAllows(prefs, type, channel) {
    const p = prefs && prefs[type];
    if (!p) return true;
    return p[channel] !== false;
}

function toHashLink(link) {
    if (!link) return '/';
    return link.startsWith('/') ? `/#${link}` : link;
}

async function sendPush(uid, tokens, { title, body, link, type }) {
    if (!tokens || tokens.length === 0) return;
    let res;
    try {
        res = await admin.messaging().sendEachForMulticast({
            tokens,
            data: {
                title: title || 'PlanetCreations',
                body: body || '',
                link: toHashLink(link),
                tag: type || '',
            },
        });
    } catch (err) {
        console.error('[Notify] FCM send failed:', err.message);
        return;
    }
    const invalid = [];
    res.responses.forEach((r, i) => {
        if (!r.success) {
            const code = (r.error && r.error.code) || '';
            if (
                code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token' ||
                code === 'messaging/invalid-argument'
            ) invalid.push(tokens[i]);
        }
    });
    if (invalid.length) {
        await db.doc(`users/${uid}/meta/inbox`)
            .update({ pushTokens: admin.firestore.FieldValue.arrayRemove(...invalid) })
            .catch(() => {});
    }
}

async function notifyUser(uid, type, { title, message, link }) {
    if (!uid) return;
    const inboxRef = db.doc(`users/${uid}/meta/inbox`);
    let pushTokens = [];
    let wantPush = true;

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(inboxRef);
        const data = snap.exists ? snap.data() : {};
        const prefs = data.prefs || {};
        pushTokens = data.pushTokens || [];
        wantPush = prefAllows(prefs, type, 'push');

        if (prefAllows(prefs, type, 'inApp')) {
            const item = {
                id: db.collection('_ids').doc().id,
                type,
                title: title || '',
                message: message || '',
                link: link || '/',
                timestamp: admin.firestore.Timestamp.now(),
                isRead: false,
            };
            const items = [item, ...(data.items || [])].slice(0, INBOX_CAP);
            const unreadCount = items.filter((i) => !i.isRead).length;
            tx.set(inboxRef, { items, unreadCount }, { merge: true });
        }
    });

    if (wantPush) {
        await sendPush(uid, pushTokens, { title, body: message, link, type });
    }
}

// Fan a community event out to members who have event notifications on
// (member doc field notifyEvents, default true).
async function notifyCommunityEvent(communityId, { title, message, link }) {
    if (!communityId) return;
    const membersSnap = await db.collection(`communitys/${communityId}/members`).get();
    if (membersSnap.empty) return;
    await Promise.all(membersSnap.docs.map((m) => {
        if (m.data().notifyEvents === false) return null; // default on
        return notifyUser(m.id, 'communityEvent', { title, message, link });
    }));
}

module.exports = { notifyUser, notifyCommunityEvent };

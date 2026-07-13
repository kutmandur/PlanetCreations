const admin = require("firebase-admin");

// Shared notification fan-out: append to a user's single capped inbox doc
// (users/{uid}/meta/inbox) and send a web-push (FCM) to their stored tokens,
// respecting the user's prefs. One transaction = 1 read + 1 write per recipient.

const INBOX_CAP = 30;

// Unknown types (e.g. admin 'bugReport') default to on for both channels.
function prefAllows(prefs, type, channel) {
    const p = prefs && prefs[type];
    if (!p) return true;
    return p[channel] !== false;
}

// Push opens the SPA via its hash route, so a react-router path like
// "/creation/123" must become "/#/creation/123" for the service worker.
function toHashLink(link) {
    if (!link) return "/";
    return link.startsWith("/") ? `/#${link}` : link;
}

async function sendPush(uid, tokens, { title, body, link, type }) {
    if (!tokens || tokens.length === 0) return;
    let res;
    try {
        res = await admin.messaging().sendEachForMulticast({
            tokens,
            // DATA-ONLY (no `notification` field) so the SW builds the notification
            // and the browser doesn't also auto-display a duplicate.
            data: {
                title: title || "PlanetCreations",
                body: body || "",
                link: toHashLink(link),
                tag: type || "",
            },
        });
    } catch (err) {
        console.error("FCM send failed:", err);
        return;
    }
    const invalid = [];
    res.responses.forEach((r, i) => {
        if (!r.success) {
            const code = (r.error && r.error.code) || "";
            if (
                code === "messaging/registration-token-not-registered" ||
                code === "messaging/invalid-registration-token" ||
                code === "messaging/invalid-argument"
            ) {
                invalid.push(tokens[i]);
            }
        }
    });
    if (invalid.length) {
        await admin.firestore().doc(`users/${uid}/meta/inbox`)
            .update({ pushTokens: admin.firestore.FieldValue.arrayRemove(...invalid) })
            .catch(() => {});
    }
}

/**
 * Notify a single user. `type` gates delivery via the user's prefs; `link` is a
 * react-router path (e.g. "/creation/123") used by both the in-app item and push.
 */
async function notifyUser(uid, type, { title, message, link }) {
    if (!uid) return;
    const db = admin.firestore();
    const inboxRef = db.doc(`users/${uid}/meta/inbox`);

    let pushTokens = [];
    let wantPush = true;

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(inboxRef);
        const data = snap.exists ? snap.data() : {};
        const prefs = data.prefs || {};
        pushTokens = data.pushTokens || [];
        wantPush = prefAllows(prefs, type, "push");

        if (prefAllows(prefs, type, "inApp")) {
            const item = {
                id: db.collection("_ids").doc().id,
                type,
                title: title || "",
                message: message || "",
                link: link || "/",
                timestamp: admin.firestore.Timestamp.now(),
                isRead: false,
            };
            // Prepend newest, drop the oldest beyond the cap (FIFO ring buffer).
            const items = [item, ...(data.items || [])].slice(0, INBOX_CAP);
            const unreadCount = items.filter((i) => !i.isRead).length;
            tx.set(inboxRef, { items, unreadCount }, { merge: true });
        }
    });

    if (wantPush) {
        await sendPush(uid, pushTokens, { title, body: message, link, type });
    }
}

module.exports = { notifyUser };

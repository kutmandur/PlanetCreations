import { doc, setDoc } from 'firebase/firestore';
import { db } from './config';

// The notification bell is backed by a single capped inbox doc per user
// (users/{uid}/meta/inbox = { items:[…], unreadCount, prefs, pushTokens }).
// Item shape: { id, type, title, message, link, timestamp, isRead }.

const inboxRef = (uid) => doc(db, 'users', uid, 'meta', 'inbox');

// Clears the user's notification inbox (1 write).
export const clearAllNotifications = async (uid) => {
    if (!uid) return;
    await setDoc(inboxRef(uid), { items: [], unreadCount: 0 }, { merge: true });
};

// Marks every notification as read (1 write). Takes the current items — the
// caller already has them via the inbox listener — so no extra read is needed.
export const markAllRead = async (uid, items) => {
    if (!uid || !Array.isArray(items) || items.length === 0) return;
    if (items.every((i) => i.isRead)) return;
    await setDoc(
        inboxRef(uid),
        { items: items.map((i) => ({ ...i, isRead: true })), unreadCount: 0 },
        { merge: true }
    );
};

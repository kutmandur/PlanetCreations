import {
    collection,
    addDoc,
    query,
    limit,
    getDocs,
    serverTimestamp,
    updateDoc,
    increment,
    where,
    doc,
    writeBatch,
    setDoc
} from 'firebase/firestore';
import { db } from './config';

// Sends notifications to followers of a creation when it's updated.
export const sendUpdateNotifications = async (creationId, creationTitle) => {
    const followersQuery = query(collection(db, 'creationFollowers', creationId, 'followers'));
    const followersSnapshot = await getDocs(followersQuery);

    followersSnapshot.forEach(async (followerDoc) => {
        const followerId = followerDoc.id;
        const notificationsRef = collection(db, 'users', followerId, 'notifications');
        
        const q = query(notificationsRef, where('creationId', '==', creationId), where('isRead', '==', false), limit(1));
        const existingNotifSnapshot = await getDocs(q);

        if (!existingNotifSnapshot.empty) {
            const existingNotifDoc = existingNotifSnapshot.docs[0];
            await updateDoc(existingNotifDoc.ref, {
                updateCount: increment(1),
                timestamp: serverTimestamp()
            });
        } else {
            await addDoc(notificationsRef, {
                creationId,
                creationTitle,
                isRead: false,
                timestamp: serverTimestamp(),
                updateCount: 1,
            });
        }
    });
};

/**
 * Deletes all notifications for a given user in a single batch.
 * @param {string} userId - The ID of the user whose notifications will be cleared.
 */
export const clearAllNotifications = async (userId) => {
    const notificationsRef = collection(db, 'users', userId, 'notifications');
    const notificationsSnapshot = await getDocs(notificationsRef);

    if (notificationsSnapshot.empty) {
        return; // Nothing to clear
    }

    const batch = writeBatch(db);
    notificationsSnapshot.forEach(doc => {
        batch.delete(doc.ref);
    });

    await batch.commit();
};

import { doc, writeBatch, collection, query, where, getDocs, arrayRemove } from "firebase/firestore";
import { db } from "./config";

/**
 * Deletes an event and removes its ID from all associated creations.
 * @param {string} eventId - The ID of the event to delete.
 */
export const deleteEvent = async (eventId) => {
    if (!eventId) return;

    const batch = writeBatch(db);

    // 1. Delete the event document itself
    const eventRef = doc(db, 'events', eventId);
    batch.delete(eventRef);

    // 2. Find all creations that were part of this event
    const creationsQuery = query(collection(db, 'creations'), where('eventIds', 'array-contains', eventId));
    const creationsSnapshot = await getDocs(creationsQuery);

    // 3. For each creation, remove the eventId from its eventIds array
    creationsSnapshot.forEach(creationDoc => {
        batch.update(creationDoc.ref, {
            eventIds: arrayRemove(eventId)
        });
    });

    // Commit all batched writes to the database
    await batch.commit();
};
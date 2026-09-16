import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from './config';

export const setEventVote = data => httpsCallable(getFunctions(), 'setEventVote')(data).then(result => result.data);
export function subscribeEventBallot(eventId, uid, callback, onError) {
    return onSnapshot(doc(db, 'events', eventId, 'ballots', uid), snap => {
        callback(snap.exists() ? snap.data() : { creationIds: [], revision: 0 });
    }, onError);
}
export function subscribeEventVoteCounts(eventId, schemaVersion, creations, callback, onError) {
    if (schemaVersion === 2) {
        return onSnapshot(collection(db, 'events', eventId, 'voteTotals'), snap => {
            callback(Object.assign({}, ...snap.docs.map(d => d.data().counts || {})));
        }, onError);
    }
    // Historical events remain readable during migration.
    const counts = {};
    const stops = creations.map(creation => onSnapshot(query(
        collection(db, 'creations', creation.id, 'votes'),
        where('type', '==', 'event_vote'), where('eventId', '==', eventId),
    ), snap => { counts[creation.id] = snap.size; callback({ ...counts }); }, onError));
    return () => stops.forEach(stop => stop());
}

import {signOut} from 'firebase/auth';
import {clearIndexedDbPersistence, terminate} from 'firebase/firestore';
import {getFunctions, httpsCallable} from 'firebase/functions';
import {auth, db} from './config';
import {clearAccountLocalData} from '../utils/accountLocalData';
import {clearIndexSnapshots} from './indexSnapshotCache';

export const DELETION_RECEIPT_KEY = 'pc-account-deletion-receipt';
export const previewAccountDeletion = async userId => (await httpsCallable(getFunctions(), 'getAccountDeletionPreview')({userId})).data;
export const communityDeletionWarning = communities => communities.length ?
    ` The following communities will also be permanently deleted: ${communities.map(item => item.name).join(', ')}. To keep them, cancel and select a new owner in Community Settings first. Other users' creations will be kept; only their community links will be removed.` : '';

export async function requestAccountDeletion(communities) {
    const uid = auth.currentUser.uid;
    const receipt = localStorage.getItem(DELETION_RECEIPT_KEY) || [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
    // Persist before submission so a lost response can be retried idempotently.
    localStorage.setItem(DELETION_RECEIPT_KEY, receipt);
    const result = (await httpsCallable(getFunctions(), 'deleteOwnAccount')({protocolVersion: 2, receipt, confirmedCommunityIds: communities.map(item => item.id)})).data;
    if (!result.accepted || !result.receipt) throw new Error('The deletion request was not accepted.');
    localStorage.setItem(DELETION_RECEIPT_KEY, result.receipt);
    clearAccountLocalData(uid);
    await signOut(auth);
    await terminate(db);
    try {
        await clearIndexSnapshots();
        await clearIndexedDbPersistence(db);
        localStorage.removeItem('pc-clear-firestore-cache');
    } catch {
        // Another open tab can own the IndexedDB lease. Retry on next startup.
        localStorage.setItem('pc-clear-firestore-cache', '1');
    }
    window.location.reload();
}

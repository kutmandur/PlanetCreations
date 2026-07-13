import { doc, getDoc } from 'firebase/firestore';
import { db } from './config';
import { entryToCreation } from './searchIndexService';

// Community-Suchindex: ein Firestore-Dokument pro Community
// (communitySearchIndex/{communityId}), gepflegt von den Cloud-Function-
// Triggern syncCommunityLinkToIndex / syncCreationToCommunityIndexes.
// Die kurzen Feldnamen müssen zu buildCommunityIndexEntry in
// functions/index.js passen.

/**
 * Wandelt einen Community-Index-Eintrag in ein CreationCard-kompatibles
 * Objekt inkl. Community-Metadaten (pinned, Showcase-Status, Creator-Rollen,
 * Custom-Field-Daten) um.
 */
export function communityEntryToCreation(id, e, communityId) {
    return {
        ...entryToCreation(id, e),
        game: e.g || '',
        shareCode: e.sc || null,
        // CreationShowcaseCard liest communitySpecificData[community.id]
        communitySpecificData: { [communityId]: e.csd || {} },
        pinned: e.pin || false,
        markedForShowcase: e.m4s || false,
        showcaseNote: e.nt || '',
        appliedForShowcase: e.app || false,
        appliedAt: e.appAt ? { toMillis: () => e.appAt, seconds: Math.floor(e.appAt / 1000) } : null,
        showcaseVideoUrl: e.svu || null,
        showcaseName: e.snm || null,
        showcaseGroupId: e.grp || null,
        creatorRoles: e.rk || [],
        linkedAt: e.la || null,
    };
}

/**
 * Lädt den Suchindex einer Community (genau 1 Firestore-Read).
 */
export async function fetchCommunityIndex(communityId) {
    const snap = await getDoc(doc(db, 'communitySearchIndex', communityId));
    if (!snap.exists()) return [];
    const entries = snap.data().entries || {};
    return Object.entries(entries).map(([id, entry]) => communityEntryToCreation(id, entry, communityId));
}

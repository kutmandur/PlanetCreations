import { doc, getDoc } from 'firebase/firestore';
import { db } from './config';

// Kompakter Suchindex: ein Firestore-Dokument pro Spiel (searchIndex/{game}),
// gepflegt vom Cloud-Function-Trigger syncCreationToSearchIndex.
// Die kurzen Feldnamen müssen zu buildIndexEntry in functions/index.js passen.

/**
 * Wandelt einen kompakten Index-Eintrag in ein CreationCard-kompatibles Objekt um.
 * Achtung: description ist im Index auf 200 Zeichen gekürzt — diese Objekte
 * dürfen daher nie in den ['creation', id]-React-Query-Cache geschrieben werden,
 * den die Detailseite nutzt.
 */
export function entryToCreation(id, e) {
    return {
        id,
        title: e.t || '',
        description: e.d || '',
        tags: e.tg || [],
        category: e.c || '',
        platform: e.p || 'pc',
        modStatus: e.m || 'NoMods',
        requiredDlcs: e.dlc || [],
        imageUrls: e.img ? [e.img] : [],
        videoUrls: e.vid ? [e.vid] : [],
        likes: e.l || 0,
        dislikes: e.dl || 0,
        views: e.v || 0,
        createdAt: e.ca ? { toMillis: () => e.ca, seconds: Math.floor(e.ca / 1000) } : null,
        userId: e.u || '',
        username: e.un || '',
        userProfilePictureUrl: e.up || null,
        status: e.s || 'wip',
        __fromIndex: true,
    };
}

/**
 * Lädt den Suchindex eines Spiels (genau 1 Firestore-Read) und liefert
 * die Einträge als Array im Creation-Format.
 */
export async function fetchSearchIndex(game) {
    const snap = await getDoc(doc(db, 'searchIndex', game));
    if (!snap.exists()) return [];
    const entries = snap.data().entries || {};
    return Object.entries(entries).map(([id, entry]) => entryToCreation(id, entry));
}

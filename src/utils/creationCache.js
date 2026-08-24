import { collection, query, where, documentId, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Cached eine Liste von Creations im React Query Cache
 */
export function cacheCreations(queryClient, creations) {
    creations.forEach(creation => {
        queryClient.setQueryData(['creation', creation.id], creation);
    });
}

/**
 * Holt eine Creation aus dem Cache
 */
export function getCachedCreation(queryClient, creationId) {
    return queryClient.getQueryData(['creation', creationId]);
}

/**
 * Removes a deleted/missing Creation from every client-side list that can keep
 * rendering a card after the canonical document is gone.
 */
export function removeCreationFromCaches(queryClient, creationId) {
    if (!queryClient || !creationId) return;
    queryClient.removeQueries({queryKey: ['creation', creationId], exact: true});
    for (const queryKey of ['searchIndex', 'communityIndex']) {
        queryClient.setQueriesData({queryKey: [queryKey]}, current =>
            Array.isArray(current) ?
                current.filter(creation => creation?.id !== creationId) :
                current
        );
    }
    queryClient.setQueriesData({queryKey: ['homeCreations']}, current =>
        current && Array.isArray(current.creationIds) ? {
            ...current,
            creationIds: current.creationIds.filter(id => id !== creationId),
        } : current
    );
}

/**
 * Holt mehrere Creations aus dem Cache, gibt gecachte und fehlende IDs zurück
 */
export function getCreationsFromCache(queryClient, creationIds) {
    const cached = [];
    const missingIds = [];

    for (const id of creationIds) {
        const data = queryClient.getQueryData(['creation', id]);
        if (data) {
            cached.push(data);
        } else {
            missingIds.push(id);
        }
    }

    return { cached, missingIds };
}

/**
 * Lädt Creations von Firestore anhand ihrer IDs (Batch-Query)
 * Firestore 'in' Query unterstützt max 10 IDs, daher splitten wir bei Bedarf
 */
export async function fetchCreationsByIds(ids) {
    if (!ids || ids.length === 0) return [];

    const creations = [];
    const batchSize = 10; // Firestore limit für 'in' queries

    for (let i = 0; i < ids.length; i += batchSize) {
        const batchIds = ids.slice(i, i + batchSize);
        const q = query(
            collection(db, 'creations'),
            where(documentId(), 'in', batchIds)
        );
        const snapshot = await getDocs(q);
        snapshot.docs.forEach(doc => {
            creations.push({ id: doc.id, ...doc.data() });
        });
    }

    return creations;
}

/**
 * Holt Creations aus Cache oder lädt fehlende vom Server
 * Gibt alle Creations in der Reihenfolge der ursprünglichen IDs zurück
 */
export async function getCreationsWithCache(queryClient, creationIds) {
    const { cached, missingIds } = getCreationsFromCache(queryClient, creationIds);

    if (missingIds.length === 0) {
        // Alle im Cache - in ursprünglicher Reihenfolge zurückgeben
        return creationIds.map(id => cached.find(c => c.id === id)).filter(Boolean);
    }

    // Fehlende laden
    const loaded = await fetchCreationsByIds(missingIds);

    // Geladene Creations cachen
    cacheCreations(queryClient, loaded);

    // Alle Creations zusammenführen
    const allCreations = [...cached, ...loaded];

    // In ursprünglicher Reihenfolge zurückgeben
    return creationIds.map(id => allCreations.find(c => c.id === id)).filter(Boolean);
}

/**
 * HomePage Listen-Cache Funktionen
 */
export function cacheHomePageList(queryClient, game, creationIds, lastTimestamp, hasMore) {
    queryClient.setQueryData(['homeCreations', game], {
        creationIds,
        lastTimestamp,
        hasMore
    });
}

export function getCachedHomePageList(queryClient, game) {
    return queryClient.getQueryData(['homeCreations', game]);
}

/**
 * Community Listen-Cache Funktionen
 */
export function cacheCommunityCreationList(queryClient, communityId, creationIds) {
    queryClient.setQueryData(['communityCreations', communityId], {
        creationIds,
        timestamp: Date.now()
    });
}

export function getCachedCommunityCreationList(queryClient, communityId) {
    return queryClient.getQueryData(['communityCreations', communityId]);
}

/**
 * Community-spezifische Metadaten (pinned, showcase)
 */
export function cacheCommunityCreationMeta(queryClient, communityId, metaData) {
    queryClient.setQueryData(['communityCreationMeta', communityId], metaData);
}

export function getCachedCommunityCreationMeta(queryClient, communityId) {
    return queryClient.getQueryData(['communityCreationMeta', communityId]);
}

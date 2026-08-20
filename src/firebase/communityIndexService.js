import { entryToCreation } from './searchIndexService';
import { fetchScalableMapIndex } from './scalableIndexService';

// Größenbasierter Community-Suchindex: State + Shards pro Community, gepflegt
// von syncCommunityLinkToIndex / syncCreationToCommunityIndexes.
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
 * Lädt alle Shards des Suchindexes einer Community.
 */
export async function fetchCommunityIndex(communityId) {
    const scalableIndex = await fetchScalableMapIndex({
        scopeId: communityId,
        shardCollection: 'communitySearchIndexShards',
        stateCollection: 'communitySearchIndexState',
    });
    const entries = scalableIndex?.entries || {};
    return Object.entries(entries).map(([id, entry]) => communityEntryToCreation(id, entry, communityId));
}

import { fetchScalableMapIndex } from './scalableIndexService';
import { cacheFrontierDlcCatalog } from '../utils/frontierDlcCatalogCache';

// Größenbasierter Suchindex: ein State-Dokument und beliebig viele Shards pro
// Spiel, gepflegt vom Cloud-Function-Trigger syncCreationToSearchIndex.
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
        activityScore: e.as || 0,
        activityAt: e.aa ? { toMillis: () => e.aa, seconds: Math.floor(e.aa / 1000) } : null,
        liveStream: e.lu ? { platform: e.lp || 'twitch', expiresAt: { toMillis: () => e.lu, seconds: Math.floor(e.lu / 1000) } } : null,
        userId: e.u || '',
        username: e.un || '',
        userProfilePictureUrl: e.up || null,
        status: e.s || 'wip',
        __fromIndex: true,
    };
}

/**
 * Lädt alle Shards eines Spiels und liefert den gemeinsamen Startseiten-Pool
 * als Array im Creation-Format.
 */
export async function fetchSearchIndex(game) {
    const scalableIndex = await fetchScalableMapIndex({
        scopeId: game,
        shardCollection: 'searchIndexShards',
        stateCollection: 'searchIndexState',
    });
    cacheFrontierDlcCatalog(game, scalableIndex?.metadata?.dlcCatalog);
    const entries = scalableIndex?.entries || {};
    return Object.entries(entries).map(([id, entry]) => entryToCreation(id, entry));
}

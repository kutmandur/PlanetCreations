import { doc, getDoc } from 'firebase/firestore';
import { db } from './config';

export const mergeScalableIndexShards = shards => {
    const entries = {};
    shards.forEach(shard => Object.assign(entries, shard?.e || {}));
    return entries;
};

const fetchLinkedShards = async (shardCollection, headShardId) => {
    const newestFirst = [];
    let currentShardId = headShardId;
    while (currentShardId) {
        const snapshot = await getDoc(doc(db, shardCollection, currentShardId));
        if (!snapshot.exists()) {
            throw new Error(`Scalable index shard ${currentShardId} is missing.`);
        }
        const shard = snapshot.data();
        newestFirst.push(shard);
        currentShardId = shard.p || null;
    }
    return newestFirst.reverse();
};

/**
 * Loads every shard of one logical index. Start-page ranking, local search and
 * filters deliberately receive one pool spanning all physical shard documents.
 */
export async function fetchScalableMapIndex({
    scopeId,
    shardCollection,
    stateCollection,
}) {
    const stateSnapshot = await getDoc(doc(db, stateCollection, scopeId));
    if (!stateSnapshot.exists()) return null;
    const state = stateSnapshot.data();
    const shardIds = Array.isArray(state.shardIds) ? state.shardIds : [];
    const shards = shardIds.length > 0
        ? await Promise.all(shardIds.map(async shardId => {
            const snapshot = await getDoc(doc(db, shardCollection, shardId));
            if (!snapshot.exists()) {
                throw new Error(`Scalable index shard ${shardId} is missing.`);
            }
            return snapshot.data();
        }))
        : await fetchLinkedShards(shardCollection, state.headShardId);

    return {
        entries: mergeScalableIndexShards(shards),
        metadata: state.m || {},
        shardCount: shards.length,
        state,
    };
}

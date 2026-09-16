import {readIndexSnapshot, saveIndexSnapshot} from './indexSnapshotCache';
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
    const visited = new Set();
    while (currentShardId) {
        if (visited.has(currentShardId)) throw new Error("Cyclic index shard chain.");
        visited.add(currentShardId);
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
const pending = new Map();
export function fetchScalableMapIndex(options) {
    const key = [options.stateCollection, options.scopeId, options.shardCollection].join('/');
    if (!pending.has(key)) pending.set(key, loadIndex(options, key).finally(() => pending.delete(key)));
    return pending.get(key);
}
async function loadIndex({scopeId, shardCollection, stateCollection}, key) {
    const cached = await readIndexSnapshot(key);
    for (let attempt = 0; attempt < 3; attempt++) {
        const stateSnapshot = await getDoc(doc(db, stateCollection, scopeId));
        if (!stateSnapshot.exists()) return null;
        const state = stateSnapshot.data();
        const shardIds = Array.isArray(state.shardIds) ? state.shardIds : [];
        const versioned = shardIds.length > 0 && shardIds.every(id => typeof state.revisions?.[id] === 'string');
        const shards = [];
        // Four concurrent reads, always keep the full pool and stable shard order.
        for (let offset = 0; offset < shardIds.length; offset += 4) {
            const page = await Promise.all(shardIds.slice(offset, offset + 4).map(async id => {
                if (versioned && cached?.shards?.[id]?.r === state.revisions[id]) return cached.shards[id];
                const snapshot = await getDoc(doc(db, shardCollection, id));
                if (!snapshot.exists()) return null;
                return snapshot.data();
            }));
            shards.push(...page);
        }
        if (!shardIds.length) shards.push(...await fetchLinkedShards(shardCollection, state.headShardId));
        if (shards.some((shard, index) => !shard || (versioned && shard.r !== state.revisions[shardIds[index]]))) continue;
        const result = {entries: mergeScalableIndexShards(shards), metadata: state.m || {}, shardCount: shards.length, state};
        if (versioned) await saveIndexSnapshot(key, {shards: Object.fromEntries(shardIds.map((id, i) => [id, shards[i]])), result});
        return result;
    }
    if (cached?.result) return cached.result;
    throw new Error('The index changed during loading. Please retry.');
}

import { communityEntryToCreation } from './communityIndexService';
import { fetchScalableMapIndex } from './scalableIndexService';

// Public scalable showcase index: state + size-bounded shards per showcase,
// maintained by syncShowcaseIndex. Entries share the community-index shape.

export async function fetchShowcaseIndex(showcaseId) {
    const scalableIndex = await fetchScalableMapIndex({
        scopeId: showcaseId,
        shardCollection: 'showcaseIndexShards',
        stateCollection: 'showcaseIndexState',
    });
    if (!scalableIndex) return null;
    const data = scalableIndex.metadata;
    const entries = scalableIndex.entries;
    return {
        communityId: data.communityId,
        name: data.name || null,
        videoUrl: data.videoUrl || null,
        creations: Object.entries(entries).map(([id, e]) =>
            communityEntryToCreation(id, e, data.communityId)),
    };
}

import { communityEntryToCreation } from './communityIndexService';
import { fetchScalableMapIndex } from './scalableIndexService';
import {doc,getDocFromServer} from 'firebase/firestore';
import {db} from './config';

// Public scalable showcase index: state + size-bounded shards per showcase,
// maintained by syncShowcaseIndex. Entries share the community-index shape.

export async function fetchShowcaseIndex(showcaseId) {
    // A fresh server check also prevents cached showcase shards bypassing a hold.
    const moderation=(await getDocFromServer(doc(db,'showcaseModeration',showcaseId))).data();
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
        name: (moderation?.withheld?moderation.name:data.name) || null,
        videoUrl: (moderation?.withheld?moderation.videoUrl:data.videoUrl) || null,
        moderationWithheld: moderation?.withheld===true,
        creations: Object.entries(entries).filter(([,entry])=>!entry.hidden).map(([id, e]) =>
            communityEntryToCreation(id, e, data.communityId)),
    };
}

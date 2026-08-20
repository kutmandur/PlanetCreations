import { doc, getDoc } from 'firebase/firestore';
import { db } from './config';

export const fetchYoutubeVideoIndexState = async () => {
    const snapshot = await getDoc(doc(db, 'youtubeVideoIndexState', 'current'));
    return snapshot.exists()
        ? snapshot.data()
        : { headNumber: 0, headShardId: null, version: 1 };
};

export const fetchYoutubeVideoIndexShard = async (shardId) => {
    if (!shardId) return null;
    const snapshot = await getDoc(doc(db, 'youtubeVideoIndexShards', shardId));
    if (!snapshot.exists()) throw new Error(`YouTube video index shard ${shardId} is missing.`);
    return { id: snapshot.id, ...snapshot.data() };
};

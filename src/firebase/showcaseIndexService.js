import { doc, getDoc } from 'firebase/firestore';
import { db } from './config';
import { communityEntryToCreation } from './communityIndexService';

// Public showcase index: one doc per showcase (showcaseIndex/{showcaseId}),
// maintained by the syncShowcaseIndex Cloud Function. Self-contained so a
// showcase page loads in a single read. Entries share the community-index shape.

export async function fetchShowcaseIndex(showcaseId) {
    const snap = await getDoc(doc(db, 'showcaseIndex', showcaseId));
    if (!snap.exists()) return null;
    const data = snap.data();
    const entries = data.entries || {};
    return {
        communityId: data.communityId,
        name: data.name || null,
        videoUrl: data.videoUrl || null,
        creations: Object.entries(entries).map(([id, e]) =>
            communityEntryToCreation(id, e, data.communityId)),
    };
}

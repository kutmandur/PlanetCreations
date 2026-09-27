import { fetchSearchIndex } from './searchIndexService';

// A cold index trigger can finish after the normal app refresh. Keep checking
// only after a creation was saved; unchanged shards use the snapshot cache.
const RETRY_DELAYS_MS = [2500, 2500, 5000, 10000, 20000, 30000];

export async function refreshCreatedCreationIndex(queryClient, { game, creationId }) {
    const queryKey = ['searchIndex', game];
    for (const delay of RETRY_DELAYS_MS) {
        await new Promise(resolve => setTimeout(resolve, delay));
        try {
            const creations = await queryClient.fetchQuery({
                queryKey,
                queryFn: () => fetchSearchIndex(game),
                // Bypass the homepage's 15-minute freshness window on retries.
                staleTime: 0,
                retry: false,
            });
            if (creations.some(creation => creation.id === creationId)) return true;
        } catch {
            // A transient read failure must not turn a successful save into an
            // upload error. The next bounded attempt can recover it.
        }
    }
    // Do not keep an incomplete result fresh on the next page visit. Withheld
    // or deleted creations may never enter the public index, so stop retrying.
    await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
    return false;
}

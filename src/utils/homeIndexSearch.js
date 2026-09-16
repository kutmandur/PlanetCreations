import Fuse from 'fuse.js';
import {rankCreations, DEFAULT_WEIGHTS} from './feedRanking';
export function searchHomeIndex({shouldUseIndexSearch, indexCreations, homeState, supportsConsole, dlcFilterMode, selectedDlcs, userProfile, activeTab, user, interestMap, globalFeedWeights, localFeedWeights, seed, now}) {
    const fuse = indexCreations?.length ? new Fuse(indexCreations, {
            keys: [
                { name: 'title', weight: 0.6 },
                { name: 'tags', weight: 0.3 },
                { name: 'description', weight: 0.1 },
            ],
            threshold: 0.35,
            ignoreLocation: true,
            minMatchCharLength: 2,
        }) : null;
        if (!shouldUseIndexSearch || !indexCreations) return [];

        let filtered = indexCreations;

        if (homeState.activeCategory !== 'All') {
            filtered = filtered.filter(c => c.category === homeState.activeCategory);
        }

        if (supportsConsole) {
            filtered = filtered.filter(c => (c.platform || 'pc') === homeState.platformFilter);
        }

        if (!homeState.showModsOnly) {
            filtered = filtered.filter(c => c.modStatus !== 'UsingMods');
        }

        if (homeState.filterTags?.length > 0) {
            filtered = filtered.filter(c =>
                c.tags && homeState.filterTags.every(filterTag =>
                    c.tags.some(creationTag => creationTag.toLowerCase() === filterTag.toLowerCase())
                )
            );
        }

        if (dlcFilterMode === 'owned') {
            const ownedDlcs = userProfile?.ownedDlcs?.[activeTab] || [];
            filtered = filtered.filter(creation =>
                !creation.requiredDlcs || creation.requiredDlcs.length === 0 || creation.requiredDlcs.every(dlc => ownedDlcs.includes(dlc))
            );
        } else if (dlcFilterMode === 'custom' && selectedDlcs.length > 0) {
            filtered = filtered.filter(creation =>
                !creation.requiredDlcs || creation.requiredDlcs.length === 0 || creation.requiredDlcs.every(dlc => selectedDlcs.includes(dlc))
            );
        }

        const term = homeState.searchTerm.trim();
        let results;
        if (term && fuse) {
            // Fuse liefert relevanz-sortierte Treffer über den ganzen Index;
            // hier auf die vorgefilterte Menge einschränken, Ranking beibehalten
            const allowed = new Map(filtered.map(c => [c.id, c]));
            results = fuse.search(term)
                .filter(r => allowed.has(r.item.id))
                .map(r => allowed.get(r.item.id));
        } else {
            results = [...filtered];
        }

        switch (homeState.sortBy) {
            case 'likes':
                results.sort((a, b) => (b.likes || 0) - (a.likes || 0));
                break;
            case 'likes_asc':
                results.sort((a, b) => (a.likes || 0) - (b.likes || 0));
                break;
            case 'createdAt_asc':
                results.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
                break;
            case 'recommended':
                // Mit Suchbegriff die Fuse-Relevanz beibehalten (wie bei 'createdAt')
                if (!term) {
                    // Seed kommt aus dem Ranking-Modul (neu pro Seitenreload,
                    // stabil während der SPA-Sitzung)
                    results = rankCreations(results, {
                        uid: user?.uid || null,
                        interestMap,
                        weights: localFeedWeights || globalFeedWeights || DEFAULT_WEIGHTS,
                        // Admin-Debug: Badge auf jeder Karte zeigt Herkunfts-Pool + Score
                        debug: userProfile?.role === 'admin',
                        seed, now,
                    });
                }
                break;
            case 'createdAt':
            default:
                // Mit Suchbegriff die Fuse-Relevanz beibehalten, sonst neueste zuerst
                if (!term) {
                    results.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
                }
                break;
        }

        return results;
}

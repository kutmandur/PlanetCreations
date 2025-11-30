import { liteClient as algoliasearch } from 'algoliasearch/lite';

// Algolia Client Setup - verwendet nur Search Key (public)
const algoliaAppId = process.env.REACT_APP_ALGOLIA_APP_ID;
const algoliaSearchKey = process.env.REACT_APP_ALGOLIA_SEARCH_KEY;

let searchClient = null;
const ALGOLIA_INDEX_NAME = 'creations';

if (algoliaAppId && algoliaSearchKey) {
    searchClient = algoliasearch(algoliaAppId, algoliaSearchKey);
}

/**
 * Checks if Algolia is configured and available
 */
export function isAlgoliaConfigured() {
    return searchClient !== null;
}

/**
 * Search creations using Algolia
 * @param {Object} options Search options
 * @param {string} options.query - Search text
 * @param {string} options.game - Game filter (planet-coaster, planet-coaster-2, planet-zoo)
 * @param {string[]} options.tags - Tag filters (AND logic)
 * @param {string} options.category - Category filter
 * @param {string} options.platform - Platform filter (pc, console)
 * @param {string} options.modStatus - Mod status filter
 * @param {string[]} options.requiredDlcs - Required DLCs filter
 * @param {number} options.limit - Results per page (default: 24)
 * @param {number} options.page - Page number (0-indexed)
 * @returns {Promise<{hits: Array, total: number, hasMore: boolean, page: number}>}
 */
export async function searchCreations({
    query = '',
    game,
    tags = [],
    category,
    platform,
    modStatus,
    requiredDlcs = [],
    limit = 24,
    page = 0
}) {
    if (!searchClient) {
        throw new Error('Algolia is not configured');
    }

    // Build filters array
    const filters = [];

    // Game filter is always required
    if (game) {
        filters.push(`game:${game}`);
    }

    // Category filter
    if (category && category !== 'All') {
        filters.push(`category:${category}`);
    }

    // Platform filter
    if (platform) {
        filters.push(`platform:${platform}`);
    }

    // Mod status filter
    if (modStatus && modStatus !== 'All') {
        filters.push(`modStatus:${modStatus}`);
    }

    // Tags filter (AND logic - all tags must match)
    // For array attributes, values need to be quoted
    if (tags.length > 0) {
        tags.forEach(tag => filters.push(`tags:"${tag}"`));
    }

    // DLC filter (AND logic - all DLCs must be required)
    if (requiredDlcs.length > 0) {
        requiredDlcs.forEach(dlc => filters.push(`requiredDlcs:${dlc}`));
    }

    try {
        const filterString = filters.join(' AND ');

        const response = await searchClient.search({
            requests: [{
                indexName: ALGOLIA_INDEX_NAME,
                query: query,
                filters: filterString,
                hitsPerPage: limit,
                page
            }]
        });

        const result = response.results[0];
        const { hits, nbHits, page: currentPage, nbPages } = result;

        // Transform hits to match Firestore format (objectID -> id)
        const transformedHits = hits.map(hit => ({
            ...hit,
            id: hit.objectID,
            // Convert imageUrl to imageUrls array for CreationCard compatibility
            imageUrls: hit.imageUrl ? [hit.imageUrl] : (hit.imageUrls || []),
            // Ensure createdAt is a proper format
            createdAt: hit.createdAt ? { toMillis: () => hit.createdAt } : null
        }));

        return {
            hits: transformedHits,
            total: nbHits,
            hasMore: currentPage < nbPages - 1,
            page: currentPage
        };
    } catch (error) {
        console.error('Algolia search error:', error);
        throw error;
    }
}

/**
 * Get search suggestions/autocomplete
 * @param {string} query - Partial search text
 * @param {string} game - Game to filter
 * @param {number} limit - Max suggestions
 * @returns {Promise<string[]>} Array of suggestions
 */
export async function getSearchSuggestions(query, game, limit = 5) {
    if (!searchClient || !query || query.length < 2) {
        return [];
    }

    try {
        const filters = game ? `game:${game}` : '';
        const response = await searchClient.search({
            requests: [{
                indexName: ALGOLIA_INDEX_NAME,
                query: query,
                filters,
                hitsPerPage: limit,
                attributesToRetrieve: ['title'],
                attributesToHighlight: []
            }]
        });

        const { hits } = response.results[0];
        return hits.map(hit => hit.title);
    } catch (error) {
        console.error('Algolia suggestions error:', error);
        return [];
    }
}

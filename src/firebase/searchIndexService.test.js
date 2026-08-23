import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./scalableIndexService', () => ({
    fetchScalableMapIndex: vi.fn(),
}));

import { fetchScalableMapIndex } from './scalableIndexService';
import { fetchSearchIndex } from './searchIndexService';
import { getCachedFrontierDlcCatalogs } from '../utils/frontierDlcCatalogCache';

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
});

it('caches the DLC catalog from the already-read search-index state', async () => {
    fetchScalableMapIndex.mockResolvedValue({
        entries: { creation: { t: 'Future Zoo' } },
        metadata: {
            dlcCatalog: {
                version: 88,
                entries: [{
                    name: 'Future Animal Pack',
                    bit: 21,
                    identifiers: ['Content21'],
                }],
            },
        },
    });

    const creations = await fetchSearchIndex('planet-zoo');

    expect(creations[0].title).toBe('Future Zoo');
    expect(getCachedFrontierDlcCatalogs()['planet-zoo']).toMatchObject({
        version: 88,
        entries: [{ name: 'Future Animal Pack', bit: 21 }],
    });
});

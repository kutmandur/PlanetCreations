import { beforeEach, describe, expect, it } from 'vitest';
import {
    cacheFrontierDlcCatalog,
    getCachedFrontierDlcCatalogs,
    sanitizeFrontierDlcCatalog,
} from './frontierDlcCatalogCache';

describe('frontier DLC catalog cache', () => {
    beforeEach(() => window.localStorage.clear());

    it('stores a sanitized catalog received with the game index', () => {
        cacheFrontierDlcCatalog('planet-zoo', {
            version: 42,
            entries: [{
                name: 'Future Animal Pack',
                bit: 21,
                identifiers: ['Content21'],
                ignored: 'not persisted',
            }],
        });

        expect(getCachedFrontierDlcCatalogs()).toEqual({
            'planet-zoo': {
                version: 42,
                entries: [{
                    name: 'Future Animal Pack',
                    bit: 21,
                    identifiers: ['Content21'],
                }],
            },
        });
    });

    it('rejects empty or malformed catalogs', () => {
        expect(sanitizeFrontierDlcCatalog({ entries: [] })).toBeNull();
        expect(sanitizeFrontierDlcCatalog(null)).toBeNull();
    });
});

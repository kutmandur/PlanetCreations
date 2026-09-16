import { beforeEach, describe, expect, test, vi } from 'vitest';
import { doc, getDoc } from 'firebase/firestore';
import {
    fetchScalableMapIndex,
    mergeScalableIndexShards,
} from './scalableIndexService';

vi.mock('./config', () => ({db: {}}));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, collection, id) => `${collection}/${id}`),
    getDoc: vi.fn(),
}));

const snapshot = data => ({
    data: () => data,
    exists: () => data !== null,
});

describe('scalableIndexService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('merges entries across physical shard boundaries', () => {
        expect(mergeScalableIndexShards([
            {e: {first: {t: 'First'}}},
            {e: {second: {t: 'Second'}}},
        ])).toEqual({
            first: {t: 'First'},
            second: {t: 'Second'},
        });
    });

    test('loads every listed shard in parallel for one complete start-page pool', async () => {
        getDoc.mockImplementation(reference => {
            if (reference === 'searchIndexState/planet-coaster-2') {
                return Promise.resolve(snapshot({
                    headShardId: 'shard-2',
                    shardIds: ['shard-1', 'shard-2'],
                }));
            }
            if (reference === 'searchIndexShards/shard-1') {
                return Promise.resolve(snapshot({e: {first: {t: 'First'}}}));
            }
            if (reference === 'searchIndexShards/shard-2') {
                return Promise.resolve(snapshot({e: {second: {t: 'Second'}}}));
            }
            return Promise.resolve(snapshot(null));
        });

        const result = await fetchScalableMapIndex({
            scopeId: 'planet-coaster-2',
            shardCollection: 'searchIndexShards',
            stateCollection: 'searchIndexState',
        });

        expect(result.shardCount).toBe(2);
        expect(Object.keys(result.entries)).toEqual(['first', 'second']);
        expect(doc).toHaveBeenCalledWith({}, 'searchIndexShards', 'shard-1');
        expect(doc).toHaveBeenCalledWith({}, 'searchIndexShards', 'shard-2');
    });

    test('does not hide unexpected scalable-index failures', async () => {
        getDoc.mockRejectedValueOnce(new Error('network unavailable'));

        await expect(fetchScalableMapIndex({
            scopeId: 'planet-coaster-2',
            shardCollection: 'searchIndexShards',
            stateCollection: 'searchIndexState',
        })).rejects.toThrow('network unavailable');
    });

    test('warm visits read one manifest plus only changed shards and retain the entire pool', async () => {
        let changed = false;
        const options = {stateCollection: 'state-cache-test', scopeId: 'game', shardCollection: 'shards-cache-test'};
        getDoc.mockImplementation(reference => {
            if (reference === 'state-cache-test/game') return Promise.resolve(snapshot({shardIds: ['a', 'b'], revisions: {a: changed ? 'a2' : 'a1', b: 'b1'}}));
            if (reference === 'shards-cache-test/a') return Promise.resolve(snapshot({r: changed ? 'a2' : 'a1', e: {first: {t: changed ? 'Updated' : 'First'}}}));
            return Promise.resolve(snapshot({r: 'b1', e: {last: {t: 'Rare old match'}}}));
        });
        await fetchScalableMapIndex(options); expect(getDoc).toHaveBeenCalledTimes(3);
        getDoc.mockClear();
        await fetchScalableMapIndex(options); expect(getDoc).toHaveBeenCalledTimes(1);
        changed = true; getDoc.mockClear();
        const result = await fetchScalableMapIndex(options);
        expect(getDoc).toHaveBeenCalledTimes(2);
        expect(result.entries).toEqual({first: {t: 'Updated'}, last: {t: 'Rare old match'}});
    });
    test('manifest mismatch retries without publishing mixed generations', async () => {
        let stateReads = 0;
        getDoc.mockImplementation(reference => reference === 'state-race/game'
            ? Promise.resolve(snapshot({shardIds: ['a'], revisions: {a: ++stateReads === 1 ? 'old' : 'new'}}))
            : Promise.resolve(snapshot({r: 'new', e: {park: {t: 'Current'}}})));
        const result = await fetchScalableMapIndex({stateCollection: 'state-race', scopeId: 'game', shardCollection: 'shards-race'});
        expect(stateReads).toBe(2); expect(result.entries.park.t).toBe('Current');
    });
});

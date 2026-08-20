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
});

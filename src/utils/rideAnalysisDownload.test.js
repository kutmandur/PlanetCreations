import {describe, expect, it, vi} from 'vitest';
import {
    MAX_COMPRESSED_ANALYSIS_BYTES,
    downloadCreationRideAnalysis,
} from './rideAnalysisDownload';

const base64 = bytes => btoa(String.fromCharCode(...bytes));

describe('ride-analysis chunk download', () => {
    it('joins contiguous authenticated chunks before decompression', async () => {
        const requestChunk = vi.fn()
            .mockResolvedValueOnce({
                offset: 0,
                totalBytes: 5,
                nextOffset: 3,
                chunkBase64: base64(Uint8Array.from([1, 2, 3])),
            })
            .mockResolvedValueOnce({
                offset: 3,
                totalBytes: 5,
                nextOffset: null,
                chunkBase64: base64(Uint8Array.from([4, 5])),
            });
        const decompress = vi.fn(async bytes => bytes.buffer);

        const result = await downloadCreationRideAnalysis('creation-1', requestChunk, {decompress});

        expect(requestChunk).toHaveBeenNthCalledWith(1, {creationId: 'creation-1', offset: 0});
        expect(requestChunk).toHaveBeenNthCalledWith(2, {creationId: 'creation-1', offset: 3});
        expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4, 5]);
    });

    it('rejects oversized and discontinuous responses', async () => {
        await expect(downloadCreationRideAnalysis('creation-1', async () => ({
            offset: 0,
            totalBytes: MAX_COMPRESSED_ANALYSIS_BYTES + 1,
            nextOffset: null,
            chunkBase64: base64(Uint8Array.from([1])),
        }), {decompress: vi.fn()})).rejects.toThrow('invalid chunk metadata');

        await expect(downloadCreationRideAnalysis('creation-1', async () => ({
            offset: 0,
            totalBytes: 2,
            nextOffset: 2,
            chunkBase64: base64(Uint8Array.from([1])),
        }), {decompress: vi.fn()})).rejects.toThrow('discontinuous chunk');
    });
});

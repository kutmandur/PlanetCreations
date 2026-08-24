const MAX_COMPRESSED_ANALYSIS_BYTES = 72 * 1024 * 1024;
const MAX_ANALYSIS_CHUNKS = 64;

function decodeBase64(value) {
    if (typeof value !== 'string' || !value) {
        throw new Error('Ride-analysis download returned an empty chunk.');
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export async function decompressRideAnalysis(compressedBytes) {
    if (typeof DecompressionStream !== 'function') {
        throw new Error('This browser does not support the ride-analysis format.');
    }
    const stream = new Blob([compressedBytes])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
}

export async function downloadCreationRideAnalysis(creationId, requestChunk, options = {}) {
    if (!creationId || typeof requestChunk !== 'function') {
        throw new Error('A creation and chunk loader are required.');
    }
    const decompress = options.decompress || decompressRideAnalysis;
    let expectedOffset = 0;
    let totalBytes = null;
    let compressed = null;
    let chunkCount = 0;

    while (expectedOffset !== null) {
        chunkCount += 1;
        if (chunkCount > MAX_ANALYSIS_CHUNKS) {
            throw new Error('Ride-analysis download contains too many chunks.');
        }
        const chunk = await requestChunk({creationId, offset: expectedOffset});
        if (!chunk || chunk.offset !== expectedOffset ||
            !Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes <= 0 ||
            chunk.totalBytes > MAX_COMPRESSED_ANALYSIS_BYTES) {
            throw new Error('Ride-analysis download returned invalid chunk metadata.');
        }
        if (totalBytes === null) {
            totalBytes = chunk.totalBytes;
            compressed = new Uint8Array(totalBytes);
        } else if (chunk.totalBytes !== totalBytes) {
            throw new Error('Ride-analysis download changed while it was being read.');
        }

        const bytes = decodeBase64(chunk.chunkBase64);
        if (bytes.length <= 0 || expectedOffset + bytes.length > totalBytes) {
            throw new Error('Ride-analysis download returned an invalid chunk size.');
        }
        compressed.set(bytes, expectedOffset);
        const followingOffset = expectedOffset + bytes.length;
        if (chunk.nextOffset === null) {
            if (followingOffset !== totalBytes) {
                throw new Error('Ride-analysis download ended before all data arrived.');
            }
            expectedOffset = null;
        } else if (chunk.nextOffset === followingOffset && followingOffset < totalBytes) {
            expectedOffset = followingOffset;
        } else {
            throw new Error('Ride-analysis download returned a discontinuous chunk.');
        }
    }

    return decompress(compressed);
}

export {MAX_ANALYSIS_CHUNKS, MAX_COMPRESSED_ANALYSIS_BYTES};

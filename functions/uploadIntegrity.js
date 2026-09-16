"use strict";

function requireObjectEtag(head) {
    if (typeof head?.ETag !== "string" || !head.ETag) {
        throw new Error("The upload has no object version token.");
    }
    return head.ETag;
}

async function boundedBodyToBuffer(body, maxBytes = 300 * 1024 * 1024, idleTimeoutMs = 60000) {
    if (!body?.[Symbol.asyncIterator]) throw new Error("Object body is not a readable stream.");
    const chunks = [];
    let bytes = 0;
    const iterator = body[Symbol.asyncIterator]();
    try {
        while (true) {
            let timer;
            const part = await Promise.race([
                iterator.next(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error("Object download stalled.")), idleTimeoutMs);
                }),
            ]).finally(() => clearTimeout(timer));
            if (part.done) break;
            const chunk = part.value;
            bytes += chunk.length;
            if (bytes > maxBytes) throw new Error("Object exceeds the permitted size.");
            chunks.push(Buffer.from(chunk));
        }
    } catch (error) {
        body.destroy?.();
        void iterator.return?.().catch(() => {});
        throw error;
    }
    return Buffer.concat(chunks, bytes);
}

module.exports = {requireObjectEtag, boundedBodyToBuffer};

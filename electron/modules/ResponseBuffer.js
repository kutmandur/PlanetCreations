const fs = require('node:fs/promises');
const DEFAULT_MAX_BYTES = 300 * 1024 * 1024;

async function* responseChunks(response, { maxBytes = DEFAULT_MAX_BYTES, idleTimeoutMs = 60000 } = {}) {
    if (!response || typeof response.arrayBuffer !== 'function' || !response.body?.[Symbol.asyncIterator]) {
        throw new TypeError('The download response does not provide arrayBuffer() and a readable body.');
    }
    const declared = Number(response.headers?.get('content-length'));
    if (declared > maxBytes) {
        if (response.body.cancel) await response.body.cancel().catch(() => {});
        response.body.destroy?.();
        throw new Error('The download exceeds its size limit.');
    }
    const reader = response.body.getReader?.();
    const iterator = reader ? {next: () => reader.read()} : response.body[Symbol.asyncIterator]();
    let total = 0;
    try {
        while (true) {
            let timer;
            const next = await Promise.race([
                iterator.next(),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Download stalled. Please try again.')), idleTimeoutMs); }),
            ]).finally(() => clearTimeout(timer));
            if (next.done) break;
            const chunk = Buffer.from(next.value);
            total += chunk.length;
            if (total > maxBytes) throw new Error('The download exceeds its size limit.');
            yield chunk;
        }
        if (total === 0) throw new Error('The download is empty.');
    } finally {
        if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        else { response.body.destroy?.(); void iterator.return?.().catch(() => {}); }
    }
}

async function responseToBuffer(response, options) {
    const chunks = [];
    for await (const chunk of responseChunks(response, options)) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function responseToFile(response, destination, options) {
    const file = await fs.open(destination, 'wx');
    try {
        for await (const chunk of responseChunks(response, options)) await file.writeFile(chunk);
        await file.sync();
    } catch (error) {
        await file.close();
        await fs.unlink(destination).catch(() => {});
        throw error;
    }
    await file.close();
    return destination;
}

module.exports = { responseToBuffer, responseToFile };

const test = require('node:test');
const assert = require('node:assert/strict');

const { responseToBuffer, responseToFile } = require('./ResponseBuffer');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('converts a native fetch Response body into a Node buffer', async () => {
    const response = new Response(Uint8Array.from([0x50, 0x43, 0x32]));

    const buffer = await responseToBuffer(response);

    assert.ok(Buffer.isBuffer(buffer));
    assert.deepEqual([...buffer], [0x50, 0x43, 0x32]);
});

test('rejects legacy or malformed response objects clearly', async () => {
    await assert.rejects(
        responseToBuffer({ buffer: async () => Buffer.from('legacy') }),
        /does not provide arrayBuffer/,
    );
});

test('aborts on actual streamed size even with a missing or forged length header', async () => {
    for (const headers of [{}, {'content-length': '2'}]) {
        let cancelled = false;
        const response = new Response(new ReadableStream({
            pull(controller) { controller.enqueue(new Uint8Array(4)); },
            cancel() { cancelled = true; },
        }), {headers});
        await assert.rejects(responseToBuffer(response, {maxBytes: 7}), /size limit/);
        assert.equal(cancelled, true);
    }
});
test('stalled streams cancel and partial files are removed; preexisting files are preserved', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-download-test-'));
    const destination = path.join(directory, 'package');
    let cancelled = false;
    try {
        const response = new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(2));}, cancel() {cancelled = true;}}));
        await assert.rejects(responseToFile(response, destination, {idleTimeoutMs: 20}), /stalled/);
        assert.equal(cancelled, true);
        await assert.rejects(fs.stat(destination), {code: 'ENOENT'});
        await fs.writeFile(destination, 'existing');
        await assert.rejects(responseToFile(new Response('new'), destination), {code: 'EEXIST'});
        assert.equal(await fs.readFile(destination, 'utf8'), 'existing');
    } finally { await fs.unlink(destination).catch(() => {}); await fs.rmdir(directory); }
});

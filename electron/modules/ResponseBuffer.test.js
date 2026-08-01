const test = require('node:test');
const assert = require('node:assert/strict');

const { responseToBuffer } = require('./ResponseBuffer');

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

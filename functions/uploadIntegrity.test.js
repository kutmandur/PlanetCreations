const assert = require('node:assert/strict');
const test = require('node:test');
const {Readable} = require('node:stream');
const {readFileSync} = require('node:fs');
const {requireObjectEtag, boundedBodyToBuffer} = require('./uploadIntegrity');
const {parseOptions, runObjectConditionTest} = require('./scripts/testUploadObjectConditions');
test('bounded R2 reader rejects actual oversized body and destroys its stream', async () => {
    const body = Readable.from([Buffer.alloc(4), Buffer.alloc(4)]);
    await assert.rejects(boundedBodyToBuffer(body, 7), /exceeds/);
    assert.equal(body.destroyed, true);
    assert.deepEqual(await boundedBodyToBuffer(Readable.from([Buffer.from('abcd')]), 4), Buffer.from('abcd'));
});
test('ETags are required opaque condition tokens, not substituted content hashes', () => {
    assert.equal(requireObjectEtag({ETag: '"multipart-etag-3"'}), '"multipart-etag-3"');
    assert.throws(() => requireObjectEtag({}), /version token/);
});

test('stalled R2 bodies stop before the overall function timeout', async () => {
    const body = new Readable({read() {}});
    await assert.rejects(boundedBodyToBuffer(body, 100, 10), /stalled/);
    assert.equal(body.destroyed, true);
});
test('all three temporary-upload publication paths bind GET and COPY to the checked HEAD', () => {
    const source = readFileSync(require.resolve('./index'), 'utf8');
    for (const name of ['finalizeBackupUpload', 'createCollaboration', 'finalizeCollaborationVersion']) {
        const start = source.indexOf(`exports.${name} =`);
        const end = source.indexOf('\nexports.', start + 10);
        const body = source.slice(start, end);
        assert.match(body, /Key: session\.objectKey,\s*IfMatch: requireObjectEtag\(head\)/, name);
        assert.match(body, /CopySource: encodeCopySource\(bucket, session\.objectKey\),\s*CopySourceIfMatch: requireObjectEtag\(head\)/, name);
        assert.match(body, /fileBuffer\.length !== head\.ContentLength/, name);
    }
});

function testBucket({failAfterCopy = false, occupied = false, refuseCleanup = false} = {}) {
    const objects = new Map(), calls = [];
    const error = code => Object.assign(new Error(`HTTP ${code}`), {$metadata: {httpStatusCode: code}});
    let copied = false;
    return {objects, calls, async send(command) {
        const {Bucket, Key, Body, IfMatch, IfNoneMatch, CopySource, CopySourceIfMatch, Prefix} = command.input;
        const operation = command.constructor.name;
        calls.push({operation, Key, Prefix});
        assert.equal(Bucket, 'test-bucket');
        if (Key) assert.match(Key, /^security-condition-test\/[a-f0-9-]+\/(source|destination)$/);
        const value = objects.get(Key);
        if (operation === 'ListObjectsV2Command') return {IsTruncated: false,
            Contents: occupied ? [{Key: `${Prefix}preexisting`}] : [...objects.keys()].filter(k => k.startsWith(Prefix)).map(Key => ({Key}))};
        if (operation === 'DeleteObjectCommand') {
            if (refuseCleanup && value) throw error(403);
            objects.delete(Key); return {};
        }
        if (operation === 'PutObjectCommand') {
            if (IfNoneMatch === '*' && value) throw error(412);
            objects.set(Key, Buffer.from(Body)); return {};
        }
        if (operation === 'CopyObjectCommand') {
            const source = objects.get(CopySource.slice(Bucket.length + 1));
            if (!source) throw error(404);
            if (CopySourceIfMatch !== source.toString('hex')) throw error(412);
            objects.set(Key, Buffer.from(source)); copied = true;
            if (failAfterCopy) throw error(503); // Remote copy succeeded but response was lost.
            return {};
        }
        if (!value) throw error(404);
        if (IfMatch && IfMatch !== value.toString('hex')) throw error(412);
        if (operation === 'HeadObjectCommand') return {ETag: value.toString('hex')};
        if (operation === 'GetObjectCommand') return {Body: Readable.from([value])};
        throw Error(`Unexpected operation ${operation}, copied=${copied}`);
    }};
}

test('production R2 test requires explicit bucket confirmation and a cleanup journal', () => {
    const args = ['--bucket=test-bucket', '--endpoint=https://example.eu.r2.cloudflarestorage.com'];
    assert.throws(() => parseOptions(args), /matching/);
    assert.throws(() => parseOptions([...args, '--confirm-production-bucket=test-bucket']), /journal/);
    assert.equal(parseOptions([...args, '--confirm-production-bucket=test-bucket', '--journal=run.json']).production, true);
});

test('R2 test verifies removal of both objects after success and a lost COPY response', async () => {
    for (const failAfterCopy of [false, true]) {
        const s3 = testBucket({failAfterCopy});
        const run = runObjectConditionTest({s3, bucket: 'test-bucket', log: () => {}});
        if (failAfterCopy) await assert.rejects(run, /503/);
        else assert.equal((await run).cleanupVerified, true);
        assert.equal(s3.objects.size, 0);
        assert.equal(s3.calls.at(-1).operation, 'ListObjectsV2Command');
    }
});

test('R2 preflight never writes or deletes anything when its fresh prefix is occupied', async () => {
    const s3 = testBucket({occupied: true});
    await assert.rejects(runObjectConditionTest({s3, bucket: 'test-bucket', log: () => {}}), /must be empty/);
    assert.deepEqual(s3.calls.map(c => c.operation), ['ListObjectsV2Command']);
});

test('R2 test cannot report success when cleanup fails', async () => {
    const s3 = testBucket({refuseCleanup: true}), messages = [];
    await assert.rejects(runObjectConditionTest({s3, bucket: 'test-bucket', log: value => messages.push(JSON.parse(value))}), /Cleanup not verified/);
    assert.equal(messages.at(-1).cleanupVerified, false);
    assert.equal(s3.objects.size, 2);
});

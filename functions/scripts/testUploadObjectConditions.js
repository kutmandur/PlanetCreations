// Opt-in R2 integration test; production use requires explicit bucket confirmation.
// Only two fresh keys under this run's random prefix may be written/deleted.
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const assert = require('node:assert/strict');
const {S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand,
    CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command} = require('@aws-sdk/client-s3');
const {boundedBodyToBuffer, requireObjectEtag} = require('../uploadIntegrity');

function parseOptions(args) {
    const option = name => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
    const bucket = option('--bucket'), endpoint = new URL(option('--endpoint'));
    const production = option('--confirm-production-bucket') === bucket;
    if (!bucket || !/^[a-z0-9][a-z0-9.-]+$/.test(bucket) ||
        (!production && option('--confirm-test-bucket') !== bucket)) {
        throw new Error('Specify --bucket and a matching --confirm-test-bucket or --confirm-production-bucket.');
    }
    if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.r2.cloudflarestorage.com') ||
        endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
        throw new Error('Use the HTTPS R2 account endpoint.');
    }
    const journalPath = option('--journal');
    if (production && !journalPath) throw new Error('Production tests require a local --journal path for cleanup recovery.');
    return {bucket, endpoint: endpoint.origin, production, journalPath};
}

async function runObjectConditionTest({s3, bucket, journalPath, signal, production = false, log = console.log}) {
    const prefix = `security-condition-test/${randomUUID()}/`;
    const source = `${prefix}source`, destination = `${prefix}destination`, keys = [source, destination];
    const journal = {bucket, prefix, keys, production, startedAt: new Date().toISOString(), cleanupVerified: false};
    const saveJournal = initial => {
        if (journalPath) fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), {flag: initial ? 'wx' : 'w', mode: 0o600});
    };
    saveJournal(true); // Refuse to overwrite another run's recovery journal.
    const send = (command, cleaning = false) => s3.send(command, {abortSignal:
        !cleaning && signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)});
    const absent = async (key, cleaning = false) => {
        await assert.rejects(send(new HeadObjectCommand({Bucket: bucket, Key: key}), cleaning),
            error => error.$metadata?.httpStatusCode === 404);
    };
    const emptyPrefix = async (cleaning = false) => {
        const list = await send(new ListObjectsV2Command({Bucket: bucket, Prefix: prefix, MaxKeys: 3}), cleaning);
        assert.equal(list.IsTruncated, false, 'Test prefix listing was truncated.');
        assert.equal((list.Contents || []).length, 0, 'Test prefix must be empty.');
    };
    // No cleanup on a failed ownership preflight: never delete preexisting data.
    await emptyPrefix();
    for (const key of keys) await absent(key);
    for (const Key of keys) await send(new DeleteObjectCommand({Bucket: bucket, Key})); // Check delete permission before uploads.
    journal.status = 'running'; saveJournal();
    log(JSON.stringify({phase: 'started', bucket, prefix, keys}));
    const original = Buffer.from('original package fixture');
    const put = (Body, first = false) => send(new PutObjectCommand({Bucket: bucket, Key: source, Body,
        ...(first ? {IfNoneMatch: '*'} : {}), Metadata: {'security-test': prefix}}));
    const head = () => send(new HeadObjectCommand({Bucket: bucket, Key: source}));
    const expectPreconditionFailure = async command => {
        let response;
        try { response = await send(command); }
        catch (error) { assert.equal(error.$metadata?.httpStatusCode, 412); return; }
        response.Body?.destroy();
        throw new Error('R2 accepted an operation with an obsolete ETag.');
    };
    let testError, cleanupError;
    try {
        await put(original, true);
        let etag = requireObjectEtag(await head());
        await put(Buffer.from('changed before GET'));
        await expectPreconditionFailure(new GetObjectCommand({Bucket: bucket, Key: source, IfMatch: etag}));
        await put(original);
        etag = requireObjectEtag(await head());
        const verified = await send(new GetObjectCommand({Bucket: bucket, Key: source, IfMatch: etag}));
        assert.deepEqual(await boundedBodyToBuffer(verified.Body, 1024), original);
        await put(Buffer.from('changed after GET'));
        const copyCommand = () => new CopyObjectCommand({Bucket: bucket, Key: destination,
            CopySource: `${bucket}/${source}`, CopySourceIfMatch: etag});
        await expectPreconditionFailure(copyCommand());
        await absent(destination);
        await put(original);
        etag = requireObjectEtag(await head());
        await send(copyCommand());
        const copied = await send(new GetObjectCommand({Bucket: bucket, Key: destination}));
        assert.deepEqual(await boundedBodyToBuffer(copied.Body, 1024), original);
        journal.results = {getPrecondition: 'passed', copyPrecondition: 'passed', unchangedCopy: 'passed'};
        journal.status = 'passed';
    } catch (error) {
        journal.status = 'failed';
        testError = error;
    } finally {
        for (let attempt = 0; attempt < 4; attempt++) {
            // Retry exact known keys only; never delete keys returned by a listing.
            await Promise.allSettled(keys.map(Key => send(new DeleteObjectCommand({Bucket: bucket, Key}), true)));
            try {
                for (const key of keys) await absent(key, true);
                await emptyPrefix(true);
                journal.cleanupVerified = true; cleanupError = null; break;
            } catch (error) {
                cleanupError = error;
                if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            }
        }
        if (cleanupError) journal.status = 'cleanup-failed';
        journal.finishedAt = new Date().toISOString(); saveJournal();
        log(JSON.stringify({phase: 'finished', ...journal}));
    }
    if (cleanupError) throw new Error(`Cleanup not verified; inspect only ${prefix}.`, {cause: cleanupError});
    if (testError) throw testError;
    return journal;
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const s3 = new S3Client({region: 'auto', endpoint: options.endpoint, maxAttempts: 3});
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('Test interrupted; cleaning up.'));
    process.on('SIGINT', abort); process.on('SIGTERM', abort);
    try { await runObjectConditionTest({...options, s3, signal: controller.signal}); }
    finally { s3.destroy(); process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {parseOptions, runObjectConditionTest};

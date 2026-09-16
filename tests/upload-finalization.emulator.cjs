/* Actual callable handlers + Firestore emulator. R2 is opt-in and journaled. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, generateKeyPairSync, createHash} = require('node:crypto');
const {Readable} = require('node:stream');
const {createRequire} = require('node:module');
const fRequire = createRequire(path.resolve(__dirname, '../functions/package.json'));
const projectId = 'demo-planetcreations-rules';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== projectId) {
    throw Error('This test requires the local Firestore emulator and demo-planetcreations-rules.');
}
const realR2 = process.argv.includes('--real-r2');
if (realR2 && (!process.env.R2_BUCKET_NAME || !process.argv.includes(`--confirm-production-bucket=${process.env.R2_BUCKET_NAME}`))) {
    throw Error('Real R2 requires explicit bucket confirmation.');
}
const journalPath = process.argv.find(a => a.startsWith('--journal='))?.slice(10);
if (realR2 && (!journalPath || fs.existsSync(journalPath))) throw Error('A fresh journal path is mandatory.');
const runId = randomUUID();
const journal = {runId, realR2, productionFirestoreWrites: 0, keys: [], cases: [], cleanupVerified: false};
const saveJournal = () => { if (journalPath) fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2)); };
saveJournal();
process.env.R2_BUCKET_NAME ||= 'local-finalization-test';
process.env.R2_ACCOUNT_ID ||= '00000000000000000000000000000000';
process.env.R2_ACCESS_KEY_ID ||= 'local'; process.env.R2_SECRET_ACCESS_KEY ||= 'local';
process.env.BACKUP_SIGNING_KEY = generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}}).privateKey;
const s3 = fRequire('@aws-sdk/client-s3');
const originalSend = s3.S3Client.prototype.send;
const memory = new Map(); const allowed = new Set(); const owned = new Set();
let activeFault = null;
const clients = new Set();
const absent = () => Object.assign(Error('Not found'), {name: 'NotFound', $metadata: {httpStatusCode: 404}});
async function rawSend(client, command) {
    clients.add(client);
    if (realR2) return originalSend.call(client, command);
    const {Key, Body, CopySource, IfMatch, CopySourceIfMatch, Prefix} = command.input;
    const type = command.constructor.name;
    if (type === 'ListObjectsV2Command') return {IsTruncated: false, Contents: [...memory.keys()].filter(k => k.startsWith(Prefix)).map(Key => ({Key}))};
    if (type === 'DeleteObjectCommand') { memory.delete(Key); return {}; }
    if (type === 'PutObjectCommand') {
        const bytes = Buffer.from(Body); memory.set(Key, {bytes, ETag: `"${createHash('md5').update(bytes).digest('hex')}"`}); return {};
    }
    const source = type === 'CopyObjectCommand' ? decodeURIComponent(CopySource).replace(/^\/+/, '').slice(process.env.R2_BUCKET_NAME.length + 1) : Key;
    const object = memory.get(source); if (!object) throw absent();
    if ((IfMatch || CopySourceIfMatch) && (IfMatch || CopySourceIfMatch) !== object.ETag) throw Object.assign(Error('Changed'), {$metadata: {httpStatusCode: 412}});
    if (type === 'HeadObjectCommand') return {ContentLength: object.bytes.length, ContentType: 'application/zip', ETag: object.ETag};
    if (type === 'GetObjectCommand') return {Body: Readable.from(object.bytes), ETag: object.ETag};
    if (type === 'CopyObjectCommand') { memory.set(Key, {...object}); return {}; }
    throw Error(`Unsupported test operation ${type}`);
}
s3.S3Client.prototype.send = async function(command) {
    const {Bucket, Key, CopySource} = command.input; const name = command.constructor.name;
    assert.equal(Bucket, process.env.R2_BUCKET_NAME);
    if (name === 'CopyObjectCommand' && activeFault?.publishSource && decodeURIComponent(CopySource).replace(/^\/+/, '').slice(Bucket.length + 1) === activeFault.publishSource) {
        assert(Key.startsWith(`creation-backups/release-${runId}/`));
        assert(!activeFault.destination || activeFault.destination === Key);
        activeFault.destination = Key; allowed.add(Key);
    }
    assert(allowed.has(Key), `Refusing unregistered key: ${Key}`);
    if (CopySource) assert(allowed.has(decodeURIComponent(CopySource).replace(/^\/+/, '').slice(Bucket.length + 1)));
    if (name === 'PutObjectCommand' || name === 'CopyObjectCommand') {
        if (!owned.has(Key)) {
            await assert.rejects(rawSend(this, new s3.HeadObjectCommand({Bucket, Key})), e => e.$metadata?.httpStatusCode === 404);
            await rawSend(this, new s3.DeleteObjectCommand({Bucket, Key}));
            owned.add(Key); journal.keys.push(Key); saveJournal();
        }
    }
    if (name === 'CopyObjectCommand' && activeFault?.mode === 'before-copy') {
        activeFault.used = true; throw Error('Injected before COPY');
    }
    const response = await rawSend(this, command);
    if (name === 'CopyObjectCommand' && activeFault?.mode === 'after-copy') {
        activeFault.used = true; throw Error('Injected lost COPY response');
    }
    return response;
};
const functions = require('../functions/index');
const {getFirestore, Timestamp} = fRequire('firebase-admin/firestore');
const db = getFirestore();
const originalTransaction = db.runTransaction.bind(db);
db.runTransaction = async function(callback, options) {
    let completion = false;
    const result = await originalTransaction(async tx => {
        const proxy = new Proxy(tx, {get(target, key) {
            if (key === 'update') return (ref, data, ...rest) => {
                if (['backupUploadSessions', 'collaborationPublishAttempts'].includes(ref.parent.id) && data.status === 'completed') completion = true;
                return target.update(ref, data, ...rest);
            };
            const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        }});
        const value = await callback(proxy);
        if (completion && activeFault?.mode === 'before-commit') { activeFault.used = true; throw Error('Injected before commit'); }
        return value;
    }, options);
    if (completion && activeFault?.mode === 'after-commit') { activeFault.used = true; throw Error('Injected lost commit response'); }
    return result;
};
const client = new s3.S3Client({region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}${process.env.R2_JURISDICTION ? `.${process.env.R2_JURISDICTION}` : ''}.r2.cloudflarestorage.com`, credentials: {accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY}});
const Bucket = process.env.R2_BUCKET_NAME;
const AdmZip = require('adm-zip');
const {buildSignedMetadata, sha256} = require('../functions/backupFormat');
function packageBytes(uid) {
    const wrap = bytes => { const head = Buffer.alloc(16); head.writeUInt32BE(0xff00fe01, 0); head.writeUInt32BE(0x12345678, 4); head.writeUInt32BE(1, 8); head.writeUInt32BE(bytes.length, 12); return Buffer.concat([head, bytes]); };
    const game = new AdmZip();
    game.addFile('metadata', wrap(Buffer.from(JSON.stringify({sName: 'Release check', tTags: [], tSave: {sParkName: 'Release check', nGuestCount: 0}}))));
    game.addFile('parkdata', wrap(Buffer.from('Synthetic release fixture')));
    const payload = game.toBuffer(); const mediaSetId = randomUUID();
    const manifest = Buffer.from(JSON.stringify({format: 'PlanetCreationsMediaManifest', formatVersion: 2, mediaSetId, assets: []}));
    const metadata = buildSignedMetadata({format: 'PlanetCreationsBackup', formatVersion: 2, packageType: 'creation', packageId: randomUUID(), mediaSetId, gameId: 'planet-coaster-2', fileKind: 'park', originalFileName: 'release.park2', payloadPath: 'payload/release.park2', payloadSize: payload.length, payloadSha256: sha256(payload), mediaManifestSha256: sha256(manifest), note: 'Synthetic fixture', createdAt: new Date().toISOString(), isSigned: false}, uid, 'Release check', process.env.BACKUP_SIGNING_KEY, 'ephemeral-test');
    const zip = new AdmZip(); zip.addFile('payload/release.park2', payload); zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata))); zip.addFile('media_manifest.json', manifest); return zip.toBuffer();
}
async function runCase(kind, mode) {
    const id = `release-${runId}-${kind}-${mode}`;
    const uid = `release-${runId}`; const objectKey = `temp-uploads/${uid}/${id}.PlanetCreations`;
    const destination = kind === 'creation' ? `creation-backups/${uid}/${id}/${id}.PlanetCreations` : `collaboration-files/${id}/save/${id}.PlanetCreations`;
    allowed.add(objectKey); allowed.add(destination);
    const bytes = packageBytes(uid);
    await client.send(new s3.PutObjectCommand({Bucket, Key: objectKey, Body: bytes, ContentType: 'application/zip', IfNoneMatch: '*'}));
    const session = db.doc(`backupUploadSessions/${id}`);
    await session.set({uid, objectKey, expectedSize: bytes.length, status: 'pending', expiresAt: Timestamp.fromMillis(Date.now() + 600000), uploadConsent: {ownershipConfirmed: true, hostingAccepted: true, confirmedBy: uid}});
    let handler; let data;
    const previousKey = `creation-backups/${uid}/${id}/previous.PlanetCreations`;
    if (kind === 'creation') {
        allowed.add(previousKey);
        await client.send(new s3.PutObjectCommand({Bucket, Key: previousKey, Body: bytes, ContentType: 'application/zip', IfNoneMatch: '*'}));
        await db.doc(`creations/${id}`).set({userId: uid, game: 'planet-coaster-2', backupObjectKey: previousKey});
        handler = functions.finalizeBackupUpload; data = {uploadId: id, creationId: id};
    } else if (kind === 'initial') {
        handler = functions.createCollaboration; data = {initialUploadId: id, title: 'Release check', game: 'planet-coaster-2', visibility: 'private'};
    } else {
        await db.doc(`collaborations/${id}`).set({status: 'active', game: 'planet-coaster-2', memberIds: [uid]});
        await db.doc(`collaborations/${id}/members/${uid}`).set({username: 'Release check'});
        await db.doc(`collaborations/${id}/uploads/${id}`).set({userId: uid, kind: 'changelog', status: 'pending-save', hasSave: false, createdAt: Timestamp.now()});
        handler = functions.finalizeCollaborationVersion; data = {uploadId: id, collaborationId: id, changelogEntryId: id};
    }
    activeFault = {mode, used: false};
    const request = {data, auth: {uid, token: {}}};
    const successful = mode === 'none' || mode === 'after-commit';
    if (successful) await handler.run(request);
    else await assert.rejects(handler.run(request));
    if (mode !== 'none') assert(activeFault.used, `Fault did not execute: ${kind}/${mode}`);
    activeFault = null;
    assert.equal((await session.get()).data().status, successful ? 'completed' : 'rejected');
    if (kind === 'creation') {
        if (successful) await assert.rejects(client.send(new s3.HeadObjectCommand({Bucket, Key: previousKey})), e => e.$metadata?.httpStatusCode === 404, 'Previous backup was orphaned');
        else {
            await client.send(new s3.HeadObjectCommand({Bucket, Key: previousKey}));
            assert.equal((await db.doc(`creations/${id}`).get()).data().backupObjectKey, previousKey);
        }
    }
    await assert.rejects(client.send(new s3.HeadObjectCommand({Bucket, Key: objectKey})), e => e.$metadata?.httpStatusCode === 404, 'Temporary upload was orphaned');
    if (successful) {
        const object = await client.send(new s3.GetObjectCommand({Bucket, Key: destination})); const chunks = []; for await (const chunk of object.Body) chunks.push(chunk);
        assert.deepEqual(Buffer.concat(chunks), bytes);
        await handler.run(request);
        await functions.abortBackupUpload.run({data: {uploadId: id}, auth: request.auth});
        await client.send(new s3.HeadObjectCommand({Bucket, Key: destination}));
        if (kind === 'creation') assert.equal((await db.doc(`creations/${id}`).get()).data().backupObjectKey, destination);
        else assert.equal((await db.doc(`collaborations/${id}/files/save/versions/${id}`).get()).data().storageKey, destination);
    } else {
        await assert.rejects(client.send(new s3.HeadObjectCommand({Bucket, Key: destination})), e => e.$metadata?.httpStatusCode === 404, 'Failed upload destination was orphaned');
    }
}
async function main() {
    try {
        for (const kind of ['creation', 'initial', 'version']) for (const mode of ['none', 'before-copy', 'after-copy', 'before-commit', 'after-commit']) {
            const row = {kind, mode};
            try { await runCase(kind, mode); row.passed = true; }
            catch (error) { row.passed = false; row.error = error.message; }
            finally { activeFault = null; journal.cases.push(row); saveJournal(); console.log(JSON.stringify(row)); }
        }
        for (const mode of ['none', 'before-copy', 'after-copy', 'before-commit', 'after-commit']) {
            const row = {kind: 'publish', mode};
            try { await runPublishCase(mode); row.passed = true; }
            catch (error) { row.passed = false; row.error = error.message; }
            finally { activeFault = null; journal.cases.push(row); saveJournal(); console.log(JSON.stringify(row)); }
        }
    } finally {
        activeFault = null;
        for (const Key of owned) {
            let failure;
            for (let attempt = 0; attempt < 4; attempt++) {
                try { await rawSend(client, new s3.DeleteObjectCommand({Bucket, Key})); await assert.rejects(rawSend(client, new s3.HeadObjectCommand({Bucket, Key})), e => e.$metadata?.httpStatusCode === 404); failure = null; break; }
                catch (error) { failure = error; }
            }
            if (failure) { journal.cleanupError = failure.message; saveJournal(); throw failure; }
        }
        const prefixes = new Set([...allowed].map(k => k.startsWith('collaboration-files/') ? k.split('/').slice(0, 2).join('/') + '/' : k.split('/').slice(0, 2).join('/') + '/'));
        for (const Prefix of prefixes) {
            const list = await rawSend(client, new s3.ListObjectsV2Command({Bucket, Prefix}));
            assert.equal(list.IsTruncated, false); assert.equal((list.Contents || []).length, 0);
        }
        journal.cleanupVerified = true; saveJournal(); console.log(JSON.stringify({cleanupVerified: true, keys: owned.size, realR2}));
        s3.S3Client.prototype.send = originalSend;
        for (const item of clients) item.destroy(); await db.terminate();
    }
    assert(journal.cases.length === 20 && journal.cases.every(row => row.passed), 'Finalization integration failed');
}
async function runPublishCase(mode) {
    const id = `release-${runId}-publish-${mode}`, uid = `release-${runId}`;
    const source = `collaboration-files/${id}/save/${id}.PlanetCreations`;
    allowed.add(source); const bytes = packageBytes(uid);
    await client.send(new s3.PutObjectCommand({Bucket, Key: source, Body: bytes, ContentType: 'application/zip', IfNoneMatch: '*'}));
    const collaboration = db.doc(`collaborations/${id}`);
    await collaboration.set({ownerId: uid, title: 'Release check', game: 'planet-coaster-2', status: 'completed', publish: {state: 'ready'}, memberIds: [uid], currentVersion: {versionId: id}});
    await db.doc(`collaborations/${id}/members/${uid}`).set({username: 'Release check', publishConsent: {agreed: true}});
    await db.doc(`collaborations/${id}/files/save/versions/${id}`).set({storageKey: source, fileKind: 'park', originalFileName: 'release.park2', uploadedBy: uid});
    activeFault = {mode, used: false, publishSource: source};
    const request = {data: {collaborationId: id}, auth: {uid, token: {}}};
    const successful = mode === 'none' || mode === 'after-commit';
    let result;
    if (successful) result = await functions.publishCollaboration.run(request);
    else await assert.rejects(functions.publishCollaboration.run(request));
    if (mode !== 'none') assert(activeFault.used, 'Publication fault did not execute');
    const destination = activeFault.destination; assert(destination); activeFault = null;
    await client.send(new s3.HeadObjectCommand({Bucket, Key: source}));
    if (successful) {
        assert.equal((await collaboration.get()).data().publish.publishedCreationId, result.creationId);
        assert.equal((await db.doc(`creations/${result.creationId}`).get()).data().backupObjectKey, destination);
        const object = await client.send(new s3.GetObjectCommand({Bucket, Key: destination})); const chunks = []; for await (const chunk of object.Body) chunks.push(chunk);
        assert.deepEqual(Buffer.concat(chunks), bytes);
        assert.equal((await functions.publishCollaboration.run(request)).creationId, result.creationId);
    } else {
        assert.equal((await collaboration.get()).data().publish.state, 'ready');
        await assert.rejects(client.send(new s3.HeadObjectCommand({Bucket, Key: destination})), e => e.$metadata?.httpStatusCode === 404);
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const test = require('node:test');
const AdmZip = require('adm-zip');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-media-test-'));
const fakePaths = {
    userData: path.join(testRoot, 'user-data'),
    documents: path.join(testRoot, 'documents'),
};
const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
        return { app: { getPath: name => fakePaths[name] || testRoot } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const MediaManager = require('./MediaManager');
Module._load = originalLoad;

function wrapFrontierPayload(payload, kind = 1) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const header = Buffer.alloc(16);
    header.writeUInt32BE(0xff00fe01, 0);
    header.writeUInt32BE(0x12345678, 4);
    header.writeUInt32BE(kind, 8);
    header.writeUInt32BE(body.length, 12);
    return Buffer.concat([header, body]);
}

test.after(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
});

test('same-name different media stops first, then parks and restores the previous file', () => {
    const gameDirectory = path.join(fakePaths.documents, 'Frontier Developments', 'Planet Zoo');
    const savePath = path.join(gameDirectory, 'Saves', 'test.zoo');
    const liveAudioPath = path.join(gameDirectory, 'UserAudio', 'theme.mp3');
    const selectedAudioPath = path.join(testRoot, 'selected', 'theme.mp3');
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.mkdirSync(path.dirname(liveAudioPath), { recursive: true });
    fs.mkdirSync(path.dirname(selectedAudioPath), { recursive: true });
    fs.writeFileSync(savePath, 'save');
    const oldAudio = Buffer.concat([Buffer.from('ID3'), Buffer.from('old-audio')]);
    const newAudio = Buffer.concat([Buffer.from('ID3'), Buffer.from('new-audio')]);
    fs.writeFileSync(liveAudioPath, oldAudio);
    fs.writeFileSync(selectedAudioPath, newAudio);

    assert.equal(MediaManager.createOrUpdateSnapshot(savePath, [selectedAudioPath]), true);
    const stopped = MediaManager.installMedia(savePath);
    assert.equal(stopped.success, false);
    assert.equal(stopped.status, 'conflict');
    assert.deepEqual(fs.readFileSync(liveAudioPath), oldAudio);

    const activated = MediaManager.installMedia(savePath, { parkConflicts: true });
    assert.equal(activated.success, true);
    assert.deepEqual(fs.readFileSync(liveAudioPath), newAudio);
    assert.equal(MediaManager.getMediaSetStatus(savePath), 'installed');

    const uninstalled = MediaManager.uninstallMedia(savePath);
    assert.equal(uninstalled.success, true);
    assert.deepEqual(fs.readFileSync(liveAudioPath), oldAudio);
    assert.equal(MediaManager.getMediaSetStatus(savePath), 'uninstalled');
});

test('automatically discovers referenced media and records missing files', () => {
    const gameDirectory = path.join(fakePaths.documents, 'Frontier Developments', 'Planet Coaster 2');
    const savePath = path.join(gameDirectory, '12345678901234567', 'Saves', 'automatic.park2');
    const imagePath = path.join(gameDirectory, 'UserMedia', 'screen.png');
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    const zip = new AdmZip();
    zip.addFile('metadata', wrapFrontierPayload(JSON.stringify({
        sName: 'Automatic Park',
        tSave: { sParkName: 'Automatic Park' },
    })));
    zip.addFile('parkdata', wrapFrontierPayload(Buffer.from('CobraSav\0screen.png\0missing.mp3\0'), 6));
    zip.writeZip(savePath);

    const synchronized = MediaManager.syncAutomaticMediaSnapshot(savePath);
    assert.equal(synchronized.success, true);
    assert.equal(synchronized.status, 'synchronized');
    assert.equal(synchronized.assetCount, 1);
    assert.equal(synchronized.referenceCount, 2);
    assert.deepEqual(synchronized.missing, ['missing.mp3']);

    const snapshot = MediaManager.getSnapshot(savePath);
    assert.equal(snapshot.associationMode, 'automatic');
    assert.equal(snapshot.assets[0].logicalName, 'screen.png');
    assert.equal(MediaManager.syncAutomaticMediaSnapshot(savePath).status, 'unchanged');
});

test('automatically associates Planet Zoo media from the sequential scan result', () => {
    const gameDirectory = path.join(fakePaths.documents, 'Frontier Developments', 'Planet Zoo');
    const savePath = path.join(gameDirectory, '12345678901234567', 'Saves', 'automatic.zoo');
    const audioPath = path.join(gameDirectory, 'UserAudio', 'habitat.ogg');
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });
    fs.writeFileSync(savePath, 'zoo-save-placeholder');
    fs.writeFileSync(audioPath, Buffer.concat([Buffer.from('OggS'), Buffer.from('zoo-audio')]));
    const stats = fs.statSync(savePath);

    const synchronized = MediaManager.syncAutomaticMediaSnapshot(savePath, {
        metadata: { gameId: 'planet-zoo' },
        mediaReferences: ['habitat.ogg', 'missing.png'],
        source: { size: stats.size, modifiedAtMs: stats.mtimeMs },
    });

    assert.equal(synchronized.success, true);
    assert.equal(synchronized.assetCount, 1);
    assert.equal(synchronized.referenceCount, 2);
    assert.deepEqual(synchronized.missing, ['missing.png']);
    const snapshot = MediaManager.getSnapshot(savePath);
    assert.equal(snapshot.gameId, 'planet-zoo');
    assert.equal(snapshot.associationMode, 'automatic');
    assert.deepEqual(snapshot.files, ['habitat.ogg']);

    const missingPath = path.join(gameDirectory, 'UserMedia', 'missing.png');
    fs.mkdirSync(path.dirname(missingPath), { recursive: true });
    fs.writeFileSync(missingPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const completed = MediaManager.syncAutomaticMediaSnapshot(savePath);
    assert.equal(completed.status, 'synchronized');
    assert.equal(completed.assetCount, 2);
    assert.deepEqual(completed.missing, []);
});

test('supplements a manual media package without replacing manual same-name assets', () => {
    const gameDirectory = path.join(fakePaths.documents, 'Frontier Developments', 'Planet Zoo');
    const savePath = path.join(gameDirectory, '12345678901234567', 'Saves', 'manual.zoo');
    const manualPath = path.join(testRoot, 'manual', 'habitat.ogg');
    const liveImagePath = path.join(gameDirectory, 'UserMedia', 'education.png');
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.mkdirSync(path.dirname(manualPath), { recursive: true });
    fs.mkdirSync(path.dirname(liveImagePath), { recursive: true });
    fs.writeFileSync(savePath, 'manual-zoo-save');
    fs.writeFileSync(manualPath, Buffer.concat([Buffer.from('OggS'), Buffer.from('manual-version')]));
    fs.writeFileSync(liveImagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(MediaManager.createOrUpdateSnapshot(savePath, [manualPath]), true);
    const manualHash = MediaManager.getSnapshot(savePath).assets[0].sha256;
    const stats = fs.statSync(savePath);

    const synchronized = MediaManager.syncAutomaticMediaSnapshot(savePath, {
        metadata: { gameId: 'planet-zoo' },
        mediaReferences: ['habitat.ogg', 'education.png'],
        source: { size: stats.size, modifiedAtMs: stats.mtimeMs },
    });

    assert.equal(synchronized.status, 'supplemented');
    const snapshot = MediaManager.getSnapshot(savePath);
    assert.equal(snapshot.associationMode, 'manual');
    assert.deepEqual(snapshot.files.sort(), ['education.png', 'habitat.ogg']);
    assert.equal(snapshot.assets.find(asset => asset.logicalName === 'habitat.ogg').sha256, manualHash);
    assert.deepEqual(snapshot.discovery.references, ['habitat.ogg', 'education.png']);
    assert.deepEqual(snapshot.discovery.missing, []);
});

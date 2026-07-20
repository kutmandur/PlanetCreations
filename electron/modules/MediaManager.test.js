const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const test = require('node:test');

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

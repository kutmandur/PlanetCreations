const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

function wrapFrontierPayload(payload, kind = 1) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const header = Buffer.alloc(16);
    header.writeUInt32BE(0xff00fe01, 0);
    header.writeUInt32BE(0x12345678, 4);
    header.writeUInt32BE(kind, 8);
    header.writeUInt32BE(body.length, 12);
    return Buffer.concat([header, body]);
}

const electronTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-backup-test-'));
const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
        return { app: { getPath: () => electronTestRoot } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const BackupManager = require('./BackupManager');
const { __test } = BackupManager;
Module._load = originalLoad;

test.after(() => fs.rmSync(electronTestRoot, { recursive: true, force: true }));

test('direct install resolves the most recently used Frontier save profile', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-install-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const olderSaves = path.join(root, 'Planet Coaster 2', '11111111111111111', 'Saves');
    const newerSaves = path.join(root, 'Planet Coaster 2', '22222222222222222', 'Saves');
    fs.mkdirSync(olderSaves, { recursive: true });
    fs.mkdirSync(newerSaves, { recursive: true });
    const olderFile = path.join(olderSaves, 'Older.park2');
    const newerFile = path.join(newerSaves, 'Newer.park2');
    fs.writeFileSync(olderFile, 'old');
    fs.writeFileSync(newerFile, 'new');
    fs.utimesSync(olderFile, new Date(1_000), new Date(1_000));
    fs.utimesSync(newerFile, new Date(2_000), new Date(2_000));

    assert.equal(__test.resolveGameSavesDirectory(root, 'planet-coaster-2'), newerSaves);
});

test('direct install creates a non-destructive collision-safe filename', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-collision-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'My Park.park2'), 'existing');
    fs.writeFileSync(path.join(root, 'My Park (PlanetCreations).park2'), 'existing');

    assert.equal(
        __test.createCollisionSafeTarget(root, 'My Park.park2'),
        path.join(root, 'My Park (PlanetCreations 2).park2'),
    );
});

test('upload and Direct Install both fail closed for an unsigned package', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-unsigned-install-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const fakePaths = {
        documents: path.join(root, 'documents'),
        temp: path.join(root, 'temp'),
        userData: path.join(root, 'user-data'),
    };
    const fakeApp = { getPath: name => fakePaths[name] || root };
    Object.values(fakePaths).forEach(directory => fs.mkdirSync(directory, { recursive: true }));
    const sourcePath = path.join(root, 'Planet Coaster 2', 'Unsigned Park.park2');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    const sourceArchive = new AdmZip();
    sourceArchive.addFile('metadata', wrapFrontierPayload('{}'));
    sourceArchive.writeZip(sourcePath);

    const packagePath = await BackupManager.createBackup(
        fakeApp,
        sourcePath,
        'unsigned regression package',
        false,
        null,
    );
    assert.ok(packagePath);

    const uploadValidation = await BackupManager.validateBackupForUpload(packagePath);
    assert.equal(uploadValidation.valid, false);
    assert.match(uploadValidation.error, /verified version-2 creation packages/i);

    const installResult = await BackupManager.installCreationPackage(
        fakeApp,
        packagePath,
        'unsigned-regression',
        path.join(root, 'Frontier Developments'),
    );
    assert.equal(installResult.success, false);
    assert.match(installResult.message, /signed and verified creation packages/i);
});

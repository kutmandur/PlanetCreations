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

test('restore preserves the original on full-disk and rename failures, and retains pre-restore bytes on success', async () => {
    const root = fs.mkdtempSync(path.join(electronTestRoot, 'restore-'));
    const target = path.join(root, 'park.park2');
    const archivePath = path.join(root, 'legacy.PlanetCreations');
    const zip = new AdmZip(); zip.addFile('metadata.json', Buffer.from(JSON.stringify({originalFileName: 'park.park2'})));
    zip.addFile('park.park2', Buffer.from('restored bytes')); zip.writeZip(archivePath);
    const app = {getPath: () => root}; const open = fs.promises.open; const rename = fs.promises.rename;
    try {
        fs.writeFileSync(target, 'original bytes');
        fs.promises.open = async (...args) => {
            const handle = await open(...args);
            if (String(args[0]).startsWith(`${target}.`) && String(args[0]).endsWith('.tmp')) handle.writeFile = async () => { throw Object.assign(Error('Injected disk full'), {code: 'ENOSPC'}); };
            return handle;
        };
        const full = await BackupManager.restoreBackup(app, archivePath, target);
        assert.equal(full.success, false); assert.match(full.message, /disk full/);
        assert.equal(fs.readFileSync(target, 'utf8'), 'original bytes');
        assert.equal(fs.readdirSync(root).filter(f => f.endsWith('.tmp')).length, 0);
        fs.promises.open = open;
        fs.promises.rename = async (source, destination) => {
            if (destination === target) throw Object.assign(Error('Injected locked target'), {code: 'EPERM'});
            return rename(source, destination);
        };
        const locked = await BackupManager.restoreBackup(app, archivePath, target);
        assert.equal(locked.success, false); assert.match(locked.message, /locked target/);
        assert.equal(fs.readFileSync(target, 'utf8'), 'original bytes');
        assert.equal(fs.readdirSync(root).filter(f => f.endsWith('.tmp')).length, 0);
        fs.promises.rename = rename;
        const restored = await BackupManager.restoreBackup(app, archivePath, target);
        assert.equal(restored.success, true); assert.equal(restored.status, 'unsigned');
        assert.equal(fs.readFileSync(target, 'utf8'), 'restored bytes');
        for (const name of fs.readdirSync(path.join(root, 'Pre-Restore Backups'))) assert.equal(fs.readFileSync(path.join(root, 'Pre-Restore Backups', name), 'utf8'), 'original bytes');
    } finally { fs.promises.open = open; fs.promises.rename = rename; }
});

test('signed Direct Install validates the signature, reuses its registered target and rejects a moved save junction', async () => {
    const crypto = require('node:crypto');
    const {buildSignedMetadata, sha256} = require('../../functions/backupFormat');
    const root = fs.mkdtempSync(path.join(electronTestRoot, 'signed-'));
    const library = path.join(root, 'Frontier'), saves = path.join(library, 'Planet Coaster 2', '12345678901234567', 'Saves');
    fs.mkdirSync(saves, {recursive: true});
    const keys = crypto.generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
    const mediaSetId = crypto.randomUUID(), payload = Buffer.from('signed game fixture');
    const manifest = Buffer.from(JSON.stringify({format: 'PlanetCreationsMediaManifest', formatVersion: 2, mediaSetId, assets: []}));
    const metadata = buildSignedMetadata({format: 'PlanetCreationsBackup', formatVersion: 2, packageType: 'creation', packageId: crypto.randomUUID(), mediaSetId, gameId: 'planet-coaster-2', fileKind: 'park', originalFileName: 'signed.park2', payloadPath: 'payload/signed.park2', payloadSize: payload.length, payloadSha256: sha256(payload), mediaManifestSha256: sha256(manifest), note: '', createdAt: new Date().toISOString()}, 'test', 'Test', keys.privateKey, 'test-key');
    const zip = new AdmZip(); zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata))); zip.addFile('media_manifest.json', manifest); zip.addFile(metadata.payloadPath, payload);
    const archive = path.join(root, 'signed.PlanetCreations'); zip.writeZip(archive);
    const fetch = global.fetch; global.fetch = async () => ({ok: true, text: async () => keys.publicKey});
    const app = {getPath: () => root};
    try {
        const installed = await BackupManager.installCreationPackage(app, archive, 'signed-test', library);
        assert.equal(installed.success, true, installed.message);
        assert.deepEqual(fs.readFileSync(installed.targetPath), payload);
        const repeated = await BackupManager.installCreationPackage(app, archive, 'signed-test', library);
        assert.equal(repeated.targetPath, installed.targetPath);
        const outside = path.join(root, 'outside'); fs.renameSync(saves, outside); fs.symlinkSync(outside, saves, 'junction');
        try {
            const rejected = await BackupManager.installCreationPackage(app, archive, 'signed-test', library);
            assert.equal(rejected.success, false); assert.match(rejected.message, /resolves outside/);
            assert.deepEqual(fs.readFileSync(path.join(outside, 'signed.park2')), payload);
        } finally { fs.unlinkSync(saves); }
        metadata.note = 'tampered'; zip.updateFile('metadata.json', Buffer.from(JSON.stringify(metadata))); zip.writeZip(archive);
        assert.equal((await BackupManager.verifyBackup(archive)).status, 'invalid');
    } finally { global.fetch = fetch; }
});

test('a killed restore process leaves the original and pre-restore copy intact', async () => {
    const {fork} = require('node:child_process');
    const root = fs.mkdtempSync(path.join(electronTestRoot, 'crash-'));
    const target = path.join(root, 'park.park2'), archive = path.join(root, 'crash.PlanetCreations');
    fs.writeFileSync(target, 'original before crash');
    const zip = new AdmZip(); zip.addFile('metadata.json', Buffer.from(JSON.stringify({originalFileName: 'park.park2'}))); zip.addFile('park.park2', Buffer.from('replacement')); zip.writeZip(archive);
    const child = fork(path.resolve(__dirname, '../../tests/helpers/restore-crash.cjs'), [root, archive, target], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    const exited = new Promise(resolve => child.once('exit', resolve));
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Restore did not reach rename')), 10000);
            child.once('message', message => { clearTimeout(timer); message === 'before-rename' ? resolve() : reject(Error('Unexpected restore result')); });
            child.once('error', error => {clearTimeout(timer); reject(error);});
        });
        child.kill(); await exited;
        assert.equal(fs.readFileSync(target, 'utf8'), 'original before crash');
        const previous = fs.readdirSync(path.join(root, 'Pre-Restore Backups'));
        assert.equal(previous.length, 1);
        assert.equal(fs.readFileSync(path.join(root, 'Pre-Restore Backups', previous[0]), 'utf8'), 'original before crash');
    } finally { if (child.exitCode === null && child.signalCode === null) {child.kill(); await exited;} }
});

const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const test = require('node:test');
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

test('creation backup automatically links media and can create the matching separate package', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-backup-media-test-'));
    const fakePaths = {
        userData: path.join(root, 'user-data'),
        documents: path.join(root, 'documents'),
        temp: path.join(root, 'temp'),
    };
    const fakeApp = { getPath: name => fakePaths[name] || root };
    const originalLoad = Module._load;
    Module._load = function mockElectron(request, parent, isMain) {
        if (request === 'electron') return { app: fakeApp };
        return originalLoad.call(this, request, parent, isMain);
    };
    const BackupManager = require('./BackupManager');
    Module._load = originalLoad;

    const gameDirectory = path.join(fakePaths.documents, 'Frontier Developments', 'Planet Coaster 2');
    const savePath = path.join(gameDirectory, '12345678901234567', 'Saves', 'Media Park.park2');
    const imagePath = path.join(gameDirectory, 'UserMedia', 'screen.png');
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    const saveZip = new AdmZip();
    saveZip.addFile('metadata', wrapFrontierPayload(JSON.stringify({ sName: 'Media Park', tSave: { sParkName: 'Media Park' } })));
    saveZip.addFile('parkdata', wrapFrontierPayload(Buffer.from('CobraSav\0screen.png\0'), 6));
    saveZip.writeZip(savePath);

    try {
        const result = await BackupManager.backupAllCreations(
            fakeApp,
            [{ path: savePath }],
            'automatic media test',
            false,
            null,
            null,
            true,
        );
        assert.equal(result.success, true);
        assert.match(result.message, /1 matching Custom Media package/);

        const creationPackages = fs.readdirSync(path.join(fakePaths.documents, 'PlanetCreations', 'Parks'));
        const mediaPackages = fs.readdirSync(path.join(fakePaths.documents, 'PlanetCreations', 'Custom Media'));
        assert.equal(creationPackages.length, 1);
        assert.equal(mediaPackages.length, 1);

        const creationArchive = new AdmZip(path.join(fakePaths.documents, 'PlanetCreations', 'Parks', creationPackages[0]));
        const manifest = JSON.parse(creationArchive.getEntry('media_manifest.json').getData().toString('utf8'));
        assert.equal(manifest.assets.length, 1);
        assert.equal(manifest.assets[0].logicalName, 'screen.png');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const electronTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-backup-test-'));
const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
        return { app: { getPath: () => electronTestRoot } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { __test } = require('./BackupManager');
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

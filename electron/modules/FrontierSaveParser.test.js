const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const AdmZip = require('adm-zip');
const {
    extractCustomMediaReferences,
    inspectFrontierFile,
    normalizeFrontierMetadata,
    readFrontierPreview,
} = require('./FrontierSaveParser');

function wrap(payload, kind = 1) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const header = Buffer.alloc(16);
    header.writeUInt32BE(0xff00fe01, 0);
    header.writeUInt32BE(0x12345678, 4);
    header.writeUInt32BE(kind, 8);
    header.writeUInt32BE(body.length, 12);
    return Buffer.concat([header, body]);
}

test('normalizes useful park and blueprint metadata including fixed-point costs', () => {
    const normalized = normalizeFrontierMetadata({
        sName: 'Mine Train',
        sGameVersion: '1.0',
        nVersion: 23,
        nRequiredDLC: 4,
        bIsModded: false,
        tTags: ['Blueprint', 'Coasters'],
        tBlueprint: {
            nPlacementCost: 13815503,
            nRunningCost: 574267,
            nSceneryCount: 1221,
            nBuildingCount: 157,
            nTrackedRideCount: 1,
            nFlatRideCount: 0,
            sRideID: 'CC_GoldFever',
            tEFN: { excitement: 4.9, fear: 2.7, nausea: 0.3 },
        },
    }, 'Mine Train.blpr2');

    assert.equal(normalized.kind, 'blueprint');
    assert.equal(normalized.blueprint.placementCost, 13815.503);
    assert.equal(normalized.blueprint.runningCost, 574.267);
    assert.equal(normalized.blueprint.rideId, 'CC_GoldFever');
    assert.equal(normalized.blueprint.ratings.excitement, 4.9);
    assert.deepEqual(normalized.requiredDlcs, ['Vintage Funfair Ride Pack']);
    assert.deepEqual(normalized.requiredDlcBits, [2]);
    assert.deepEqual(normalized.unknownDlcBits, []);

    const autosave = normalizeFrontierMetadata({tSave: {sParkName: 'Autosave'}}, 'Autosave.prkauto2');
    assert.equal(autosave.kind, 'autosave');
});

test('normalizes Planet Zoo park metadata and Frontier content identifiers', () => {
    const normalized = normalizeFrontierMetadata({
        sName: 'Goodwin House',
        nRequiredDLC: 18,
        tDLCNames: ['Content1', 'Content4'],
        tSave: {
            sParkName: 'Goodwin House',
            sGameMode: 'Career',
            sGeome: 'Temperate',
            sGameDifficulty: 'Medium',
            nGuestCount: 847,
            nAnimalCount: 45,
            nParkRating: 0.91,
            nGuestHappiness: 0.82,
            nCash: 12500500,
            tStars: [true, true, false],
        },
    }, 'Goodwin House.zoo');

    assert.equal(normalized.gameId, 'planet-zoo');
    assert.equal(normalized.kind, 'park');
    assert.equal(normalized.park.animalCount, 45);
    assert.equal(normalized.park.parkRating, 0.91);
    assert.equal(normalized.park.cash, 12500.5);
    assert.equal(normalized.park.scenarioStarsEarned, 2);
    assert.equal(normalized.isModded, null);
    assert.equal(normalized.complexityLimitDisabled, null);
    assert.equal(normalized.park.containsCustomContent, null);
    assert.equal(normalized.park.isUserGeneratedPark, null);
    assert.equal(normalized.park.isDiorama, null);
    assert.deepEqual(normalized.requiredDlcs, ['Arctic Pack', 'Aquatic Pack']);
    assert.deepEqual(normalized.requiredDlcBits, [1, 4]);
    assert.deepEqual(normalized.unknownDlcBits, []);
    assert.equal(normalized.dlcMappingVersion, 2);
    assert.deepEqual(normalized.requiredDlcIdentifiers, ['Content1', 'Content4']);
});

test('extracts only safe supported custom-media base names', () => {
    const payload = Buffer.concat([
        Buffer.from('CobraSav\0screen.png\0ride.webm\0music.mp3\0türen.png\0/usr/docs/UserAudio/ride music.mp3\0'),
        Buffer.from('notes.txt\0../escape.png\0nested/path.jpg\0'),
    ]);
    assert.deepEqual(extractCustomMediaReferences(payload), ['music.mp3', 'ride music.mp3', 'ride.webm', 'screen.png', 'türen.png']);
});

test('limits custom-media scanning to the CobraSav declaration header', () => {
    const payload = Buffer.concat([
        Buffer.from('CobraSav\0screen.png\0music.ogg\0'),
        Buffer.from('<<ClientClient>>\xf3', 'latin1'),
        Buffer.alloc(2 * 1024 * 1024, 0x61),
        Buffer.from('not-a-declared-reference.mp3\0'),
    ]);

    assert.deepEqual(extractCustomMediaReferences(payload), ['music.ogg', 'screen.png']);
});

test('reads wrapped JSON and media references from a Frontier ZIP container', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontier-parser-test-'));
    const filePath = path.join(root, 'Test.blpr2');
    const zip = new AdmZip();
    zip.addFile('metadata', wrap(JSON.stringify({
        sName: 'Test Blueprint',
        tBlueprint: { nPlacementCost: 150500, nSceneryCount: 2 },
    })));
    zip.addFile('blueprint', wrap(Buffer.from('CobraSav\0sign.png\0audio.ogg\0'), 2));
    zip.addFile('metathumb', wrap(Buffer.from('ffd8ffe000104a464946', 'hex'), 3));
    zip.writeZip(filePath);

    try {
        const result = inspectFrontierFile(filePath, { includeMediaReferences: true });
        assert.equal(result.metadata.name, 'Test Blueprint');
        assert.equal(result.metadata.blueprint.placementCost, 150.5);
        assert.deepEqual(result.mediaReferences, ['audio.ogg', 'sign.png']);
        assert.match(readFrontierPreview(filePath), /^data:image\/jpeg;base64,/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

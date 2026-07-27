const test = require('node:test');
const assert = require('node:assert/strict');

const {
    findLatestCollaborationSave,
    STALE_SAVE_THRESHOLD_MS,
} = require('./CollaborationSaveFinder');

const NOW = Date.parse('2026-07-27T12:00:00.000Z');

const scanResult = (files) => ({
    'Planet Coaster 2': {
        parks: files,
        blueprints: [],
        autosaves: [],
    },
});

test('prefers the collaboration file name over a newer unrelated save', () => {
    const result = findLatestCollaborationSave(scanResult([
        {
            name: 'My Park.park2',
            path: 'C:\\Saves\\My Park.park2',
            size: 10,
            modifiedAt: new Date(NOW - 60_000),
        },
        {
            name: 'Other Park.park2',
            path: 'C:\\Saves\\Other Park.park2',
            size: 20,
            modifiedAt: new Date(NOW - 10_000),
        },
    ]), 'planet-coaster-2', 'My Park.park2', NOW);

    assert.equal(result.success, true);
    assert.equal(result.fileName, 'My Park.park2');
    assert.equal(result.nameMatchesExpected, true);
});

test('uses the newest save of the same type when the downloaded file was renamed', () => {
    const result = findLatestCollaborationSave(scanResult([
        {
            name: 'My Park (PlanetCreations).park2',
            path: 'C:\\Saves\\My Park (PlanetCreations).park2',
            modifiedAt: new Date(NOW - 30_000),
        },
        {
            name: 'Older.park2',
            path: 'C:\\Saves\\Older.park2',
            modifiedAt: new Date(NOW - 90_000),
        },
    ]), 'planet-coaster-2', 'My Park.park2', NOW);

    assert.equal(result.fileName, 'My Park (PlanetCreations).park2');
    assert.equal(result.nameMatchesExpected, false);
});

test('marks a save older than two minutes as stale', () => {
    const result = findLatestCollaborationSave(scanResult([{
        name: 'My Park.park2',
        path: 'C:\\Saves\\My Park.park2',
        modifiedAt: new Date(NOW - STALE_SAVE_THRESHOLD_MS - 1),
    }]), 'planet-coaster-2', 'My Park.park2', NOW);

    assert.equal(result.stale, true);
    assert.equal(result.ageMs, STALE_SAVE_THRESHOLD_MS + 1);
});

test('rejects a save type that belongs to another game', () => {
    const result = findLatestCollaborationSave(
        scanResult([]),
        'planet-coaster-2',
        'Zoo Save.zoo',
        NOW,
    );

    assert.equal(result.success, false);
    assert.match(result.message, /does not match/i);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    METADATA_CACHE_VERSION,
    isMetadataCacheEntryFresh,
    normalizeMetadataCache,
    writeMetadataCacheFile,
} = require('./FileHandler');

test('preserves per-file metadata across cache schema and client versions', () => {
    const entry = {
        size: 1234,
        modifiedAtMs: 4567.25,
        metadata: { name: 'Cached park', rideCount: 40 },
    };
    const normalized = normalizeMetadataCache({
        version: METADATA_CACHE_VERSION - 1,
        files: { 'C:\\Saves\\park.park2': entry },
    });

    assert.equal(normalized.version, METADATA_CACHE_VERSION);
    assert.equal(normalized.files['C:\\Saves\\park.park2'], entry);
});

test('reuses stats only while the individual source-file signature is unchanged', () => {
    const cached = { size: 1234, modifiedAtMs: 4567.25 };
    const current = { size: 1234, modifiedAtMs: 4567.25 };

    assert.equal(isMetadataCacheEntryFresh(cached, current), true);
    assert.equal(isMetadataCacheEntryFresh(cached, { ...current, size: 1235 }), false);
    assert.equal(isMetadataCacheEntryFresh(cached, { ...current, modifiedAtMs: 4568 }), false);
    assert.equal(isMetadataCacheEntryFresh(cached, current, true), false);
});

test('keeps legacy entries with an exact mtime and upgrades size on their next write', () => {
    assert.equal(isMetadataCacheEntryFresh(
        { modifiedAtMs: 4567.25 },
        { size: 1234, modifiedAtMs: 4567.25 },
    ), true);
});

test('atomically replaces an existing persistent cache file', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcn-metadata-cache-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const cachePath = path.join(directory, 'frontier-metadata-cache.json');

    writeMetadataCacheFile(cachePath, {
        version: 1,
        files: { first: { modifiedAtMs: 1, metadata: { rideCount: 2 } } },
    });
    writeMetadataCacheFile(cachePath, {
        version: 2,
        files: { second: { modifiedAtMs: 2, metadata: { rideCount: 40 } } },
    });

    const persisted = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.equal(persisted.version, METADATA_CACHE_VERSION);
    assert.deepEqual(Object.keys(persisted.files), ['second']);
    assert.equal(fs.existsSync(`${cachePath}.${process.pid}.tmp`), false);
});

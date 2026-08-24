const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRideAnalysisObject } = require('./RideAnalysisObject');

test('builds the same browser-readable ride-analysis envelope as the Workshop', () => {
    const source = {
        schemaVersion: 1,
        clientVersion: 9,
        fieldCount: 20,
        trackedRideCount: 1,
        pathCount: 1,
        totalSampleCount: 2,
        sourceBytes: 256,
        rides: [{ entityId: 42, rideIndex: 0, name: 'Test coaster', traceCount: 1, pathStart: 0 }],
        cacheBody: Buffer.from([9, 1, 42, 1, 0, 1, 2]),
    };
    const result = buildRideAnalysisObject(source);

    assert.equal(result.objectBuffer.subarray(0, 8).toString('ascii'), 'PCRIDE01');
    const manifestLength = result.objectBuffer.readUInt32LE(8);
    const manifest = JSON.parse(result.objectBuffer.subarray(12, 12 + manifestLength).toString('utf8'));
    assert.equal(manifest.channels.length, 20);
    assert.equal(manifest.rides[0].name, 'Test coaster');
    assert.equal(result.summary.available, true);
    assert.equal(result.summary.objectBytes, result.objectBuffer.length);
    assert.match(result.summary.objectSha256, /^[a-f0-9]{64}$/);
});

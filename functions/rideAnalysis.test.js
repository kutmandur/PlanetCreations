"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    RIDE_ANALYSIS_HEADER_BYTES,
    RIDE_ANALYSIS_MAGIC,
    buildRideAnalysisObject,
} = require("./rideAnalysis");

test("packages the exact full-resolution Cobra cache behind a bounded manifest", () => {
    const cacheBody = Buffer.from([9, 1, 42, 1, 1, 2, 3, 4, 5]);
    const result = buildRideAnalysisObject({
        schemaVersion: 1,
        clientVersion: 9,
        fieldCount: 20,
        trackedRideCount: 1,
        pathCount: 2,
        totalSampleCount: 1234,
        sourceBytes: cacheBody.length,
        rides: [{entityId: 42, rideIndex: 0, name: "Test coaster", traceCount: 2}],
        cacheBody,
    }, {payloadSha256: "a".repeat(64)});

    assert.ok(result.objectBuffer.subarray(0, 8).equals(RIDE_ANALYSIS_MAGIC));
    const manifestLength = result.objectBuffer.readUInt32LE(8);
    const manifest = JSON.parse(result.objectBuffer
        .subarray(RIDE_ANALYSIS_HEADER_BYTES, RIDE_ANALYSIS_HEADER_BYTES + manifestLength)
        .toString("utf8"));
    assert.equal(manifest.totalSampleCount, 1234);
    assert.equal(manifest.channels.length, 20);
    assert.deepEqual(
        manifest.channels.slice(4, 7).map((channel) => channel.key),
        ["routeX", "elevation", "routeZ"],
    );
    assert.deepEqual(
        manifest.channels.slice(7, 11).map((channel) => channel.key),
        ["orientationX", "orientationY", "orientationZ", "orientationW"],
    );
    assert.deepEqual(
        manifest.channels.slice(14, 17).map((channel) => channel.key),
        ["lateralAcceleration", "verticalAcceleration", "longitudinalAcceleration"],
    );
    assert.equal(manifest.rides[0].name, "Test coaster");
    assert.ok(result.objectBuffer.subarray(RIDE_ANALYSIS_HEADER_BYTES + manifestLength)
        .equals(cacheBody));
    assert.match(result.summary.objectSha256, /^[a-f0-9]{64}$/);
});

test("refuses malformed or unbounded analysis sources", () => {
    assert.equal(buildRideAnalysisObject(null), null);
    assert.equal(buildRideAnalysisObject({schemaVersion: 1, cacheBody: Buffer.alloc(1)}), null);
});

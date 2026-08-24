"use strict";

const crypto = require("crypto");

const RIDE_ANALYSIS_MAGIC = Buffer.from("PCRIDE01", "ascii");
const RIDE_ANALYSIS_HEADER_BYTES = RIDE_ANALYSIS_MAGIC.length + 4;
const MAX_RIDE_ANALYSIS_MANIFEST_BYTES = 512 * 1024;
const MAX_RIDE_ANALYSIS_CACHE_BYTES = 64 * 1024 * 1024;

const RIDE_ANALYSIS_CHANNELS = Object.freeze([
    {index: 0, key: "state", label: "Trace state", unit: null, status: "internal", valueType: "uint32", description: "Internal integer state stored by the game for this sample."},
    {index: 1, key: "time", label: "Time", unit: "s", status: "verified", description: "Elapsed test time."},
    {index: 2, key: "distance", label: "Distance", unit: "m", status: "verified", description: "Distance travelled along the test route."},
    {index: 3, key: "speed", label: "Speed", unit: "m/s", status: "verified", description: "Vehicle speed."},
    {index: 4, key: "routeX", label: "Route X", unit: "m", status: "verified", description: "Horizontal X position of the stored route sample."},
    {index: 5, key: "elevation", label: "Elevation", unit: "m", status: "verified", description: "Vertical Y position of the stored route sample."},
    {index: 6, key: "routeZ", label: "Route Z", unit: "m", status: "verified", description: "Horizontal Z position of the stored route sample."},
    {index: 7, key: "orientationX", label: "Orientation qX", unit: null, status: "verified", description: "X component of the vehicle orientation quaternion."},
    {index: 8, key: "orientationY", label: "Orientation qY", unit: null, status: "verified", description: "Y component of the vehicle orientation quaternion."},
    {index: 9, key: "orientationZ", label: "Orientation qZ", unit: null, status: "verified", description: "Z component of the vehicle orientation quaternion."},
    {index: 10, key: "orientationW", label: "Orientation qW", unit: null, status: "verified", description: "W component of the vehicle orientation quaternion."},
    {index: 11, key: "excitement", label: "Excitement", unit: null, status: "verified", description: "Momentary excitement score calculated by the game."},
    {index: 12, key: "fear", label: "Fear", unit: null, status: "verified", description: "Momentary fear score calculated by the game."},
    {index: 13, key: "nausea", label: "Nausea", unit: null, status: "verified", description: "Momentary nausea score calculated by the game."},
    {index: 14, key: "lateralAcceleration", label: "Lateral acceleration", unit: "m/s²", status: "verified", description: "Sideways vehicle acceleration before conversion to G-force."},
    {index: 15, key: "verticalAcceleration", label: "Vertical acceleration", unit: "m/s²", status: "verified", description: "Vertical vehicle acceleration excluding the constant 1 g gravity baseline."},
    {index: 16, key: "longitudinalAcceleration", label: "Longitudinal acceleration", unit: "m/s²", status: "verified", description: "Forward or backward vehicle acceleration before conversion to G-force."},
    {index: 17, key: "lateralG", label: "Lateral G", unit: "g", status: "verified", description: "Sideways acceleration in multiples of gravity."},
    {index: 18, key: "verticalG", label: "Vertical G", unit: "g", status: "verified", description: "Vertical acceleration in multiples of gravity, including the 1 g baseline."},
    {index: 19, key: "longitudinalG", label: "Longitudinal G", unit: "g", status: "verified", description: "Forward or backward acceleration in multiples of gravity."},
]);

function boundedString(value, maximum = 500) {
    return typeof value === "string" ? value.slice(0, maximum) : null;
}

function sanitizeRide(ride) {
    return {
        entityId: Number.isSafeInteger(ride?.entityId) ? ride.entityId : null,
        rideIndex: Number.isSafeInteger(ride?.rideIndex) ? ride.rideIndex : null,
        name: boundedString(ride?.name),
        typeId: boundedString(ride?.typeId),
        category: boundedString(ride?.category),
        rideCategoryKey: boundedString(ride?.rideCategoryKey, 100),
        rideCategory: boundedString(ride?.rideCategory, 100),
        traceCount: Number.isSafeInteger(ride?.traceCount) ? ride.traceCount : 0,
        pathStart: Number.isSafeInteger(ride?.pathStart) ? ride.pathStart : 0,
    };
}

function buildRideAnalysisObject(source, context = {}) {
    if (!source || source.schemaVersion !== 1 || !Buffer.isBuffer(source.cacheBody)) {
        return null;
    }
    if (source.cacheBody.length <= 0 ||
        source.cacheBody.length > MAX_RIDE_ANALYSIS_CACHE_BYTES ||
        !Number.isSafeInteger(source.fieldCount) || source.fieldCount !== 20 ||
        !Number.isSafeInteger(source.totalSampleCount) || source.totalSampleCount <= 0) {
        return null;
    }
    const manifest = {
        schemaVersion: 1,
        source: "planet-coaster-2-tracked-ride-test-cache",
        gameId: "planet-coaster-2",
        payloadSha256: boundedString(context.payloadSha256, 64),
        clientVersion: source.clientVersion,
        fieldCount: source.fieldCount,
        trackedRideCount: source.trackedRideCount,
        pathCount: source.pathCount,
        totalSampleCount: source.totalSampleCount,
        sourceBytes: source.sourceBytes,
        channels: RIDE_ANALYSIS_CHANNELS,
        rides: Array.isArray(source.rides) ? source.rides.map(sanitizeRide).slice(0, 500) : [],
    };
    const manifestBuffer = Buffer.from(JSON.stringify(manifest), "utf8");
    if (manifestBuffer.length > MAX_RIDE_ANALYSIS_MANIFEST_BYTES) return null;
    const header = Buffer.alloc(RIDE_ANALYSIS_HEADER_BYTES);
    RIDE_ANALYSIS_MAGIC.copy(header, 0);
    header.writeUInt32LE(manifestBuffer.length, RIDE_ANALYSIS_MAGIC.length);
    const objectBuffer = Buffer.concat([header, manifestBuffer, source.cacheBody]);
    return {
        objectBuffer,
        manifest,
        summary: {
            schemaVersion: 1,
            available: true,
            trackedRideCount: manifest.trackedRideCount,
            pathCount: manifest.pathCount,
            totalSampleCount: manifest.totalSampleCount,
            sourceBytes: manifest.sourceBytes,
            objectBytes: objectBuffer.length,
            objectSha256: crypto.createHash("sha256").update(objectBuffer).digest("hex"),
        },
    };
}

module.exports = {
    MAX_RIDE_ANALYSIS_CACHE_BYTES,
    RIDE_ANALYSIS_CHANNELS,
    RIDE_ANALYSIS_HEADER_BYTES,
    RIDE_ANALYSIS_MAGIC,
    buildRideAnalysisObject,
};

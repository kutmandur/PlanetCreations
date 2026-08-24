const MAGIC = 'PCRIDE01';
const HEADER_BYTES = 12;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_SAMPLE_COUNT = 10_000_000;

const KNOWN_CHANNELS = [
    {index: 0, key: 'state', label: 'Trace state', unit: null, status: 'internal', valueType: 'uint32', description: 'Internal integer state stored by the game for this sample.'},
    {index: 1, key: 'time', label: 'Time', unit: 's', status: 'verified', description: 'Elapsed test time.'},
    {index: 2, key: 'distance', label: 'Distance', unit: 'm', status: 'verified', description: 'Distance travelled along the test route.'},
    {index: 3, key: 'speed', label: 'Speed', unit: 'm/s', status: 'verified', description: 'Vehicle speed.'},
    {index: 4, key: 'routeX', label: 'Route X', unit: 'm', status: 'verified', description: 'Horizontal X position of the stored route sample.'},
    {index: 5, key: 'elevation', label: 'Elevation', unit: 'm', status: 'verified', description: 'Vertical Y position of the stored route sample.'},
    {index: 6, key: 'routeZ', label: 'Route Z', unit: 'm', status: 'verified', description: 'Horizontal Z position of the stored route sample.'},
    {index: 7, key: 'orientationX', label: 'Orientation qX', unit: null, status: 'verified', description: 'X component of the vehicle orientation quaternion.'},
    {index: 8, key: 'orientationY', label: 'Orientation qY', unit: null, status: 'verified', description: 'Y component of the vehicle orientation quaternion.'},
    {index: 9, key: 'orientationZ', label: 'Orientation qZ', unit: null, status: 'verified', description: 'Z component of the vehicle orientation quaternion.'},
    {index: 10, key: 'orientationW', label: 'Orientation qW', unit: null, status: 'verified', description: 'W component of the vehicle orientation quaternion.'},
    {index: 11, key: 'excitement', label: 'Excitement', unit: null, status: 'verified', description: 'Momentary excitement score calculated by the game.'},
    {index: 12, key: 'fear', label: 'Fear', unit: null, status: 'verified', description: 'Momentary fear score calculated by the game.'},
    {index: 13, key: 'nausea', label: 'Nausea', unit: null, status: 'verified', description: 'Momentary nausea score calculated by the game.'},
    {index: 14, key: 'lateralAcceleration', label: 'Lateral acceleration', unit: 'm/s²', status: 'verified', description: 'Sideways vehicle acceleration before conversion to G-force.'},
    {index: 15, key: 'verticalAcceleration', label: 'Vertical acceleration', unit: 'm/s²', status: 'verified', description: 'Vertical vehicle acceleration excluding the constant 1 g gravity baseline.'},
    {index: 16, key: 'longitudinalAcceleration', label: 'Longitudinal acceleration', unit: 'm/s²', status: 'verified', description: 'Forward or backward vehicle acceleration before conversion to G-force.'},
    {index: 17, key: 'lateralG', label: 'Lateral G', unit: 'g', status: 'verified', description: 'Sideways acceleration in multiples of gravity.'},
    {index: 18, key: 'verticalG', label: 'Vertical G', unit: 'g', status: 'verified', description: 'Vertical acceleration in multiples of gravity, including the 1 g baseline.'},
    {index: 19, key: 'longitudinalG', label: 'Longitudinal G', unit: 'g', status: 'verified', description: 'Forward or backward acceleration in multiples of gravity.'},
];

function readVarUInt(bytes, offset) {
    if (offset < 0 || offset >= bytes.length) return null;
    const first = bytes[offset];
    if (first < 0xc0) return { value: first, offset: offset + 1 };
    if (first < 0xc8 && offset + 1 < bytes.length) {
        return { value: ((first & 0x07) << 8) | bytes[offset + 1], offset: offset + 2 };
    }
    if (first >= 0xd0 && first < 0xe0 && offset + 2 < bytes.length) {
        return {
            value: ((first & 0x0f) << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2],
            offset: offset + 3,
        };
    }
    if (first >= 0xe0 && first < 0xf0 && offset + 3 < bytes.length) {
        return {
            value: ((first & 0x0f) * 0x1000000) +
                (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3],
            offset: offset + 4,
        };
    }
    return null;
}

function parseCacheLayout(bytes, fieldCount) {
    const version = readVarUInt(bytes, 0);
    const rideCount = version ? readVarUInt(bytes, version.offset) : null;
    if (!version || !rideCount || rideCount.value > 500) throw new Error('Invalid ride-analysis cache header.');
    let offset = rideCount.offset;
    let pathCount = 0;
    const rides = [];
    for (let index = 0; index < rideCount.value; index += 1) {
        const entityId = readVarUInt(bytes, offset);
        const firstCount = entityId ? readVarUInt(bytes, entityId.offset) : null;
        const secondCount = firstCount ? readVarUInt(bytes, firstCount.offset) : null;
        if (!entityId || !firstCount || !secondCount || firstCount.value > 100 || secondCount.value > 100) {
            throw new Error('Invalid ride-analysis ride table.');
        }
        const traceCount = firstCount.value + secondCount.value;
        rides.push({ entityId: entityId.value, traceCount, pathStart: pathCount });
        pathCount += traceCount;
        offset = secondCount.offset;
    }
    const storedPathCount = readVarUInt(bytes, offset);
    if (!storedPathCount || storedPathCount.value !== pathCount) {
        throw new Error('Invalid ride-analysis path table.');
    }
    offset = storedPathCount.offset;
    let totalSamples = 0;
    const pathLengths = [];
    const pathOffsets = [];
    for (let index = 0; index < pathCount; index += 1) {
        const length = readVarUInt(bytes, offset);
        if (!length) throw new Error('Invalid ride-analysis path length.');
        pathOffsets.push(totalSamples);
        totalSamples += length.value;
        if (totalSamples > MAX_SAMPLE_COUNT) throw new Error('Ride analysis contains too many samples.');
        pathLengths.push(length.value);
        offset = length.offset;
    }
    const blockStride = 4 + totalSamples * 4;
    if (!Number.isSafeInteger(blockStride) || offset + fieldCount * blockStride > bytes.length) {
        throw new Error('Ride-analysis channel data is incomplete.');
    }
    return { version: version.value, rides, pathLengths, pathOffsets, totalSamples, dataOffset: offset, blockStride };
}

function safeJson(bytes) {
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new Error('Invalid ride-analysis manifest.');
    }
}

export function parseRideAnalysisBuffer(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (bytes.length < HEADER_BYTES) throw new Error('Ride-analysis file is incomplete.');
    const magic = String.fromCharCode(...bytes.subarray(0, 8));
    if (magic !== MAGIC) throw new Error('Unsupported ride-analysis format.');
    const headerView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const manifestLength = headerView.getUint32(8, true);
    if (manifestLength <= 0 || manifestLength > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestLength > bytes.length) {
        throw new Error('Invalid ride-analysis manifest length.');
    }
    const manifest = safeJson(bytes.subarray(HEADER_BYTES, HEADER_BYTES + manifestLength));
    if (manifest?.schemaVersion !== 1 || manifest?.fieldCount !== 20 ||
        !Array.isArray(manifest.channels) || manifest.channels.length !== KNOWN_CHANNELS.length) {
        throw new Error('Unsupported ride-analysis schema.');
    }
    const normalizedManifest = {
        ...manifest,
        // The field order is part of the Cobra cache schema. Normalizing by
        // index also corrects labels embedded in analysis objects produced
        // before every field had been identified.
        channels: KNOWN_CHANNELS.map((known, index) => ({
            ...manifest.channels[index],
            ...known,
        })),
    };
    const cacheBytes = bytes.subarray(HEADER_BYTES + manifestLength);
    const layout = parseCacheLayout(cacheBytes, normalizedManifest.fieldCount);
    if (layout.totalSamples !== normalizedManifest.totalSampleCount) throw new Error('Ride-analysis sample count mismatch.');
    const cacheView = new DataView(cacheBytes.buffer, cacheBytes.byteOffset, cacheBytes.byteLength);

    const readPath = pathIndex => {
        const length = layout.pathLengths[pathIndex];
        if (!Number.isSafeInteger(length)) throw new Error('Unknown ride-analysis path.');
        const channels = normalizedManifest.channels.map((channel, fieldIndex) => {
            const values = channel.valueType === 'uint32' ?
                new Uint32Array(length) : new Float32Array(length);
            const start = layout.dataOffset + fieldIndex * layout.blockStride + 4 + layout.pathOffsets[pathIndex] * 4;
            for (let index = 0; index < length; index += 1) {
                values[index] = channel.valueType === 'uint32' ?
                    cacheView.getUint32(start + index * 4, true) :
                    cacheView.getFloat32(start + index * 4, true);
            }
            return { ...channel, values };
        });
        return { pathIndex, sampleCount: length, channels };
    };

    const getRidePaths = (rideIndex, rideName = '') => {
        const descriptor = normalizedManifest.rides.find(ride => ride.rideIndex === rideIndex) ||
            normalizedManifest.rides.find(ride => ride.name && ride.name === rideName);
        if (!descriptor) return [];
        const cacheRide = layout.rides.find(ride => ride.entityId === descriptor.entityId);
        if (!cacheRide) return [];
        return Array.from({ length: cacheRide.traceCount }, (_, index) =>
            readPath(cacheRide.pathStart + index));
    };

    return { manifest: normalizedManifest, layout, getRidePaths, readPath };
}

function finiteExtent(values) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    for (const value of values || []) {
        if (!Number.isFinite(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
        count += 1;
    }
    return count ? { min, max, average: sum / count } : { min: null, max: null, average: null };
}

export function getRidePathSummary(path) {
    const byKey = new Map((path?.channels || []).map(channel => [channel.key, channel.values]));
    const lastFinite = key => {
        const values = byKey.get(key) || [];
        for (let index = values.length - 1; index >= 0; index -= 1) {
            if (Number.isFinite(values[index])) return values[index];
        }
        return null;
    };
    const speed = finiteExtent(byKey.get('speed'));
    const elevationValues = byKey.get('elevation') || [];
    const elevation = finiteExtent(elevationValues);
    let peak = -Infinity;
    let largestDrop = 0;
    for (const value of elevationValues) {
        if (!Number.isFinite(value)) continue;
        peak = Math.max(peak, value);
        largestDrop = Math.max(largestDrop, peak - value);
    }
    return {
        sampleCount: path?.sampleCount || 0,
        durationSeconds: lastFinite('time'),
        distanceMeters: lastFinite('distance'),
        maxSpeedKph: Number.isFinite(speed.max) ? speed.max * 3.6 : null,
        averageSpeedKph: Number.isFinite(speed.average) ? speed.average * 3.6 : null,
        elevation,
        largestSampledDropMeters: Number.isFinite(largestDrop) ? largestDrop : null,
        gForces: {
            lateral: finiteExtent(byKey.get('lateralG')),
            vertical: finiteExtent(byKey.get('verticalG')),
            longitudinal: finiteExtent(byKey.get('longitudinalG')),
        },
        calculatedRatings: {
            excitement: finiteExtent(byKey.get('excitement')).average,
            fear: finiteExtent(byKey.get('fear')).average,
            nausea: finiteExtent(byKey.get('nausea')).average,
        },
    };
}

export const RIDE_ANALYSIS_DEFAULT_SERIES = [
    'time', 'distance', 'speed', 'elevation', 'excitement', 'fear', 'nausea',
    'lateralG', 'verticalG', 'longitudinalG',
];

const COBRA_MAGIC = Buffer.from('CobraSav');
const CLIENT_MARKER = Buffer.from('<<ClientClient>>\xf3', 'latin1');
const TRACK_RECORD_TERMINATOR = Buffer.from('c0c801010000f300', 'hex');
const TRACK_NAME_SENTINEL = Buffer.from('f9ffffffffffffffff01', 'hex');
const MAX_RIDES = 500;
const MAX_TEST_SAMPLES = 10_000_000;
const { resolveFrontierRideCategory } = require('./FrontierRideCategory');

function readVarUInt(buffer, offset) {
    if (!Buffer.isBuffer(buffer) || offset < 0 || offset >= buffer.length) return null;
    const first = buffer[offset];
    if (first < 0xc0) return { value: first, offset: offset + 1 };
    if (first < 0xc8 && offset + 1 < buffer.length) {
        return { value: ((first & 0x07) << 8) | buffer[offset + 1], offset: offset + 2 };
    }
    if (first >= 0xd0 && first < 0xe0 && offset + 2 < buffer.length) {
        return {
            value: ((first & 0x0f) << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2],
            offset: offset + 3,
        };
    }
    if (first >= 0xe0 && first < 0xf0 && offset + 3 < buffer.length) {
        return {
            value: ((first & 0x0f) * 0x1000000) +
                (buffer[offset + 1] << 16) + (buffer[offset + 2] << 8) + buffer[offset + 3],
            offset: offset + 4,
        };
    }
    return null;
}

function encodeVarUInt(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= 0x100000) return null;
    if (value < 0xc0) return Buffer.from([value]);
    if (value < 0x800) return Buffer.from([0xc0 | (value >> 8), value & 0xff]);
    return Buffer.from([0xd0 | ((value >> 16) & 0x0f), (value >> 8) & 0xff, value & 0xff]);
}

function parseStringTable(payload) {
    if (!Buffer.isBuffer(payload) || !payload.subarray(0, COBRA_MAGIC.length).equals(COBRA_MAGIC)) return null;
    const marker = Buffer.from('Strings>');
    const endMarker = Buffer.from('WString>');
    const start = payload.indexOf(marker, COBRA_MAGIC.length);
    const end = payload.indexOf(endMarker, start + marker.length);
    if (start < 0 || end < 0) return null;
    const countValue = readVarUInt(payload, start + marker.length);
    if (!countValue || countValue.value > 100000) return null;

    const strings = [];
    let offset = countValue.offset;
    for (let index = 0; index < countValue.value; index += 1) {
        if (offset >= end || payload[offset] !== 0xf3) return null;
        const stringEnd = payload.indexOf(0, offset + 1);
        if (stringEnd < 0 || stringEnd > end || stringEnd - offset > 1000) return null;
        strings.push(payload.subarray(offset + 1, stringEnd).toString('utf8').slice(0, 500));
        offset = stringEnd + 1;
    }
    return strings;
}

function parseClients(payload) {
    const clients = new Map();
    const markers = [];
    let offset = 0;
    while ((offset = payload.indexOf(CLIENT_MARKER, offset)) >= 0) {
        const nameStart = offset + CLIENT_MARKER.length;
        const nameEnd = payload.indexOf(0, nameStart);
        if (nameEnd > nameStart && nameEnd - nameStart <= 128) {
            const name = payload.subarray(nameStart, nameEnd).toString('utf8');
            if (/^[A-Za-z0-9_:]+$/.test(name)) markers.push({ offset, name, bodyStart: nameEnd + 1 });
        }
        offset += CLIENT_MARKER.length;
    }
    for (let index = 0; index < markers.length; index += 1) {
        const marker = markers[index];
        const bodyEnd = markers[index + 1]?.offset ?? payload.length;
        clients.set(marker.name, payload.subarray(marker.bodyStart, bodyEnd));
    }
    return clients;
}

function readClientHeader(body) {
    const version = readVarUInt(body, 0);
    const count = version ? readVarUInt(body, version.offset) : null;
    if (!version || !count || count.value > 1000000) return null;
    return { version: version.value, count: count.value, dataOffset: count.offset };
}

function getClientCount(clients, name) {
    return readClientHeader(clients.get(name))?.count ?? null;
}

function finiteFloat(body, offset) {
    if (offset < 0 || offset + 4 > body.length) return null;
    const value = body.readFloatLE(offset);
    return Number.isFinite(value) ? value : null;
}

function summarizeTrace(values, mode) {
    const finite = values.filter(Number.isFinite);
    if (finite.length === 0) return null;
    let result = mode === 'min' ? Infinity : (mode === 'max' ? -Infinity : 0);
    for (const value of finite) {
        if (mode === 'min') result = Math.min(result, value);
        else if (mode === 'max') result = Math.max(result, value);
        else result += value;
    }
    return mode === 'average' ? result / finite.length : result;
}

/**
 * Reads the per-sample cache written by Planet Coaster 2 after a tracked ride
 * has been tested. These are measured trace values, not the game's final EFN
 * rating. Untested/empty traces deliberately produce no stats.
 */
function parseTrackedRideTestDataCache(body, trackedRideCount) {
    const header = readClientHeader(body);
    if (!header || header.count !== trackedRideCount || header.count > MAX_RIDES) return [];
    let offset = header.dataOffset;
    const cacheEntries = [];
    let declaredPathCount = 0;
    for (let index = 0; index < header.count; index += 1) {
        const entityId = readVarUInt(body, offset);
        const firstTraceCount = entityId ? readVarUInt(body, entityId.offset) : null;
        const secondTraceCount = firstTraceCount ? readVarUInt(body, firstTraceCount.offset) : null;
        if (!entityId || !firstTraceCount || !secondTraceCount ||
            firstTraceCount.value > 100 || secondTraceCount.value > 100) return [];
        const traceCount = firstTraceCount.value + secondTraceCount.value;
        cacheEntries.push({ entityId: entityId.value, traceCount, pathStart: declaredPathCount });
        declaredPathCount += traceCount;
        offset = secondTraceCount.offset;
    }

    const pathCountValue = readVarUInt(body, offset);
    if (!pathCountValue || pathCountValue.value !== declaredPathCount) return [];
    offset = pathCountValue.offset;
    const pathLengths = [];
    let totalSamples = 0;
    for (let index = 0; index < pathCountValue.value; index += 1) {
        const length = readVarUInt(body, offset);
        if (!length) return [];
        totalSamples += length.value;
        if (totalSamples > MAX_TEST_SAMPLES) return [];
        pathLengths.push(length.value);
        offset = length.offset;
    }
    if (totalSamples === 0) return cacheEntries.map(entry => ({ entityId: entry.entityId, stats: null }));

    const blockStride = 4 + totalSamples * 4;
    const fieldCount = 20;
    if (!Number.isSafeInteger(blockStride) || offset + fieldCount * blockStride > body.length) return [];

    const pathOffsets = [];
    let sampleOffset = 0;
    for (const length of pathLengths) {
        pathOffsets.push(sampleOffset);
        sampleOffset += length;
    }
    const readPathField = (pathIndex, fieldIndex) => {
        const length = pathLengths[pathIndex];
        const fieldStart = offset + fieldIndex * blockStride + 4;
        const start = fieldStart + pathOffsets[pathIndex] * 4;
        const values = [];
        for (let index = 0; index < length; index += 1) values.push(finiteFloat(body, start + index * 4));
        return values;
    };

    const results = [];
    for (const cacheEntry of cacheEntries) {
        const pathIndexes = Array.from({ length: cacheEntry.traceCount }, (_, index) => cacheEntry.pathStart + index)
            .filter(pathIndex => pathLengths[pathIndex] > 1);
        if (pathIndexes.length === 0) {
            results.push({ entityId: cacheEntry.entityId, stats: null });
            continue;
        }
        const longestPathIndex = pathIndexes.reduce((best, current) =>
            pathLengths[current] > pathLengths[best] ? current : best);
        const acrossPaths = fieldIndex => pathIndexes.flatMap(pathIndex => readPathField(pathIndex, fieldIndex));
        const lastAcrossPaths = fieldIndex => pathIndexes
            .map(pathIndex => readPathField(pathIndex, fieldIndex).at(-1))
            .filter(Number.isFinite);
        const durationSeconds = summarizeTrace(lastAcrossPaths(1), 'max');
        const traversalLengthMeters = summarizeTrace(lastAcrossPaths(2), 'max');
        const maxSpeedMps = summarizeTrace(acrossPaths(3), 'max');
        if (!(durationSeconds > 0) && !(traversalLengthMeters > 0) && !(maxSpeedMps > 0)) {
            results.push({ entityId: cacheEntry.entityId, stats: null });
            continue;
        }
        const excitement = readPathField(longestPathIndex, 11);
        const fear = readPathField(longestPathIndex, 12);
        const nausea = readPathField(longestPathIndex, 13);
        results.push({
            entityId: cacheEntry.entityId,
            stats: {
                source: 'tracked-ride-test-cache',
                traceCount: pathIndexes.length,
                sampleCount: pathIndexes.reduce((sum, pathIndex) => sum + pathLengths[pathIndex], 0),
                durationSeconds,
                traversalLengthMeters,
                maxSpeedMps,
                maxSpeedKph: Number.isFinite(maxSpeedMps) ? maxSpeedMps * 3.6 : null,
                testCurves: {
                    average: {
                        excitement: summarizeTrace(excitement, 'average'),
                        fear: summarizeTrace(fear, 'average'),
                        nausea: summarizeTrace(nausea, 'average'),
                    },
                    maximum: {
                        excitement: summarizeTrace(excitement, 'max'),
                        fear: summarizeTrace(fear, 'max'),
                        nausea: summarizeTrace(nausea, 'max'),
                    },
                    isFinalRating: false,
                },
                gForces: {
                    lateral: { min: summarizeTrace(acrossPaths(17), 'min'), max: summarizeTrace(acrossPaths(17), 'max') },
                    vertical: { min: summarizeTrace(acrossPaths(18), 'min'), max: summarizeTrace(acrossPaths(18), 'max') },
                    longitudinal: { min: summarizeTrace(acrossPaths(19), 'min'), max: summarizeTrace(acrossPaths(19), 'max') },
                },
            },
        });
    }
    return results;
}

function parsePoolCount(body) {
    const header = readClientHeader(body);
    if (!header) return null;
    if (header.count === 0) return 0;

    // The header count represents serialized pool segments. Each logical pool
    // is identified by a repeated entity ID inside PoolComponentManager.
    const poolEntityIds = new Set();
    for (let offset = header.dataOffset; offset + 5 < body.length; offset += 1) {
        if (body[offset] !== 0 || body[offset + 1] !== 1) continue;
        const firstId = readVarUInt(body, offset + 2);
        if (!firstId || body[firstId.offset] !== 1 || body[firstId.offset + 1] !== 1) continue;
        const repeatedId = readVarUInt(body, firstId.offset + 2);
        if (!repeatedId || repeatedId.value !== firstId.value || body[repeatedId.offset] !== 0) continue;
        poolEntityIds.add(firstId.value);
        offset = repeatedId.offset;
    }
    for (let offset = header.dataOffset; offset + 6 < body.length; offset += 1) {
        const firstId = readVarUInt(body, offset);
        if (!firstId || firstId.value < 0x800 ||
            body[firstId.offset] !== 0 || body[firstId.offset + 1] !== 1) continue;
        const repeatedId = readVarUInt(body, firstId.offset + 2);
        if (!repeatedId || repeatedId.value !== firstId.value ||
            body[repeatedId.offset] !== 0xc0 || body[repeatedId.offset + 1] !== 0x64) continue;
        poolEntityIds.add(firstId.value);
        offset = repeatedId.offset;
    }
    return poolEntityIds.size > 0 ? poolEntityIds.size : null;
}

function humanizeRideType(typeId, fallback) {
    const label = String(typeId || '')
        .replace(/^(?:Coaster_|TrackedRide_|Water_|Powered_|CC_|PTR_|FR_|fr_)/i, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return label || fallback;
}

function stringAt(strings, reference) {
    if (!reference || reference.value < 0 || reference.value >= strings.length) return null;
    const value = strings[reference.value];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function readSerializedString(buffer, offset, strings) {
    if (buffer[offset] === 0xf3) {
        const end = buffer.indexOf(0, offset + 1);
        if (end < 0 || end - offset > 501) return null;
        const value = buffer.subarray(offset + 1, end).toString('utf8');
        return value || null;
    }
    return stringAt(strings, readVarUInt(buffer, offset));
}

function readTrackName(record, strings) {
    const sentinel = record.indexOf(TRACK_NAME_SENTINEL);
    if (sentinel < 0) return null;
    return stringAt(strings, readVarUInt(record, sentinel + TRACK_NAME_SENTINEL.length));
}

function makeRide(kind, typeId, name, categoryTypeId = typeId, tags = []) {
    const fallback = kind === 'flat' ? 'Flat ride' : 'Tracked ride';
    const rideCategory = resolveFrontierRideCategory(kind, typeId, tags);
    return {
        kind,
        name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 500) : null,
        typeId: typeof typeId === 'string' && typeId ? typeId.slice(0, 500) : null,
        category: humanizeRideType(categoryTypeId, fallback).slice(0, 500),
        rideCategoryKey: rideCategory.key,
        rideCategory: rideCategory.label,
        ratings: null,
    };
}

function findAll(buffer, pattern) {
    const positions = [];
    let offset = 0;
    while ((offset = buffer.indexOf(pattern, offset)) >= 0) {
        positions.push(offset);
        offset += pattern.length;
    }
    return positions;
}

function parseBlueprintTrackedRides(body, strings, tags) {
    const header = readClientHeader(body);
    if (!header || header.count <= 0) return [];
    const endings = findAll(body, TRACK_RECORD_TERMINATOR).slice(0, header.count);
    if (endings.length !== header.count) return [];
    const rides = [];
    let start = header.dataOffset;
    for (const ending of endings) {
        const record = body.subarray(start, ending + TRACK_RECORD_TERMINATOR.length);
        const typeReference = readVarUInt(record, 0);
        const typeId = stringAt(strings, typeReference);
        rides.push(makeRide('tracked', typeId, readTrackName(record, strings), typeId, tags));
        start = ending + TRACK_RECORD_TERMINATOR.length;
    }
    return rides;
}

function parseParkTrackedRides(body, strings, tags) {
    const header = readClientHeader(body);
    if (!header || header.count <= 0) return [];
    const endings = findAll(body, TRACK_RECORD_TERMINATOR).slice(0, header.count);
    if (endings.length !== header.count) return [];
    const rides = [];
    let start = header.dataOffset;
    for (let index = 0; index < endings.length; index += 1) {
        const ending = endings[index];
        const record = body.subarray(start, ending + TRACK_RECORD_TERMINATOR.length);
        const entityId = readVarUInt(record, 0);
        const sequentialId = entityId ? readVarUInt(record, entityId.offset) : null;
        const typeId = sequentialId ? readSerializedString(record, sequentialId.offset, strings) : null;
        const ride = makeRide('tracked', typeId, readTrackName(record, strings), typeId, tags);
        ride._entityId = entityId?.value ?? null;
        rides.push(ride);
        start = ending + TRACK_RECORD_TERMINATOR.length + (index < endings.length - 1 ? 2 : 0);
    }
    return rides;
}

function parseParkRideIds(body) {
    const header = readClientHeader(body);
    if (!header || header.count > MAX_RIDES) return [];
    const ids = [];
    let offset = header.dataOffset;
    for (let index = 0; index < header.count; index += 1) {
        const id = readVarUInt(body, offset);
        if (!id || id.offset + 3 > body.length ||
            body[id.offset] !== 1 || body[id.offset + 1] !== 0 || body[id.offset + 2] !== 1) return [];
        ids.push(id.value);
        offset = id.offset + 3;
    }
    return ids;
}

function parseParkFlatRides(body, rideIds, strings, tags) {
    const header = readClientHeader(body);
    if (!header || header.count <= 0) return [];
    const matches = [];
    for (const rideId of rideIds) {
        const encodedId = encodeVarUInt(rideId);
        if (!encodedId) continue;
        let offset = header.dataOffset;
        while ((offset = body.indexOf(encodedId, offset)) >= 0) {
            const typeReference = readVarUInt(body, offset + encodedId.length);
            const typeId = stringAt(strings, typeReference);
            if (typeId && /^fr_/i.test(typeId) && body[typeReference.offset] === 0) {
                const displayTypeId = /^FR_/i.test(strings[typeReference.value + 1] || '') ?
                    strings[typeReference.value + 1] : typeId;
                matches.push({ offset, ride: makeRide('flat', typeId, null, displayTypeId, tags) });
                break;
            }
            offset += encodedId.length;
        }
    }
    return matches.sort((left, right) => left.offset - right.offset)
        .slice(0, header.count).map(match => match.ride);
}

function parseBlueprintFlatRides(body, strings, tags) {
    const header = readClientHeader(body);
    if (!header || header.count <= 0) return [];
    const typeId = stringAt(strings, readVarUInt(body, header.dataOffset));
    return typeId && /^fr_/i.test(typeId) ? [makeRide('flat', typeId, null, typeId, tags)] : [];
}

function fillMissingRides(rides, kind, count, tags) {
    const result = rides.slice(0, Math.min(count, MAX_RIDES));
    while (result.length < Math.min(count, MAX_RIDES)) result.push(makeRide(kind, null, null, null, tags));
    return result;
}

function parseCobraSaveMetadata(payload, kind, outerRatings = null, tags = []) {
    const strings = parseStringTable(payload);
    if (!strings) return null;
    const clients = parseClients(payload);
    const trackBody = clients.get('Track');
    const flatBody = clients.get('FlatRide');
    const trackedRideCount = getClientCount(clients, 'Track') ?? 0;
    const flatRideCount = getClientCount(clients, 'FlatRide') ?? 0;
    const rideCount = getClientCount(clients, 'Ride') ?? (trackedRideCount + flatRideCount);
    const buildingCount = getClientCount(clients, 'PartDataGroupComponentManager');
    const placedPartCount = getClientCount(clients, 'PlacementPartData');
    const sceneryPieceCount = getClientCount(clients, 'PartDataTransformComponentManager');
    const railElementCount = getClientCount(clients, 'RailComponentManager');
    const trackedRideElementCount = getClientCount(clients, 'TrackedRideMotionAnalysis');
    const binCount = getClientCount(clients, 'Bins');
    const poolCount = parsePoolCount(clients.get('PoolComponentManager'));

    let trackedRides = [];
    let flatRides = [];
    if (kind === 'park' || kind === 'autosave') {
        trackedRides = trackBody ? parseParkTrackedRides(trackBody, strings, tags) : [];
        const rideIds = clients.has('Ride') ? parseParkRideIds(clients.get('Ride')) : [];
        flatRides = flatBody ? parseParkFlatRides(flatBody, rideIds, strings, tags) : [];
    } else if (kind === 'blueprint') {
        trackedRides = trackBody ? parseBlueprintTrackedRides(trackBody, strings, tags) : [];
        flatRides = flatBody ? parseBlueprintFlatRides(flatBody, strings, tags) : [];
    }
    const testData = clients.has('TrackedRideTestDataCache') ?
        parseTrackedRideTestDataCache(clients.get('TrackedRideTestDataCache'), trackedRideCount) : [];
    const testStatsByEntityId = new Map(testData.map(entry => [entry.entityId, entry.stats]));
    trackedRides.forEach(ride => {
        const testStats = testStatsByEntityId.get(ride._entityId);
        if (testStats) ride.testStats = testStats;
        delete ride._entityId;
    });
    const rides = [
        ...fillMissingRides(trackedRides, 'tracked', trackedRideCount, tags),
        ...fillMissingRides(flatRides, 'flat', flatRideCount, tags),
    ].slice(0, MAX_RIDES);
    if (rideCount === 1 && rides.length === 1 && outerRatings) rides[0].ratings = outerRatings;

    return {
        rideCount,
        trackedRideCount,
        flatRideCount,
        buildingCount,
        placedPartCount,
        sceneryPieceCount,
        railElementCount,
        trackedRideElementCount,
        binCount,
        poolCount,
        rides,
    };
}

module.exports = {
    humanizeRideType,
    parseCobraSaveMetadata,
    parsePoolCount,
    parseTrackedRideTestDataCache,
    readVarUInt,
};

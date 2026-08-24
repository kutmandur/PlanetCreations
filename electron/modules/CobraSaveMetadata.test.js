const assert = require('node:assert/strict');
const test = require('node:test');
const { parseCobraSaveMetadata, parsePlanetZooSaveMetadata, parsePoolCount, parseTrackedRideTestDataCache, readVarUInt } = require('./CobraSaveMetadata');
const { resolveFrontierRideCategory } = require('./FrontierRideCategory');

function varUInt(value) {
    if (value < 0xc0) return Buffer.from([value]);
    if (value < 0x800) return Buffer.from([0xc0 | (value >> 8), value & 0xff]);
    return Buffer.from([0xd0 | ((value >> 16) & 0x0f), (value >> 8) & 0xff, value & 0xff]);
}

function client(name, version, count, data = Buffer.alloc(0)) {
    return Buffer.concat([
        Buffer.from('<<ClientClient>>\xf3', 'latin1'),
        Buffer.from(`${name}\0`),
        varUInt(version),
        varUInt(count),
        data,
    ]);
}

function trackedRide(typeIndex, nameIndex) {
    return Buffer.concat([
        varUInt(typeIndex),
        Buffer.from([0]),
        Buffer.from('f9ffffffffffffffff01', 'hex'),
        varUInt(nameIndex),
        Buffer.from([0]),
        Buffer.from('c0c801010000f300', 'hex'),
    ]);
}

function cobraBlueprint(strings, clients) {
    return Buffer.concat([
        Buffer.from('CobraSavStrings>'),
        varUInt(strings.length),
        ...strings.map(value => Buffer.concat([Buffer.from([0xf3]), Buffer.from(value), Buffer.from([0])])),
        Buffer.from('WString>\0Hierarchy>\0ClientSizes>\0'),
        ...clients,
    ]);
}

test('decodes Cobra variable-width unsigned integers', () => {
    for (const value of [0, 63, 191, 192, 494, 2047, 2048, 98987]) {
        assert.equal(readVarUInt(varUInt(value), 0).value, value);
    }
});

test('extracts individual tracked-ride names and exact aggregate counts', () => {
    const strings = ['BodyFlume', 'Body Flume 1', 'Body Flume 2'];
    const payload = cobraBlueprint(strings, [
        client('FlatRide', 41, 0),
        client('PartDataGroupComponentManager', 2, 7),
        client('PartDataTransformComponentManager', 2, 35),
        client('PlacementPartData', 97, 42),
        client('RailComponentManager', 2, 11),
        client('TrackedRideMotionAnalysis', 2, 9),
        client('Bins', 2, 3),
        client('PoolComponentManager', 4, 148, Buffer.concat([
            Buffer.from([0x80, 0x1f, 0x05, 0, 1]),
            varUInt(14778),
            Buffer.from([1, 1]),
            varUInt(14778),
            Buffer.from([0, 0xc0, 0x64, 0]),
        ])),
        client('Track', 103, 2, Buffer.concat([
            trackedRide(0, 1),
            trackedRide(0, 2),
        ])),
    ]);
    const result = parseCobraSaveMetadata(payload, 'blueprint');

    assert.equal(result.rideCount, 2);
    assert.equal(result.trackedRideCount, 2);
    assert.equal(result.flatRideCount, 0);
    assert.equal(result.buildingCount, 7);
    assert.equal(result.placedPartCount, 42);
    assert.equal(result.sceneryPieceCount, 35);
    assert.equal(result.railElementCount, 11);
    assert.equal(result.trackedRideElementCount, 9);
    assert.equal(result.binCount, 3);
    assert.equal(result.poolCount, 1);
    assert.deepEqual(result.rides.map(ride => ride.name), ['Body Flume 1', 'Body Flume 2']);
    assert.deepEqual(result.rides.map(ride => ride.category), ['Body Flume', 'Body Flume']);
    assert.ok(result.rides.every(ride => ride.rideCategory === 'Water Slide'));
    assert.equal(result.sceneryCount, undefined);
    assert.equal(result.editingTimeSeconds, undefined);
});

test('extracts conservative values from a completed tracked-ride test cache', () => {
    const pathValues = new Map([
        [1, [0, 10, 0, 9]],
        [2, [0, 100, 0, 90]],
        [3, [0, 20, 0, 18]],
        [11, [1, 3, 2, 4]],
        [12, [1, 2, 1, 3]],
        [13, [0.1, 0.3, 0.2, 0.4]],
        [17, [-1.2, 1.4, -0.8, 1.1]],
        [18, [-0.4, 3.2, 0.2, 2.8]],
        [19, [-1.1, 0.8, -0.9, 0.5]],
    ]);
    const blocks = [];
    for (let field = 0; field < 20; field += 1) {
        const block = Buffer.alloc(4 + 4 * 4);
        (pathValues.get(field) || [0, 0, 0, 0]).forEach((value, index) => block.writeFloatLE(value, 4 + index * 4));
        blocks.push(block);
    }
    const body = Buffer.concat([
        varUInt(1), varUInt(1),
        varUInt(42), Buffer.from([1, 1]),
        varUInt(2), varUInt(2), varUInt(2),
        ...blocks,
    ]);

    const [{ entityId, stats }] = parseTrackedRideTestDataCache(body, 1);
    assert.equal(entityId, 42);
    assert.equal(stats.durationSeconds, 10);
    assert.equal(stats.traversalLengthMeters, 100);
    assert.equal(stats.maxSpeedMps, 20);
    assert.equal(stats.maxSpeedKph, 72);
    assert.equal(stats.sampleCount, 4);
    assert.ok(Math.abs(stats.testCurves.average.excitement - 2) < 0.0001);
    assert.ok(Math.abs(stats.calculatedRatings.excitement - 2) < 0.0001);
    assert.equal(stats.calculatedRatings.source, 'tracked-ride-test-curve-sample-mean-v1');
    assert.equal(stats.calculatedRatings.isFinalRating, false);
    assert.ok(Math.abs(stats.gForces.vertical.max - 3.2) < 0.0001);
    assert.equal(stats.testCurves.isFinalRating, false);
});

test('supports untested rides and a variable number of traces in the same cache', () => {
    const pathValues = new Map([
        [1, [0, 5, 0, 7, 0, 9]],
        [2, [0, 50, 0, 70, 0, 90]],
        [3, [0, 10, 0, 12, 0, 14]],
    ]);
    const blocks = [];
    for (let field = 0; field < 20; field += 1) {
        const block = Buffer.alloc(4 + 6 * 4);
        (pathValues.get(field) || [0, 0, 0, 0, 0, 0])
            .forEach((value, index) => block.writeFloatLE(value, 4 + index * 4));
        blocks.push(block);
    }
    const body = Buffer.concat([
        varUInt(9), varUInt(2),
        varUInt(100), varUInt(0), varUInt(0),
        varUInt(200), varUInt(1), varUInt(2),
        varUInt(3), varUInt(2), varUInt(2), varUInt(2),
        ...blocks,
    ]);

    const entries = parseTrackedRideTestDataCache(body, 2);
    assert.deepEqual(entries[0], { entityId: 100, stats: null });
    assert.equal(entries[1].entityId, 200);
    assert.equal(entries[1].stats.traceCount, 3);
    assert.equal(entries[1].stats.durationSeconds, 9);
    assert.equal(entries[1].stats.traversalLengthMeters, 90);
});

test('assigns outer EFN ratings only when exactly one ride exists', () => {
    const ratings = { excitement: 4.9, fear: 2.7, nausea: 0.3 };
    const payload = cobraBlueprint(['GoldFever', 'Mine Train'], [
        client('FlatRide', 41, 0),
        client('Track', 103, 1, trackedRide(0, 1)),
    ]);
    const result = parseCobraSaveMetadata(payload, 'blueprint', ratings);
    assert.deepEqual(result.rides[0].ratings, ratings);
});

test('extracts conservative Planet Zoo counts and transport-ride records', () => {
    const strings = ['Transport_Monorail', 'Savannah Express'];
    const payload = cobraBlueprint(strings, [
        client('HabitatSerialisation', 7, 13),
        client('AnimalSerialisation', 4, 93),
        client('HabitatObject', 3, 428),
        client('Facility', 8, 37),
        client('StaffSerialisation', 6, 24),
        client('FeedingStation', 2, 61),
        client('KeeperHutSerialisation', 3, 5),
        client('DonationBox', 4, 18),
        client('AnimalTalkArea', 1, 3),
        client('Lake', 2, 4),
        client('Paths', 9, 1200),
        client('PlacementPartData', 51, 10494),
        client('Bins', 2, 22),
        client('Benches', 2, 17),
        client('Ride', 5, 1),
        client('Station', 4, 2),
        client('Track', 88, 1, Buffer.concat([
            varUInt(0),
            varUInt(1),
            Buffer.from('c0c801010000f300', 'hex'),
        ])),
    ]);

    const result = parsePlanetZooSaveMetadata(payload, 'park');
    assert.equal(result.animalHabitatCount, 13);
    assert.equal(result.habitatAnimalCount, 93);
    assert.equal(result.habitatObjectCount, 428);
    assert.equal(result.facilityCount, 37);
    assert.equal(result.staffCount, 24);
    assert.equal(result.feedingStationCount, 61);
    assert.equal(result.keeperHutCount, 5);
    assert.equal(result.donationBoxCount, 18);
    assert.equal(result.animalTalkCount, 3);
    assert.equal(result.lakeCount, 4);
    assert.equal(result.pathSegmentCount, 1200);
    assert.equal(result.placedPartCount, 10494);
    assert.equal(result.binCount, 22);
    assert.equal(result.benchCount, 17);
    assert.equal(result.rideCount, 1);
    assert.equal(result.stationCount, 2);
    assert.equal(result.rides[0].typeId, 'Transport_Monorail');
    assert.equal(result.rides[0].name, 'Savannah Express');
    assert.equal(result.rides[0].category, 'Monorail');
    assert.equal(result.rides[0].rideCategory, 'Transport Ride');
});

test('does not expose internal Planet Zoo scenario identifiers as ride names', () => {
    const payload = cobraBlueprint(['Transport_Steam_Train', 'Scenario01_SteamTrain01'], [
        client('Ride', 5, 1),
        client('Track', 88, 1, Buffer.concat([
            varUInt(0),
            varUInt(1),
            Buffer.from('c0c801010000f300', 'hex'),
        ])),
    ]);

    const result = parsePlanetZooSaveMetadata(payload, 'park');
    assert.equal(result.rides[0].typeId, 'Transport_Steam_Train');
    assert.equal(result.rides[0].name, null);
});

test('reads inline legacy ride types and classifies Rage as a coaster', () => {
    const inlineTrackRecord = Buffer.concat([
        varUInt(4000),
        varUInt(1),
        Buffer.from([0xf3]),
        Buffer.from('Rage\0'),
        Buffer.from('f9ffffffffffffffff01', 'hex'),
        varUInt(0),
        Buffer.from([0]),
        Buffer.from('c0c801010000f300', 'hex'),
    ]);
    const payload = cobraBlueprint(["Frost Giant's Reach"], [
        client('FlatRide', 41, 0),
        client('Track', 114, 1, inlineTrackRecord),
    ]);

    const result = parseCobraSaveMetadata(payload, 'park');
    assert.equal(result.rides[0].name, "Frost Giant's Reach");
    assert.equal(result.rides[0].typeId, 'Rage');
    assert.equal(result.rides[0].rideCategory, 'Coaster');
});

test('extracts pools from the older PoolComponentManager layout', () => {
    const poolEntityId = 0x10165;
    const body = Buffer.concat([
        varUInt(3),
        varUInt(148),
        Buffer.from([0x16, 0x29, 0x56, 0x95, 0xe7, 0xc7, 0x46, 1]),
        varUInt(poolEntityId),
        Buffer.from([0, 1]),
        varUInt(poolEntityId),
        Buffer.from([0xc0, 0x64, 0]),
    ]);
    assert.equal(parsePoolCount(body), 1);
});

test('classifies tracked rides into player-facing ride categories', () => {
    const category = (typeId, tags = []) =>
        resolveFrontierRideCategory('tracked', typeId, tags).label;
    assert.equal(category('CC_GoldFever'), 'Coaster');
    assert.equal(category('Monster'), 'Coaster');
    assert.equal(category('Rage'), 'Coaster');
    assert.equal(category('WRC_WideLogFlume'), 'Water Ride');
    assert.equal(category('BodyFlume'), 'Water Slide');
    assert.equal(category('RaftFlume'), 'Water Slide');
    assert.equal(category('PTR_Tracker'), 'Dark Ride');
    assert.equal(category('TR_IronHorse'), 'Transport Ride');
    assert.equal(category('unknown', ['Menu_TrackedRide_Transport']), 'Transport Ride');
});

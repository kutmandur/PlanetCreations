"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const AdmZip = require("adm-zip");
const {
    buildCreationMetadataUpdate,
    extractFrontierMetadata,
    normalizeFrontierMetadata,
    resolveVerifiedRequiredDlcs,
} = require("./frontierMetadata");
const {
    parseCobraSaveMetadata,
    parsePlanetZooSaveMetadata,
    parsePoolCount,
    parseTrackedRideTestDataCache,
} = require("./cobraSaveMetadata");
const {normalizeFrontierDlcCatalog} = require("./frontierDlcResolver");

function wrapFrontierMetadata(value) {
    const payload = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(16);
    header.writeUInt32BE(0xff00fe01, 0);
    header.writeUInt32BE(1, 8);
    header.writeUInt32BE(payload.length, 12);
    return Buffer.concat([header, payload]);
}

test("only verified DLC requirements replace the user's wizard selection", () => {
    const selected = ["User selected DLC"];
    assert.deepEqual(resolveVerifiedRequiredDlcs(selected, {
        requiredDlc: null,
        requiredDlcs: [],
    }), selected);
    assert.deepEqual(resolveVerifiedRequiredDlcs(selected, {
        requiredDlc: 4,
        requiredDlcs: ["Vintage Funfair Ride Pack"],
    }), ["Vintage Funfair Ride Pack"]);
});

test("replacing a creation savefile replaces the complete verified metadata snapshot", () => {
    const previous = {
        payloadSha256: "old-payload",
        metadata: {name: "Old Park", requiredDlc: 0, rideCount: 2},
    };
    const replacement = {
        payloadSha256: "new-payload",
        extractedAt: "new-time",
        metadata: {
            name: "Updated Park",
            requiredDlc: 4,
            requiredDlcs: ["Vintage Funfair Ride Pack"],
            park: {rideCount: 48, placedPartCount: 199034},
        },
    };

    const update = buildCreationMetadataUpdate(["Old selection"], replacement);
    assert.strictEqual(update.verifiedGameMetadata, replacement);
    assert.notStrictEqual(update.verifiedGameMetadata, previous);
    assert.deepEqual(update.requiredDlcs, ["Vintage Funfair Ride Pack"]);
    assert.equal(update.verifiedGameMetadata.metadata.park.rideCount, 48);
    assert.equal(update.verifiedGameMetadata.metadata.rideCount, undefined);
});

function wrapFrontierEntry(payload, version = 2) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const header = Buffer.alloc(16);
    header.writeUInt32BE(0xff00fe01, 0);
    header.writeUInt32BE(version, 8);
    header.writeUInt32BE(body.length, 12);
    return Buffer.concat([header, body]);
}

function varUInt(value) {
    if (value < 0xc0) return Buffer.from([value]);
    if (value < 0x800) {
        return Buffer.from([0xc0 | (value >> 8), value & 0xff]);
    }
    return Buffer.from([
        0xd0 | ((value >> 16) & 0x0f),
        (value >> 8) & 0xff,
        value & 0xff,
    ]);
}

function cobraClient(name, version, count, data = Buffer.alloc(0)) {
    return Buffer.concat([
        Buffer.from("<<ClientClient>>\xf3", "latin1"),
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
        Buffer.from("f9ffffffffffffffff01", "hex"),
        varUInt(nameIndex),
        Buffer.from([0]),
        Buffer.from("c0c801010000f300", "hex"),
    ]);
}

function cobraBlueprint(strings, clients) {
    return Buffer.concat([
        Buffer.from("CobraSavStrings>"),
        varUInt(strings.length),
        ...strings.map((value) => Buffer.concat([
            Buffer.from([0xf3]), Buffer.from(value), Buffer.from([0]),
        ])),
        Buffer.from("WString>\0Hierarchy>\0ClientSizes>\0"),
        ...clients,
    ]);
}

function makeFrontierFile(metadata) {
    const zip = new AdmZip();
    zip.addFile("metadata", wrapFrontierMetadata(metadata));
    zip.addFile("blueprint", Buffer.from("CobraSav"));
    return zip.toBuffer();
}

test("normalizes the public park and blueprint metadata schema", () => {
    const result = normalizeFrontierMetadata({
        sName: "Mine Train",
        bIsModded: false,
        nRequiredDLC: 4,
        tBlueprint: {
            nPlacementCost: 13815503,
            nRunningCost: 574267,
            nTrackedRideCount: 1,
            sRideID: "CC_GoldFever",
            tEFN: {excitement: 4.924, fear: 2.718, nausea: 0.342},
        },
    }, "Mine Train.blpr2");

    assert.equal(result.kind, "blueprint");
    assert.equal(result.blueprint.placementCost, 13815.503);
    assert.equal(result.blueprint.runningCost, 574.267);
    assert.equal(result.blueprint.rideId, "CC_GoldFever");
    assert.equal(result.blueprint.ratings.excitement, 4.924);
    assert.deepEqual(result.requiredDlcs, ["Vintage Funfair Ride Pack"]);
    assert.deepEqual(result.requiredDlcBits, [2]);
});

test("resolves Planet Zoo DLC names while preserving future unknown bits", () => {
    const result = normalizeFrontierMetadata({
        nRequiredDLC: 7 + (2 ** 21),
        tDLCNames: ["Deluxe", "Content1", "Content2", "Content21"],
        tSave: {sParkName: "Future Zoo"},
    }, "Future Zoo.zoo");

    assert.deepEqual(result.requiredDlcs, [
        "Deluxe Upgrade Pack",
        "Arctic Pack",
        "South America Pack",
    ]);
    assert.deepEqual(result.requiredDlcBits, [0, 1, 2, 21]);
    assert.deepEqual(result.unknownDlcBits, [21]);
    assert.equal(result.dlcMappingVersion, 2);
});

test("server metadata normalization prefers the current DLC catalog", () => {
    const dlcCatalog = normalizeFrontierDlcCatalog("planet-zoo", {
        names: ["Future Animal Pack"],
        catalogVersion: 123,
        saveMappings: {
            "Future Animal Pack": {bit: 21, identifiers: ["Content21"]},
        },
    });
    const result = normalizeFrontierMetadata({
        nRequiredDLC: 2 ** 21,
        tDLCNames: ["Content21"],
        tSave: {sParkName: "Future Zoo"},
    }, "Future Zoo.zoo", {dlcCatalog});

    assert.deepEqual(result.requiredDlcs, ["Future Animal Pack"]);
    assert.deepEqual(result.unknownDlcBits, []);
    assert.deepEqual(result.unknownDlcIdentifiers, []);
    assert.equal(result.dlcMappingVersion, 123);
});

test("extracts metadata only when signed identity and extension agree", () => {
    const payload = makeFrontierFile({
        sName: "Server Parsed Blueprint",
        nVersion: 23,
        tBlueprint: {nPlacementCost: 150500},
    });
    const result = extractFrontierMetadata(payload, {
        originalFileName: "Server Parsed.blpr2",
        expectedGameId: "planet-coaster-2",
        expectedFileKind: "blueprint",
    });

    assert.equal(result.name, "Server Parsed Blueprint");
    assert.equal(result.blueprint.placementCost, 150.5);
    assert.throws(() => extractFrontierMetadata(payload, {
        originalFileName: "Server Parsed.blpr2",
        expectedGameId: "planet-zoo",
        expectedFileKind: "blueprint",
    }), /game identifier/);
    assert.throws(() => extractFrontierMetadata(payload, {
        originalFileName: "Server Parsed.blpr2",
        expectedGameId: "planet-coaster-2",
        expectedFileKind: "park",
    }), /file kind/);
});

test("securely extracts per-ride metadata from the signed CobraSav payload", () => {
    const cobraPayload = cobraBlueprint(
        ["BodyFlume", "Body Flume 1", "Body Flume 2"],
        [
            cobraClient("FlatRide", 41, 0),
            cobraClient("PartDataGroupComponentManager", 2, 7),
            cobraClient("PartDataTransformComponentManager", 2, 35),
            cobraClient("PlacementPartData", 97, 42),
            cobraClient("RailComponentManager", 2, 11),
            cobraClient("TrackedRideMotionAnalysis", 2, 9),
            cobraClient("Bins", 2, 3),
            cobraClient("Track", 103, 2, Buffer.concat([
                trackedRide(0, 1),
                trackedRide(0, 2),
            ])),
        ],
    );
    const zip = new AdmZip();
    zip.addFile("metadata", wrapFrontierMetadata({
        sName: "Two Flumes",
        tBlueprint: {
            nTrackedRideCount: 2,
            nFlatRideCount: 0,
            nBuildingCount: 7,
        },
    }));
    zip.addFile("blueprint", wrapFrontierEntry(cobraPayload));

    const result = extractFrontierMetadata(zip.toBuffer(), {
        originalFileName: "Two Flumes.blpr2",
        expectedGameId: "planet-coaster-2",
        expectedFileKind: "blueprint",
    });
    assert.equal(result.blueprint.rideCount, 2);
    assert.equal(result.blueprint.placedPartCount, 42);
    assert.equal(result.blueprint.sceneryPieceCount, 35);
    assert.equal(result.blueprint.railElementCount, 11);
    assert.equal(result.blueprint.trackedRideElementCount, 9);
    assert.equal(result.blueprint.binCount, 3);
    assert.deepEqual(
        result.blueprint.rides.map((ride) => ride.name),
        ["Body Flume 1", "Body Flume 2"],
    );
    assert.ok(result.blueprint.rides.every((ride) => ride.ratings === null));
    assert.ok(result.blueprint.rides.every((ride) =>
        ride.rideCategory === "Water Slide"));
});

test("securely extracts Planet Zoo park, habitat and transport metadata", () => {
    const cobraPayload = cobraBlueprint(
        ["Transport_Steam_Train", "Goodwin Railway"],
        [
            cobraClient("HabitatSerialisation", 7, 6),
            cobraClient("AnimalSerialisation", 4, 35),
            cobraClient("HabitatObject", 3, 210),
            cobraClient("Facility", 8, 18),
            cobraClient("StaffSerialisation", 6, 12),
            cobraClient("PlacementPartData", 51, 3684),
            cobraClient("Paths", 9, 640),
            cobraClient("Ride", 5, 1),
            cobraClient("Station", 4, 2),
            cobraClient("Track", 88, 1, Buffer.concat([
                varUInt(0),
                varUInt(1),
                Buffer.from("c0c801010000f300", "hex"),
            ])),
        ],
    );
    const zip = new AdmZip();
    zip.addFile("metadata", wrapFrontierMetadata({
        sName: "Goodwin House",
        nRequiredDLC: 18,
        tDLCNames: ["Content1", "Content4"],
        tSave: {
            sParkName: "Goodwin House",
            sGameMode: "Career",
            sGeome: "Temperate",
            sGameDifficulty: "Medium",
            nGuestCount: 847,
            nAnimalCount: 45,
            nParkRating: 0.91,
            nGuestHappiness: 0.82,
            nCash: 12500500,
            tStars: [true, true, false],
        },
    }));
    zip.addFile("parkdata", wrapFrontierEntry(cobraPayload));

    const result = extractFrontierMetadata(zip.toBuffer(), {
        originalFileName: "Goodwin House.zoo",
        expectedGameId: "planet-zoo",
        expectedFileKind: "park",
    });
    assert.equal(result.gameId, "planet-zoo");
    assert.equal(result.park.animalCount, 45);
    assert.equal(result.park.animalHabitatCount, 6);
    assert.equal(result.park.habitatAnimalCount, 35);
    assert.equal(result.park.facilityCount, 18);
    assert.equal(result.park.staffCount, 12);
    assert.equal(result.park.placedPartCount, 3684);
    assert.equal(result.park.pathSegmentCount, 640);
    assert.equal(result.park.rides[0].typeId, "Transport_Steam_Train");
    assert.equal(result.park.rides[0].name, "Goodwin Railway");
    assert.deepEqual(result.requiredDlcs, ["Arctic Pack", "Aquatic Pack"]);
    assert.deepEqual(result.requiredDlcBits, [1, 4]);
    assert.deepEqual(result.unknownDlcBits, []);
    assert.equal(result.dlcMappingVersion, 2);
    assert.deepEqual(result.requiredDlcIdentifiers, ["Content1", "Content4"]);
});

test("Planet Zoo parser exposes only conservative manager counts", () => {
    const payload = cobraBlueprint([], [
        cobraClient("HabitatSerialisation", 7, 3),
        cobraClient("AnimalSerialisation", 4, 12),
        cobraClient("ExhibitSerialisation", 4, 999999),
    ]);
    const result = parsePlanetZooSaveMetadata(payload, "park");
    assert.equal(result.animalHabitatCount, 3);
    assert.equal(result.habitatAnimalCount, 12);
    assert.equal(result.exhibitCount, undefined);
    assert.equal(result.species, undefined);
});

test("Planet Zoo parser hides internal scenario identifiers used as ride names", () => {
    const payload = cobraBlueprint(
        ["Transport_Steam_Train", "Scenario01_SteamTrain01"],
        [
            cobraClient("Ride", 5, 1),
            cobraClient("Track", 88, 1, Buffer.concat([
                varUInt(0),
                varUInt(1),
                Buffer.from("c0c801010000f300", "hex"),
            ])),
        ],
    );
    const result = parsePlanetZooSaveMetadata(payload, "park");
    assert.equal(result.rides[0].typeId, "Transport_Steam_Train");
    assert.equal(result.rides[0].name, null);
});

test("extracts a logical pool instead of counting its serialized segments", () => {
    const poolEntityId = 0x10165;
    const poolManager = Buffer.concat([
        varUInt(3),
        varUInt(148),
        Buffer.from([0x16, 0x29, 0x56, 0x95, 0xe7, 0xc7, 0x46, 1]),
        varUInt(poolEntityId),
        Buffer.from([0, 1]),
        varUInt(poolEntityId),
        Buffer.from([0xc0, 0x64, 0]),
    ]);
    assert.equal(parsePoolCount(poolManager), 1);
});

test("securely reads an inline Rage ride type as a coaster", () => {
    const inlineTrackRecord = Buffer.concat([
        varUInt(4000),
        varUInt(1),
        Buffer.from([0xf3]),
        Buffer.from("Rage\0"),
        Buffer.from("f9ffffffffffffffff01", "hex"),
        varUInt(0),
        Buffer.from([0]),
        Buffer.from("c0c801010000f300", "hex"),
    ]);
    const payload = cobraBlueprint(["Frost Giant's Reach"], [
        cobraClient("FlatRide", 41, 0),
        cobraClient("Track", 114, 1, inlineTrackRecord),
    ]);

    const result = parseCobraSaveMetadata(payload, "park");
    assert.equal(result.rides[0].typeId, "Rage");
    assert.equal(result.rides[0].rideCategory, "Coaster");
});

test("accepts mixed untested and multi-trace ride-test cache entries", () => {
    const fields = [];
    for (let field = 0; field < 20; field += 1) {
        const block = Buffer.alloc(4 + 6 * 4);
        const values = field === 1 ? [0, 5, 0, 7, 0, 9] :
            (field === 2 ? [0, 50, 0, 70, 0, 90] :
                (field === 3 ? [0, 10, 0, 12, 0, 14] :
                    [0, 0, 0, 0, 0, 0]));
        values.forEach((value, index) =>
            block.writeFloatLE(value, 4 + index * 4));
        fields.push(block);
    }
    const body = Buffer.concat([
        varUInt(9), varUInt(2),
        varUInt(100), varUInt(0), varUInt(0),
        varUInt(200), varUInt(1), varUInt(2),
        varUInt(3), varUInt(2), varUInt(2), varUInt(2),
        ...fields,
    ]);

    const entries = parseTrackedRideTestDataCache(body, 2);
    assert.deepEqual(entries[0], {entityId: 100, stats: null});
    assert.equal(entries[1].entityId, 200);
    assert.equal(entries[1].stats.traceCount, 3);
    assert.equal(entries[1].stats.durationSeconds, 9);
});

test("rejects a non-Frontier payload instead of trusting client metadata", () => {
    assert.throws(() => extractFrontierMetadata(Buffer.from("not a zip"), {
        originalFileName: "Forged.park2",
        expectedGameId: "planet-coaster-2",
        expectedFileKind: "park",
    }), /Frontier archive/);
});

test("rejects structurally mismatched Frontier metadata", () => {
    const payload = makeFrontierFile({sName: "Not actually a blueprint"});
    assert.throws(() => extractFrontierMetadata(payload, {
        originalFileName: "Forged.blpr2",
        expectedGameId: "planet-coaster-2",
        expectedFileKind: "blueprint",
    }), /blueprint metadata section/);
});

"use strict";

const path = require("path");
const AdmZip = require("adm-zip");
const {resolveFrontierDlcRequirements} = require("./frontierDlcResolver");
const {
    parseCobraSaveMetadata,
    parsePlanetZooSaveMetadata,
} = require("./cobraSaveMetadata");

const FRONTIER_WRAPPER_MAGIC = "ff00fe01";
const VERIFIED_METADATA_SCHEMA_VERSION = 4;
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_CREATION_PAYLOAD_BYTES = 512 * 1024 * 1024;
const GAME_BY_EXTENSION = new Map([
    [".park2", "planet-coaster-2"],
    [".blpr2", "planet-coaster-2"],
    [".prkauto2", "planet-coaster-2"],
    [".zoo", "planet-zoo"],
    [".pzblueprint", "planet-zoo"],
    [".zooauto", "planet-zoo"],
]);
const KIND_BY_EXTENSION = new Map([
    [".park2", "park"],
    [".blpr2", "blueprint"],
    [".prkauto2", "autosave"],
    [".zoo", "park"],
    [".pzblueprint", "blueprint"],
    [".zooauto", "autosave"],
]);

function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value) {
    return Number.isSafeInteger(value) ? value : null;
}

function booleanValue(value) {
    return typeof value === "boolean" ? value : null;
}

function stringValue(value, maximumLength = 500) {
    if (typeof value !== "string") return null;
    const cleaned = Array.from(value)
        .filter((character) => {
            const code = character.charCodeAt(0);
            return code >= 0x20 && code !== 0x7f;
        })
        .join("")
        .trim();
    return cleaned ? cleaned.slice(0, maximumLength) : null;
}

function stringArray(value, maximumItems = 200, maximumItemLength = 100) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => stringValue(item, maximumItemLength))
        .filter(Boolean)
        .slice(0, maximumItems);
}

function unwrapFrontierEntry(buffer, maximumPayloadBytes = MAX_METADATA_BYTES) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 16 ||
        buffer.subarray(0, 4).toString("hex") !== FRONTIER_WRAPPER_MAGIC) {
        throw new Error("The Frontier metadata wrapper is invalid.");
    }
    const payloadLength = buffer.readUInt32BE(12);
    if (payloadLength > maximumPayloadBytes || buffer.length !== payloadLength + 16) {
        throw new Error("The Frontier metadata payload length is invalid.");
    }
    return buffer.subarray(16);
}

function normalizeFrontierMetadata(rawMetadata, originalFileName, options = {}) {
    if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) {
        throw new Error("The Frontier metadata root must be an object.");
    }
    const extension = path.extname(originalFileName).toLowerCase();
    const kind = KIND_BY_EXTENSION.get(extension);
    if (!kind) throw new Error("The Frontier game-file extension is unsupported.");

    const save = rawMetadata.tSave && typeof rawMetadata.tSave === "object" &&
        !Array.isArray(rawMetadata.tSave) ? rawMetadata.tSave : null;
    const blueprint = rawMetadata.tBlueprint &&
        typeof rawMetadata.tBlueprint === "object" &&
        !Array.isArray(rawMetadata.tBlueprint) ? rawMetadata.tBlueprint : null;
    const ratings = blueprint?.tEFN && typeof blueprint.tEFN === "object" &&
        !Array.isArray(blueprint.tEFN) ? blueprint.tEFN : null;
    const utilities = blueprint?.tUtilityParams &&
        typeof blueprint.tUtilityParams === "object" &&
        !Array.isArray(blueprint.tUtilityParams) ? blueprint.tUtilityParams : null;
    const placementCostRaw = integer(blueprint?.nPlacementCost);
    const runningCostRaw = integer(blueprint?.nRunningCost);
    const requiredDlc = integer(rawMetadata.nRequiredDLC);
    const gameId = GAME_BY_EXTENSION.get(extension);
    const requiredDlcIdentifiers = stringArray(rawMetadata.tDLCNames, 100, 100);
    const dlcRequirements = resolveFrontierDlcRequirements(
        gameId,
        requiredDlc,
        requiredDlcIdentifiers,
        options.dlcCatalog || null,
    );
    if (kind === "blueprint" && !blueprint) {
        throw new Error("The Frontier blueprint metadata section is missing.");
    }
    if (["park", "autosave"].includes(kind) && !save) {
        throw new Error("The Frontier park metadata section is missing.");
    }

    const normalized = {
        gameId,
        kind,
        name: stringValue(rawMetadata.sName, 500) ||
            stringValue(save?.sParkName, 500),
        description: stringValue(rawMetadata.sDescription, 5000) || "",
        gameVersion: stringValue(rawMetadata.sGameVersion, 100),
        saveFormatVersion: integer(rawMetadata.nVersion),
        isModded: booleanValue(rawMetadata.bIsModded),
        complexityLimitDisabled:
            booleanValue(rawMetadata.bComplexityLimitDisabledWhenSaved),
        requiredDlc,
        requiredDlcs: dlcRequirements.requiredDlcs,
        requiredDlcBits: dlcRequirements.requiredDlcBits,
        unknownDlcBits: dlcRequirements.unknownDlcBits,
        unknownDlcIdentifiers: dlcRequirements.unknownDlcIdentifiers,
        dlcMappingVersion: dlcRequirements.mappingVersion,
        requiredDlcIdentifiers,
        loadCriticalDlc: integer(rawMetadata.nLoadCriticalDLC),
        tags: stringArray(rawMetadata.tTags),
        park: save ? {
            parkName: stringValue(save.sParkName, 500),
            worldName: stringValue(save.sWorldName, 500),
            biome: stringValue(save.sGeome, 200) ||
                stringValue(save.sBiome, 200),
            gameMode: stringValue(save.sGameMode, 200),
            guestCount: integer(save.nGuestCount),
            guestCap: integer(save.nGuestCap),
            complexity: finiteNumber(save.nComplexity),
            containsCustomContent: booleanValue(save.bContainsUGC),
            isUserGeneratedPark: booleanValue(save.bIsUGCPark),
            ...(gameId === "planet-zoo" ? {
                animalCount: integer(save.nAnimalCount),
                parkRating: finiteNumber(save.nParkRating),
                guestHappiness: finiteNumber(save.nGuestHappiness),
                cashRaw: integer(save.nCash),
                cash: integer(save.nCash) === null ? null : save.nCash / 1000,
                difficulty: stringValue(save.sGameDifficulty, 200),
                continentId: integer(save.nContinentEnum),
                latitude: finiteNumber(save.nLatitude),
                longitude: finiteNumber(save.nLongitude),
                scenarioCode: stringValue(save.sScenarioCode, 500),
                scenarioStarsEarned: Array.isArray(save.tStars) ?
                    save.tStars.filter(Boolean).length : null,
                scenarioStarsTotal: Array.isArray(save.tStars) ?
                    save.tStars.length : null,
                isDiorama: booleanValue(save.bIsDiorama),
            } : {}),
        } : null,
        blueprint: blueprint ? {
            placementCost: placementCostRaw === null ?
                null : placementCostRaw / 1000,
            placementCostRaw,
            runningCost: runningCostRaw === null ?
                null : runningCostRaw / 1000,
            runningCostRaw,
            flatRideCount: integer(blueprint.nFlatRideCount),
            sceneryCount: integer(blueprint.nSceneryCount),
            trackedRideCount: integer(blueprint.nTrackedRideCount),
            buildingCount: integer(blueprint.nBuildingCount),
            rideId: stringValue(blueprint.sRideID, 500),
            ratings: ratings ? {
                excitement: finiteNumber(ratings.excitement),
                fear: finiteNumber(ratings.fear),
                nausea: finiteNumber(ratings.nausea),
            } : null,
            utilities: utilities ? {
                generatedPower: finiteNumber(utilities.generatedPower),
                requiredPower: finiteNumber(utilities.requiredPower),
                generatedWater: finiteNumber(utilities.generatedWater),
                requiredWater: finiteNumber(utilities.requiredWater),
            } : null,
            researchPacks: Array.isArray(blueprint.tResearchPacks) ?
                blueprint.tResearchPacks
                    .filter(Number.isSafeInteger)
                    .slice(0, 100) : [],
        } : null,
    };
    if (!normalized.name) {
        throw new Error("The Frontier creation name is missing.");
    }
    return normalized;
}

function extractFrontierMetadata(payloadBuffer, options) {
    if (!Buffer.isBuffer(payloadBuffer) || payloadBuffer.length <= 0) {
        throw new Error("The verified game-file payload is missing.");
    }
    const originalFileName = options?.originalFileName;
    const extension = path.extname(originalFileName || "").toLowerCase();
    const expectedGameForExtension = GAME_BY_EXTENSION.get(extension);
    const expectedKindForExtension = KIND_BY_EXTENSION.get(extension);
    if (!expectedGameForExtension || !expectedKindForExtension) {
        throw new Error("The verified game-file extension is unsupported.");
    }
    if (options?.expectedGameId !== expectedGameForExtension) {
        throw new Error("The game identifier does not match the game-file extension.");
    }
    if (options?.expectedFileKind !== expectedKindForExtension) {
        throw new Error("The signed file kind does not match the game-file extension.");
    }

    let archive;
    try {
        archive = new AdmZip(payloadBuffer);
    } catch {
        throw new Error("The signed payload is not a valid Frontier archive.");
    }
    const metadataEntry = archive.getEntry("metadata");
    if (!metadataEntry || metadataEntry.isDirectory ||
        !Number.isSafeInteger(metadataEntry.header.size) ||
        metadataEntry.header.size > MAX_METADATA_BYTES + 16) {
        throw new Error("The Frontier metadata entry is missing or too large.");
    }
    let wrappedMetadata;
    try {
        wrappedMetadata = metadataEntry.getData();
    } catch {
        throw new Error("The Frontier metadata entry could not be decompressed.");
    }
    const metadataPayload = unwrapFrontierEntry(wrappedMetadata);
    let rawMetadata;
    try {
        rawMetadata = JSON.parse(metadataPayload.toString("utf8"));
    } catch {
        throw new Error("The Frontier metadata entry is not valid JSON.");
    }
    const normalized = normalizeFrontierMetadata(rawMetadata, originalFileName, options);
    const creationEntry = archive.getEntry(expectedKindForExtension === "blueprint" ?
        "blueprint" : "parkdata");
    if (creationEntry && !creationEntry.isDirectory &&
        Number.isSafeInteger(creationEntry.header.size) &&
        creationEntry.header.size <= MAX_CREATION_PAYLOAD_BYTES + 16) {
        try {
            const creationPayload = unwrapFrontierEntry(
                creationEntry.getData(),
                MAX_CREATION_PAYLOAD_BYTES,
            );
            const inner = expectedGameForExtension === "planet-coaster-2" ?
                parseCobraSaveMetadata(
                    creationPayload,
                    expectedKindForExtension,
                    normalized.blueprint?.ratings,
                    normalized.tags,
                ) : parsePlanetZooSaveMetadata(
                    creationPayload,
                    expectedKindForExtension,
                );
            if (inner && normalized.park) Object.assign(normalized.park, inner);
            if (inner && normalized.blueprint) {
                if (expectedGameForExtension === "planet-zoo") {
                    Object.assign(normalized.blueprint, inner);
                } else {
                    normalized.blueprint.rideCount = inner.rideCount;
                    normalized.blueprint.rides = inner.rides;
                    normalized.blueprint.placedPartCount = inner.placedPartCount;
                    normalized.blueprint.sceneryPieceCount = inner.sceneryPieceCount;
                    normalized.blueprint.serializedGroupCount = inner.buildingCount;
                    normalized.blueprint.railElementCount = inner.railElementCount;
                    normalized.blueprint.trackedRideElementCount =
                        inner.trackedRideElementCount;
                    normalized.blueprint.binCount = inner.binCount;
                    normalized.blueprint.poolCount = inner.poolCount;
                }
            }
        } catch {
            // Preserve verified outer metadata if the optional internal layout is newer.
        }
    }
    return normalized;
}

function resolveVerifiedRequiredDlcs(currentRequiredDlcs, verifiedMetadata) {
    if (!Number.isSafeInteger(verifiedMetadata?.requiredDlc)) {
        return Array.isArray(currentRequiredDlcs) ? currentRequiredDlcs : [];
    }
    return Array.isArray(verifiedMetadata.requiredDlcs) ? verifiedMetadata.requiredDlcs : [];
}

function buildCreationMetadataUpdate(currentRequiredDlcs, verifiedGameMetadata) {
    if (!verifiedGameMetadata || typeof verifiedGameMetadata !== "object" ||
        !verifiedGameMetadata.metadata || typeof verifiedGameMetadata.metadata !== "object") {
        throw new TypeError("Verified game metadata is required for a backup update.");
    }
    return {
        // This object is written in the same Firestore update as the new backup
        // identity. Replacing a savefile therefore always replaces its complete
        // metadata snapshot; no fields from the previous file are merged in.
        verifiedGameMetadata,
        requiredDlcs: resolveVerifiedRequiredDlcs(
            currentRequiredDlcs,
            verifiedGameMetadata.metadata,
        ),
    };
}

module.exports = {
    FRONTIER_WRAPPER_MAGIC,
    VERIFIED_METADATA_SCHEMA_VERSION,
    buildCreationMetadataUpdate,
    extractFrontierMetadata,
    normalizeFrontierMetadata,
    resolveVerifiedRequiredDlcs,
    unwrapFrontierEntry,
};

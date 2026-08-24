const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { resolveFrontierDlcRequirements } = require('./FrontierDlcResolver');
const { parseCobraSaveMetadata, parsePlanetZooSaveMetadata } = require('./CobraSaveMetadata');

const FRONTIER_WRAPPER_MAGIC = 'ff00fe01';
const CLIENT_DATA_MARKER = Buffer.from('<<ClientClient>>\xf3', 'latin1');
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_CREATION_PAYLOAD_BYTES = 512 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
    '.park2', '.blpr2', '.prkauto2',
    '.zoo', '.pzblueprint', '.zooauto',
]);
const MEDIA_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.mp4', '.webm', '.mov', '.mp3', '.ogg',
]);
const inspectionCache = new Map();

function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integer(value) {
    return Number.isSafeInteger(value) ? value : null;
}

function booleanValue(value) {
    return typeof value === 'boolean' ? value : null;
}

function stringValue(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function unwrapFrontierEntry(buffer, maximumPayloadBytes) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 16 ||
        buffer.subarray(0, 4).toString('hex') !== FRONTIER_WRAPPER_MAGIC) {
        throw new Error('Unsupported Frontier entry wrapper.');
    }
    const payloadLength = buffer.readUInt32BE(12);
    if (payloadLength > maximumPayloadBytes || buffer.length !== payloadLength + 16) {
        throw new Error('Invalid Frontier entry payload length.');
    }
    return {
        payload: buffer.subarray(16),
        wrapperVersion: buffer.readUInt32BE(8),
    };
}

function normalizeFrontierMetadata(rawMetadata, filePath = '', options = {}) {
    if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) return null;
    const save = rawMetadata.tSave && typeof rawMetadata.tSave === 'object' ? rawMetadata.tSave : null;
    const blueprint = rawMetadata.tBlueprint && typeof rawMetadata.tBlueprint === 'object' ? rawMetadata.tBlueprint : null;
    const ratings = blueprint?.tEFN && typeof blueprint.tEFN === 'object' ? blueprint.tEFN : null;
    const utilities = blueprint?.tUtilityParams && typeof blueprint.tUtilityParams === 'object' ? blueprint.tUtilityParams : null;
    const extension = path.extname(filePath).toLowerCase();
    const gameId = ['.park2', '.blpr2', '.prkauto2'].includes(extension) ? 'planet-coaster-2' :
        (['.zoo', '.pzblueprint', '.zooauto'].includes(extension) ? 'planet-zoo' : null);
    const kind = ['.prkauto2', '.zooauto'].includes(extension) ? 'autosave' :
        (blueprint || ['.blpr2', '.pzblueprint'].includes(extension) ? 'blueprint' :
            (save || ['.park2', '.zoo'].includes(extension) ? 'park' : 'creation'));
    const placementCostRaw = integer(blueprint?.nPlacementCost);
    const runningCostRaw = integer(blueprint?.nRunningCost);
    const requiredDlc = integer(rawMetadata.nRequiredDLC);
    const requiredDlcIdentifiers = Array.isArray(rawMetadata.tDLCNames) ?
        rawMetadata.tDLCNames.filter(value => typeof value === 'string' && value.length > 0).slice(0, 100) : [];
    const dlcCatalog = options.dlcCatalog || options.dlcCatalogs?.[gameId] || null;
    const dlcRequirements = resolveFrontierDlcRequirements(
        gameId,
        requiredDlc,
        requiredDlcIdentifiers,
        dlcCatalog,
    );

    return {
        gameId,
        kind,
        name: stringValue(rawMetadata.sName) || stringValue(save?.sParkName) || null,
        description: typeof rawMetadata.sDescription === 'string' ? rawMetadata.sDescription : '',
        gameVersion: stringValue(rawMetadata.sGameVersion),
        saveFormatVersion: integer(rawMetadata.nVersion),
        isModded: booleanValue(rawMetadata.bIsModded),
        complexityLimitDisabled: booleanValue(rawMetadata.bComplexityLimitDisabledWhenSaved),
        requiredDlc,
        requiredDlcs: dlcRequirements.requiredDlcs,
        requiredDlcBits: dlcRequirements.requiredDlcBits,
        unknownDlcBits: dlcRequirements.unknownDlcBits,
        unknownDlcIdentifiers: dlcRequirements.unknownDlcIdentifiers,
        dlcMappingVersion: dlcRequirements.mappingVersion,
        requiredDlcIdentifiers,
        loadCriticalDlc: integer(rawMetadata.nLoadCriticalDLC),
        tags: Array.isArray(rawMetadata.tTags) ? rawMetadata.tTags.filter(tag => typeof tag === 'string').slice(0, 200) : [],
        park: save ? {
            parkName: stringValue(save.sParkName),
            worldName: stringValue(save.sWorldName),
            biome: stringValue(save.sGeome) || stringValue(save.sBiome),
            gameMode: stringValue(save.sGameMode),
            guestCount: integer(save.nGuestCount),
            guestCap: integer(save.nGuestCap),
            complexity: finiteNumber(save.nComplexity),
            containsCustomContent: booleanValue(save.bContainsUGC),
            isUserGeneratedPark: booleanValue(save.bIsUGCPark),
            ...(gameId === 'planet-zoo' ? {
                animalCount: integer(save.nAnimalCount),
                parkRating: finiteNumber(save.nParkRating),
                guestHappiness: finiteNumber(save.nGuestHappiness),
                cashRaw: integer(save.nCash),
                cash: integer(save.nCash) === null ? null : save.nCash / 1000,
                difficulty: stringValue(save.sGameDifficulty),
                continentId: integer(save.nContinentEnum),
                latitude: finiteNumber(save.nLatitude),
                longitude: finiteNumber(save.nLongitude),
                scenarioCode: stringValue(save.sScenarioCode),
                scenarioStarsEarned: Array.isArray(save.tStars) ? save.tStars.filter(Boolean).length : null,
                scenarioStarsTotal: Array.isArray(save.tStars) ? save.tStars.length : null,
                isDiorama: booleanValue(save.bIsDiorama),
            } : {}),
        } : null,
        blueprint: blueprint ? {
            placementCost: placementCostRaw === null ? null : placementCostRaw / 1000,
            placementCostRaw,
            runningCost: runningCostRaw === null ? null : runningCostRaw / 1000,
            runningCostRaw,
            flatRideCount: integer(blueprint.nFlatRideCount),
            sceneryCount: integer(blueprint.nSceneryCount),
            trackedRideCount: integer(blueprint.nTrackedRideCount),
            buildingCount: integer(blueprint.nBuildingCount),
            rideId: stringValue(blueprint.sRideID),
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
                blueprint.tResearchPacks.filter(Number.isSafeInteger).slice(0, 100) : [],
        } : null,
    };
}

function readMetadataFromArchive(archive, filePath, options = {}) {
    const entry = archive.getEntry('metadata');
    if (!entry || entry.header.size > MAX_METADATA_BYTES + 16) {
        throw new Error('Frontier metadata entry is missing or too large.');
    }
    const { payload } = unwrapFrontierEntry(entry.getData(), MAX_METADATA_BYTES);
    const raw = JSON.parse(payload.toString('utf8'));
    const normalized = normalizeFrontierMetadata(raw, filePath, options);
    const extension = path.extname(filePath).toLowerCase();
    const creationEntry = archive.getEntry(normalized.kind === 'blueprint' ? 'blueprint' : 'parkdata');
    let creationPayload = null;
    if (creationEntry && creationEntry.header.size <= MAX_CREATION_PAYLOAD_BYTES + 16) {
        try {
            ({ payload: creationPayload } = unwrapFrontierEntry(
                creationEntry.getData(),
                MAX_CREATION_PAYLOAD_BYTES,
            ));
        } catch {
            creationPayload = null;
        }
    }
    let rideAnalysis = null;
    if (creationPayload) {
        try {
            const inner = ['.park2', '.blpr2', '.prkauto2'].includes(extension) ?
                parseCobraSaveMetadata(
                    creationPayload,
                    normalized.kind,
                    normalized.blueprint?.ratings,
                    normalized.tags,
                    { includeRideAnalysis: options.includeRideAnalysis === true && normalized.kind !== 'blueprint' },
                ) : parsePlanetZooSaveMetadata(creationPayload, normalized.kind);
            const { rideAnalysis: extractedRideAnalysis = null, ...innerMetadata } = inner || {};
            rideAnalysis = extractedRideAnalysis;
            if (inner && normalized.park) Object.assign(normalized.park, innerMetadata);
            if (inner && normalized.blueprint) {
                if (normalized.gameId === 'planet-zoo') {
                    Object.assign(normalized.blueprint, innerMetadata);
                } else {
                    normalized.blueprint.rideCount = innerMetadata.rideCount;
                    normalized.blueprint.rides = innerMetadata.rides;
                    normalized.blueprint.placedPartCount = innerMetadata.placedPartCount;
                    normalized.blueprint.sceneryPieceCount = innerMetadata.sceneryPieceCount;
                    normalized.blueprint.serializedGroupCount = innerMetadata.buildingCount;
                    normalized.blueprint.railElementCount = innerMetadata.railElementCount;
                    normalized.blueprint.trackedRideElementCount = innerMetadata.trackedRideElementCount;
                    normalized.blueprint.binCount = innerMetadata.binCount;
                    normalized.blueprint.poolCount = innerMetadata.poolCount;
                }
            }
        } catch {
            // Outer metadata remains useful when Frontier changes the internal CobraSav layout.
        }
    }
    return {
        raw,
        normalized,
        rideAnalysis,
        mediaReferences: options.includeMediaReferences && creationPayload ?
            extractCustomMediaReferences(creationPayload) : undefined,
    };
}

function readFrontierPreview(filePath) {
    if (!SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        throw new Error('Unsupported Frontier creation file extension.');
    }
    const archive = new AdmZip(filePath);
    const entry = archive.getEntry('metathumb') || archive.getEntry('bigscreenshot');
    if (!entry || entry.header.size > MAX_PREVIEW_BYTES + 16) return null;
    const { payload } = unwrapFrontierEntry(entry.getData(), MAX_PREVIEW_BYTES);
    let mimeType = null;
    if (payload.length >= 3 && payload[0] === 0xff && payload[1] === 0xd8 && payload[2] === 0xff) {
        mimeType = 'image/jpeg';
    } else if (payload.length >= 8 && payload.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
        mimeType = 'image/png';
    }
    return mimeType ? `data:${mimeType};base64,${payload.toString('base64')}` : null;
}

function safeMediaName(value) {
    if (typeof value !== 'string') return null;
    const candidate = value.trim();
    if (!candidate || candidate.length > 255 || candidate !== path.basename(candidate) ||
        /[<>:"/\\|?*\u0000-\u001f]/.test(candidate) || !MEDIA_EXTENSIONS.has(path.extname(candidate).toLowerCase())) {
        return null;
    }
    return candidate;
}

function extractCustomMediaReferences(payload) {
    const references = new Map();
    const extensionPattern = /\.(?:jpe?g|png|gif|webp|mp4|webm|mov|mp3|ogg)/ig;
    // CobraSav declares its reusable strings before the first serialized client.
    // Restricting the search to that header avoids copying/scanning tens or even
    // hundreds of megabytes of ride, scenery and simulation data.
    const firstClientOffset = payload.indexOf(CLIENT_DATA_MARKER);
    const referencePayload = firstClientOffset >= 0 ? payload.subarray(0, firstClientOffset) : payload;
    const byteString = referencePayload.toString('latin1');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const reservedByte = byte => byte < 0x20 || byte === 0x7f ||
        [0x3c, 0x3e, 0x3a, 0x22, 0x2f, 0x5c, 0x7c, 0x3f, 0x2a].includes(byte);

    for (const extensionMatch of byteString.matchAll(extensionPattern)) {
        const end = extensionMatch.index + extensionMatch[0].length;
        let boundary = extensionMatch.index;
        while (boundary > 0 && end - boundary < 255 && !reservedByte(referencePayload[boundary - 1])) boundary -= 1;
        const boundaryByte = boundary > 0 ? referencePayload[boundary - 1] : null;
        if (boundaryByte === 0x2f || boundaryByte === 0x5c) {
            const virtualPathPrefix = byteString.slice(Math.max(0, boundary - 64), boundary).toLowerCase();
            const isFrontierMediaPath = virtualPathPrefix.endsWith('/usr/docs/useraudio/') ||
                virtualPathPrefix.endsWith('/usr/docs/usermedia/');
            if (!isFrontierMediaPath) continue;
        }

        for (let start = boundary; start < extensionMatch.index; start += 1) {
            try {
                const candidate = safeMediaName(decoder.decode(referencePayload.subarray(start, end)));
                if (candidate) {
                    references.set(candidate.toLowerCase(), candidate);
                    break;
                }
            } catch {
                // A binary prefix or split UTF-8 code point is skipped until a valid filename begins.
            }
        }
    }
    return [...references.values()].sort((left, right) => left.localeCompare(right));
}

function readCustomMediaReferencesFromArchive(archive) {
    const entry = archive.getEntry('parkdata') || archive.getEntry('blueprint');
    if (!entry) return [];
    if (entry.header.size > MAX_CREATION_PAYLOAD_BYTES + 16) {
        throw new Error('Frontier creation payload is too large to inspect.');
    }
    const { payload } = unwrapFrontierEntry(entry.getData(), MAX_CREATION_PAYLOAD_BYTES);
    return extractCustomMediaReferences(payload);
}

function getCacheRecord(filePath) {
    const stats = fs.statSync(filePath);
    const cached = inspectionCache.get(path.resolve(filePath));
    if (cached && cached.size === stats.size && cached.modifiedAtMs === stats.mtimeMs) return cached;
    const record = { size: stats.size, modifiedAtMs: stats.mtimeMs };
    inspectionCache.set(path.resolve(filePath), record);
    return record;
}

function inspectFrontierFile(filePath, options = {}) {
    if (!SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        throw new Error('Unsupported Frontier creation file extension.');
    }
    const cache = getCacheRecord(filePath);
    if (!cache.metadata || (options.includeMediaReferences && !cache.mediaReferences) ||
        (options.includeRideAnalysis && cache.rideAnalysis === undefined)) {
        const archive = new AdmZip(filePath);
        if (!cache.metadata || (options.includeRideAnalysis && cache.rideAnalysis === undefined)) {
            const parsed = readMetadataFromArchive(archive, filePath, options);
            cache.metadata = { raw: parsed.raw, normalized: parsed.normalized };
            cache.rideAnalysis = parsed.rideAnalysis;
            if (options.includeMediaReferences && parsed.mediaReferences) {
                cache.mediaReferences = parsed.mediaReferences;
            }
        }
        if (options.includeMediaReferences && !cache.mediaReferences) {
            cache.mediaReferences = readCustomMediaReferencesFromArchive(archive);
        }
    }
    return {
        rawMetadata: cache.metadata.raw,
        metadata: cache.metadata.normalized,
        rideAnalysis: options.includeRideAnalysis ? cache.rideAnalysis : undefined,
        mediaReferences: options.includeMediaReferences ? [...(cache.mediaReferences || [])] : undefined,
        source: {
            size: cache.size,
            modifiedAtMs: cache.modifiedAtMs,
        },
    };
}

module.exports = {
    FRONTIER_WRAPPER_MAGIC,
    MEDIA_EXTENSIONS,
    SUPPORTED_EXTENSIONS,
    extractCustomMediaReferences,
    inspectFrontierFile,
    normalizeFrontierMetadata,
    readFrontierPreview,
    safeMediaName,
    unwrapFrontierEntry,
};

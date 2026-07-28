const path = require('path');

const GAME_NAMES = {
    'planet-coaster-2': 'Planet Coaster 2',
    'planet-zoo': 'Planet Zoo',
};

const EXTENSIONS_BY_GAME = {
    'planet-coaster-2': new Set(['.park2', '.blpr2', '.prkauto2']),
    'planet-zoo': new Set(['.zoo', '.pzblueprint', '.zooauto']),
};

const STALE_SAVE_THRESHOLD_MS = 2 * 60 * 1000;

function toModifiedMillis(value) {
    if (value instanceof Date) return value.getTime();
    const milliseconds = new Date(value || 0).getTime();
    return Number.isFinite(milliseconds) ? milliseconds : 0;
}

function portableBasename(value) {
    return path.posix.basename(String(value || '').replaceAll('\\', '/'));
}

function findLatestCollaborationSave(scanResult, gameId, expectedFileName = '', now = Date.now()) {
    const gameName = GAME_NAMES[gameId];
    const supportedExtensions = EXTENSIONS_BY_GAME[gameId];
    if (!gameName || !supportedExtensions) {
        return { success: false, message: 'The collaboration game is not supported.' };
    }

    const expectedName = portableBasename(expectedFileName).toLowerCase();
    const expectedExtension = path.extname(expectedName);
    if (expectedExtension && !supportedExtensions.has(expectedExtension)) {
        return { success: false, message: 'The current collaboration save type does not match its game.' };
    }

    const gameFiles = scanResult?.[gameName] || {};
    const candidates = [
        ...(gameFiles.parks || []),
        ...(gameFiles.blueprints || []),
        ...(gameFiles.autosaves || []),
    ]
        .filter((file) => {
            const extension = path.extname(String(file?.name || file?.path || '')).toLowerCase();
            return supportedExtensions.has(extension) &&
                (!expectedExtension || extension === expectedExtension);
        })
        .map((file) => ({
            ...file,
            modifiedAtMs: toModifiedMillis(file.modifiedAt),
        }))
        .filter((file) => file.path && file.modifiedAtMs > 0);

    if (candidates.length === 0) {
        return {
            success: false,
            message: expectedExtension
                ? `No local ${expectedExtension} save was found for this collaboration.`
                : 'No local save was found for this collaboration.',
        };
    }

    const exactMatches = expectedName
        ? candidates.filter((file) => portableBasename(file.path).toLowerCase() === expectedName)
        : [];
    const pool = exactMatches.length > 0 ? exactMatches : candidates;
    pool.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs || a.path.localeCompare(b.path));

    const latest = pool[0];
    const ageMs = Math.max(0, now - latest.modifiedAtMs);
    return {
        success: true,
        filePath: latest.path,
        fileName: latest.name || portableBasename(latest.path),
        fileSize: Number(latest.size) || 0,
        modifiedAt: new Date(latest.modifiedAtMs).toISOString(),
        modifiedAtMs: latest.modifiedAtMs,
        ageMs,
        stale: ageMs > STALE_SAVE_THRESHOLD_MS,
        nameMatchesExpected: exactMatches.length > 0,
    };
}

module.exports = {
    findLatestCollaborationSave,
    STALE_SAVE_THRESHOLD_MS,
};

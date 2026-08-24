const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { inspectFrontierFile } = require('./FrontierSaveParser');
const { resolveFrontierDlcRequirements } = require('./FrontierDlcResolver');
const { buildRideAnalysisObject } = require('./RideAnalysisObject');

// Informational on-disk schema version. A version change must never discard
// valid per-file entries: reading large Frontier saves is tied exclusively to
// the source file signature. Users can explicitly request a full refresh from
// the Offline Manager when they want every save interpreted by a newer parser.
const METADATA_CACHE_VERSION = 6;
let latestDlcCatalogs = {};

const GAME_CONFIG = {
    'Planet Coaster 2': {
        folderName: 'Planet Coaster 2',
        fileTypes: {
            park: '.park2', 
            blueprint: '.blpr2',
            autosave: '.prkauto2'
        }
    },
    'Planet Zoo': {
        folderName: 'Planet Zoo',
        fileTypes: {
            park: '.zoo',
            blueprint: '.pzblueprint',
            autosave: '.zooauto'
        }
    }
};

// NEU: Eine Liste der erlaubten Dateiendungen für Medien
const ALLOWED_MEDIA_EXTENSIONS = new Set([
    // Bilder
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    // Videos
    '.mp4', '.webm', '.mov',
    // Audio
    '.mp3', '.ogg'
]);

function getDocumentsPath() {
    try {
        return app.getPath('documents');
    } catch (error) {
        console.error("Could not get 'documents' path from Electron:", error);
        return null;
    }
}

function enumerateGamesFromPath(basePath) {
    const results = {};
    if (!basePath || !fs.existsSync(basePath)) {
        console.error(`[FileHandler] Base path does not exist: ${basePath}`);
        return results;
    }

    for (const [gameName, config] of Object.entries(GAME_CONFIG)) {
        const gameResults = { parks: [], blueprints: [], autosaves: [] };
        const gamePath = path.join(basePath, config.folderName);
        if (!fs.existsSync(gamePath)) continue;

        const steamIdFolders = fs.readdirSync(gamePath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() && /^\d{17}$/.test(dirent.name))
            .map(dirent => dirent.name);

        for (const steamId of steamIdFolders) {
            const savesPath = path.join(gamePath, steamId, 'Saves');

            const scanDirectory = (dirPath, fileTypeKey, category) => {
                if (!fs.existsSync(dirPath)) return;
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                    if (file.toLowerCase().endsWith(config.fileTypes[fileTypeKey])) {
                        const filePath = path.join(dirPath, file);
                        const stats = fs.statSync(filePath);
                        const fileRecord = {
                            name: file,
                            path: filePath,
                            size: stats.size,
                            modifiedAt: stats.mtime,
                            modifiedAtMs: stats.mtimeMs,
                        };
                        gameResults[category].push(fileRecord);
                    }
                }
            };

            scanDirectory(savesPath, 'park', 'parks');
            scanDirectory(savesPath, 'blueprint', 'blueprints');
            scanDirectory(savesPath, 'autosave', 'autosaves');
        }
        results[gameName] = gameResults;
    }
    return results;
}

function allGameFiles(results) {
    return Object.values(results).flatMap(game => [
        ...(game.parks || []),
        ...(game.blueprints || []),
        ...(game.autosaves || []),
    ]);
}

function scanGamesFromPath(basePath) {
    const results = enumerateGamesFromPath(basePath);
    for (const fileRecord of allGameFiles(results)) {
        try {
            const inspection = inspectFrontierFile(fileRecord.path);
            fileRecord.frontierMetadata = inspection.metadata;
            fileRecord.metadataStatus = 'ready';
        } catch (error) {
            fileRecord.frontierMetadataError = error.message;
            fileRecord.metadataStatus = 'error';
        }
    }
    return results;
}

function getMetadataCachePath() {
    return path.join(app.getPath('userData'), 'frontier-metadata-cache.json');
}

function normalizeMetadataCache(parsed) {
    const files = parsed?.files && typeof parsed.files === 'object' &&
        !Array.isArray(parsed.files) ? parsed.files : {};
    return {
        version: METADATA_CACHE_VERSION,
        files,
    };
}

function isMetadataCacheEntryFresh(cached, fileRecord, forceMetadataRefresh = false) {
    if (forceMetadataRefresh || !cached) return false;
    if (cached.modifiedAtMs !== fileRecord.modifiedAtMs) return false;
    // Older cache entries did not always persist size. Their exact mtime still
    // remains a valid signature; all newly written entries use both values.
    return typeof cached.size !== 'number' || cached.size === fileRecord.size;
}

function readMetadataCache() {
    try {
        const parsed = JSON.parse(fs.readFileSync(getMetadataCachePath(), 'utf8'));
        return normalizeMetadataCache(parsed);
    } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[FileHandler] Metadata cache could not be read:', error.message);
    }
    return normalizeMetadataCache(null);
}

function writeMetadataCacheFile(cachePath, cache) {
    const temporaryPath = `${cachePath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(normalizeMetadataCache(cache)));
        fs.renameSync(temporaryPath, cachePath);
    } catch (error) {
        try { fs.unlinkSync(temporaryPath); } catch (_cleanupError) { /* best effort */ }
        throw error;
    }
}

function writeMetadataCache(cache) {
    writeMetadataCacheFile(getMetadataCachePath(), cache);
}

function getRideAnalysisCachePath(cacheKey) {
    const fileName = crypto.createHash('sha256').update(cacheKey).digest('hex');
    return path.join(app.getPath('userData'), 'frontier-ride-analysis', `${fileName}.pcride`);
}

function writeRideAnalysisCache(cacheKey, source) {
    const cachePath = getRideAnalysisCachePath(cacheKey);
    const built = buildRideAnalysisObject(source);
    if (!built) {
        try { fs.unlinkSync(cachePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return { schemaVersion: 1, available: false };
    }
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const temporaryPath = `${cachePath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, built.objectBuffer);
        fs.renameSync(temporaryPath, cachePath);
    } catch (error) {
        try { fs.unlinkSync(temporaryPath); } catch (_cleanupError) { /* best effort */ }
        throw error;
    }
    return built.summary;
}

function isPathInside(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pruneMissingCacheEntries(cache, basePath, currentCacheKeys) {
    let changed = false;
    for (const cacheKey of Object.keys(cache.files)) {
        if (!isPathInside(basePath, cacheKey) || currentCacheKeys.has(cacheKey)) continue;
        delete cache.files[cacheKey];
        try { fs.unlinkSync(getRideAnalysisCachePath(cacheKey)); } catch (error) {
            if (error.code !== 'ENOENT') console.warn('[FileHandler] Orphaned ride-analysis cache could not be removed:', error.message);
        }
        changed = true;
    }
    if (changed) writeMetadataCache(cache);
}

function indexGamesFromPath(basePath, options = {}) {
    if (options.dlcCatalogs && typeof options.dlcCatalogs === 'object') {
        latestDlcCatalogs = options.dlcCatalogs;
    }
    const results = enumerateGamesFromPath(basePath);
    const cache = readMetadataCache();
    const pending = [];
    const fileRecords = allGameFiles(results);
    const currentCacheKeys = new Set(fileRecords.map(fileRecord => path.resolve(fileRecord.path)));
    pruneMissingCacheEntries(cache, basePath, currentCacheKeys);
    for (const fileRecord of fileRecords) {
        const cacheKey = path.resolve(fileRecord.path);
        const cached = cache.files[cacheKey];
        const isFresh = isMetadataCacheEntryFresh(
            cached,
            fileRecord,
            options.forceMetadataRefresh === true,
        );
        if (cached?.metadata) {
            const requirements = resolveFrontierDlcRequirements(
                cached.metadata.gameId,
                cached.metadata.requiredDlc,
                cached.metadata.requiredDlcIdentifiers,
                latestDlcCatalogs[cached.metadata.gameId],
            );
            fileRecord.frontierMetadata = {
                ...cached.metadata,
                requiredDlcs: requirements.requiredDlcs,
                requiredDlcBits: requirements.requiredDlcBits,
                unknownDlcBits: requirements.unknownDlcBits,
                unknownDlcIdentifiers: requirements.unknownDlcIdentifiers,
                dlcMappingVersion: requirements.mappingVersion,
            };
        }
        if (Array.isArray(cached?.mediaReferences)) fileRecord.customMediaReferences = cached.mediaReferences;
        if (isFresh && cached?.rideAnalysis?.available) fileRecord.rideAnalysisSummary = cached.rideAnalysis;
        if (isFresh) {
            fileRecord.frontierMetadataError = cached.error || undefined;
            fileRecord.metadataStatus = cached.error ? 'error' : 'ready';
        } else {
            fileRecord.metadataStatus = 'pending';
            pending.push({
                path: fileRecord.path,
                size: fileRecord.size,
                modifiedAtMs: fileRecord.modifiedAtMs,
                cacheKey,
            });
        }
    }
    return { results, pending, cache };
}

function saveMetadataInspection(cache, pendingFile, inspection, error = null) {
    const previous = cache.files[pendingFile.cacheKey];
    let rideAnalysis = previous?.rideAnalysis || null;
    if (inspection || error) {
        try {
            rideAnalysis = inspection && !error ?
                writeRideAnalysisCache(pendingFile.cacheKey, inspection.rideAnalysis) :
                writeRideAnalysisCache(pendingFile.cacheKey, null);
        } catch (rideAnalysisError) {
            console.warn('[FileHandler] Ride-analysis cache could not be written:', rideAnalysisError.message);
            rideAnalysis = null;
        }
    }
    cache.files[pendingFile.cacheKey] = {
        size: pendingFile.size,
        modifiedAtMs: pendingFile.modifiedAtMs,
        inspectedAt: new Date().toISOString(),
        metadata: inspection?.metadata || previous?.metadata || null,
        mediaReferences: inspection?.mediaReferences || previous?.mediaReferences || [],
        rideAnalysis,
        error: error ? String(error.message || error) : null,
    };
    writeMetadataCache(cache);
    return cache.files[pendingFile.cacheKey];
}

function inspectFrontierFileInWorker(filePath, dlcCatalogs = latestDlcCatalogs, options = {}) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'FrontierMetadataWorker.js'), {
            workerData: {
                filePath,
                dlcCatalogs,
                includeRideAnalysis: options.includeRideAnalysis === true,
            },
        });
        let settled = false;
        worker.once('message', message => {
            settled = true;
            if (message?.error) reject(new Error(message.error));
            else resolve(message?.inspection);
        });
        worker.once('error', error => {
            settled = true;
            reject(error);
        });
        worker.once('exit', code => {
            if (!settled && code !== 0) reject(new Error(`Metadata worker stopped with exit code ${code}.`));
            else if (!settled) reject(new Error('Metadata worker stopped before returning a result.'));
        });
    });
}

async function loadOrCreateRideAnalysis(filePath, dlcCatalogs = latestDlcCatalogs) {
    const resolvedPath = path.resolve(filePath);
    const stats = fs.statSync(resolvedPath);
    const pendingFile = {
        path: resolvedPath,
        size: stats.size,
        modifiedAtMs: stats.mtimeMs,
        cacheKey: resolvedPath,
    };
    const cache = readMetadataCache();
    const cached = cache.files[pendingFile.cacheKey];
    if (isMetadataCacheEntryFresh(cached, pendingFile) && cached?.rideAnalysis?.available) {
        try {
            return fs.readFileSync(getRideAnalysisCachePath(pendingFile.cacheKey));
        } catch (error) {
            if (error.code !== 'ENOENT') console.warn('[FileHandler] Cached ride analysis could not be read:', error.message);
        }
    }
    if (isMetadataCacheEntryFresh(cached, pendingFile) && cached?.rideAnalysis?.available === false) {
        return null;
    }

    const inspection = await inspectFrontierFileInWorker(
        resolvedPath,
        dlcCatalogs,
        { includeRideAnalysis: true },
    );
    const persisted = saveMetadataInspection(cache, pendingFile, inspection);
    if (!persisted.rideAnalysis?.available) return null;
    return fs.readFileSync(getRideAnalysisCachePath(pendingFile.cacheKey));
}

// *** ANGEPASSTE FUNKTION ***
function scanAllMediaFiles() {
    const documentsPath = getDocumentsPath();
    if (!documentsPath) return [];

    const frontierPath = path.join(documentsPath, 'Frontier Developments');
    if (!fs.existsSync(frontierPath)) return [];

    let allMediaFiles = [];

    for (const gameName in GAME_CONFIG) {
        const gamePath = path.join(frontierPath, GAME_CONFIG[gameName].folderName);
        const mediaFoldersToScan = ['UserMedia', 'UserAudio'];

        for (const mediaFolder of mediaFoldersToScan) {
            const fullPath = path.join(gamePath, mediaFolder);
            if (fs.existsSync(fullPath)) {
                const files = fs.readdirSync(fullPath);
                for (const file of files) {
                    const fileExtension = path.extname(file).toLowerCase();
                    // Prüfe, ob die Dateiendung in unserer Liste der erlaubten Endungen ist.
                    if (!file.startsWith('.') && ALLOWED_MEDIA_EXTENSIONS.has(fileExtension)) {
                        allMediaFiles.push({
                            name: file,
                            path: path.join(fullPath, file),
                            game: gameName
                        });
                    }
                }
            }
        }
    }
    return allMediaFiles;
}

module.exports = {
    METADATA_CACHE_VERSION,
    indexGamesFromPath,
    inspectFrontierFileInWorker,
    isMetadataCacheEntryFresh,
    loadOrCreateRideAnalysis,
    normalizeMetadataCache,
    saveMetadataInspection,
    scanGamesFromPath,
    scanAllMediaFiles,
    writeMetadataCacheFile,
};

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { inspectFrontierFile } = require('./FrontierSaveParser');

const METADATA_CACHE_VERSION = 4;

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

function readMetadataCache() {
    try {
        const parsed = JSON.parse(fs.readFileSync(getMetadataCachePath(), 'utf8'));
        if (parsed?.version === METADATA_CACHE_VERSION && parsed.files && typeof parsed.files === 'object') {
            return parsed;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[FileHandler] Metadata cache could not be read:', error.message);
    }
    return { version: METADATA_CACHE_VERSION, files: {} };
}

function writeMetadataCache(cache) {
    const cachePath = getMetadataCachePath();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache));
}

function indexGamesFromPath(basePath, options = {}) {
    const results = enumerateGamesFromPath(basePath);
    const cache = readMetadataCache();
    const pending = [];
    for (const fileRecord of allGameFiles(results)) {
        const cacheKey = path.resolve(fileRecord.path);
        const cached = cache.files[cacheKey];
        const isFresh = !options.forceMetadataRefresh && cached?.modifiedAtMs === fileRecord.modifiedAtMs;
        if (cached?.metadata) fileRecord.frontierMetadata = cached.metadata;
        if (Array.isArray(cached?.mediaReferences)) fileRecord.customMediaReferences = cached.mediaReferences;
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
    cache.files[pendingFile.cacheKey] = {
        size: pendingFile.size,
        modifiedAtMs: pendingFile.modifiedAtMs,
        inspectedAt: new Date().toISOString(),
        metadata: inspection?.metadata || previous?.metadata || null,
        mediaReferences: inspection?.mediaReferences || previous?.mediaReferences || [],
        error: error ? String(error.message || error) : null,
    };
    writeMetadataCache(cache);
    return cache.files[pendingFile.cacheKey];
}

function inspectFrontierFileInWorker(filePath) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'FrontierMetadataWorker.js'), {
            workerData: { filePath },
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
    indexGamesFromPath,
    inspectFrontierFileInWorker,
    saveMetadataInspection,
    scanGamesFromPath,
    scanAllMediaFiles,
};

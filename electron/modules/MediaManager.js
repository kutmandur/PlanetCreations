const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MEDIA_MANIFEST_FORMAT = 'PlanetCreationsMediaManifest';
const MEDIA_MANIFEST_VERSION = 2;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg']);
const USER_MEDIA_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.mp4', '.webm', '.mov',
]);
const ALLOWED_MEDIA_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...USER_MEDIA_EXTENSIONS]);

const MASTER_MEDIA_LIBRARY = path.join(app.getPath('userData'), 'MasterMediaLibrary');
const MEDIA_OBJECTS_DIR = path.join(MASTER_MEDIA_LIBRARY, 'objects');
const MEDIA_MANIFESTS_DIR = path.join(app.getPath('userData'), 'MediaManifests');
const CONFLICT_VAULT_DIR = path.join(app.getPath('userData'), 'MediaConflictVault');
const ACTIVE_MEDIA_MANIFEST_PATH = path.join(app.getPath('userData'), 'active_media_manifest.json');

function initializeDirectories() {
    for (const directory of [MASTER_MEDIA_LIBRARY, MEDIA_OBJECTS_DIR, MEDIA_MANIFESTS_DIR, CONFLICT_VAULT_DIR]) {
        fs.mkdirSync(directory, { recursive: true });
    }
}

function sha256Buffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
    return sha256Buffer(fs.readFileSync(filePath));
}

function safeLogicalName(fileName) {
    return typeof fileName === 'string' && fileName.length > 0 && fileName.length <= 255 &&
        fileName === path.basename(fileName) && !fileName.includes('/') && !fileName.includes('\\') &&
        fileName !== '.' && fileName !== '..';
}

function getTargetForFile(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    if (AUDIO_EXTENSIONS.has(extension)) return 'UserAudio';
    if (USER_MEDIA_EXTENSIONS.has(extension)) return 'UserMedia';
    throw new Error(`Unsupported custom-media type: ${extension || '(none)'}`);
}

function hasExpectedMediaSignature(fileName, buffer) {
    const extension = path.extname(fileName).toLowerCase();
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
    if (extension === '.mp3') {
        return buffer.subarray(0, 3).toString('ascii') === 'ID3' ||
            (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    }
    if (extension === '.ogg') return buffer.subarray(0, 4).toString('ascii') === 'OggS';
    if (extension === '.jpg' || extension === '.jpeg') {
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (extension === '.png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (extension === '.gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
    if (extension === '.webp') {
        return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
            buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    if (extension === '.mp4' || extension === '.mov') {
        return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    }
    if (extension === '.webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    return false;
}

function getGameIdFromPath(savePath) {
    const lowerPath = String(savePath || '').toLowerCase();
    if (lowerPath.includes('planet coaster 2')) return 'planet-coaster-2';
    if (lowerPath.includes('planet zoo')) return 'planet-zoo';
    return null;
}

function getGameName(gameId, savePath = '') {
    if (gameId === 'planet-coaster-2' || String(savePath).includes('Planet Coaster 2')) return 'Planet Coaster 2';
    if (gameId === 'planet-zoo' || String(savePath).includes('Planet Zoo')) return 'Planet Zoo';
    throw new Error('Could not determine the game for this media set.');
}

function getManifestKey(saveOrBlueprintPath) {
    const normalized = path.resolve(saveOrBlueprintPath).toLowerCase();
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

function getManifestPath(saveOrBlueprintPath) {
    return path.join(MEDIA_MANIFESTS_DIR, `${getManifestKey(saveOrBlueprintPath)}.json`);
}

function getLegacyManifestPath(saveOrBlueprintPath) {
    return path.join(MEDIA_MANIFESTS_DIR, `${path.basename(saveOrBlueprintPath)}.json`);
}

function getObjectPath(asset) {
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256 || '')) throw new Error('Invalid media SHA-256.');
    const extension = path.extname(asset.logicalName).toLowerCase();
    if (!ALLOWED_MEDIA_EXTENSIONS.has(extension)) throw new Error('Unsupported media extension.');
    return path.join(MEDIA_OBJECTS_DIR, `${asset.sha256}${extension}`);
}

function readJson(filePath, fallback = null) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Could not read JSON file ${filePath}:`, error);
    }
    return fallback;
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
    fs.renameSync(temporaryPath, filePath);
}

function validatePortableManifest(manifest) {
    if (!manifest || manifest.format !== MEDIA_MANIFEST_FORMAT ||
        manifest.formatVersion !== MEDIA_MANIFEST_VERSION ||
        typeof manifest.mediaSetId !== 'string' || !Array.isArray(manifest.assets)) {
        throw new Error('Unsupported media manifest.');
    }
    const names = new Set();
    for (const asset of manifest.assets) {
        const lowerName = String(asset?.logicalName || '').toLowerCase();
        if (!safeLogicalName(asset?.logicalName) || names.has(lowerName) ||
            !/^[a-f0-9]{64}$/.test(asset?.sha256 || '') ||
            !Number.isSafeInteger(asset?.size) || asset.size < 0 ||
            asset.target !== getTargetForFile(asset.logicalName)) {
            throw new Error('The media manifest contains invalid or duplicate assets.');
        }
        names.add(lowerName);
    }
    return manifest;
}

function storeAssetBuffer(asset, buffer) {
    validatePortableManifest({
        format: MEDIA_MANIFEST_FORMAT,
        formatVersion: MEDIA_MANIFEST_VERSION,
        mediaSetId: crypto.randomUUID(),
        assets: [asset],
    });
    if (!Buffer.isBuffer(buffer) || buffer.length !== asset.size || sha256Buffer(buffer) !== asset.sha256 ||
        !hasExpectedMediaSignature(asset.logicalName, buffer)) {
        throw new Error(`Media integrity check failed for ${asset.logicalName}.`);
    }
    initializeDirectories();
    const objectPath = getObjectPath(asset);
    if (!fs.existsSync(objectPath)) {
        const temporaryPath = `${objectPath}.${crypto.randomUUID()}.tmp`;
        fs.writeFileSync(temporaryPath, buffer);
        fs.renameSync(temporaryPath, objectPath);
    }
    return objectPath;
}

function normalizeLegacySnapshot(snapshot, savePath) {
    if (!snapshot || !Array.isArray(snapshot.files)) return null;
    initializeDirectories();
    const assets = [];
    const seen = new Set();
    for (const unsafeName of snapshot.files) {
        const logicalName = path.basename(String(unsafeName));
        const lowerName = logicalName.toLowerCase();
        if (!safeLogicalName(logicalName) || seen.has(lowerName)) continue;
        const legacyPath = path.join(MASTER_MEDIA_LIBRARY, logicalName);
        if (!fs.existsSync(legacyPath) || !fs.statSync(legacyPath).isFile()) continue;
        const buffer = fs.readFileSync(legacyPath);
        const asset = {
            logicalName,
            sha256: sha256Buffer(buffer),
            size: buffer.length,
            target: getTargetForFile(logicalName),
        };
        storeAssetBuffer(asset, buffer);
        assets.push(asset);
        seen.add(lowerName);
    }
    const manifest = {
        format: MEDIA_MANIFEST_FORMAT,
        formatVersion: MEDIA_MANIFEST_VERSION,
        mediaSetId: crypto.randomUUID(),
        gameId: getGameIdFromPath(savePath),
        localSavePath: savePath,
        assets,
    };
    writeJsonAtomic(getManifestPath(savePath), manifest);
    return manifest;
}

function getSnapshot(saveOrBlueprintPath) {
    try {
        initializeDirectories();
        let snapshot = readJson(getManifestPath(saveOrBlueprintPath));
        if (!snapshot) {
            const legacy = readJson(getLegacyManifestPath(saveOrBlueprintPath));
            snapshot = normalizeLegacySnapshot(legacy, saveOrBlueprintPath);
        }
        if (!snapshot) return null;
        validatePortableManifest(snapshot);
        return { ...snapshot, files: snapshot.assets.map(asset => asset.logicalName) };
    } catch (error) {
        console.error('Failed to get media snapshot:', error);
        return null;
    }
}

function createOrUpdateSnapshot(saveOrBlueprintPath, mediaFilePaths) {
    try {
        initializeDirectories();
        const current = getSnapshot(saveOrBlueprintPath);
        const assets = [];
        const seen = new Set();
        for (const mediaPath of mediaFilePaths || []) {
            if (!fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
                throw new Error(`Media file not found: ${path.basename(mediaPath)}`);
            }
            const logicalName = path.basename(mediaPath);
            const lowerName = logicalName.toLowerCase();
            if (!safeLogicalName(logicalName) || seen.has(lowerName)) {
                throw new Error(`Duplicate or invalid media target name: ${logicalName}`);
            }
            getTargetForFile(logicalName);
            const buffer = fs.readFileSync(mediaPath);
            if (!hasExpectedMediaSignature(logicalName, buffer)) {
                throw new Error(`The file content does not match its media extension: ${logicalName}`);
            }
            const asset = {
                logicalName,
                sha256: sha256Buffer(buffer),
                size: buffer.length,
                target: getTargetForFile(logicalName),
            };
            storeAssetBuffer(asset, buffer);
            assets.push(asset);
            seen.add(lowerName);
        }
        const manifest = {
            format: MEDIA_MANIFEST_FORMAT,
            formatVersion: MEDIA_MANIFEST_VERSION,
            mediaSetId: current?.mediaSetId || crypto.randomUUID(),
            gameId: getGameIdFromPath(saveOrBlueprintPath),
            localSavePath: saveOrBlueprintPath,
            assets,
        };
        writeJsonAtomic(getManifestPath(saveOrBlueprintPath), manifest);
        return true;
    } catch (error) {
        console.error('Failed to create media manifest:', error);
        return false;
    }
}

function createPortableManifest(saveOrBlueprintPath, fallbackMediaSetId = crypto.randomUUID()) {
    const snapshot = getSnapshot(saveOrBlueprintPath);
    const manifest = {
        format: MEDIA_MANIFEST_FORMAT,
        formatVersion: MEDIA_MANIFEST_VERSION,
        mediaSetId: snapshot?.mediaSetId || fallbackMediaSetId,
        assets: (snapshot?.assets || []).map(({ logicalName, sha256, size, target }) => ({
            logicalName, sha256, size, target,
        })),
    };
    return validatePortableManifest(manifest);
}

function savePortableManifestForCreation(saveOrBlueprintPath, portableManifest) {
    const manifest = validatePortableManifest(JSON.parse(JSON.stringify(portableManifest)));
    writeJsonAtomic(getManifestPath(saveOrBlueprintPath), {
        ...manifest,
        gameId: getGameIdFromPath(saveOrBlueprintPath),
        localSavePath: saveOrBlueprintPath,
    });
    return true;
}

function hasMediaSnapshot(saveOrBlueprintPath) {
    return fs.existsSync(getManifestPath(saveOrBlueprintPath)) || fs.existsSync(getLegacyManifestPath(saveOrBlueprintPath));
}

function readActiveManifest() {
    const active = readJson(ACTIVE_MEDIA_MANIFEST_PATH, null);
    if (active?.formatVersion === 2 && active.activeSets) return active;
    return { formatVersion: 2, activeSets: {} };
}

function writeActiveManifest(manifest) {
    writeJsonAtomic(ACTIVE_MEDIA_MANIFEST_PATH, manifest);
}

function getGameMediaPaths(gameName) {
    const gamePath = path.join(app.getPath('documents'), 'Frontier Developments', gameName);
    return {
        userMedia: path.join(gamePath, 'UserMedia'),
        userAudio: path.join(gamePath, 'UserAudio'),
    };
}

function targetPathForAsset(mediaPaths, asset) {
    const directory = asset.target === 'UserAudio' ? mediaPaths.userAudio : mediaPaths.userMedia;
    return path.join(directory, asset.logicalName);
}

function installMedia(saveOrBlueprintPath, options = {}) {
    const staged = [];
    const replaced = [];
    const installedPaths = [];
    try {
        const snapshot = getSnapshot(saveOrBlueprintPath);
        if (!snapshot) return { success: false, status: 'missing', message: 'No media manifest exists for this creation.' };
        if (snapshot.assets.length === 0) return { success: true, status: 'installed', conflicts: [] };
        const gameName = getGameName(snapshot.gameId, saveOrBlueprintPath);
        const mediaPaths = getGameMediaPaths(gameName);
        const conflicts = [];

        for (const asset of snapshot.assets) {
            const sourcePath = getObjectPath(asset);
            if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size !== asset.size || sha256File(sourcePath) !== asset.sha256) {
                return { success: false, status: 'missing', message: `Checked media data is missing: ${asset.logicalName}` };
            }
            const destinationPath = targetPathForAsset(mediaPaths, asset);
            if (fs.existsSync(destinationPath)) {
                const existingHash = sha256File(destinationPath);
                if (existingHash !== asset.sha256) {
                    conflicts.push({ logicalName: asset.logicalName, existingSha256: existingHash, requestedSha256: asset.sha256 });
                }
            }
        }
        if (conflicts.length > 0 && !options.parkConflicts) {
            return { success: false, status: 'conflict', conflicts };
        }

        const parked = [];
        for (const asset of snapshot.assets) {
            const sourcePath = getObjectPath(asset);
            const destinationPath = targetPathForAsset(mediaPaths, asset);
            fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
            if (fs.existsSync(destinationPath) && sha256File(destinationPath) === asset.sha256) continue;

            const stagePath = `${destinationPath}.${crypto.randomUUID()}.pc-stage`;
            fs.copyFileSync(sourcePath, stagePath);
            staged.push(stagePath);
            if (fs.existsSync(destinationPath)) {
                const existingBuffer = fs.readFileSync(destinationPath);
                const existingHash = sha256Buffer(existingBuffer);
                const extension = path.extname(asset.logicalName).toLowerCase();
                const vaultName = `${existingHash}${extension}`;
                const vaultPath = path.join(CONFLICT_VAULT_DIR, vaultName);
                if (!fs.existsSync(vaultPath)) fs.writeFileSync(vaultPath, existingBuffer);
                const oldPath = `${destinationPath}.${crypto.randomUUID()}.pc-old`;
                fs.renameSync(destinationPath, oldPath);
                replaced.push({ destinationPath, oldPath });
                parked.push({
                    logicalName: asset.logicalName,
                    target: asset.target,
                    sha256: existingHash,
                    size: existingBuffer.length,
                    vaultName,
                });
            }
            fs.renameSync(stagePath, destinationPath);
            staged.splice(staged.indexOf(stagePath), 1);
            installedPaths.push(destinationPath);
        }
        const active = readActiveManifest();
        active.activeSets[getManifestKey(saveOrBlueprintPath)] = {
            savePath: saveOrBlueprintPath,
            mediaSetId: snapshot.mediaSetId,
            gameId: snapshot.gameId,
            assets: snapshot.assets,
            parked,
            installedAt: new Date().toISOString(),
        };
        writeActiveManifest(active);
        for (const replacement of replaced) {
            if (fs.existsSync(replacement.oldPath)) fs.unlinkSync(replacement.oldPath);
        }
        return { success: true, status: 'installed', conflicts };
    } catch (error) {
        for (const stagePath of staged) {
            if (fs.existsSync(stagePath)) fs.unlinkSync(stagePath);
        }
        for (const installedPath of installedPaths.reverse()) {
            if (fs.existsSync(installedPath)) fs.unlinkSync(installedPath);
        }
        for (const replacement of replaced.reverse()) {
            if (fs.existsSync(replacement.oldPath)) {
                fs.renameSync(replacement.oldPath, replacement.destinationPath);
            }
        }
        console.error('[MediaManager] Failed to install media:', error);
        return { success: false, status: 'error', message: error.message };
    }
}

function uninstallMedia(saveOrBlueprintPath) {
    try {
        const active = readActiveManifest();
        const saveKey = getManifestKey(saveOrBlueprintPath);
        const installedSet = active.activeSets[saveKey];
        if (!installedSet) return { success: true, status: 'uninstalled' };
        const mediaPaths = getGameMediaPaths(getGameName(installedSet.gameId, saveOrBlueprintPath));
        const otherSets = Object.entries(active.activeSets)
            .filter(([key]) => key !== saveKey)
            .map(([, value]) => value);

        for (const asset of installedSet.assets) {
            const destinationPath = targetPathForAsset(mediaPaths, asset);
            const shared = otherSets.some(set => set.gameId === installedSet.gameId &&
                set.assets.some(other => other.target === asset.target &&
                    other.logicalName.toLowerCase() === asset.logicalName.toLowerCase() &&
                    other.sha256 === asset.sha256));
            if (!shared && fs.existsSync(destinationPath) && sha256File(destinationPath) === asset.sha256) {
                fs.unlinkSync(destinationPath);
            }
        }
        for (const parked of installedSet.parked || []) {
            const destinationPath = targetPathForAsset(mediaPaths, parked);
            if (!fs.existsSync(destinationPath)) {
                const vaultPath = path.join(CONFLICT_VAULT_DIR, path.basename(parked.vaultName));
                if (fs.existsSync(vaultPath) && sha256File(vaultPath) === parked.sha256) {
                    fs.copyFileSync(vaultPath, destinationPath);
                }
            }
        }
        delete active.activeSets[saveKey];
        writeActiveManifest(active);
        return { success: true, status: 'uninstalled' };
    } catch (error) {
        console.error('[MediaManager] Failed to uninstall media:', error);
        return { success: false, status: 'error', message: error.message };
    }
}

function getMediaSetStatus(saveOrBlueprintPath) {
    try {
        const active = readActiveManifest();
        const installedSet = active.activeSets[getManifestKey(saveOrBlueprintPath)];
        if (!installedSet) return 'uninstalled';
        const mediaPaths = getGameMediaPaths(getGameName(installedSet.gameId, saveOrBlueprintPath));
        let matching = 0;
        for (const asset of installedSet.assets) {
            const destinationPath = targetPathForAsset(mediaPaths, asset);
            if (fs.existsSync(destinationPath) && sha256File(destinationPath) === asset.sha256) matching++;
        }
        if (matching === installedSet.assets.length) return 'installed';
        if (matching === 0) return 'conflict';
        return 'partial';
    } catch (error) {
        return 'error';
    }
}

function findManifestPathsByMediaSetId(mediaSetId) {
    initializeDirectories();
    const matches = [];
    for (const fileName of fs.readdirSync(MEDIA_MANIFESTS_DIR)) {
        if (!fileName.endsWith('.json')) continue;
        const manifestPath = path.join(MEDIA_MANIFESTS_DIR, fileName);
        const manifest = readJson(manifestPath);
        if (manifest?.mediaSetId === mediaSetId) matches.push(manifestPath);
    }
    return matches;
}

async function deleteCreationMedia(filePath, mode) {
    const snapshot = getSnapshot(filePath);
    if (!snapshot) return { success: false, message: 'No media snapshot found for this creation.' };
    const referencedHashes = new Set();
    if (mode !== 'force') {
        for (const manifestFile of fs.readdirSync(MEDIA_MANIFESTS_DIR)) {
            const manifestPath = path.join(MEDIA_MANIFESTS_DIR, manifestFile);
            if (manifestPath === getManifestPath(filePath) || !manifestFile.endsWith('.json')) continue;
            const other = readJson(manifestPath);
            for (const asset of other?.assets || []) referencedHashes.add(asset.sha256);
        }
    }
    let deletedCount = 0;
    for (const asset of snapshot.assets) {
        if (mode === 'force' || !referencedHashes.has(asset.sha256)) {
            const objectPath = getObjectPath(asset);
            if (fs.existsSync(objectPath)) {
                fs.unlinkSync(objectPath);
                deletedCount++;
            }
        }
    }
    if (fs.existsSync(getManifestPath(filePath))) fs.unlinkSync(getManifestPath(filePath));
    return { success: true, message: `Media link removed. ${deletedCount} unused checked file(s) were deleted.` };
}

module.exports = {
    MEDIA_MANIFEST_FORMAT,
    MEDIA_MANIFEST_VERSION,
    ALLOWED_MEDIA_EXTENSIONS,
    MASTER_MEDIA_LIBRARY,
    createOrUpdateSnapshot,
    createPortableManifest,
    savePortableManifestForCreation,
    getSnapshot,
    installMedia,
    uninstallMedia,
    getMediaSetStatus,
    getManifestPath,
    getGameMediaPaths,
    hasMediaSnapshot,
    deleteCreationMedia,
    getObjectPath,
    storeAssetBuffer,
    findManifestPathsByMediaSetId,
    validatePortableManifest,
};

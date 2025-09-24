const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// --- Verzeichnisstruktur ---
const MASTER_MEDIA_LIBRARY = path.join(app.getPath('userData'), 'MasterMediaLibrary');
const MEDIA_MANIFESTS_DIR = path.join(app.getPath('userData'), 'MediaManifests');
const ACTIVE_MEDIA_MANIFEST_PATH = path.join(app.getPath('userData'), 'active_media_manifest.json');

// --- Interne Hilfsfunktionen ---
function initializeDirectories() {
    fs.mkdirSync(MASTER_MEDIA_LIBRARY, { recursive: true });
    fs.mkdirSync(MEDIA_MANIFESTS_DIR, { recursive: true });
}

function getManifestPath(saveOrBlueprintPath) {
    const baseName = path.basename(saveOrBlueprintPath);
    return path.join(MEDIA_MANIFESTS_DIR, `${baseName}.json`);
}

function readActiveManifest() {
    if (fs.existsSync(ACTIVE_MEDIA_MANIFEST_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(ACTIVE_MEDIA_MANIFEST_PATH));
        } catch (error) {
            console.error("Error reading active media manifest:", error);
            return {};
        }
    }
    return {};
}

function writeActiveManifest(manifest) {
    try {
        fs.writeFileSync(ACTIVE_MEDIA_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    } catch (error) { console.error("Error writing active media manifest:", error); }
}

function getGameMediaPaths(gameName) {
    const documentsPath = app.getPath('documents');
    const gamePath = path.join(documentsPath, 'Frontier Developments', gameName);
    return {
        userMedia: path.join(gamePath, 'UserMedia'),
        userAudio: path.join(gamePath, 'UserAudio'),
    };
}

// --- Exportierte Hauptfunktionen ---
function createOrUpdateSnapshot(saveOrBlueprintPath, mediaFilePaths) {
    try {
        initializeDirectories();
        const manifestPath = getManifestPath(saveOrBlueprintPath);
        const fileNames = mediaFilePaths.map(p => path.basename(p));
        const manifest = {
            originalSavePath: saveOrBlueprintPath,
            files: fileNames,
        };
        for (const mediaPath of mediaFilePaths) {
            const fileName = path.basename(mediaPath);
            const destPath = path.join(MASTER_MEDIA_LIBRARY, fileName);
            if (!fs.existsSync(destPath)) {
                fs.copyFileSync(mediaPath, destPath);
            }
        }
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        return true;
    } catch (error) {
        console.error("Failed to create media manifest:", error);
        return false;
    }
}

function getSnapshot(saveOrBlueprintPath) {
    try {
        const manifestPath = getManifestPath(saveOrBlueprintPath);
        if (fs.existsSync(manifestPath)) {
            return JSON.parse(fs.readFileSync(manifestPath));
        }
    } catch (error) { console.error("Failed to get snapshot:", error); }
    return null;
}

// ✅ NEUE FUNKTION: Prüft, ob ein Snapshot für eine Datei existiert.
function hasMediaSnapshot(saveOrBlueprintPath) {
    const manifestPath = getManifestPath(saveOrBlueprintPath);
    return fs.existsSync(manifestPath);
}

function installMedia(saveOrBlueprintPath) {
    try {
        const snapshot = getSnapshot(saveOrBlueprintPath);
        if (!snapshot || !snapshot.files || snapshot.files.length === 0) return true;
        const saveKey = path.basename(saveOrBlueprintPath);
        const gameName = saveOrBlueprintPath.includes('Planet Coaster 2') ? 'Planet Coaster 2' : 'Planet Zoo';
        const mediaPaths = getGameMediaPaths(gameName);
        for (const fileName of snapshot.files) {
            const sourcePath = path.join(MASTER_MEDIA_LIBRARY, fileName);
            if (!fs.existsSync(sourcePath)) {
                 console.error(`[MediaManager] CRITICAL: File ${fileName} not found in Master Library! Skipping.`);
                 continue;
            }
            const destDir = fileName.endsWith('.ogg') || fileName.endsWith('.mp3') ? mediaPaths.userAudio : mediaPaths.userMedia;
            const destPath = path.join(destDir, fileName);
            fs.mkdirSync(destDir, { recursive: true });
            if (!fs.existsSync(destPath)) {
                fs.copyFileSync(sourcePath, destPath);
            }
        }
        const manifest = readActiveManifest();
        manifest[saveKey] = snapshot.files;
        writeActiveManifest(manifest);
        return true;
    } catch (error) {
        console.error(`[MediaManager] Failed to install media:`, error);
        return false;
    }
}

function uninstallMedia(saveOrBlueprintPath) {
    try {
        const manifest = readActiveManifest();
        const saveKey = path.basename(saveOrBlueprintPath);
        if (!manifest[saveKey]) return true;
        const filesToPotentiallyRemove = manifest[saveKey];
        delete manifest[saveKey];
        const allOtherActiveFiles = Object.values(manifest).flat();
        for (const fileToRemove of filesToPotentiallyRemove) {
            if (!allOtherActiveFiles.includes(fileToRemove)) {
                for (const gameName of ['Planet Coaster 2', 'Planet Zoo']) {
                    const mediaPaths = getGameMediaPaths(gameName);
                    const livePathMedia = path.join(mediaPaths.userMedia, fileToRemove);
                    const livePathAudio = path.join(mediaPaths.userAudio, fileToRemove);
                    if (fs.existsSync(livePathMedia)) fs.unlinkSync(livePathMedia);
                    if (fs.existsSync(livePathAudio)) fs.unlinkSync(livePathAudio);
                }
            }
        }
        writeActiveManifest(manifest);
        return true;
    } catch (error) {
        console.error(`[MediaManager] Failed to uninstall media:`, error);
        return false;
    }
}

function getMediaSetStatus(saveOrBlueprintPath) {
    const manifest = readActiveManifest();
    const saveKey = path.basename(saveOrBlueprintPath);
    return manifest[saveKey] ? 'installed' : 'uninstalled';
}

async function deleteCreationMedia(filePath, mode) {
    const snapshot = getSnapshot(filePath);
    if (!snapshot) {
        return { success: false, message: 'No media snapshot found for this creation.' };
    }

    const filesInManifest = snapshot.files;
    let filesToDelete = [];

    if (mode === 'force') {
        filesToDelete = filesInManifest;
    } else if (mode === 'safe') {
        // Find all media files used by OTHER snapshots
        const otherManifestPaths = fs.readdirSync(MEDIA_MANIFESTS_DIR)
            .map(f => path.join(MEDIA_MANIFESTS_DIR, f))
            .filter(f => f !== getManifestPath(filePath));

        const otherMediaFiles = new Set();
        for (const manifestPath of otherManifestPaths) {
            try {
                const otherSnap = JSON.parse(fs.readFileSync(manifestPath));
                otherSnap.files.forEach(file => otherMediaFiles.add(file));
            } catch (e) { console.error(`Could not parse manifest ${manifestPath}`, e); }
        }

        filesToDelete = filesInManifest.filter(file => !otherMediaFiles.has(file));
    }

    // Delete the identified media files from the Master Library
    let deletedCount = 0;
    for (const fileName of filesToDelete) {
        try {
            const mediaPath = path.join(MASTER_MEDIA_LIBRARY, fileName);
            if (fs.existsSync(mediaPath)) {
                fs.unlinkSync(mediaPath);
                deletedCount++;
            }
        } catch (e) { console.error(`Failed to delete media file ${fileName}`, e); }
    }

    // Finally, delete the creation's manifest file
    try {
        fs.unlinkSync(getManifestPath(filePath));
    } catch(e) { console.error(`Failed to delete manifest for ${filePath}`, e); }

    return { success: true, message: `Media link removed. ${deletedCount} unused media file(s) were deleted from the library.` };
}

module.exports = {
    createOrUpdateSnapshot, getSnapshot, installMedia, uninstallMedia,
    getMediaSetStatus, getManifestPath, getGameMediaPaths, hasMediaSnapshot,
    deleteCreationMedia, // ✅ NEU
};
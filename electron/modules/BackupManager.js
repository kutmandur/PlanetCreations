const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const {
    createPortableManifest,
    savePortableManifestForCreation,
    getSnapshot,
    getObjectPath,
    storeAssetBuffer,
    findManifestPathsByMediaSetId,
} = require('./MediaManager');
const {
    FORMAT_NAME,
    FORMAT_VERSION,
    MAX_BACKUP_SIZE_BYTES,
    sha256,
    inspectCreationPackage,
    inspectMediaPackage,
} = require('./BackupFormat');
const { responseToBuffer } = require('./ResponseBuffer');

const API_BASE_URL = 'https://us-central1-planetcreationsdotnet.cloudfunctions.net/api';
const ALLOWED_GAME_EXTENSIONS = ['.park2', '.zoo', '.blpr2', '.pzblueprint', '.prkauto2', '.zooauto'];
const MAX_UPLOAD_SIZE_BYTES = MAX_BACKUP_SIZE_BYTES;
const backupCategoryMap = {
    '.park2': 'Parks', '.zoo': 'Parks',
    '.blpr2': 'Blueprints', '.pzblueprint': 'Blueprints',
    '.prkauto2': 'Auto Save', '.zooauto': 'Auto Save',
};
const gameByExtension = {
    '.park2': 'planet-coaster-2', '.blpr2': 'planet-coaster-2', '.prkauto2': 'planet-coaster-2',
    '.zoo': 'planet-zoo', '.pzblueprint': 'planet-zoo', '.zooauto': 'planet-zoo',
};
const kindByExtension = {
    '.park2': 'park', '.zoo': 'park',
    '.blpr2': 'blueprint', '.pzblueprint': 'blueprint',
    '.prkauto2': 'autosave', '.zooauto': 'autosave',
};
const gameFolderById = {
    'planet-coaster-2': 'Planet Coaster 2',
    'planet-zoo': 'Planet Zoo',
};
let cachedPublicKey = null;
let publicKeyFetchedAt = 0;

function isValidGameFile(filePath) {
    return ALLOWED_GAME_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function getBackupBaseDir(app) {
    return path.join(app.getPath('documents'), 'PlanetCreations');
}

function isPathInside(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readJson(filePath, fallback = {}) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Could not read ${filePath}:`, error);
    }
    return fallback;
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
    fs.renameSync(temporaryPath, filePath);
}

function getTargetRegistryPath(app) {
    return path.join(app.getPath('userData'), 'backup_targets.json');
}

function registerLocalTarget(app, packageId, targetPath) {
    if (!packageId || !targetPath) return;
    const registryPath = getTargetRegistryPath(app);
    const registry = readJson(registryPath, {});
    registry[packageId] = { targetPath, updatedAt: new Date().toISOString() };
    writeJsonAtomic(registryPath, registry);
}

function getRegisteredTarget(app, packageId) {
    if (!packageId) return null;
    const registered = readJson(getTargetRegistryPath(app), {})[packageId]?.targetPath;
    return typeof registered === 'string' ? registered : null;
}

function getDirectInstallRegistryPath(app) {
    return path.join(app.getPath('userData'), 'direct_install_targets.json');
}

function getDirectInstallTarget(app, creationId) {
    if (!creationId) return null;
    const registered = readJson(getDirectInstallRegistryPath(app), {})[creationId]?.targetPath;
    return typeof registered === 'string' ? registered : null;
}

function registerDirectInstallTarget(app, creationId, targetPath, metadata) {
    if (!creationId || !targetPath) return;
    const registryPath = getDirectInstallRegistryPath(app);
    const registry = readJson(registryPath, {});
    registry[creationId] = {
        targetPath,
        packageId: metadata?.packageId || null,
        payloadSha256: metadata?.payloadSha256 || null,
        updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(registryPath, registry);
}

function getWorkshopRegistryPath(app) {
    return path.join(app.getPath('userData'), 'workshop_packages.json');
}

function getWorkshopPackageRecord(app, packagePath) {
    return readJson(getWorkshopRegistryPath(app), {})[path.resolve(packagePath)] || null;
}

function registerWorkshopPackage(app, packagePath, creationId, details = {}) {
    const registryPath = getWorkshopRegistryPath(app);
    const registry = readJson(registryPath, {});
    registry[path.resolve(packagePath)] = {
        ...registry[path.resolve(packagePath)],
        creationId,
        title: details.title || registry[path.resolve(packagePath)]?.title || null,
        previewPath: details.previewPath || registry[path.resolve(packagePath)]?.previewPath || null,
        downloadedAt: new Date().toISOString(),
    };
    writeJsonAtomic(registryPath, registry);
}

async function downloadWorkshopPreview(previewUrl, destinationBasePath) {
    if (!previewUrl) return null;
    let currentUrl = new URL(previewUrl);
    for (let redirects = 0; redirects <= 3; redirects++) {
        if (currentUrl.protocol !== 'https:' || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(currentUrl.hostname)) {
            throw new Error('The workshop preview URL is not allowed.');
        }
        const response = await fetch(currentUrl.toString(), { redirect: 'manual', size: 8 * 1024 * 1024 });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw new Error('The workshop preview redirect is invalid.');
            currentUrl = new URL(location, currentUrl);
            continue;
        }
        if (!response.ok) throw new Error(`Workshop preview download failed (${response.status}).`);
        const mimeType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
        const extensionByMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
        const extension = extensionByMime[mimeType];
        if (!extension) throw new Error('The workshop preview is not a supported image.');
        const buffer = await responseToBuffer(response);
        if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error('The workshop preview is empty or too large.');
        const signatureMatches =
            (mimeType === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8) ||
            (mimeType === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
            (mimeType === 'image/gif' && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) ||
            (mimeType === 'image/webp' && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP');
        if (!signatureMatches) throw new Error('The workshop preview content does not match its image type.');
        const previewPath = `${destinationBasePath}${extension}`;
        fs.writeFileSync(previewPath, buffer);
        return previewPath;
    }
    throw new Error('The workshop preview redirected too many times.');
}

async function archiveWorkshopPackage(app, sourcePath, creationId, details = {}) {
    const verification = await verifyBackup(sourcePath);
    if (verification.status !== 'verified' || verification.metadata?.packageType !== 'creation') {
        throw new Error(verification.error || 'Only signed and verified creation packages can be archived.');
    }
    const workshopDir = path.join(getBackupBaseDir(app), 'Workshop');
    fs.mkdirSync(workshopDir, { recursive: true });
    const originalName = path.basename(verification.metadata.originalFileName || 'creation');
    const baseName = path.basename(originalName, path.extname(originalName)).replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeCreationId = creationId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destinationPath = path.join(workshopDir, `${baseName}_${safeCreationId}.PlanetCreations`);
    fs.copyFileSync(sourcePath, destinationPath);
    let previewPath = null;
    try {
        previewPath = await downloadWorkshopPreview(details.previewUrl, path.join(workshopDir, `${baseName}_${safeCreationId}.preview`));
    } catch (error) {
        console.warn(`Could not download workshop preview for ${creationId}:`, error.message);
    }
    registerWorkshopPackage(app, destinationPath, creationId, { title: details.title, previewPath });
    return destinationPath;
}

function getLatestGameFileMtime(directoryPath, gameId) {
    const allowedExtensions = new Set(Object.entries(gameByExtension)
        .filter(([, mappedGameId]) => mappedGameId === gameId)
        .map(([extension]) => extension));
    let latest = 0;
    try {
        for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
            if (!entry.isFile() || !allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
            latest = Math.max(latest, fs.statSync(path.join(directoryPath, entry.name)).mtimeMs);
        }
    } catch (error) {
        console.warn(`Could not inspect game save directory ${directoryPath}:`, error.message);
    }
    return latest;
}

function resolveGameSavesDirectory(frontierPath, gameId) {
    const gameFolder = gameFolderById[gameId];
    if (!gameFolder || !frontierPath || !fs.existsSync(frontierPath)) {
        throw new Error('The configured Frontier game folder could not be found.');
    }
    const gamePath = path.join(frontierPath, gameFolder);
    if (!fs.existsSync(gamePath)) throw new Error(`${gameFolder} was not found in the configured Frontier folder.`);

    const candidates = fs.readdirSync(gamePath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d{17}$/.test(entry.name))
        .map((entry) => path.join(gamePath, entry.name, 'Saves'))
        .filter((savesPath) => fs.existsSync(savesPath))
        .map((savesPath) => ({
            savesPath,
            latestFileMtime: getLatestGameFileMtime(savesPath, gameId),
        }))
        .sort((a, b) => b.latestFileMtime - a.latestFileMtime || a.savesPath.localeCompare(b.savesPath));

    if (candidates.length === 0) throw new Error(`No local ${gameFolder} save profile was found.`);
    return candidates[0].savesPath;
}

function createCollisionSafeTarget(directoryPath, originalFileName) {
    const safeName = path.basename(originalFileName);
    const extension = path.extname(safeName);
    const baseName = path.basename(safeName, extension);
    const initialPath = path.join(directoryPath, safeName);
    if (!fs.existsSync(initialPath)) return initialPath;

    let index = 1;
    while (index < 1000) {
        const suffix = index === 1 ? ' (PlanetCreations)' : ` (PlanetCreations ${index})`;
        const candidate = path.join(directoryPath, `${baseName}${suffix}${extension}`);
        if (!fs.existsSync(candidate)) return candidate;
        index++;
    }
    throw new Error('Could not create a collision-free game file name.');
}

async function fetchPublicKey() {
    if (cachedPublicKey && Date.now() - publicKeyFetchedAt < 60 * 60 * 1000) return cachedPublicKey;
    const response = await fetch(`${API_BASE_URL}/getPublicKey`);
    if (!response.ok) throw new Error('Could not fetch the PlanetCreations verification key.');
    cachedPublicKey = await response.text();
    publicKeyFetchedAt = Date.now();
    return cachedPublicKey;
}

async function signMetadata(metadata, idToken, appCheckToken = null) {
    const response = await fetch(`${API_BASE_URL}/signBackup`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
            ...(appCheckToken ? {
                'X-Firebase-AppCheck': appCheckToken,
            } : {}),
        },
        body: JSON.stringify({ metadata }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.metadata) throw new Error(data.error || 'The server could not sign this package.');
    return data.metadata;
}

function readBasicMetadata(packagePath) {
    const zip = new AdmZip(packagePath);
    const entry = zip.getEntry('metadata.json');
    if (!entry || entry.header.size > 64 * 1024) throw new Error('metadata.json is missing or too large.');
    return JSON.parse(entry.getData().toString('utf8'));
}

async function inspectWithVerification(packagePath) {
    const metadata = readBasicMetadata(packagePath);
    if (metadata.format !== FORMAT_NAME || metadata.formatVersion !== FORMAT_VERSION) {
        return { legacy: true, metadata, signatureStatus: 'unsigned' };
    }
    let publicKey = null;
    if (metadata.isSigned) {
        try {
            publicKey = await fetchPublicKey();
        } catch (error) {
            const inspector = metadata.packageType === 'media' ? inspectMediaPackage : inspectCreationPackage;
            const result = inspector(packagePath, ALLOWED_GAME_EXTENSIONS, null);
            return { ...result, signatureStatus: 'unverified', verificationError: error.message };
        }
    }
    return metadata.packageType === 'media' ?
        inspectMediaPackage(packagePath, ALLOWED_GAME_EXTENSIONS, publicKey) :
        inspectCreationPackage(packagePath, ALLOWED_GAME_EXTENSIONS, publicKey);
}

async function verifyBackup(backupZipPath) {
    try {
        const inspection = await inspectWithVerification(backupZipPath);
        return { status: inspection.signatureStatus, metadata: inspection.metadata, inspection };
    } catch (error) {
        console.error('Backup verification failed:', error);
        return { status: 'invalid', error: error.message };
    }
}

async function validateBackupForUpload(backupFilePath) {
    try {
        if (!fs.existsSync(backupFilePath) || path.extname(backupFilePath).toLowerCase() !== '.planetcreations') {
            return { valid: false, error: 'Only existing .PlanetCreations packages can be uploaded.' };
        }
        const fileSize = fs.statSync(backupFilePath).size;
        if (fileSize <= 0 || fileSize > MAX_UPLOAD_SIZE_BYTES) {
            return { valid: false, error: 'The creation package must be between 1 byte and 300 MB.', fileSize };
        }
        const result = await verifyBackup(backupFilePath);
        if (result.status !== 'verified' || result.metadata?.packageType !== 'creation') {
            const reason = result.status === 'unverified' ?
                'The signing service is currently unreachable, so this package cannot be safely uploaded.' :
                (result.error || 'Only verified version-2 creation packages can be uploaded.');
            return { valid: false, error: reason, fileSize };
        }
        return { valid: true, isSigned: true, fileSize, metadata: result.metadata };
    } catch (error) {
        return { valid: false, error: `Validation failed: ${error.message}` };
    }
}

async function backupAllCreations(app, files, note, isSigned, idToken, appCheckToken = null) {
    let successCount = 0;
    for (const file of files) {
        if (await createBackup(
            app,
            file.path,
            note,
            isSigned,
            idToken,
            null,
            appCheckToken,
        )) successCount++;
    }
    return { success: true, message: `${successCount} of ${files.length} creations backed up successfully.` };
}

function deleteBackup(app, backupFilePath) {
    try {
        if (!isPathInside(getBackupBaseDir(app), backupFilePath) && !isPathInside(app.getPath('temp'), backupFilePath)) {
            return { success: false, message: 'Error: Invalid backup path.' };
        }
        if (!fs.existsSync(backupFilePath)) return { success: false, message: 'Error: Backup file not found.' };
        const resolvedPath = path.resolve(backupFilePath);
        const workshopRegistryPath = getWorkshopRegistryPath(app);
        const workshopRegistry = readJson(workshopRegistryPath, {});
        const workshopRecord = workshopRegistry[resolvedPath];
        if (workshopRecord?.previewPath && fs.existsSync(workshopRecord.previewPath)) fs.unlinkSync(workshopRecord.previewPath);
        if (workshopRecord) {
            delete workshopRegistry[resolvedPath];
            writeJsonAtomic(workshopRegistryPath, workshopRegistry);
        }
        fs.unlinkSync(backupFilePath);
        return { success: true, message: 'Backup deleted successfully.' };
    } catch (error) {
        return { success: false, message: `An error occurred: ${error.message}` };
    }
}

async function createBackup(
    app,
    sourceFilePath,
    note,
    isSigned = false,
    idToken = null,
    targetDir = null,
    appCheckToken = null,
) {
    if (!fs.existsSync(sourceFilePath) || !isValidGameFile(sourceFilePath)) {
        throw new Error(`Only game files (${ALLOWED_GAME_EXTENSIONS.join(', ')}) can be backed up.`);
    }
    const extension = path.extname(sourceFilePath).toLowerCase();
    const fileName = path.basename(sourceFilePath);
    const payloadBuffer = fs.readFileSync(sourceFilePath);
    if (payloadBuffer.length <= 0 || payloadBuffer.length > MAX_BACKUP_SIZE_BYTES) {
        throw new Error('The game file must be between 1 byte and 300 MB.');
    }
    const packageId = crypto.randomUUID();
    const portableManifest = createPortableManifest(sourceFilePath);
    const manifestBuffer = Buffer.from(JSON.stringify(portableManifest, null, 2));
    let metadata = {
        format: FORMAT_NAME,
        formatVersion: FORMAT_VERSION,
        packageType: 'creation',
        packageId,
        mediaSetId: portableManifest.mediaSetId,
        gameId: gameByExtension[extension],
        fileKind: kindByExtension[extension],
        originalFileName: fileName,
        payloadPath: `payload/${fileName}`,
        payloadSize: payloadBuffer.length,
        payloadSha256: sha256(payloadBuffer),
        mediaManifestSha256: sha256(manifestBuffer),
        note: String(note || '').slice(0, 1000),
        createdAt: new Date().toISOString(),
        isSigned: false,
    };
    if (isSigned) {
        if (!idToken) throw new Error('Login is required for signed packages.');
        metadata = await signMetadata(metadata, idToken, appCheckToken);
    }

    const category = backupCategoryMap[extension] || 'Misc';
    const backupDir = targetDir || path.join(getBackupBaseDir(app), category);
    fs.mkdirSync(backupDir, { recursive: true });
    const baseName = path.basename(fileName, extension).replace(/[^a-zA-Z0-9._-]/g, '_');
    const version = targetDir ? `upload-${packageId}` : `v${Date.now()}`;
    const destinationPath = path.join(backupDir, `${baseName}_${version}.PlanetCreations`);
    const zip = new AdmZip();
    zip.addFile(metadata.payloadPath, payloadBuffer);
    zip.addFile('media_manifest.json', manifestBuffer);
    zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));
    zip.writeZip(destinationPath);
    registerLocalTarget(app, packageId, sourceFilePath);
    return destinationPath;
}

function listAllBackups(app) {
    const allBackups = {};
    const baseDir = getBackupBaseDir(app);
    for (const category of ['Parks', 'Blueprints', 'Auto Save', 'Custom Media', 'Workshop', 'Misc']) {
        const categoryDir = path.join(baseDir, category);
        if (!fs.existsSync(categoryDir)) continue;
        for (const fileName of fs.readdirSync(categoryDir).filter(file => file.toLowerCase().endsWith('.planetcreations'))) {
            try {
                const archivePath = path.join(categoryDir, fileName);
                const metadata = readBasicMetadata(archivePath);
                const originalFileName = path.basename(metadata.originalFileName || 'unknown');
                const saveName = path.basename(originalFileName, path.extname(originalFileName));
                const packageType = metadata.packageType || metadata.backupType || 'creation';
                const backupData = {
                    ...metadata,
                    backupType: packageType,
                    backupDate: metadata.createdAt || metadata.backupDate,
                    category,
                    filePath: archivePath,
                    originalFilePath: getRegisteredTarget(app, metadata.packageId) || metadata.originalFilePath || null,
                    gameId: metadata.gameId || gameByExtension[path.extname(originalFileName).toLowerCase()] || null,
                };
                if (category === 'Workshop') {
                    const record = getWorkshopPackageRecord(app, archivePath);
                    const targetPath = record?.creationId ? getDirectInstallTarget(app, record.creationId) : null;
                    backupData.creationId = record?.creationId || null;
                    backupData.workshopTitle = record?.title || null;
                    backupData.previewPath = record?.previewPath && fs.existsSync(record.previewPath) ? record.previewPath : null;
                    backupData.installTargetPath = targetPath;
                    backupData.installStatus = targetPath && fs.existsSync(targetPath) ?
                        (metadata.payloadSha256 && sha256(fs.readFileSync(targetPath)) !== metadata.payloadSha256 ? 'modified' : 'installed') :
                        'not-installed';
                }
                if (!allBackups[saveName]) allBackups[saveName] = [];
                allBackups[saveName].push(backupData);
            } catch (error) {
                console.error(`Could not read backup ${fileName}:`, error);
            }
        }
    }
    for (const backups of Object.values(allBackups)) {
        backups.sort((a, b) => new Date(b.backupDate) - new Date(a.backupDate));
    }
    return allBackups;
}

async function backupCreationMedia(
    app,
    sourceFilePath,
    note,
    isSigned = false,
    idToken = null,
    appCheckToken = null,
) {
    try {
        const snapshot = getSnapshot(sourceFilePath);
        if (!snapshot?.assets?.length) return { success: false, message: 'No media is associated with this creation.' };
        const portableManifest = createPortableManifest(sourceFilePath, snapshot.mediaSetId);
        const manifestBuffer = Buffer.from(JSON.stringify(portableManifest, null, 2));
        const packageId = crypto.randomUUID();
        let metadata = {
            format: FORMAT_NAME,
            formatVersion: FORMAT_VERSION,
            packageType: 'media',
            packageId,
            mediaSetId: portableManifest.mediaSetId,
            gameId: snapshot.gameId || gameByExtension[path.extname(sourceFilePath).toLowerCase()],
            originalFileName: path.basename(sourceFilePath),
            mediaManifestSha256: sha256(manifestBuffer),
            assetCount: portableManifest.assets.length,
            assetsTotalSize: portableManifest.assets.reduce((total, asset) => total + asset.size, 0),
            note: String(note || '').slice(0, 1000),
            createdAt: new Date().toISOString(),
            isSigned: false,
        };
        if (isSigned) {
            if (!idToken) throw new Error('Login is required for signed media packages.');
            metadata = await signMetadata(metadata, idToken, appCheckToken);
        }
        const destinationDirectory = path.join(getBackupBaseDir(app), 'Custom Media');
        fs.mkdirSync(destinationDirectory, { recursive: true });
        const destinationPath = path.join(destinationDirectory, `CustomMedia-${packageId}.PlanetCreations`);
        const zip = new AdmZip();
        zip.addFile('media_manifest.json', manifestBuffer);
        for (const asset of portableManifest.assets) {
            const extension = path.extname(asset.logicalName).toLowerCase();
            zip.addLocalFile(getObjectPath(asset), 'assets', `${asset.sha256}${extension}`);
        }
        zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));
        zip.writeZip(destinationPath);
        return { success: true, message: `Checked media package created for '${path.basename(sourceFilePath)}'.` };
    } catch (error) {
        console.error('Failed to create media package:', error);
        return { success: false, message: error.message };
    }
}

async function importMediaBackup(app, dialog) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select checked media package',
        defaultPath: app.getPath('downloads'),
        filters: [{ name: 'PlanetCreations Media Package', extensions: ['PlanetCreations'] }],
        properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { success: false, status: 'canceled', message: 'No file selected.' };
    try {
        const packageSize = fs.statSync(filePaths[0]).size;
        if (packageSize <= 0 || packageSize > 2 * 1024 * 1024 * 1024) {
            throw new Error('The media package must be between 1 byte and 2 GB.');
        }
        const result = await verifyBackup(filePaths[0]);
        if (result.status !== 'verified' || result.metadata?.packageType !== 'media') {
            return {
                success: false,
                status: result.status,
                message: result.error || 'Only signed and verified version-2 media packages can be imported.',
            };
        }
        for (const { asset, buffer } of result.inspection.assetBuffers) storeAssetBuffer(asset, buffer);
        const linkedCount = findManifestPathsByMediaSetId(result.metadata.mediaSetId).length;
        return {
            success: true,
            status: 'verified',
            mediaSetId: result.metadata.mediaSetId,
            message: linkedCount > 0 ?
                `Checked media imported and matched to ${linkedCount} local creation(s). You can activate it separately.` :
                'Checked media imported. Its matching creation has not been restored on this PC yet.',
        };
    } catch (error) {
        return { success: false, status: 'invalid', message: error.message };
    }
}

function writeVerifiedCreation(app, backupZipPath, verification, originalFilePath) {
    if (!originalFilePath || !isValidGameFile(originalFilePath)) {
        return { success: false, status: 'needs-target', originalFileName: verification.metadata?.originalFileName };
    }
    if (path.extname(originalFilePath).toLowerCase() !==
        path.extname(verification.metadata?.originalFileName || '').toLowerCase()) {
        return { success: false, status: 'error', message: 'The restore target must use the original game-file extension.' };
    }

    let payloadBuffer;
    let manifest = null;
    if (verification.inspection?.legacy) {
        const zip = new AdmZip(backupZipPath);
        const originalName = path.basename(verification.metadata.originalFileName || '');
        const entry = zip.getEntry(originalName);
        if (!entry || !isValidGameFile(originalName)) throw new Error('Legacy backup payload is missing or unsafe.');
        payloadBuffer = entry.getData();
    } else if (verification.metadata.packageType === 'creation') {
        payloadBuffer = verification.inspection.payloadBuffer;
        manifest = verification.inspection.mediaManifest;
    } else {
        throw new Error('A media package cannot be restored as a game file.');
    }

    if (fs.existsSync(originalFilePath)) {
        const preRestoreDirectory = path.join(path.dirname(originalFilePath), 'Pre-Restore Backups');
        fs.mkdirSync(preRestoreDirectory, { recursive: true });
        fs.copyFileSync(originalFilePath, path.join(preRestoreDirectory, `${path.basename(originalFilePath)}.${Date.now()}.pre-restore`));
    } else {
        fs.mkdirSync(path.dirname(originalFilePath), { recursive: true });
    }
    fs.writeFileSync(originalFilePath, payloadBuffer);
    if (manifest) savePortableManifestForCreation(originalFilePath, manifest);
    registerLocalTarget(app, verification.metadata?.packageId, originalFilePath);
    return { success: true, status: verification.status, targetPath: originalFilePath };
}

async function restoreBackup(app, backupZipPath, originalFilePath) {
    try {
        if (!fs.existsSync(backupZipPath)) return { success: false, status: 'error', message: 'Backup file not found.' };
        const verification = await verifyBackup(backupZipPath);
        if (verification.status === 'invalid' || verification.status === 'unverified') {
            return { success: false, status: verification.status, message: verification.error || 'Package verification failed.' };
        }
        return writeVerifiedCreation(app, backupZipPath, verification, originalFilePath);
    } catch (error) {
        return { success: false, status: 'error', message: error.message };
    }
}

async function installCreationPackage(app, backupZipPath, creationId, frontierPath) {
    try {
        if (!fs.existsSync(backupZipPath)) throw new Error('Downloaded creation package was not found.');
        if (typeof creationId !== 'string' || creationId.length < 1 || creationId.length > 128) {
            throw new Error('The creation ID is invalid.');
        }
        const verification = await verifyBackup(backupZipPath);
        if (verification.status !== 'verified' || verification.metadata?.packageType !== 'creation') {
            return {
                success: false,
                status: verification.status,
                permanent: verification.status === 'invalid',
                message: verification.error || 'Only signed and verified creation packages can be installed.',
            };
        }

        const metadata = verification.metadata;
        const extension = path.extname(metadata.originalFileName || '').toLowerCase();
        if (!isValidGameFile(metadata.originalFileName || '') || gameByExtension[extension] !== metadata.gameId) {
            throw new Error('The package game and file type do not match.');
        }

        const registeredTarget = getDirectInstallTarget(app, creationId);
        let targetPath = registeredTarget && isPathInside(frontierPath, registeredTarget) &&
            path.extname(registeredTarget).toLowerCase() === extension ? registeredTarget : null;
        if (!targetPath) {
            const savesDirectory = resolveGameSavesDirectory(frontierPath, metadata.gameId);
            const originalTarget = path.join(savesDirectory, path.basename(metadata.originalFileName));
            if (fs.existsSync(originalTarget) && metadata.payloadSha256 &&
                sha256(fs.readFileSync(originalTarget)) === metadata.payloadSha256) {
                targetPath = originalTarget;
            } else {
                targetPath = createCollisionSafeTarget(savesDirectory, metadata.originalFileName);
            }
        }

        const result = writeVerifiedCreation(app, backupZipPath, verification, targetPath);
        if (!result.success) return result;
        registerDirectInstallTarget(app, creationId, targetPath, metadata);
        return {
            ...result,
            installedFileName: path.basename(targetPath),
            mediaSetId: metadata.mediaSetId || null,
        };
    } catch (error) {
        return { success: false, status: 'error', permanent: false, message: error.message };
    }
}

async function installWorkshopPackage(app, packagePath, frontierPath) {
    if (!isPathInside(path.join(getBackupBaseDir(app), 'Workshop'), packagePath)) {
        return { success: false, status: 'error', message: 'The selected package is not in the Workshop folder.' };
    }
    const record = getWorkshopPackageRecord(app, packagePath);
    const creationId = record?.creationId || `workshop-${crypto.createHash('sha256').update(path.resolve(packagePath)).digest('hex').slice(0, 24)}`;
    registerWorkshopPackage(app, packagePath, creationId);
    return installCreationPackage(app, packagePath, creationId, frontierPath);
}

async function uninstallWorkshopPackage(app, packagePath) {
    try {
        if (!isPathInside(path.join(getBackupBaseDir(app), 'Workshop'), packagePath)) {
            return { success: false, status: 'error', message: 'The selected package is not in the Workshop folder.' };
        }
        const record = getWorkshopPackageRecord(app, packagePath);
        if (!record?.creationId) return { success: false, message: 'This workshop package has no local installation record.' };
        const targetPath = getDirectInstallTarget(app, record.creationId);
        if (!targetPath || !fs.existsSync(targetPath)) return { success: true, status: 'not-installed', message: 'The creation is already uninstalled.' };
        const verification = await verifyBackup(packagePath);
        if (verification.status !== 'verified') return { success: false, message: verification.error || 'Package verification failed.' };
        const modified = Boolean(verification.metadata?.payloadSha256 && sha256(fs.readFileSync(targetPath)) !== verification.metadata.payloadSha256);
        if (modified) return { success: false, status: 'modified', message: 'The installed game file has changed. It was not removed to protect your progress.' };
        fs.unlinkSync(targetPath);
        return { success: true, status: 'not-installed', message: 'Creation uninstalled. The workshop package remains available.' };
    } catch (error) {
        return { success: false, status: 'error', message: error.message };
    }
}

module.exports = {
    createBackup,
    listAllBackups,
    restoreBackup,
    installCreationPackage,
    archiveWorkshopPackage,
    installWorkshopPackage,
    uninstallWorkshopPackage,
    backupCreationMedia,
    importMediaBackup,
    deleteBackup,
    backupAllCreations,
    verifyBackup,
    validateBackupForUpload,
    isValidGameFile,
    ALLOWED_GAME_EXTENSIONS,
    MAX_UPLOAD_SIZE_BYTES,
    __test: {
        resolveGameSavesDirectory,
        createCollisionSafeTarget,
    },
};

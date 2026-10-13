const {gameForFile} = require('./GameFileTypes');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const {sha256} = require('./BackupFormat');
const {hasMediaPackageMagic, readMediaPackageHeader} = require('./MediaPackageFormat');

function getBackupBaseDir(app) {
    return path.join(app.getPath('documents'), 'PlanetCreations');
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

function getDirectInstallRegistryPath(app) {
    return path.join(app.getPath('userData'), 'direct_install_targets.json');
}

function getWorkshopRegistryPath(app) {
    return path.join(app.getPath('userData'), 'workshop_packages.json');
}

const isBackupPackageName = fileName => /\.planetcreations(media)?$/i.test(fileName);

function readBasicMetadata(packagePath) {
    // Media packages expose their metadata in a small header; never load their data.
    if (hasMediaPackageMagic(packagePath)) return readMediaPackageHeader(packagePath).metadata;
    const zip = new AdmZip(packagePath);
    const entry = zip.getEntry('metadata.json');
    if (!entry || entry.header.size > 64 * 1024) throw new Error('metadata.json is missing or too large.');
    return JSON.parse(entry.getData().toString('utf8'));
}

function listAllBackupsSync(app) {
    const allBackups = {};
    const baseDir = getBackupBaseDir(app);
    const targets = readJson(getTargetRegistryPath(app), {});
    const workshop = readJson(getWorkshopRegistryPath(app), {});
    const installed = readJson(getDirectInstallRegistryPath(app), {});
    const cachePath = path.join(app.getPath('userData'), 'backup_metadata_cache_v1.json');
    const oldCache = readJson(cachePath, {});
    const cache = {};
    for (const category of ['Parks', 'Blueprints', 'Auto Save', 'Custom Media', 'Workshop', 'Misc']) {
        const categoryDir = path.join(baseDir, category);
        if (!fs.existsSync(categoryDir)) continue;
        for (const fileName of fs.readdirSync(categoryDir).filter(isBackupPackageName)) {
            try {
                const archivePath = path.join(categoryDir, fileName);
                const stat = fs.statSync(archivePath);
                const key = [stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
                const metadata = oldCache[archivePath]?.key === key ? oldCache[archivePath].metadata : readBasicMetadata(archivePath);
                cache[archivePath] = {key, metadata};
                const originalFileName = path.basename(metadata.originalFileName || 'unknown');
                const saveName = path.basename(originalFileName, path.extname(originalFileName));
                const packageType = metadata.packageType || metadata.backupType || 'creation';
                const backupData = {
                    ...metadata,
                    missingMedia: (() => {
                        try { const entry = new AdmZip(archivePath).getEntry('media_manifest.json');
                            if (!entry || entry.header.size > 1024 * 1024) return [];
                            const manifest = JSON.parse(entry.getData().toString('utf8'));
                            return manifest.embeddedMedia && Array.isArray(manifest.missingMedia) ? manifest.missingMedia.filter(name => typeof name === 'string') : [];
                        } catch { return []; }
                    })(),
                    backupType: packageType,
                    backupDate: metadata.createdAt || metadata.backupDate,
                    category,
                    filePath: archivePath,
                    originalFilePath: targets[metadata.packageId]?.targetPath || metadata.originalFilePath || null,
                    gameId: metadata.gameId || gameForFile(metadata.originalFilePath || originalFileName) || null,
                };
                if (category === 'Workshop') {
                    const record = workshop[path.resolve(archivePath)];
                    const targetPath = record?.creationId ? installed[record.creationId]?.targetPath : null;
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
    if (JSON.stringify(cache) !== JSON.stringify(oldCache)) writeJsonAtomic(cachePath, cache);
    return allBackups;
}

module.exports = {listBackups: paths => listAllBackupsSync({getPath: name => paths[name]})};

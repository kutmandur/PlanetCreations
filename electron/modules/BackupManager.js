const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { getManifestPath, getSnapshot } = require('./MediaManager');

const backupCategoryMap = {
    '.park2': 'Parks',
    '.zoo': 'Parks',
    '.blpr2': 'Blueprints',
    '.pzblueprint': 'Blueprints',
    '.prkauto2': 'Auto Save',
    '.zooauto': 'Auto Save'
};

function getBackupBaseDir(app) {
    return path.join(app.getPath('documents'), 'PlanetCreations');
}

// ✅ NEUE FUNKTION: Führt ein Backup für eine Liste von Dateien durch
async function backupAllCreations(app, files, note) {
    let successCount = 0;
    for (const file of files) {
        const success = createBackup(app, file.path, note);
        if (success) {
            successCount++;
        }
    }
    return { success: true, message: `${successCount} of ${files.length} creations backed up successfully.` };
}


function deleteBackup(app, backupFilePath) {
    try {
        const baseDir = getBackupBaseDir(app);
        if (!backupFilePath.startsWith(baseDir)) {
            return { success: false, message: 'Error: Invalid backup path.' };
        }

        if (fs.existsSync(backupFilePath)) {
            fs.unlinkSync(backupFilePath);
            return { success: true, message: 'Backup deleted successfully.' };
        } else {
            return { success: false, message: 'Error: Backup file not found.' };
        }
    } catch (error) {
        console.error(`[BackupManager] Failed to delete backup:`, error);
        return { success: false, message: `An error occurred: ${error.message}` };
    }
}

function createBackup(app, sourceFilePath, note) {
    if (!fs.existsSync(sourceFilePath)) return false;
    try {
        const fileExtension = path.extname(sourceFilePath).toLowerCase();
        const category = backupCategoryMap[fileExtension] || 'Misc';
        const backupDir = path.join(getBackupBaseDir(app), category);
        fs.mkdirSync(backupDir, { recursive: true });

        const fileName = path.basename(sourceFilePath);
        const baseName = fileName.replace(/\.[^/.]+$/, "");
        
        const timestamp = new Date();
        const dateString = timestamp.toISOString().split('T')[0];
        const existingBackups = fs.readdirSync(backupDir).filter(f => f.startsWith(baseName) && f.endsWith('.zip'));
        const newVersion = existingBackups.length + 1;
        
        const zipFileName = `${baseName}_${dateString}_v${newVersion}.zip`;
        const destZipPath = path.join(backupDir, zipFileName);

        const metadata = { note, originalFileName: fileName, originalFilePath: sourceFilePath, backupDate: timestamp.toISOString(), version: newVersion, filePath: destZipPath, backupType: 'creation' };
        const zip = new AdmZip();
        zip.addLocalFile(sourceFilePath);
        
        const mediaManifestPath = getManifestPath(sourceFilePath);
        if (fs.existsSync(mediaManifestPath)) {
            zip.addLocalFile(mediaManifestPath, '', 'media_manifest.json');
        }
        zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));
        zip.writeZip(destZipPath);
        return true;
    } catch (error) {
        console.error(`[BackupManager] Failed to create ZIP backup:`, error);
        return false;
    }
}

function listAllBackups(app) {
    const allBackups = {};
    const baseDir = getBackupBaseDir(app);
    const categories = ['Parks', 'Blueprints', 'Auto Save', 'Custom Media'];

    for (const category of categories) {
        const categoryDir = path.join(baseDir, category);
        if (!fs.existsSync(categoryDir)) continue;

        const backupFiles = fs.readdirSync(categoryDir).filter(f => f.endsWith('.zip'));
        for (const file of backupFiles) {
            try {
                const zipPath = path.join(categoryDir, file);
                const zip = new AdmZip(zipPath);
                const metaEntry = zip.getEntry('metadata.json');
                if (metaEntry) {
                    const metadata = JSON.parse(metaEntry.getData().toString('utf8'));
                    const saveName = path.basename(metadata.originalFileName).replace(/\.[^/.]+$/, "");
                    if (!allBackups[saveName]) {
                        allBackups[saveName] = [];
                    }
                    allBackups[saveName].push(metadata);
                }
            } catch (e) { console.error(`[BackupManager] Could not read metadata from ${file}:`, e); }
        }
    }

    for (const saveName in allBackups) {
        allBackups[saveName].sort((a, b) => new Date(b.backupDate) - new Date(a.backupDate));
    }
    return allBackups;
}

function backupCreationMedia(app, sourceFilePath) {
    try {
        const snapshot = getSnapshot(sourceFilePath);
        if (!snapshot || !snapshot.files || snapshot.files.length === 0) {
            return { success: false, message: 'No media associated with this creation.' };
        }
        
        const MASTER_MEDIA_LIBRARY = path.join(app.getPath('userData'), 'MasterMediaLibrary');
        const destDir = path.join(getBackupBaseDir(app), 'Custom Media');
        fs.mkdirSync(destDir, { recursive: true });

        const fileName = path.basename(sourceFilePath);
        const baseName = fileName.replace(/\.[^/.]+$/, "");
        const timestamp = new Date();
        const dateString = timestamp.toISOString().split('T')[0];
        const existingBackups = fs.readdirSync(destDir).filter(f => f.startsWith(`CustomMediaBackup-${baseName}`) && f.endsWith('.zip'));
        const newVersion = existingBackups.length + 1;
        
        const zipFileName = `CustomMediaBackup-${baseName}_${dateString}_v${newVersion}.zip`;
        const destZipPath = path.join(destDir, zipFileName);

        const zip = new AdmZip();
        for (const mediaFile of snapshot.files) {
            const mediaFilePath = path.join(MASTER_MEDIA_LIBRARY, mediaFile);
            if (fs.existsSync(mediaFilePath)) {
                zip.addLocalFile(mediaFilePath);
            }
        }
        
        const mediaManifestPath = getManifestPath(sourceFilePath);
        if (fs.existsSync(mediaManifestPath)) {
            zip.addLocalFile(mediaManifestPath, '', 'media_manifest.json');
        }

        const metadata = {
            note: `Media backup for ${baseName}`,
            originalFileName: fileName,
            originalFilePath: sourceFilePath,
            backupDate: timestamp.toISOString(),
            version: newVersion,
            filePath: destZipPath,
            backupType: 'media'
        };
        zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));
        
        if (zip.getEntries().length <= 2) {
            return { success: false, message: 'Associated media files could not be found.' };
        }

        zip.writeZip(destZipPath);
        return { success: true, message: `Media backup for '${baseName}' created successfully!` };
    } catch (error) {
        console.error(`[BackupManager] Failed to create creation media backup:`, error);
        return { success: false, message: `Error: ${error.message}` };
    }
}

async function importMediaBackup(app, dialog) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Media Backup File',
        defaultPath: app.getPath('downloads'),
        filters: [{ name: 'Media Backup Files', extensions: ['zip'] }],
        properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) {
        return { success: false, message: 'No file selected.' };
    }

    const filePath = filePaths[0];
    try {
        const zip = new AdmZip(filePath);
        const manifestEntry = zip.getEntry('media_manifest.json');
        if (!manifestEntry) {
            return { success: false, message: 'Invalid media backup: media_manifest.json is missing.' };
        }
        
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        const MASTER_MEDIA_LIBRARY = path.join(app.getPath('userData'), 'MasterMediaLibrary');
        
        zip.getEntries().forEach(entry => {
            if (entry.entryName !== 'media_manifest.json' && entry.entryName !== 'metadata.json') {
                const destPath = path.join(MASTER_MEDIA_LIBRARY, entry.entryName);
                if (!fs.existsSync(destPath)) {
                    fs.writeFileSync(destPath, entry.getData());
                }
            }
        });

        if (fs.existsSync(manifest.originalSavePath)) {
            const destManifestPath = getManifestPath(manifest.originalSavePath);
            fs.mkdirSync(path.dirname(destManifestPath), { recursive: true });
            fs.writeFileSync(destManifestPath, manifestEntry.getData());
            return { success: true, message: 'Media backup imported and successfully linked to existing creation!' };
        } else {
            return { success: true, message: 'Media files imported, but original creation was not found. The link could not be restored.' };
        }
    } catch (error) {
        console.error('Failed to import media backup:', error);
        return { success: false, message: `An error occurred: ${error.message}` };
    }
}

function restoreBackup(app, backupZipPath, originalFilePath) {
    try {
        if (!fs.existsSync(backupZipPath)) return false;
        const zip = new AdmZip(backupZipPath);
        const metaEntry = zip.getEntry('metadata.json');
        if (!metaEntry) throw new Error("metadata.json not found.");
        const metadata = JSON.parse(metaEntry.getData().toString('utf8'));
        if (fs.existsSync(originalFilePath)) {
            fs.copyFileSync(originalFilePath, `${originalFilePath}.pre-restore`);
        }
        zip.extractEntryTo(metadata.originalFileName, path.dirname(originalFilePath), false, true);
        const mediaManifestEntry = zip.getEntry('media_manifest.json');
        if (mediaManifestEntry) {
            const destManifestPath = getManifestPath(originalFilePath);
            fs.mkdirSync(path.dirname(destManifestPath), { recursive: true });
            fs.writeFileSync(destManifestPath, mediaManifestEntry.getData());
        }
        return true;
    } catch (error) {
        console.error(`[BackupManager] Failed to restore backup:`, error);
        return false;
    }
}

module.exports = {
    createBackup,
    listAllBackups,
    restoreBackup,
    backupCreationMedia,
    importMediaBackup,
    deleteBackup,
    backupAllCreations,
};
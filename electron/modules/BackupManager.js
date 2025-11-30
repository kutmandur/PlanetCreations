const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { getManifestPath, getSnapshot } = require('./MediaManager');
const crypto = require('crypto');
const fetch = require('node-fetch');

const backupCategoryMap = {
    '.park2': 'Parks',
    '.zoo': 'Parks',
    '.blpr2': 'Blueprints',
    '.pzblueprint': 'Blueprints',
    '.prkauto2': 'Auto Save',
    '.zooauto': 'Auto Save'
};

// Erlaubte Dateiendungen für Game-Files
const ALLOWED_GAME_EXTENSIONS = ['.park2', '.zoo', '.blpr2', '.pzblueprint', '.prkauto2', '.zooauto'];

// Maximale Dateigröße für Uploads (300 MB)
const MAX_UPLOAD_SIZE_BYTES = 300 * 1024 * 1024;

/**
 * Prüft ob eine Datei ein gültiges Game-File ist
 */
function isValidGameFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ALLOWED_GAME_EXTENSIONS.includes(ext);
}

/**
 * Validiert eine Backup-Datei für den Upload
 * Prüft: Dateiendung, Größe (max 300MB), Signatur
 * @returns {Object} { valid: boolean, error?: string, isSigned: boolean, fileSize: number }
 */
async function validateBackupForUpload(backupFilePath) {
    try {
        // 1. Prüfe ob Datei existiert
        if (!fs.existsSync(backupFilePath)) {
            return { valid: false, error: 'File not found.' };
        }

        // 2. Prüfe Dateiendung
        const ext = path.extname(backupFilePath).toLowerCase();
        if (ext !== '.planetcreations') {
            return { valid: false, error: 'Invalid file type. Only .PlanetCreations backup files are allowed.' };
        }

        // 3. Prüfe Dateigröße
        const stats = fs.statSync(backupFilePath);
        const fileSizeBytes = stats.size;
        if (fileSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
            const sizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
            return {
                valid: false,
                error: `File too large (${sizeMB} MB). Maximum allowed size is 300 MB.`,
                fileSize: fileSizeBytes
            };
        }

        // 4. Prüfe ob es ein gültiges Backup-Archiv ist
        let zip;
        try {
            zip = new AdmZip(backupFilePath);
        } catch (e) {
            return { valid: false, error: 'Invalid or corrupted backup file.' };
        }

        const metaEntry = zip.getEntry('metadata.json');
        if (!metaEntry) {
            return { valid: false, error: 'Invalid backup file: metadata.json is missing.' };
        }

        let metadata;
        try {
            metadata = JSON.parse(metaEntry.getData().toString('utf8'));
        } catch (e) {
            return { valid: false, error: 'Invalid backup file: metadata.json is corrupted.' };
        }

        // 5. Prüfe ob das Original-File ein gültiges Game-File war
        if (metadata.originalFileName) {
            const originalExt = path.extname(metadata.originalFileName).toLowerCase();
            if (!ALLOWED_GAME_EXTENSIONS.includes(originalExt)) {
                return {
                    valid: false,
                    error: `Invalid backup content. Only game files (${ALLOWED_GAME_EXTENSIONS.join(', ')}) are allowed.`
                };
            }
        }

        // 6. Prüfe Signatur (Client-seitig nur zur Info - die echte Validierung erfolgt serverseitig)
        // Der Server validiert die Signatur erneut und ist die einzige vertrauenswürdige Quelle
        const isSigned = metadata.isSigned === true && !!metadata.signature;

        // Warnung für unsignierte Backups (aber kein harter Fehler - Server entscheidet)
        if (!isSigned) {
            return {
                valid: true, // Client erlaubt Upload, Server wird ablehnen
                isSigned: false,
                fileSize: fileSizeBytes,
                warning: 'This backup is not signed. The server will reject unsigned backups.',
                metadata: {
                    originalFileName: metadata.originalFileName,
                    backupDate: metadata.backupDate
                }
            };
        }

        return {
            valid: true,
            isSigned: true,
            fileSize: fileSizeBytes,
            metadata: {
                originalFileName: metadata.originalFileName,
                backupDate: metadata.backupDate,
                signerUsername: metadata.signerUsername
            }
        };

    } catch (error) {
        console.error('[BackupManager] Validation error:', error);
        return { valid: false, error: `Validation failed: ${error.message}` };
    }
}

function getBackupBaseDir(app) {
    return path.join(app.getPath('documents'), 'PlanetCreations');
}

async function verifyBackup(backupZipPath) {
    try {
        const zip = new AdmZip(backupZipPath);
        const metaEntry = zip.getEntry('metadata.json');
        if (!metaEntry) {
            throw new Error('Invalid backup file: metadata.json is missing.');
        }
        const metadata = JSON.parse(metaEntry.getData().toString('utf8'));

        if (!metadata.isSigned) {
            return { status: 'unsigned' };
        }

        try {
            const response = await fetch('https://us-central1-planetcreationsdotnet.cloudfunctions.net/api/getPublicKey');
            if (!response.ok) {
                // throw new Error('Could not fetch public key for verification.');
                 // Fallback, wenn der Server nicht erreichbar ist, um die App nicht zu blockieren
                console.warn('Could not fetch public key, verification skipped.');
                return { status: 'unsigned' };
            }
            const publicKey = await response.text();

            const { signature, ...metadataWithoutSignature } = metadata;
            const metadataString = JSON.stringify(metadataWithoutSignature, null, 2);
            const hash = crypto.createHash('sha256').update(metadataString).digest('hex');

            // Verifiziere die Signatur des Hashes (nicht des Hashes erneut hashen)
            const verifier = crypto.createVerify('RSA-SHA256');
            verifier.update(hash);
            verifier.end();

            const isVerified = verifier.verify(publicKey, signature, 'hex');

            return { status: isVerified ? 'verified' : 'invalid' };

        } catch (error) {
            console.error("Verification failed:", error);
            return { status: 'invalid', error: error.message };
        }
    } catch(err) {
        console.error("Could not read backup for verification:", err);
        return { status: 'invalid', error: err.message };
    }
}


async function backupAllCreations(app, files, note, isSigned, idToken) {
    let successCount = 0;
    for (const file of files) {
        const backupPath = await createBackup(app, file.path, note, isSigned, idToken);
        if (backupPath) {
            successCount++;
        }
    }
    return { success: true, message: `${successCount} of ${files.length} creations backed up successfully.` };
}

function deleteBackup(app, backupFilePath) {
    try {
        const baseDir = getBackupBaseDir(app);
        if (!backupFilePath.startsWith(baseDir) && !backupFilePath.startsWith(app.getPath('temp'))) {
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

async function createBackup(app, sourceFilePath, note, isSigned = false, idToken = null, targetDir = null) {
    if (!fs.existsSync(sourceFilePath)) return null;

    // Prüfe ob es ein gültiges Game-File ist
    if (!isValidGameFile(sourceFilePath)) {
        const ext = path.extname(sourceFilePath).toLowerCase();
        throw new Error(`Invalid file type "${ext}". Only game files (${ALLOWED_GAME_EXTENSIONS.join(', ')}) can be backed up.`);
    }

    try {
        const fileExtension = path.extname(sourceFilePath).toLowerCase();
        const category = backupCategoryMap[fileExtension] || 'Misc';
        const backupDir = targetDir || path.join(getBackupBaseDir(app), category);
        fs.mkdirSync(backupDir, { recursive: true });

        const fileName = path.basename(sourceFilePath);
        const baseName = fileName.replace(/\.[^/.]+$/, "");
        
        const timestamp = new Date();
        const dateString = timestamp.toISOString().split('T')[0];
        // Wenn es ein temporäres Verzeichnis ist, brauchen wir keine Versionierung
        const versionString = targetDir ? 'temp' : `v${fs.readdirSync(backupDir).filter(f => f.startsWith(baseName) && f.endsWith('.PlanetCreations')).length + 1}`;
        
        const zipFileName = `${baseName}_${dateString}_${versionString}.PlanetCreations`;
        const destZipPath = path.join(backupDir, zipFileName);

        const metadata = { note, originalFileName: fileName, originalFilePath: sourceFilePath, backupDate: timestamp.toISOString(), filePath: destZipPath, backupType: 'creation', isSigned: false };
        
        const zip = new AdmZip();
        zip.addLocalFile(sourceFilePath);
        
        const mediaManifestPath = getManifestPath(sourceFilePath);
        if (fs.existsSync(mediaManifestPath)) {
            zip.addLocalFile(mediaManifestPath, '', 'media_manifest.json');
        }

        if (isSigned && idToken) {
            // Kopiere Metadaten ohne Signatur-relevante Felder für den Hash
            const signableMeta = { ...metadata };
            delete signableMeta.filePath; // Der Pfad kann sich ändern, sollte nicht Teil der Signatur sein

            const metadataString = JSON.stringify(signableMeta, null, 2);
            const hash = crypto.createHash('sha256').update(metadataString).digest('hex');

            const response = await fetch('https://us-central1-planetcreationsdotnet.cloudfunctions.net/api/signBackup', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ hash: hash }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to get signature from server.');
            }

            const { signature, signerUid, signerUsername } = await response.json();
            
            metadata.isSigned = true;
            metadata.signature = signature;
            metadata.signerUid = signerUid;
            metadata.signerUsername = signerUsername;
        }

        zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));
        zip.writeZip(destZipPath);
        return destZipPath; // GIB DEN PFAD ZURÜCK
    } catch (error) {
        console.error(`[BackupManager] Failed to create backup:`, error);
        throw error;
    }
}


function listAllBackups(app) {
    const allBackups = {};
    const baseDir = getBackupBaseDir(app);
    const categories = ['Parks', 'Blueprints', 'Auto Save', 'Custom Media', 'Workshop', 'Misc'];

    for (const category of categories) {
        const categoryDir = path.join(baseDir, category);
        if (!fs.existsSync(categoryDir)) continue;

        const backupFiles = fs.readdirSync(categoryDir).filter(f => f.endsWith('.PlanetCreations'));
        for (const file of backupFiles) {
            try {
                const zipPath = path.join(categoryDir, file);
                const zip = new AdmZip(zipPath);
                const metaEntry = zip.getEntry('metadata.json');
                if (metaEntry) {
                    const metadata = JSON.parse(metaEntry.getData().toString('utf8'));
                    const backupData = { ...metadata, category: category };

                    const saveName = path.basename(metadata.originalFileName).replace(/\.[^/.]+$/, "");
                    if (!allBackups[saveName]) {
                        allBackups[saveName] = [];
                    }
                    allBackups[saveName].push(backupData);
                }
            } catch (e) { console.error(`[BackupManager] Could not read metadata from ${file}:`, e); }
        }
    }

    for (const saveName in allBackups) {
        allBackups[saveName].sort((a, b) => new Date(b.backupDate) - new Date(a.backupDate));
    }
    return allBackups;
}

async function backupCreationMedia(app, sourceFilePath, note, isSigned = false, idToken = null) {
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
        const existingBackups = fs.readdirSync(destDir).filter(f => f.startsWith(`CustomMediaBackup-${baseName}`) && f.endsWith('.PlanetCreations'));
        const newVersion = existingBackups.length + 1;
        
        const zipFileName = `CustomMediaBackup-${baseName}_${dateString}_v${newVersion}.PlanetCreations`;
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
            note: note || `Media backup for ${baseName}`,
            originalFileName: fileName,
            originalFilePath: sourceFilePath,
            backupDate: timestamp.toISOString(),
            version: newVersion,
            filePath: destZipPath,
            backupType: 'media',
            isSigned: false
        };
        
        if (zip.getEntries().length <= 2) {
            return { success: false, message: 'Associated media files could not be found.' };
        }
        
        if (isSigned && idToken) {
            const signableMeta = { ...metadata };
            delete signableMeta.filePath;

            const metadataString = JSON.stringify(signableMeta, null, 2);
            const hash = crypto.createHash('sha256').update(metadataString).digest('hex');

            const response = await fetch('https://us-central1-planetcreationsdotnet.cloudfunctions.net/api/signBackup', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ hash: hash }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to get signature from server.');
            }

            const { signature, signerUid, signerUsername } = await response.json();
            
            metadata.isSigned = true;
            metadata.signature = signature;
            metadata.signerUid = signerUid;
            metadata.signerUsername = signerUsername;
        }

        zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));
        zip.writeZip(destZipPath);

        return { success: true, message: `Media backup for '${baseName}' created successfully!` };
    } catch (error) {
        console.error(`[BackupManager] Failed to create creation media backup:`, error);
        throw error;
    }
}

async function importMediaBackup(app, dialog) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Media Backup File',
        defaultPath: app.getPath('downloads'),
        filters: [{ name: 'PlanetCreations Media Backup', extensions: ['PlanetCreations'] }],
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

async function restoreBackup(app, backupZipPath, originalFilePath) {
    try {
        const verificationResult = await verifyBackup(backupZipPath);
        
        if (!fs.existsSync(backupZipPath)) return { success: false, status: 'error', message: 'Backup file not found.' };

        if (verificationResult.status === 'unsigned') {
            // Wir erlauben die Wiederherstellung unsignierter Backups, aber der Benutzer wird gewarnt.
            // Die Warnung muss im Frontend passieren, hier geben wir nur den Status zurück.
        }
        if (verificationResult.status === 'invalid') {
            return { success: false, status: 'invalid', message: 'This backup has an invalid signature and cannot be restored.' };
        }
        
        const zip = new AdmZip(backupZipPath);
        const metaEntry = zip.getEntry('metadata.json');
        if (!metaEntry) throw new Error("metadata.json not found.");
        const metadata = JSON.parse(metaEntry.getData().toString('utf8'));
        
        // Backup des aktuellen "live" Spielstands vor der Wiederherstellung
        if (fs.existsSync(originalFilePath)) {
            const preRestoreBackupDir = path.join(path.dirname(originalFilePath), 'Pre-Restore Backups');
            fs.mkdirSync(preRestoreBackupDir, { recursive: true });
            const backupFileName = `${path.basename(originalFilePath)}.${Date.now()}.pre-restore`;
            fs.copyFileSync(originalFilePath, path.join(preRestoreBackupDir, backupFileName));
        }

        zip.extractEntryTo(metadata.originalFileName, path.dirname(originalFilePath), false, true);
        
        const mediaManifestEntry = zip.getEntry('media_manifest.json');
        if (mediaManifestEntry) {
            const destManifestPath = getManifestPath(originalFilePath);
            fs.mkdirSync(path.dirname(destManifestPath), { recursive: true });
            fs.writeFileSync(destManifestPath, mediaManifestEntry.getData());
        }
        return { success: true, status: verificationResult.status };
    } catch (error) {
        console.error(`[BackupManager] Failed to restore backup:`, error);
        return { success: false, status: 'error', message: error.message };
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
    verifyBackup,
    validateBackupForUpload,
    isValidGameFile,
    ALLOWED_GAME_EXTENSIONS,
    MAX_UPLOAD_SIZE_BYTES,
};
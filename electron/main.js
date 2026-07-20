const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mime = require('mime-types');
const AdmZip = require('adm-zip');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const fetch = require('node-fetch');

const { scanGamesFromPath, scanAllMediaFiles } = require('./modules/FileHandler');
const { createBackup, listAllBackups, restoreBackup, backupCreationMedia, importMediaBackup, deleteBackup, backupAllCreations, verifyBackup, validateBackupForUpload, isValidGameFile, ALLOWED_GAME_EXTENSIONS } = require('./modules/BackupManager');
const { createOrUpdateSnapshot, getSnapshot, installMedia, uninstallMedia, getMediaSetStatus, hasMediaSnapshot, deleteCreationMedia } = require('./modules/MediaManager');

const isDev = !app.isPackaged;
const backupCategoryMap = { '.park2': 'Parks', '.zoo': 'Parks', '.blpr2': 'Blueprints', '.pzblueprint': 'Blueprints', '.prkauto2': 'Auto Save', '.zooauto': 'Auto Save' };
let mainWindow;

function isPathInside(root, candidate) {
    if (!root || !candidate) return false;
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Protokoll-Handler registrieren
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('planetcreations', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('planetcreations');
}


// Konfiguriere electron-log für den Updater
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

// --- UPDATE-LOGIK ---
async function checkForUpdatesViaAPI() {
    const owner = 'kutmandur';
    const repo = 'PlanetCreations';
    const currentVersion = app.getVersion();
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            log.warn(`Manual update check: Could not fetch release info from GitHub. Status: ${response.status}`);
            return;
        }
        const release = await response.json();
        const latestVersion = release.tag_name.replace('v', '');

        if (latestVersion > currentVersion) {
            log.info(`Manual update check: Update available: ${latestVersion}`);
            mainWindow.webContents.send('update-info-available', {
                version: latestVersion,
                url: release.html_url
            });
        } else {
            log.info('Manual update check: App is up-to-date.');
        }
    } catch (error) {
        log.error('Manual update check failed:', error);
    }
}

// --- HILFSFUNKTION FÜR DEN IMPORT ---
async function importBackupFromFile(filePath, overrideCategory = null) {
    try {
        const verificationResult = await verifyBackup(filePath);
        if (verificationResult.status === 'invalid' || verificationResult.status === 'unverified') {
            return { success: false, status: verificationResult.status, message: verificationResult.error || 'This package could not be securely verified and cannot be imported.' };
        }
        
        const zip = new AdmZip(filePath);
        const metaEntry = zip.getEntry('metadata.json');
        if (!metaEntry) return { success: false, status: 'error', message: 'Invalid backup file: metadata.json is missing.' };
        
        const metadata = JSON.parse(metaEntry.getData().toString('utf8'));
        
        let category;

        if (overrideCategory) {
            category = overrideCategory;
        } else if (metadata.packageType === 'media' || metadata.backupType === 'media') {
            category = 'Custom Media';
        } else {
            const fileExtension = path.extname(metadata.originalFileName).toLowerCase();
            category = backupCategoryMap[fileExtension] || 'Misc';
        }
        
        const backupDir = path.join(app.getPath('documents'), 'PlanetCreations', category);
        fs.mkdirSync(backupDir, { recursive: true });

        const destPath = path.join(backupDir, path.basename(filePath));
        if (fs.existsSync(destPath)) {
            return { success: false, status: 'exists', message: `Backup '${path.basename(filePath)}' already exists.` };
        }
        
        fs.copyFileSync(filePath, destPath);

        return { success: true, status: verificationResult.status, message: 'Backup successfully imported!' };

    } catch (error) {
        console.error('Failed to import external backup:', error);
        return { success: false, status: 'error', message: `An error occurred: ${error.message}` };
    }
}

// --- FUNKTION: URL verarbeiten, herunterladen und importieren ---
async function handleUrlImport(urlToHandle) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const sendStatus = (type, message) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('backup-import-status', { type, message });
        }
    };

    sendStatus('info', 'Starting download from URL...');

    let tempPath = null;
    try {
        const parsedUrl = new URL(urlToHandle);
        const downloadUrl = parsedUrl.searchParams.get('url');

        if (!downloadUrl) {
            throw new Error('No download URL found in the link.');
        }

        // URL-Validierung: Nur HTTPS erlauben
        const downloadParsed = new URL(downloadUrl);
        if (downloadParsed.protocol !== 'https:') {
            throw new Error('Only HTTPS downloads are allowed for security reasons.');
        }
        if (!downloadParsed.hostname.endsWith('.r2.cloudflarestorage.com')) {
            throw new Error('Direct creation installs are only accepted from PlanetCreations R2 downloads.');
        }

        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Failed to download file. Status: ${response.status} ${response.statusText}`);
        }

        const declaredSize = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredSize) && declaredSize > 300 * 1024 * 1024) {
            throw new Error('The download exceeds the 300 MB package limit.');
        }
        const buffer = await response.buffer();
        if (buffer.length <= 0 || buffer.length > 300 * 1024 * 1024) {
            throw new Error('The downloaded package has an invalid size.');
        }
        const fileName = `${crypto.randomUUID()}.PlanetCreations`;
        tempPath = path.join(app.getPath('temp'), fileName);

        fs.writeFileSync(tempPath, buffer);
        sendStatus('info', 'Download complete. Importing backup...');

        const importResult = await importBackupFromFile(tempPath, 'Workshop');

        if (importResult.success) {
            sendStatus('success', `Successfully imported '${fileName}' to Workshop!`);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('backups-updated');
            }
        } else {
            sendStatus('error', importResult.message || 'Failed to import backup.');
        }

    } catch (error) {
        console.error('URL Import Error:', error);
        sendStatus('error', `An error occurred: ${error.message}`);
    } finally {
        // Temp-Datei immer aufräumen
        if (tempPath && fs.existsSync(tempPath)) {
            try {
                fs.unlinkSync(tempPath);
            } catch (e) {
                console.error('Failed to clean up temp file:', e);
            }
        }
    }
}


// --- LOGIK FÜR AUTO-IMPORT BEI DOPPELKLICK / PROTOKOLL ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const url = commandLine.pop();
    if (url && url.startsWith('planetcreations://')) {
        handleUrlImport(url);
    } else if (url && url.endsWith('.PlanetCreations')) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('import-file-triggered', url);
        }
    }
  });
}

function getStoredPath() {
    try {
        const configPath = path.join(app.getPath('userData'), 'config.json');
        if (fs.existsSync(configPath)) {
            const rawData = fs.readFileSync(configPath);
            const config = JSON.parse(rawData);
            return config.frontierPath || null;
        }
    } catch (error) { console.error("Error reading stored path:", error); }
    return null;
}

function setStoredPath(newPath) {
    try {
        const config = { frontierPath: newPath };
        const configPath = path.join(app.getPath('userData'), 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) { console.error("Error storing path:", error); }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
    });

    mainWindow.setMenu(null);
    const splashPath = isDev ? path.join(__dirname, '../public/splash.html') : path.join(__dirname, '../build/splash.html');
    mainWindow.loadFile(splashPath);
    
    ipcMain.on('select-mode', (event, mode) => {
        const reactAppUrl = isDev ? 'http://localhost:3000' : `file://${path.join(__dirname, '../build/index.html')}`;
        if (mode === 'online') mainWindow.loadURL(reactAppUrl);
        else if (mode === 'offline') mainWindow.loadURL(`${reactAppUrl}#/client/dashboard`);
    });

    if (isDev) mainWindow.webContents.openDevTools();

    mainWindow.once('ready-to-show', () => {
        if (!isDev) {
            autoUpdater.checkForUpdates();
        }
    });

    const initialUrlOrFile = !isDev ? process.argv[1] : null;
    if (initialUrlOrFile) {
        mainWindow.webContents.once('did-finish-load', () => {
            if (initialUrlOrFile.startsWith('planetcreations://')) {
                handleUrlImport(initialUrlOrFile);
            } else if (initialUrlOrFile.endsWith('.PlanetCreations')) {
                mainWindow.webContents.send('import-file-triggered', initialUrlOrFile);
            }
        });
    }
}

// --- AUTO-UPDATE EVENTS ---
autoUpdater.on('error', (error) => {
    log.error('Auto-update error:', error);
    checkForUpdatesViaAPI();
});
autoUpdater.on('update-available', () => {
    mainWindow.webContents.send('update-available');
});
autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update-downloaded');
});
ipcMain.on('restart-app', () => {
    autoUpdater.quitAndInstall();
});

// --- IPC LISTENER ---
ipcMain.handle('open-external-link', (event, url) => {
    shell.openExternal(url);
});

ipcMain.handle('get-stored-path', () => getStoredPath());

ipcMain.handle('select-folder', async () => {
    const defaultPath = path.join(app.getPath('home'), 'Saved Games', 'Frontier Developments');
    const result = await dialog.showOpenDialog({ 
        properties: ['openDirectory'],
        defaultPath: defaultPath
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selectedPath = result.filePaths[0];
    setStoredPath(selectedPath);
    return selectedPath;
});

ipcMain.handle('read-file-as-data-url', (event, filePath) => {
    try {
        // Sicherheitsprüfung: Nur erlaubte Pfade zulassen
        if (!filePath || typeof filePath !== 'string') return null;

        const normalizedPath = path.normalize(filePath);
        const allowedPaths = [
            app.getPath('documents'),
            app.getPath('userData'),
            app.getPath('temp'),
            path.join(app.getPath('home'), 'Saved Games')
        ];

        const isAllowed = allowedPaths.some(allowed => isPathInside(allowed, normalizedPath));
        if (!isAllowed) {
            console.warn(`[Security] Blocked file read attempt: ${filePath}`);
            return null;
        }

        if (!fs.existsSync(filePath)) return null;
        const data = fs.readFileSync(filePath);
        const base64Data = data.toString('base64');
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';
        return `data:${mimeType};base64,${base64Data}`;
    } catch (error) {
        console.error(`Failed to read file as data URL: ${filePath}`, error);
        return null;
    }
});

ipcMain.handle('open-backup-folder', () => {
    const backupDir = path.join(app.getPath('documents'), 'PlanetCreations');
    fs.mkdirSync(backupDir, { recursive: true });
    shell.openPath(backupDir);
});

ipcMain.handle('load-external-backup', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Backup File',
        defaultPath: app.getPath('downloads'),
        filters: [{ name: 'PlanetCreations Backup', extensions: ['PlanetCreations'] }],
        properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) {
        return { success: false, status: 'canceled' };
    }
    return importBackupFromFile(filePaths[0]);
});

ipcMain.handle('import-backup-from-path', (event, filePath) => {
    return importBackupFromFile(filePath);
});

ipcMain.handle('list-all-local-creations-and-backups', (event) => {
    const storedPath = getStoredPath();
    if (!storedPath) {
        return {}; 
    }

    const gameFiles = scanGamesFromPath(storedPath);
    const allBackupsBySave = listAllBackups(app);
    const flatBackups = Object.values(allBackupsBySave).flat();
    
    const creationBackups = flatBackups
        .filter(b => b.backupType !== 'media')
        .map(b => ({
            name: path.basename(b.filePath),
            path: b.filePath,
            modifiedAt: b.backupDate,
        }));

    for (const backup of creationBackups) {
        const originalFileName = backup.name.split('_')[0] + path.extname(backup.name.split('_')[0] || '.tmp');
        const origExt = path.extname(originalFileName).toLowerCase();
        let gameName = null;
        
        if (['.park2', '.blpr2', '.prkauto2'].includes(origExt)) gameName = 'Planet Coaster 2';
        if (['.zoo', '.pzblueprint', '.zooauto'].includes(origExt)) gameName = 'Planet Zoo';
        
        if (gameName && gameFiles[gameName]) {
            if (!gameFiles[gameName].backups) {
                gameFiles[gameName].backups = [];
            }
            gameFiles[gameName].backups.push(backup);
        }
    }
    
    for (const game in gameFiles) {
        if (gameFiles[game].parks) gameFiles[game].parks.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
        if (gameFiles[game].blueprints) gameFiles[game].blueprints.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
        if (gameFiles[game].autosaves) gameFiles[game].autosaves.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
        if (gameFiles[game].backups) gameFiles[game].backups.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    }

    return gameFiles;
});

ipcMain.handle('prepare-backup-for-upload', async (event, filePath, idToken) => {
    if (!filePath) {
        return { success: false, message: 'No file path provided.' };
    }

    const fileExt = path.extname(filePath).toLowerCase();

    try {
        const storedPath = getStoredPath();
        const allowedSourceRoots = [
            storedPath,
            path.join(app.getPath('documents'), 'Frontier Developments'),
            path.join(app.getPath('documents'), 'PlanetCreations'),
            app.getPath('temp'),
        ].filter(Boolean);
        if (!allowedSourceRoots.some(root => isPathInside(root, filePath))) {
            return { success: false, message: 'The selected file is outside the configured game and backup folders.' };
        }
        if (fileExt === '.planetcreations') {
            // Existierendes Backup: Vollständige Validierung durchführen
            const validation = await validateBackupForUpload(filePath);

            if (!validation.valid) {
                return { success: false, message: validation.error };
            }

            return {
                success: true,
                filePath: filePath,
                fileName: path.basename(filePath),
                isSigned: validation.isSigned,
                fileSize: validation.fileSize,
                metadata: validation.metadata,
            };
        } else {
            // Neues Backup aus Game-File erstellen
            // Prüfe zuerst ob es ein gültiges Game-File ist
            if (!isValidGameFile(filePath)) {
                return {
                    success: false,
                    message: `Invalid file type. Only game files (${ALLOWED_GAME_EXTENSIONS.join(', ')}) can be uploaded.`
                };
            }

            // Quelldatei-Größe wird nicht geprüft - die Datei wird komprimiert
            // Die finale Backup-Größe wird nach dem Erstellen und serverseitig geprüft

            const tempDir = app.getPath('temp');
            const newBackupPath = await createBackup(app, filePath, "Uploaded with creation", true, idToken, tempDir);

            if (!newBackupPath) {
                throw new Error("Backup creation function did not return a valid path.");
            }

            // Validiere das erstellte Backup
            const validation = await validateBackupForUpload(newBackupPath);
            if (!validation.valid) {
                // Lösche das fehlerhafte Backup
                if (fs.existsSync(newBackupPath)) {
                    fs.unlinkSync(newBackupPath);
                }
                return { success: false, message: validation.error };
            }

            return {
                success: true,
                filePath: newBackupPath,
                fileName: path.basename(newBackupPath),
                isSigned: validation.isSigned,
                fileSize: validation.fileSize,
            };
        }
    } catch (error) {
        console.error('Error in prepareBackupForUpload:', error);
        return { success: false, message: `An error occurred: ${error.message}` };
    }
});

ipcMain.handle('upload-backup-file', async (event, filePath, uploadUrl, contentType) => {
    try {
        if (!filePath || path.extname(filePath).toLowerCase() !== '.planetcreations' || !fs.existsSync(filePath)) {
            return { success: false, message: 'The prepared backup file is missing or invalid.' };
        }
        const resolvedPath = path.resolve(filePath);
        const allowedRoots = [app.getPath('temp'), app.getPath('documents')].map(root => path.resolve(root));
        const isAllowedPath = allowedRoots.some(root => isPathInside(root, resolvedPath));
        if (!isAllowedPath) {
            return { success: false, message: 'The prepared file is outside an allowed local folder.' };
        }
        const parsedUrl = new URL(uploadUrl);
        if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.r2.cloudflarestorage.com')) {
            return { success: false, message: 'The upload target is not a Cloudflare R2 endpoint.' };
        }
        const stats = fs.statSync(resolvedPath);
        if (!stats.isFile() || stats.size <= 0 || stats.size > 300 * 1024 * 1024) {
            return { success: false, message: 'The backup must be between 1 byte and 300 MB.' };
        }
        const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': contentType || 'application/zip',
                'Content-Length': String(stats.size),
            },
            body: fs.createReadStream(resolvedPath),
        });
        if (!response.ok) {
            return { success: false, status: response.status, message: `Cloudflare R2 returned HTTP ${response.status}.` };
        }
        return { success: true, status: response.status };
    } catch (error) {
        console.error('R2 backup upload failed:', error);
        return { success: false, message: error.message };
    }
});

// --- Andere Kern-Funktionen ---
ipcMain.handle('import-media-backup', () => importMediaBackup(app, dialog));
ipcMain.handle('has-media-snapshot', (event, filePath) => hasMediaSnapshot(filePath));
ipcMain.handle('backup-creation-media', (event, filePath, note, isSigned, idToken) => backupCreationMedia(app, filePath, note, isSigned, idToken));
ipcMain.handle('delete-creation-media', (event, filePath, mode) => deleteCreationMedia(filePath, mode));
ipcMain.handle('scan-games', (event, basePath) => scanGamesFromPath(basePath));
ipcMain.handle('create-backup', (event, filePath, note, isSigned, idToken) => createBackup(app, filePath, note, isSigned, idToken));
ipcMain.handle('list-all-backups', () => listAllBackups(app));
ipcMain.handle('restore-backup', async (event, backupFilePath, originalFilePath) => {
    let targetPath = originalFilePath;
    if (!targetPath || !fs.existsSync(path.dirname(targetPath))) {
        try {
            const zip = new AdmZip(backupFilePath);
            const metadata = JSON.parse(zip.getEntry('metadata.json').getData().toString('utf8'));
            const suggestedName = path.basename(metadata.originalFileName || 'creation.park2');
            const result = await dialog.showSaveDialog({
                title: 'Choose where to restore the game file',
                defaultPath: path.join(app.getPath('documents'), suggestedName),
                filters: [{ name: 'Supported game file', extensions: [path.extname(suggestedName).slice(1)] }],
            });
            if (result.canceled || !result.filePath) return { success: false, status: 'canceled' };
            targetPath = result.filePath;
        } catch (error) {
            return { success: false, status: 'error', message: `Could not read package metadata: ${error.message}` };
        }
    }
    return restoreBackup(app, backupFilePath, targetPath);
});
ipcMain.handle('delete-backup', (event, filePath) => deleteBackup(app, filePath));
ipcMain.handle('backup-all-creations', (event, files, note, isSigned, idToken) => backupAllCreations(app, files, note, isSigned, idToken));
ipcMain.handle('scan-all-media-files', () => scanAllMediaFiles(app));
ipcMain.handle('create-media-snapshot', (event, savePath, mediaPaths) => createOrUpdateSnapshot(savePath, mediaPaths));
ipcMain.handle('get-media-snapshot', (event, savePath) => getSnapshot(savePath));
ipcMain.handle('install-media', (event, savePath, options) => installMedia(savePath, options));
ipcMain.handle('uninstall-media', (event, savePath) => uninstallMedia(savePath));
ipcMain.handle('get-media-status', (event, savePath) => getMediaSetStatus(savePath));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

app.on('open-url', (event, url) => {
    event.preventDefault();
    handleUrlImport(url);
});

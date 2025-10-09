const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const AdmZip = require('adm-zip');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const fetch = require('node-fetch');

const { scanGamesFromPath, scanAllMediaFiles } = require('./modules/FileHandler');
const { createBackup, listAllBackups, restoreBackup, backupCreationMedia, importMediaBackup, deleteBackup, backupAllCreations, verifyBackup } = require('./modules/BackupManager');
const { createOrUpdateSnapshot, getSnapshot, installMedia, uninstallMedia, getMediaSetStatus, hasMediaSnapshot, deleteCreationMedia } = require('./modules/MediaManager');

const isDev = !app.isPackaged;
const backupCategoryMap = { '.park2': 'Parks', '.zoo': 'Parks', '.blpr2': 'Blueprints', '.pzblueprint': 'Blueprints', '.prkauto2': 'Auto Save', '.zooauto': 'Auto Save' };
let mainWindow;

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
async function importBackupFromFile(filePath) {
    try {
        const verificationResult = await verifyBackup(filePath);
        if (verificationResult.status === 'invalid') {
            return { success: false, status: 'invalid', message: 'This backup has an invalid signature and cannot be imported.' };
        }
        
        const zip = new AdmZip(filePath);
        const metaEntry = zip.getEntry('metadata.json');
        if (!metaEntry) return { success: false, status: 'error', message: 'Invalid backup file: metadata.json is missing.' };
        
        const metadata = JSON.parse(metaEntry.getData().toString('utf8'));
        
        let category = 'Misc';
        if (metadata.backupType === 'media') {
            category = 'Custom Media';
        } else {
            const fileExtension = path.extname(metadata.originalFileName).toLowerCase();
            category = backupCategoryMap[fileExtension] || 'Misc';
        }
        
        const backupDir = path.join(app.getPath('documents'), 'PlanetCreations', category);
        fs.mkdirSync(backupDir, { recursive: true });

        const destPath = path.join(backupDir, path.basename(filePath));
        if (fs.existsSync(destPath)) return { success: false, status: 'exists', message: `Backup '${path.basename(filePath)}' already exists.` };
        
        fs.copyFileSync(filePath, destPath);

        return { success: true, status: verificationResult.status, message: 'Backup successfully imported!' };

    } catch (error) {
        console.error('Failed to import external backup:', error);
        return { success: false, status: 'error', message: `An error occurred: ${error.message}` };
    }
}

// --- FUNKTION: URL verarbeiten, herunterladen und importieren ---
async function handleUrlImport(urlToHandle) {
    if (!mainWindow) return;
    mainWindow.webContents.send('backup-import-status', { type: 'info', message: 'Starting download from URL...' });

    try {
        const parsedUrl = new URL(urlToHandle);
        const downloadUrl = parsedUrl.searchParams.get('url');

        if (!downloadUrl) {
            throw new Error('No download URL found in the link.');
        }

        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Failed to download file. Status: ${response.status} ${response.statusText}`);
        }

        const buffer = await response.buffer();
        const fileName = path.basename(new URL(downloadUrl).pathname);
        const tempPath = path.join(app.getPath('temp'), fileName);
        
        fs.writeFileSync(tempPath, buffer);
        mainWindow.webContents.send('backup-import-status', { type: 'info', message: 'Download complete. Importing backup...' });

        const importResult = await importBackupFromFile(tempPath);
        
        if (importResult.success) {
            mainWindow.webContents.send('backup-import-status', { type: 'success', message: `Successfully imported '${fileName}'!` });
        } else {
            mainWindow.webContents.send('backup-import-status', { type: 'error', message: importResult.message || 'Failed to import backup.' });
        }

        fs.unlinkSync(tempPath);

    } catch (error) {
        console.error('URL Import Error:', error);
        mainWindow.webContents.send('backup-import-status', { type: 'error', message: `An error occurred: ${error.message}` });
    }
}


// --- LOGIK FÜR AUTO-IMPORT BEI DOPPELKLICK / PROTOKOLL ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const url = commandLine.pop();
    if (url.startsWith('planetcreations://')) {
        handleUrlImport(url);
    } else if (url.endsWith('.PlanetCreations')) {
        mainWindow.webContents.send('import-file-triggered', url);
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

// *** NEUER IPC HANDLER ZUM AUFLISTEN ALLER DATEIEN ***
ipcMain.handle('list-all-local-creations-and-backups', (event) => {
    const storedPath = getStoredPath();
    if (!storedPath) {
        return {}; // Kein Pfad konfiguriert
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

// *** NEUER IPC HANDLER ZUR VORBEREITUNG DES UPLOADS ***
ipcMain.handle('prepare-backup-for-upload', async (event, filePath, idToken) => {
    if (!filePath) {
        return { success: false, message: 'No file path provided.' };
    }

    const fileExt = path.extname(filePath).toLowerCase();

    try {
        if (fileExt === '.planetcreations') {
            const verification = await verifyBackup(filePath);
            return {
                success: true,
                filePath: filePath,
                fileName: path.basename(filePath),
                isSigned: verification.status === 'verified',
            };
        } else {
            const tempDir = app.getPath('temp');
            const newBackupPath = await createBackup(app, filePath, "Uploaded with creation", true, idToken, tempDir);
            
            if (!newBackupPath) {
                 throw new Error("Backup creation function did not return a valid path.");
            }

            return {
                success: true,
                filePath: newBackupPath,
                fileName: path.basename(newBackupPath),
                isSigned: true,
            };
        }
    } catch (error) {
        console.error('Error in prepareBackupForUpload:', error);
        return { success: false, message: `An error occurred: ${error.message}` };
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
ipcMain.handle('restore-backup', (event, backupFilePath, originalFilePath) => restoreBackup(app, backupFilePath, originalFilePath)); 
ipcMain.handle('delete-backup', (event, filePath) => deleteBackup(app, filePath));
ipcMain.handle('backup-all-creations', (event, files, note, isSigned, idToken) => backupAllCreations(app, files, note, isSigned, idToken));
ipcMain.handle('scan-all-media-files', () => scanAllMediaFiles(app));
ipcMain.handle('create-media-snapshot', (event, savePath, mediaPaths) => createOrUpdateSnapshot(savePath, mediaPaths));
ipcMain.handle('get-media-snapshot', (event, savePath) => getSnapshot(savePath));
ipcMain.handle('install-media', (event, savePath) => installMedia(savePath));
ipcMain.handle('uninstall-media', (event, savePath) => uninstallMedia(savePath));
ipcMain.handle('get-media-status', (event, savePath) => getMediaSetStatus(savePath));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

app.on('open-url', (event, url) => {
    event.preventDefault();
    handleUrlImport(url);
});
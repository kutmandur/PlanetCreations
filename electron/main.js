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

// --- LOGIK FÜR AUTO-IMPORT BEI DOPPELKLICK ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const filePath = !isDev ? commandLine.pop() : commandLine[commandLine.length -1];
    if (filePath && filePath.endsWith('.PlanetCreations')) {
        mainWindow.webContents.send('import-file-triggered', filePath);
    }
  });
}

function getStoredPath() {
    // ... (unverändert)
}
function setStoredPath(newPath) {
    // ... (unverändert)
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

    // HYBRIDE AUTO-UPDATE LOGIK
    mainWindow.once('ready-to-show', () => {
        if (!isDev) {
            autoUpdater.checkForUpdates();
        }
    });

    // Verarbeite eine Datei, falls die App damit gestartet wurde
    const filePath = process.argv.length >= 2 && !isDev ? process.argv[1] : null;
    if (filePath && filePath.endsWith('.PlanetCreations')) {
        mainWindow.webContents.once('did-finish-load', () => {
            mainWindow.webContents.send('import-file-triggered', filePath);
        });
    }
}

// --- AUTO-UPDATE EVENTS ---
autoUpdater.on('error', (error) => {
    log.error('Auto-update error:', error);
    checkForUpdatesViaAPI(); // Fallback zur manuellen Methode
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
    // ... (unverändert)
});
ipcMain.handle('open-backup-folder', () => {
    // ... (unverändert)
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
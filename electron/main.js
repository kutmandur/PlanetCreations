const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const AdmZip = require('adm-zip');
const { scanGamesFromPath, scanAllMediaFiles } = require('./modules/FileHandler');
const { createBackup, listAllBackups, restoreBackup, backupCreationMedia, importMediaBackup, deleteBackup, backupAllCreations } = require('./modules/BackupManager');
const { createOrUpdateSnapshot, getSnapshot, installMedia, uninstallMedia, getMediaSetStatus, hasMediaSnapshot, deleteCreationMedia } = require('./modules/MediaManager');

const isDev = !app.isPackaged;
const backupCategoryMap = { '.park2': 'Parks', '.zoo': 'Parks', '.blpr2': 'Blueprints', '.pzblueprint': 'Blueprints', '.prkauto2': 'Auto Save', '.zooauto': 'Auto Save' };

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
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
        },
    });
    const splashPath = isDev ? path.join(__dirname, '../public/splash.html') : path.join(__dirname, '../build/splash.html');
    win.loadFile(splashPath);
    ipcMain.on('select-mode', (event, mode) => {
        const reactAppUrl = isDev ? 'http://localhost:3000' : `file://${path.join(__dirname, '../build/index.html')}`;
        if (mode === 'online') win.loadURL(reactAppUrl);
        else if (mode === 'offline') win.loadURL(`${reactAppUrl}#/client/dashboard`);
    });
    if (isDev) win.webContents.openDevTools();
}

// IPC Listener
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
        title: 'Select Creation Backup File',
        defaultPath: app.getPath('downloads'),
        filters: [{ name: 'Backup Files', extensions: ['zip'] }],
        properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) {
        return { success: false, message: 'No file selected.' };
    }

    const filePath = filePaths[0];
    try {
        const zip = new AdmZip(filePath);
        const metaEntry = zip.getEntry('metadata.json');
        if (!metaEntry) return { success: false, message: 'Invalid backup file: metadata.json is missing.' };
        
        const metadata = JSON.parse(metaEntry.getData().toString('utf8'));
        const fileExtension = path.extname(metadata.originalFileName).toLowerCase();
        const category = backupCategoryMap[fileExtension] || 'Misc';
        const backupDir = path.join(app.getPath('documents'), 'PlanetCreations', category);
        fs.mkdirSync(backupDir, { recursive: true });

        const destPath = path.join(backupDir, path.basename(filePath));
        if (fs.existsSync(destPath)) return { success: false, message: `Backup '${path.basename(filePath)}' already exists.` };
        
        fs.copyFileSync(filePath, destPath);
        return { success: true, message: 'Backup successfully imported!' };
    } catch (error) {
        console.error('Failed to import external backup:', error);
        return { success: false, message: `An error occurred: ${error.message}` };
    }
});
ipcMain.handle('import-media-backup', () => importMediaBackup(app, dialog));
ipcMain.handle('has-media-snapshot', (event, filePath) => hasMediaSnapshot(filePath));
ipcMain.handle('backup-creation-media', (event, filePath) => backupCreationMedia(app, filePath));
ipcMain.handle('delete-creation-media', (event, filePath, mode) => deleteCreationMedia(filePath, mode));
ipcMain.handle('scan-games', (event, basePath) => scanGamesFromPath(basePath));
ipcMain.handle('create-backup', (event, filePath, note) => createBackup(app, filePath, note));
ipcMain.handle('list-all-backups', () => listAllBackups(app));
ipcMain.handle('restore-backup', (event, backupFilePath, originalFilePath) => restoreBackup(app, backupFilePath, originalFilePath)); 
ipcMain.handle('delete-backup', (event, filePath) => deleteBackup(app, filePath));
ipcMain.handle('backup-all-creations', (event, files, note) => backupAllCreations(app, files, note)); // ✅ NEU
ipcMain.handle('scan-all-media-files', () => scanAllMediaFiles(app));
ipcMain.handle('create-media-snapshot', (event, savePath, mediaPaths) => createOrUpdateSnapshot(savePath, mediaPaths));
ipcMain.handle('get-media-snapshot', (event, savePath) => getSnapshot(savePath));
ipcMain.handle('install-media', (event, savePath) => installMedia(savePath));
ipcMain.handle('uninstall-media', (event, savePath) => uninstallMedia(savePath));
ipcMain.handle('get-media-status', (event, savePath) => getMediaSetStatus(savePath));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
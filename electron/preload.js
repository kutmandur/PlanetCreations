const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectMode: (mode) => ipcRenderer.send('select-mode', mode),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getStoredPath: () => ipcRenderer.invoke('get-stored-path'),
  readFileAsDataURL: (filePath) => ipcRenderer.invoke('read-file-as-data-url', filePath),
  openBackupFolder: () => ipcRenderer.invoke('open-backup-folder'),
  loadExternalBackup: () => ipcRenderer.invoke('load-external-backup'),
  importMediaBackup: () => ipcRenderer.invoke('import-media-backup'),

  hasMediaSnapshot: (filePath) => ipcRenderer.invoke('has-media-snapshot', filePath),
  backupCreationMedia: (filePath) => ipcRenderer.invoke('backup-creation-media', filePath),
  deleteCreationMedia: (filePath, mode) => ipcRenderer.invoke('delete-creation-media', filePath, mode),

  scanGames: (basePath) => ipcRenderer.invoke('scan-games', basePath),
  createBackup: (filePath, note) => ipcRenderer.invoke('create-backup', filePath, note),
  listAllBackups: () => ipcRenderer.invoke('list-all-backups'),
  restoreBackup: (backupFilePath, originalFilePath) => ipcRenderer.invoke('restore-backup', backupFilePath, originalFilePath),
  deleteBackup: (filePath) => ipcRenderer.invoke('delete-backup', filePath),
  backupAllCreations: (files, note) => ipcRenderer.invoke('backup-all-creations', files, note),
  
  scanAllMediaFiles: () => ipcRenderer.invoke('scan-all-media-files'),
  createMediaSnapshot: (savePath, mediaPaths) => ipcRenderer.invoke('create-media-snapshot', savePath, mediaPaths),
  getMediaSnapshot: (savePath) => ipcRenderer.invoke('get-media-snapshot', savePath),
  installMedia: (savePath) => ipcRenderer.invoke('install-media', savePath),
  uninstallMedia: (savePath) => ipcRenderer.invoke('uninstall-media', savePath),
  getMediaStatus: (savePath) => ipcRenderer.invoke('get-media-status', savePath),
  
  // NEU: Funktionen für den Auto-Updater
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_event, ...args) => callback(...args)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_event, ...args) => callback(...args)),
  restartApp: () => ipcRenderer.send('restart-app'),
});
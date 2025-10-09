const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true, 

  // --- Update-Funktionen ---
  onUpdateInfoAvailable: (callback) => ipcRenderer.on('update-info-available', (_event, updateInfo) => callback(updateInfo)),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_event, ...args) => callback(...args)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_event, ...args) => callback(...args)),
  restartApp: () => ipcRenderer.send('restart-app'),

  // --- Auto-Import Funktionen ---
  onFileImportTriggered: (callback) => ipcRenderer.on('import-file-triggered', (_event, filePath) => callback(filePath)),
  importBackupFromPath: (filePath) => ipcRenderer.invoke('import-backup-from-path', filePath),
  onBackupImportStatus: (callback) => ipcRenderer.on('backup-import-status', (_event, status) => callback(status)),

  // --- NEUE FUNKTIONEN FÜR DAS MODAL ---
  listAllLocalCreationsAndBackups: () => ipcRenderer.invoke('list-all-local-creations-and-backups'),
  prepareBackupForUpload: (filePath, idToken) => ipcRenderer.invoke('prepare-backup-for-upload', filePath, idToken),


  // --- Kern-Funktionen ---
  selectMode: (mode) => ipcRenderer.send('select-mode', mode),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getStoredPath: () => ipcRenderer.invoke('get-stored-path'),
  readFileAsDataURL: (filePath) => ipcRenderer.invoke('read-file-as-data-url', filePath),
  openBackupFolder: () => ipcRenderer.invoke('open-backup-folder'),
  loadExternalBackup: () => ipcRenderer.invoke('load-external-backup'),
  importMediaBackup: () => ipcRenderer.invoke('import-media-backup'),
  hasMediaSnapshot: (filePath) => ipcRenderer.invoke('has-media-snapshot', filePath),
  backupCreationMedia: (filePath, note, isSigned, idToken) => ipcRenderer.invoke('backup-creation-media', filePath, note, isSigned, idToken),
  deleteCreationMedia: (filePath, mode) => ipcRenderer.invoke('delete-creation-media', filePath, mode),
  scanGames: (basePath) => ipcRenderer.invoke('scan-games', basePath),
  createBackup: (filePath, note, isSigned, idToken) => ipcRenderer.invoke('create-backup', filePath, note, isSigned, idToken),
  listAllBackups: () => ipcRenderer.invoke('list-all-backups'),
  restoreBackup: (backupFilePath, originalFilePath) => ipcRenderer.invoke('restore-backup', backupFilePath, originalFilePath),
  deleteBackup: (filePath) => ipcRenderer.invoke('delete-backup', filePath),
  backupAllCreations: (files, note, isSigned, idToken) => ipcRenderer.invoke('backup-all-creations', files, note, isSigned, idToken),
  scanAllMediaFiles: () => ipcRenderer.invoke('scan-all-media-files'),
  createMediaSnapshot: (savePath, mediaPaths) => ipcRenderer.invoke('create-media-snapshot', savePath, mediaPaths),
  getMediaSnapshot: (savePath) => ipcRenderer.invoke('get-media-snapshot', savePath),
  installMedia: (savePath) => ipcRenderer.invoke('install-media', savePath),
  uninstallMedia: (savePath) => ipcRenderer.invoke('uninstall-media', savePath),
  getMediaStatus: (savePath) => ipcRenderer.invoke('get-media-status', savePath),
});
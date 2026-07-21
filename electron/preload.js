const { contextBridge, ipcRenderer } = require('electron');

const TRUSTED_WEB_ORIGINS = new Set([
  'https://planetcreations.net',
  'https://www.planetcreations.net',
]);

let currentOrigin = '';
try { currentOrigin = window.location.origin; } catch (error) { /* local splash */ }
const isTrustedHostedView = TRUSTED_WEB_ORIGINS.has(currentOrigin);
const isBundledClientView = window.location.protocol === 'file:' || currentOrigin === 'http://localhost:3000';

const listen = (channel, callback, transform = (_event, ...args) => args) => {
  const listener = (...args) => callback(...transform(...args));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

// Shared bridge for the trusted hosted website. Normal browsers never receive this
// object; it exists only inside the secured PlanetCreations Electron windows.
const hostedApi = {
  isElectron: true,
  isHostedWebView: isTrustedHostedView,
  isGameOverlay: process.argv.includes('--game-overlay'),
  reportHostedUiReady: (capabilities) => ipcRenderer.invoke('report-hosted-ui-ready', capabilities),

  onUpdateInfoAvailable: (callback) => listen('update-info-available', callback, (_event, info) => [info]),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
  onUpdateAvailable: (callback) => listen('update-available', callback, (_event, ...args) => args),
  onUpdateDownloaded: (callback) => listen('update-downloaded', callback, (_event, ...args) => args),
  restartApp: () => ipcRenderer.send('restart-app'),

  showSystemNotification: (payload) => ipcRenderer.invoke('show-system-notification', payload),
  getLaunchAtLogin: () => ipcRenderer.invoke('get-launch-at-login'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('set-launch-at-login', enabled),
  getClientIdentity: () => ipcRenderer.invoke('get-client-identity'),
  installQueuedCreation: (payload) => ipcRenderer.invoke('install-queued-creation', payload),
  onNavigateToRoute: (callback) => listen('navigate-to-route', callback, (_event, route) => [route]),
  onBackupImportStatus: (callback) => listen('backup-import-status', callback, (_event, status) => [status]),

  listAllLocalCreationsAndBackups: () => ipcRenderer.invoke('list-all-local-creations-and-backups'),
  prepareBackupForUpload: (filePath, idToken) => ipcRenderer.invoke('prepare-backup-for-upload', filePath, idToken),
  uploadBackupFile: (filePath, uploadUrl, contentType) => ipcRenderer.invoke('upload-backup-file', filePath, uploadUrl, contentType),

  startOverlayDrag: (point) => ipcRenderer.send('overlay-drag-start', point),
  moveOverlay: (point) => ipcRenderer.send('overlay-drag-move', point),
  endOverlayDrag: () => ipcRenderer.send('overlay-drag-end'),
  resizeOverlay: (direction) => ipcRenderer.send('overlay-resize', direction),
  setOverlayExpanded: (expanded) => ipcRenderer.invoke('set-overlay-expanded', expanded),
  onOverlayModeChanged: (callback) => listen('overlay-mode-changed', callback, (_event, expanded) => [expanded]),
};

const localApi = {
  ...hostedApi,
  selectMode: (mode) => ipcRenderer.send('select-mode', mode),
  onFileImportTriggered: (callback) => listen('import-file-triggered', callback, (_event, filePath) => [filePath]),
  importBackupFromPath: (filePath) => ipcRenderer.invoke('import-backup-from-path', filePath),
  onBackupsUpdated: (callback) => listen('backups-updated', callback, () => []),
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
  installWorkshopPackage: (packagePath) => ipcRenderer.invoke('install-workshop-package', packagePath),
  uninstallWorkshopPackage: (packagePath) => ipcRenderer.invoke('uninstall-workshop-package', packagePath),
  deleteBackup: (filePath) => ipcRenderer.invoke('delete-backup', filePath),
  backupAllCreations: (files, note, isSigned, idToken) => ipcRenderer.invoke('backup-all-creations', files, note, isSigned, idToken),
  scanAllMediaFiles: () => ipcRenderer.invoke('scan-all-media-files'),
  createMediaSnapshot: (savePath, mediaPaths) => ipcRenderer.invoke('create-media-snapshot', savePath, mediaPaths),
  getMediaSnapshot: (savePath) => ipcRenderer.invoke('get-media-snapshot', savePath),
  installMedia: (savePath, options) => ipcRenderer.invoke('install-media', savePath, options),
  uninstallMedia: (savePath) => ipcRenderer.invoke('uninstall-media', savePath),
  getMediaStatus: (savePath) => ipcRenderer.invoke('get-media-status', savePath),
};

// The main window and overlay deliberately use the same hosted origin so Firebase
// Auth/IndexedDB state is shared between them. Both trusted Electron views need the
// full bridge: the expanded overlay can therefore open the Offline Manager too.
contextBridge.exposeInMainWorld('electronAPI', (isTrustedHostedView || isBundledClientView) ? localApi : { isElectron: true });

const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed preload scripts may only require Electron's explicitly supported
// built-ins. Keep this small channel check self-contained; requiring a local
// module here prevents the entire bridge from loading on current Electron.
const distributionChannel = process.windowsStore === true ||
  process.env?.PLANETCREATIONS_DISTRIBUTION_CHANNEL === 'store'
  ? 'store'
  : 'github';
const distributionInfo = {
  channel: distributionChannel,
  isStore: distributionChannel === 'store',
  updatesManagedBy: distributionChannel === 'store' ? 'microsoft-store' : 'electron-updater',
};
const HOSTED_BRIDGE_VERSION = 3;
const HOSTED_OFFLINE_MANAGER_VERSION = 1;

const TRUSTED_WEB_ORIGINS = new Set([
  'https://planetcreations.net',
  'https://www.planetcreations.net',
]);
const LOOPBACK_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const getDevServerOrigin = () => {
  try {
    const parsed = new URL(
      process.env.PLANETCREATIONS_DEV_SERVER_URL || 'http://localhost:3000'
    );
    if (
      parsed.protocol === 'http:' &&
      LOOPBACK_DEV_HOSTS.has(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    ) {
      return parsed.origin;
    }
  } catch (error) { /* use the safe default */ }
  return 'http://localhost:3000';
};

let currentOrigin = '';
try { currentOrigin = window.location.origin; } catch (error) { /* local splash */ }
const isTrustedHostedView = TRUSTED_WEB_ORIGINS.has(currentOrigin);
const isBundledClientView =
  window.location.protocol === 'file:' ||
  currentOrigin === getDevServerOrigin();

const listen = (channel, callback, transform = (_event, ...args) => args) => {
  const listener = (...args) => callback(...transform(...args));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

// Both desktop channels may run the reviewed Offline Manager UI from the trusted
// PlanetCreations origin. Keep this group explicit and versioned so UI-only web
// updates cannot silently require native capabilities the installed bridge does
// not provide. Every other origin continues to receive none of these operations.
const offlineManagerApi = {
  onFileImportTriggered: (callback) => listen('import-file-triggered', callback, (_event, filePath) => [filePath]),
  reportClientDashboardReady: () => ipcRenderer.invoke('client-dashboard-ready'),
  importBackupFromPath: (filePath) => ipcRenderer.invoke('import-backup-from-path', filePath),
  onBackupsUpdated: (callback) => listen('backups-updated', callback, () => []),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getStoredPath: () => ipcRenderer.invoke('get-stored-path'),
  readFileAsDataURL: (filePath) => ipcRenderer.invoke('read-file-as-data-url', filePath),
  openBackupFolder: () => ipcRenderer.invoke('open-backup-folder'),
  loadExternalBackup: () => ipcRenderer.invoke('load-external-backup'),
  importMediaBackup: () => ipcRenderer.invoke('import-media-backup'),
  hasMediaSnapshot: (filePath) => ipcRenderer.invoke('has-media-snapshot', filePath),
  backupCreationMedia: (filePath, note, isSigned, idToken, appCheckToken) => ipcRenderer.invoke('backup-creation-media', filePath, note, isSigned, idToken, appCheckToken),
  deleteCreationMedia: (filePath, mode) => ipcRenderer.invoke('delete-creation-media', filePath, mode),
  scanGames: (basePath, options) => ipcRenderer.invoke('scan-games', basePath, options),
  onFrontierMetadataUpdated: (callback) => listen('frontier-metadata-updated', callback, (_event, payload) => [payload]),
  createBackup: (filePath, note, isSigned, idToken, appCheckToken) => ipcRenderer.invoke('create-backup', filePath, note, isSigned, idToken, appCheckToken),
  listAllBackups: () => ipcRenderer.invoke('list-all-backups'),
  restoreBackup: (backupFilePath, originalFilePath) => ipcRenderer.invoke('restore-backup', backupFilePath, originalFilePath),
  installWorkshopPackage: (packagePath) => ipcRenderer.invoke('install-workshop-package', packagePath),
  uninstallWorkshopPackage: (packagePath) => ipcRenderer.invoke('uninstall-workshop-package', packagePath),
  deleteBackup: (filePath) => ipcRenderer.invoke('delete-backup', filePath),
  backupAllCreations: (files, note, isSigned, idToken, appCheckToken, includeMediaPackages) => ipcRenderer.invoke('backup-all-creations', files, note, isSigned, idToken, appCheckToken, includeMediaPackages),
  scanAllMediaFiles: () => ipcRenderer.invoke('scan-all-media-files'),
  createMediaSnapshot: (savePath, mediaPaths) => ipcRenderer.invoke('create-media-snapshot', savePath, mediaPaths),
  syncAutomaticMediaSnapshot: (savePath) => ipcRenderer.invoke('sync-automatic-media-snapshot', savePath),
  getMediaSnapshot: (savePath) => ipcRenderer.invoke('get-media-snapshot', savePath),
  installMedia: (savePath, options) => ipcRenderer.invoke('install-media', savePath, options),
  uninstallMedia: (savePath) => ipcRenderer.invoke('uninstall-media', savePath),
  getMediaStatus: (savePath) => ipcRenderer.invoke('get-media-status', savePath),
};

// Shared bridge for the trusted hosted website. Normal browsers never receive this
// object; it exists only inside the secured PlanetCreations Electron windows.
const hostedApi = {
  isElectron: true,
  bridgeVersion: HOSTED_BRIDGE_VERSION,
  distributionChannel: distributionInfo.channel,
  updatesManagedBy: distributionInfo.updatesManagedBy,
  isStoreBuild: distributionInfo.isStore,
  isHostedWebView: isTrustedHostedView,
  hostedOfflineManagerVersion: HOSTED_OFFLINE_MANAGER_VERSION,
  isGameOverlay: process.argv.includes('--game-overlay'),
  isStreamManagement: process.argv.includes('--stream-management'),
  isOverlayNotification: process.argv.includes('--overlay-notification'),
  reportHostedUiReady: (capabilities) => ipcRenderer.invoke('report-hosted-ui-ready', capabilities),

  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
  ...(distributionInfo.isStore ? {} : {
    onUpdateInfoAvailable: (callback) => listen('update-info-available', callback, (_event, info) => [info]),
    onUpdateAvailable: (callback) => listen('update-available', callback, (_event, ...args) => args),
    onUpdateDownloaded: (callback) => listen('update-downloaded', callback, (_event, ...args) => args),
    restartApp: () => ipcRenderer.send('restart-app'),
  }),

  reloadWindow: () => ipcRenderer.invoke('reload-window'),
  showSystemNotification: (payload) => ipcRenderer.invoke('show-system-notification', payload),
  getLaunchAtLogin: () => ipcRenderer.invoke('get-launch-at-login'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('set-launch-at-login', enabled),
  openStartupAppSettings: () => ipcRenderer.invoke('open-startup-app-settings'),
  getClientIdentity: () => ipcRenderer.invoke('get-client-identity'),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  switchDesktopMode: (mode) => ipcRenderer.invoke('switch-desktop-mode', mode),
  installQueuedCreation: (payload) => ipcRenderer.invoke('install-queued-creation', payload),
  onNavigateToRoute: (callback) => listen('navigate-to-route', callback, (_event, route) => [route]),
  onBackupImportStatus: (callback) => listen('backup-import-status', callback, (_event, status) => [status]),

  listAllLocalCreationsAndBackups: () => ipcRenderer.invoke('list-all-local-creations-and-backups'),
  selectFrontierFolder: () => ipcRenderer.invoke('select-frontier-folder'),
  readFrontierPreview: (filePath) => ipcRenderer.invoke('read-frontier-preview', filePath),
  inspectFrontierFile: (filePath) => ipcRenderer.invoke('inspect-frontier-file', filePath),
  getLatestCollaborationFile: (gameId, expectedFileName) => ipcRenderer.invoke('get-latest-collaboration-file', gameId, expectedFileName),
  selectCollaborationFile: (gameId) => ipcRenderer.invoke('select-collaboration-file', gameId),
  prepareBackupForUpload: (filePath, idToken, appCheckToken) => ipcRenderer.invoke('prepare-backup-for-upload', filePath, idToken, appCheckToken),
  uploadPreparedBackup: (uploadHandle, idToken, appCheckToken, consent) => ipcRenderer.invoke('upload-prepared-backup', uploadHandle, idToken, appCheckToken, consent),
  saveCollaborationVersion: (payload) => ipcRenderer.invoke('save-collaboration-version', payload),

  getObsStatus: () => ipcRenderer.invoke('get-obs-status'),
  setObsConfig: (config) => ipcRenderer.invoke('set-obs-config', config),
  onObsStatusChanged: (callback) => listen('obs-status-changed', callback, (_event, status) => [status]),
  onObsStreamStarted: (callback) => listen('obs-stream-started', callback, (_event, payload) => [payload]),
  onObsStreamStopped: (callback) => listen('obs-stream-stopped', callback, () => []),
  getStreamStartContext: () => ipcRenderer.invoke('get-stream-start-context'),
  openStreamManagement: () => ipcRenderer.invoke('open-stream-management'),
  closeStreamManagement: () => ipcRenderer.invoke('close-stream-management'),
  syncStreamManagementSession: (session) => ipcRenderer.invoke('sync-stream-management-session', session),
  onStreamManagementContextChanged: (callback) => listen('stream-management-context-changed', callback, (_event, context) => [context]),
  showOverlayNotification: (notification) => ipcRenderer.invoke('show-overlay-notification', notification),
  getOverlayNotificationContext: () => ipcRenderer.invoke('get-overlay-notification-context'),
  onOverlayNotificationChanged: (callback) => listen('overlay-notification-changed', callback, (_event, notification) => [notification]),
  closeOverlayNotification: () => ipcRenderer.invoke('close-overlay-notification'),
  openOverlayNotificationLink: (link) => ipcRenderer.invoke('open-overlay-notification-link', link),
  getOverlayForced: () => ipcRenderer.invoke('get-overlay-forced'),
  setOverlayForced: (value) => ipcRenderer.invoke('set-overlay-forced', value),
  onOverlayForcedChanged: (callback) => listen('overlay-forced-changed', callback, (_event, value) => [value]),
  getActiveGame: () => ipcRenderer.invoke('get-active-game'),
  onActiveGameChanged: (callback) => listen('active-game-changed', callback, (_event, gameId) => [gameId]),
  onGameProcessStopped: (callback) => listen('game-process-stopped', callback, (_event, payload) => [payload]),

  startOverlayDrag: (point) => ipcRenderer.send('overlay-drag-start', point),
  moveOverlay: (point) => ipcRenderer.send('overlay-drag-move', point),
  endOverlayDrag: () => ipcRenderer.send('overlay-drag-end'),
  resizeOverlay: (direction) => ipcRenderer.send('overlay-resize', direction),
  setOverlayExpanded: (expanded) => ipcRenderer.invoke('set-overlay-expanded', expanded),
  onOverlayModeChanged: (callback) => listen('overlay-mode-changed', callback, (_event, expanded) => [expanded]),

  ...offlineManagerApi,
};

const localApi = {
  ...hostedApi,
  ...offlineManagerApi,
  selectMode: (mode) => ipcRenderer.send('select-mode', mode),
};

// Only the exact trusted HTTPS origins receive the hosted bridge. Every packaged
// client retains a reviewed bundled copy as an offline and compatibility fallback.
contextBridge.exposeInMainWorld(
  'electronAPI',
  isTrustedHostedView ? hostedApi : (isBundledClientView ? localApi : { isElectron: true })
);

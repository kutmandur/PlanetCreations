const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, Notification, screen } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const mime = require('mime-types');
const AdmZip = require('adm-zip');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const fetch = require('node-fetch');

const { scanGamesFromPath, scanAllMediaFiles } = require('./modules/FileHandler');
const { createBackup, listAllBackups, restoreBackup, installCreationPackage, archiveWorkshopPackage, installWorkshopPackage, uninstallWorkshopPackage, backupCreationMedia, importMediaBackup, deleteBackup, backupAllCreations, verifyBackup, validateBackupForUpload, isValidGameFile, ALLOWED_GAME_EXTENSIONS } = require('./modules/BackupManager');
const { createOrUpdateSnapshot, getSnapshot, installMedia, uninstallMedia, getMediaSetStatus, hasMediaSnapshot, deleteCreationMedia } = require('./modules/MediaManager');

const isDev = !app.isPackaged;
const useHostedUiInDev = isDev && process.env.PLANETCREATIONS_USE_HOSTED_UI === '1';
const AUTO_START_ARG = '--autostart';
const isAutoStart = app.isPackaged && process.argv.includes(AUTO_START_ARG);
const backupCategoryMap = { '.park2': 'Parks', '.zoo': 'Parks', '.blpr2': 'Blueprints', '.pzblueprint': 'Blueprints', '.prkauto2': 'Auto Save', '.zooauto': 'Auto Save' };
let mainWindow;
let tray;
let gameOverlayWindow;
let gameProcessTimer;
let updateCheckTimer;
let overlayDragState = null;
let isGameOverlayExpanded = false;
let pendingMainWebRefresh = false;
let isQuitting = false;
let hasShownTrayHint = false;
const activeNotifications = new Set();
const GAME_PROCESS_NAME = 'PlanetCoaster2.exe';
const OVERLAY_MIN_SIZE = 56;
const OVERLAY_MAX_SIZE = 180;
const OVERLAY_DEFAULT_SIZE = 88;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRODUCTION_WEB_ORIGIN = 'https://planetcreations.net';

function getBundledAppUrl() {
    return isDev ? 'http://localhost:3000' : pathToFileURL(path.join(__dirname, '../build/index.html')).toString();
}

function getHostedAppUrl() {
    return isDev && !useHostedUiInDev ? 'http://localhost:3000' : PRODUCTION_WEB_ORIGIN;
}

function isAllowedAppUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.origin === PRODUCTION_WEB_ORIGIN || parsed.origin === 'https://www.planetcreations.net') return true;
        if (isDev && parsed.origin === 'http://localhost:3000') return true;
        if (parsed.protocol !== 'file:') return false;
        const filePath = path.resolve(fileURLToPath(parsed));
        const allowedRoots = [path.resolve(__dirname, '../build'), path.resolve(__dirname, '../public')];
        return allowedRoots.some((root) => filePath === root || filePath.startsWith(`${root}${path.sep}`));
    } catch (error) {
        return false;
    }
}

function isHostedAppUrl(rawUrl) {
    try {
        const origin = new URL(rawUrl).origin;
        return origin === PRODUCTION_WEB_ORIGIN || origin === 'https://www.planetcreations.net';
    } catch (error) {
        return false;
    }
}

function openSafeExternalUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        shell.openExternal(parsed.toString());
        return true;
    } catch (error) {
        return false;
    }
}

function secureAppWindow(browserWindow) {
    browserWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        if (isAllowedAppUrl(navigationUrl)) return;
        event.preventDefault();
        openSafeExternalUrl(navigationUrl);
    });
    browserWindow.webContents.setWindowOpenHandler(({ url }) => {
        openSafeExternalUrl(url);
        return { action: 'deny' };
    });
}

function isTrustedIpcSender(event, allowHosted = false) {
    const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    if (!isAllowedAppUrl(senderUrl)) return false;
    return allowHosted || !isHostedAppUrl(senderUrl);
}

function requireTrustedIpcSender(event, allowHosted = false) {
    if (!isTrustedIpcSender(event, allowHosted)) throw new Error('IPC request rejected for an untrusted page.');
}

function loadHostedAppWithFallback(browserWindow, hashRoute = '/', { requireOverlayCapability = false } = {}) {
    const hostedUrl = `${getHostedAppUrl()}#${hashRoute}`;
    const fallbackUrl = `${getBundledAppUrl()}#${hashRoute}`;
    let usingFallback = false;
    let capabilityTimer = null;
    const loadFallback = (reason) => {
        if (usingFallback || browserWindow.isDestroyed()) return;
        usingFallback = true;
        if (capabilityTimer) clearTimeout(capabilityTimer);
        log.warn(`Hosted UI unavailable (${reason}); loading bundled fallback.`);
        browserWindow.loadURL(fallbackUrl).catch((error) => log.error('Bundled UI fallback failed:', error));
    };
    const handleLoadFailure = (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || usingFallback || !isHostedAppUrl(validatedUrl)) return;
        loadFallback(`${errorCode}: ${errorDescription}`);
    };
    if (browserWindow.__hostedFallbackListener) {
        browserWindow.webContents.removeListener('did-fail-load', browserWindow.__hostedFallbackListener);
    }
    browserWindow.__hostedFallbackListener = handleLoadFailure;
    browserWindow.webContents.on('did-fail-load', handleLoadFailure);
    browserWindow.webContents.__hostedUiCapabilities = null;
    if (requireOverlayCapability) {
        browserWindow.webContents.once('did-finish-load', () => {
            if (!isHostedAppUrl(browserWindow.webContents.getURL())) return;
            capabilityTimer = setTimeout(() => {
                if (browserWindow.webContents.__hostedUiCapabilities?.gameOverlay !== true) {
                    loadFallback('hosted UI does not advertise overlay support');
                }
            }, 2500);
        });
    }
    const loadPromise = browserWindow.loadURL(hostedUrl);
    loadPromise.catch((error) => loadFallback(error.message));
    return loadPromise;
}

function getOverlaySettingsPath() {
    return path.join(app.getPath('userData'), 'game-overlay.json');
}

function readOverlaySettings() {
    try {
        const stored = JSON.parse(fs.readFileSync(getOverlaySettingsPath(), 'utf8'));
        return {
            x: Number.isFinite(stored.x) ? Math.round(stored.x) : null,
            y: Number.isFinite(stored.y) ? Math.round(stored.y) : null,
            size: Math.min(OVERLAY_MAX_SIZE, Math.max(OVERLAY_MIN_SIZE, Number(stored.size) || OVERLAY_DEFAULT_SIZE)),
            panelBounds: stored.panelBounds || null,
        };
    } catch (error) {
        return { x: null, y: null, size: OVERLAY_DEFAULT_SIZE, panelBounds: null };
    }
}

function writeOverlaySettings(patch) {
    const current = readOverlaySettings();
    try {
        fs.writeFileSync(getOverlaySettingsPath(), JSON.stringify({ ...current, ...patch }, null, 2));
    } catch (error) {
        log.warn('Could not save game overlay settings:', error);
    }
}

function keepBoundsOnScreen(bounds) {
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    return {
        x: Math.min(Math.max(bounds.x, area.x), area.x + Math.max(0, area.width - bounds.width)),
        y: Math.min(Math.max(bounds.y, area.y), area.y + Math.max(0, area.height - bounds.height)),
        width: Math.min(bounds.width, area.width),
        height: Math.min(bounds.height, area.height),
    };
}

function createGameOverlayWindow() {
    if (gameOverlayWindow && !gameOverlayWindow.isDestroyed()) return gameOverlayWindow;
    const settings = readOverlaySettings();
    const primaryArea = screen.getPrimaryDisplay().workArea;
    const initialBounds = keepBoundsOnScreen({
        x: settings.x ?? primaryArea.x + primaryArea.width - settings.size - 32,
        y: settings.y ?? primaryArea.y + Math.round((primaryArea.height - settings.size) / 2),
        width: settings.size,
        height: settings.size,
    });

    gameOverlayWindow = new BrowserWindow({
        ...initialBounds,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        hasShadow: false,
        thickFrame: false,
        icon: getAppIconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: ['--game-overlay'],
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    gameOverlayWindow.setMenu(null);
    secureAppWindow(gameOverlayWindow);
    gameOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
    loadHostedAppWithFallback(gameOverlayWindow, '/', { requireOverlayCapability: true });
    gameOverlayWindow.on('closed', () => { gameOverlayWindow = null; });
    return gameOverlayWindow;
}

function setOverlayExpanded(expanded) {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed()) return false;
    const settings = readOverlaySettings();
    if (expanded) {
        isGameOverlayExpanded = true;
        const compact = gameOverlayWindow.getBounds();
        writeOverlaySettings({ x: compact.x, y: compact.y, size: compact.width });
        const area = screen.getDisplayMatching(compact).workArea;
        const saved = settings.panelBounds;
        const hasValidSavedPanel = saved && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved[key]));
        const desired = hasValidSavedPanel ? saved : {
            width: Math.min(980, area.width - 48),
            height: Math.min(780, area.height - 48),
            x: Math.round(compact.x + compact.width / 2 - Math.min(980, area.width - 48) / 2),
            y: Math.round(compact.y + compact.height / 2 - Math.min(780, area.height - 48) / 2),
        };
        gameOverlayWindow.setResizable(true);
        gameOverlayWindow.setHasShadow(true);
        gameOverlayWindow.setBounds(keepBoundsOnScreen(desired), true);
        gameOverlayWindow.webContents.send('overlay-mode-changed', true);
        gameOverlayWindow.focus();
    } else {
        isGameOverlayExpanded = false;
        const panelBounds = gameOverlayWindow.getBounds();
        writeOverlaySettings({ panelBounds });
        const compactBounds = keepBoundsOnScreen({ x: settings.x ?? panelBounds.x, y: settings.y ?? panelBounds.y, width: settings.size, height: settings.size });
        gameOverlayWindow.webContents.send('overlay-mode-changed', false);
        gameOverlayWindow.setResizable(false);
        gameOverlayWindow.setHasShadow(false);
        gameOverlayWindow.setBounds(compactBounds, true);
    }
    return true;
}

function isPlanetCoaster2Running() {
    if (process.platform !== 'win32') return Promise.resolve(false);
    return new Promise((resolve) => {
        execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${GAME_PROCESS_NAME}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout = '') => {
            resolve(!error && stdout.toLowerCase().includes(GAME_PROCESS_NAME.toLowerCase()));
        });
    });
}

async function updateGameOverlayVisibility() {
    const running = await isPlanetCoaster2Running();
    if (running) {
        const overlay = createGameOverlayWindow();
        if (!overlay.isVisible()) overlay.showInactive();
    } else if (gameOverlayWindow && !gameOverlayWindow.isDestroyed()) {
        gameOverlayWindow.hide();
    }
}

function startGameProcessMonitor() {
    updateGameOverlayVisibility();
    gameProcessTimer = setInterval(updateGameOverlayVisibility, 4000);
}

function getAppIconPath() {
    return isDev ?
        path.join(__dirname, '../public/favicon.ico') :
        path.join(__dirname, '../build/favicon.ico');
}

function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') app.dock?.show();
}

function createTray() {
    if (tray && !tray.isDestroyed()) return;
    try {
        tray = new Tray(getAppIconPath());
        tray.setToolTip('PlanetCreations Client');
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'PlanetCreations is running in the background', enabled: false },
            { type: 'separator' },
            { label: 'Open', click: showMainWindow },
            {
                label: 'Quit',
                click: () => {
                    isQuitting = true;
                    app.quit();
                },
            },
        ]));
        tray.on('click', showMainWindow);
        tray.on('balloon-click', showMainWindow);
    } catch (error) {
        log.error('Could not create system tray icon:', error);
        tray = null;
    }
}

function hideMainWindowToTray() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.hide();
    if (pendingMainWebRefresh && isHostedAppUrl(mainWindow.webContents.getURL())) {
        pendingMainWebRefresh = false;
        mainWindow.webContents.reloadIgnoringCache();
    }
    if (process.platform === 'darwin') app.dock?.hide();
    if (!hasShownTrayHint && tray && process.platform === 'win32') {
        tray.displayBalloon({
            iconType: 'info',
            title: 'PlanetCreations is still running',
            content: 'Notifications and background tasks remain active. Use the tray menu to open or quit the client.',
        });
        hasShownTrayHint = true;
    }
}

function sanitizeNotificationPayload(payload) {
    const title = typeof payload?.title === 'string' ? payload.title.trim().slice(0, 120) : '';
    const body = typeof payload?.body === 'string' ? payload.body.trim().slice(0, 500) : '';
    const rawLink = typeof payload?.link === 'string' ? payload.link.trim() : '';
    const link = rawLink.startsWith('/') && !rawLink.startsWith('//') && rawLink.length <= 500 ? rawLink : null;
    return { title: title || 'PlanetCreations', body, link };
}

function showSystemNotification(payload) {
    if (!Notification.isSupported() || (mainWindow?.isVisible() && mainWindow?.isFocused())) {
        return { shown: false };
    }
    const { title, body, link } = sanitizeNotificationPayload(payload);
    const notification = new Notification({ title, body, icon: getAppIconPath() });
    activeNotifications.add(notification);
    notification.on('click', () => {
        showMainWindow();
        if (link && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('navigate-to-route', link);
        }
    });
    notification.on('close', () => activeNotifications.delete(notification));
    notification.show();
    return { shown: true };
}

function getLaunchAtLoginStatus() {
    const supported = app.isPackaged && process.platform === 'win32';
    if (!supported) return { supported: false, enabled: false };

    const settings = app.getLoginItemSettings({
        path: process.execPath,
        args: [AUTO_START_ARG],
    });
    return { supported: true, enabled: settings.openAtLogin };
}

function setLaunchAtLogin(enabled) {
    if (typeof enabled !== 'boolean') {
        throw new TypeError('The launch-at-login setting must be a boolean.');
    }
    if (!app.isPackaged || process.platform !== 'win32') {
        return { supported: false, enabled: false };
    }

    app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: [AUTO_START_ARG],
    });
    return getLaunchAtLoginStatus();
}

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

function startDailyUpdateChecks() {
    if (isDev) return;
    if (updateCheckTimer) clearInterval(updateCheckTimer);
    updateCheckTimer = setInterval(() => {
        log.info('Running scheduled daily update check...');
        autoUpdater.checkForUpdates().catch((error) => {
            // The updater also emits an error event, which runs the GitHub API fallback.
            log.warn('Scheduled update check failed:', error);
        });
        refreshHostedWebViews();
    }, UPDATE_CHECK_INTERVAL_MS);
}

function refreshHostedWebViews() {
    if (mainWindow && !mainWindow.isDestroyed() && isHostedAppUrl(mainWindow.webContents.getURL())) {
        if (mainWindow.isVisible()) pendingMainWebRefresh = true;
        else mainWindow.webContents.reloadIgnoringCache();
    }
    if (gameOverlayWindow && !gameOverlayWindow.isDestroyed() && isHostedAppUrl(gameOverlayWindow.webContents.getURL()) && !isGameOverlayExpanded) {
        gameOverlayWindow.webContents.reloadIgnoringCache();
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

function validateR2DownloadUrl(downloadUrl) {
    if (typeof downloadUrl !== 'string' || downloadUrl.length > 4096) {
        throw new Error('The download URL is invalid.');
    }
    const parsed = new URL(downloadUrl);
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS downloads are allowed for security reasons.');
    if (!parsed.hostname.endsWith('.r2.cloudflarestorage.com')) {
        throw new Error('Direct creation installs are only accepted from PlanetCreations R2 downloads.');
    }
    return parsed.toString();
}

async function downloadR2PackageToTemp(downloadUrl) {
    const safeUrl = validateR2DownloadUrl(downloadUrl);
    const response = await fetch(safeUrl);
    if (!response.ok) throw new Error(`Failed to download file. Status: ${response.status} ${response.statusText}`);

    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > 300 * 1024 * 1024) {
        throw new Error('The download exceeds the 300 MB package limit.');
    }
    const buffer = await response.buffer();
    if (buffer.length <= 0 || buffer.length > 300 * 1024 * 1024) {
        throw new Error('The downloaded package has an invalid size.');
    }
    const tempPath = path.join(app.getPath('temp'), `${crypto.randomUUID()}.PlanetCreations`);
    fs.writeFileSync(tempPath, buffer);
    return tempPath;
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
        if (!downloadUrl) throw new Error('No download URL found in the link.');
        tempPath = await downloadR2PackageToTemp(downloadUrl);
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
// Development-only escape hatch for an isolated overlay preview while the installed
// client is already running. Packaged builds always retain single-instance behavior.
const isOverlayTestInstance = isDev && process.argv.includes('--overlay-test-instance');
const gotTheLock = isOverlayTestInstance || app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const url = commandLine.find((argument) =>
        argument.startsWith('planetcreations://') || argument.endsWith('.PlanetCreations')
    );
    showMainWindow();
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
        const configPath = path.join(app.getPath('userData'), 'config.json');
        let config = {};
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        config.frontierPath = newPath;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) { console.error("Error storing path:", error); }
}

function getFrontierPathForInstall() {
    const storedPath = getStoredPath();
    if (storedPath && fs.existsSync(storedPath)) return storedPath;
    const candidates = [
        path.join(app.getPath('home'), 'Saved Games', 'Frontier Developments'),
        path.join(app.getPath('documents'), 'Frontier Developments'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || storedPath || candidates[0];
}

function getClientIdentity() {
    const identityPath = path.join(app.getPath('userData'), 'device.json');
    let identity = {};
    try {
        if (fs.existsSync(identityPath)) identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    } catch (error) {
        log.warn('Could not read desktop client identity:', error);
    }
    let changed = false;
    if (typeof identity.clientId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identity.clientId)) {
        identity.clientId = crypto.randomUUID();
        changed = true;
    }
    if (typeof identity.displayName !== 'string' || !identity.displayName.trim()) {
        identity.displayName = String(os.hostname() || 'Windows PC').trim().slice(0, 50) || 'Windows PC';
        changed = true;
    }
    if (changed) {
        try {
            fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2));
        } catch (error) {
            log.warn('Could not persist desktop client identity:', error);
        }
    }
    return {
        clientId: identity.clientId,
        displayName: identity.displayName,
        platform: process.platform,
        clientVersion: app.getVersion(),
    };
}

function createWindow({ openOnline = false } = {}) {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: getAppIconPath(),
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
    });

    mainWindow.setMenu(null);
    secureAppWindow(mainWindow);
    const splashPath = isDev ? path.join(__dirname, '../public/splash.html') : path.join(__dirname, '../build/splash.html');
    const bundledAppUrl = getBundledAppUrl();
    if (openOnline) loadHostedAppWithFallback(mainWindow, '/');
    else mainWindow.loadFile(splashPath);
    
    ipcMain.on('select-mode', (event, mode) => {
        if (!isTrustedIpcSender(event) || event.sender !== mainWindow?.webContents) return;
        if (mode === 'online') loadHostedAppWithFallback(mainWindow, '/');
        else if (mode === 'offline') mainWindow.loadURL(`${bundledAppUrl}#/client/dashboard`);
    });

    if (isDev) mainWindow.webContents.openDevTools();

    mainWindow.on('close', (event) => {
        if (isQuitting || !tray) return;
        event.preventDefault();
        hideMainWindowToTray();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.once('ready-to-show', () => {
        if (!isDev) {
            autoUpdater.checkForUpdates();
            startDailyUpdateChecks();
        }
    });

    const initialUrlOrFile = !isDev ? process.argv.slice(1).find((argument) =>
        argument.startsWith('planetcreations://') || argument.endsWith('.PlanetCreations')
    ) : null;
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
ipcMain.on('restart-app', (event) => {
    if (!isTrustedIpcSender(event, true)) return;
    isQuitting = true;
    autoUpdater.quitAndInstall();
});

// --- IPC LISTENER ---
ipcMain.handle('open-external-link', (event, url) => {
    requireTrustedIpcSender(event, true);
    return openSafeExternalUrl(url);
});

ipcMain.handle('show-system-notification', (event, payload) => {
    requireTrustedIpcSender(event, true);
    return showSystemNotification(payload);
});

ipcMain.handle('get-launch-at-login', (event) => {
    requireTrustedIpcSender(event, true);
    return getLaunchAtLoginStatus();
});
ipcMain.handle('report-hosted-ui-ready', (event, capabilities) => {
    requireTrustedIpcSender(event, true);
    const senderUrl = event.senderFrame?.url || event.sender.getURL();
    if (!isHostedAppUrl(senderUrl)) return false;
    event.sender.__hostedUiCapabilities = {
        bridgeVersion: Number.isInteger(capabilities?.bridgeVersion) ? capabilities.bridgeVersion : 0,
        gameOverlay: capabilities?.gameOverlay === true,
    };
    return true;
});
ipcMain.handle('set-launch-at-login', (event, enabled) => {
    requireTrustedIpcSender(event, true);
    return setLaunchAtLogin(enabled);
});
ipcMain.on('overlay-drag-start', (event, point) => {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed() || event.sender !== gameOverlayWindow.webContents) return;
    if (!Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
    overlayDragState = { pointerX: point.screenX, pointerY: point.screenY, bounds: gameOverlayWindow.getBounds() };
});
ipcMain.on('overlay-drag-move', (event, point) => {
    if (!overlayDragState || !gameOverlayWindow || gameOverlayWindow.isDestroyed() || event.sender !== gameOverlayWindow.webContents) return;
    if (!Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
    const next = keepBoundsOnScreen({
        ...overlayDragState.bounds,
        x: overlayDragState.bounds.x + Math.round(point.screenX - overlayDragState.pointerX),
        y: overlayDragState.bounds.y + Math.round(point.screenY - overlayDragState.pointerY),
    });
    gameOverlayWindow.setBounds(next);
});
ipcMain.on('overlay-drag-end', (event) => {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed() || event.sender !== gameOverlayWindow.webContents) return;
    const bounds = gameOverlayWindow.getBounds();
    if (gameOverlayWindow.isResizable()) writeOverlaySettings({ panelBounds: bounds });
    else writeOverlaySettings({ x: bounds.x, y: bounds.y, size: bounds.width });
    overlayDragState = null;
});
ipcMain.on('overlay-resize', (event, direction) => {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed() || gameOverlayWindow.isResizable() || event.sender !== gameOverlayWindow.webContents) return;
    const current = gameOverlayWindow.getBounds();
    const nextSize = Math.min(OVERLAY_MAX_SIZE, Math.max(OVERLAY_MIN_SIZE, current.width + (direction > 0 ? 8 : -8)));
    const next = keepBoundsOnScreen({
        x: Math.round(current.x - (nextSize - current.width) / 2),
        y: Math.round(current.y - (nextSize - current.height) / 2),
        width: nextSize,
        height: nextSize,
    });
    gameOverlayWindow.setBounds(next);
    if (overlayDragState) {
        const pointer = screen.getCursorScreenPoint();
        overlayDragState = { pointerX: pointer.x, pointerY: pointer.y, bounds: next };
    }
    writeOverlaySettings({ x: next.x, y: next.y, size: nextSize });
});
ipcMain.handle('set-overlay-expanded', (event, expanded) => {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed() || event.sender !== gameOverlayWindow.webContents) return false;
    overlayDragState = null;
    return setOverlayExpanded(Boolean(expanded));
});
ipcMain.handle('get-client-identity', (event) => {
    requireTrustedIpcSender(event, true);
    return getClientIdentity();
});
ipcMain.handle('install-queued-creation', async (event, payload) => {
    requireTrustedIpcSender(event, true);
    const creationId = typeof payload?.creationId === 'string' ? payload.creationId.trim() : '';
    const downloadUrl = typeof payload?.downloadUrl === 'string' ? payload.downloadUrl : '';
    const title = typeof payload?.title === 'string' ? payload.title.trim().slice(0, 200) : '';
    const previewUrl = typeof payload?.previewUrl === 'string' ? payload.previewUrl : '';
    if (!creationId || creationId.length > 128) {
        return { success: false, permanent: true, message: 'The creation ID is invalid.' };
    }

    let tempPath = null;
    try {
        tempPath = await downloadR2PackageToTemp(downloadUrl);
        const workshopPath = await archiveWorkshopPackage(app, tempPath, creationId, { title, previewUrl });
        const result = await installCreationPackage(app, workshopPath, creationId, getFrontierPathForInstall());
        return { ...result, workshopPath };
    } catch (error) {
        log.error(`Direct install failed for creation ${creationId}:`, error);
        return { success: false, permanent: false, message: error.message };
    } finally {
        if (tempPath && fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch (error) { log.warn('Could not remove direct-install temp file:', error); }
        }
    }
});

ipcMain.handle('install-workshop-package', async (_event, packagePath) =>
    installWorkshopPackage(app, packagePath, getFrontierPathForInstall()));
ipcMain.handle('uninstall-workshop-package', async (_event, packagePath) =>
    uninstallWorkshopPackage(app, packagePath));

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
    requireTrustedIpcSender(event, true);
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
    requireTrustedIpcSender(event, true);
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
    requireTrustedIpcSender(event, true);
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

app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.planetcreations.app');
    createTray();
    createWindow({ openOnline: isAutoStart || useHostedUiInDev });
    startGameProcessMonitor();
});
app.on('before-quit', () => {
    isQuitting = true;
    if (gameProcessTimer) clearInterval(gameProcessTimer);
    if (updateCheckTimer) clearInterval(updateCheckTimer);
});
app.on('window-all-closed', () => {
    if (!tray || isQuitting) app.quit();
});
app.on('activate', showMainWindow);
app.on('will-quit', () => {
    if (tray && !tray.isDestroyed()) tray.destroy();
});

app.on('open-url', (event, url) => {
    event.preventDefault();
    showMainWindow();
    handleUrlImport(url);
});

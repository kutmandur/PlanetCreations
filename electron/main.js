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

const {
    indexGamesFromPath,
    inspectFrontierFileInWorker,
    saveMetadataInspection,
    scanGamesFromPath,
    scanAllMediaFiles,
} = require('./modules/FileHandler');
const { readFrontierPreview } = require('./modules/FrontierSaveParser');
const { findLatestCollaborationSave } = require('./modules/CollaborationSaveFinder');
const { detectActiveGameFromTasklist } = require('./modules/GameProcessMonitor');
const { resolveDevServerUrl } = require('./modules/DevServerUrl');
const { OBSIntegration } = require('./modules/OBSIntegration');
const { StreamlabsIntegration } = require('./modules/StreamlabsIntegration');
const { responseToBuffer } = require('./modules/ResponseBuffer');
const { createBackup, listAllBackups, restoreBackup, installCreationPackage, archiveWorkshopPackage, installWorkshopPackage, uninstallWorkshopPackage, backupCreationMedia, importMediaBackup, deleteBackup, backupAllCreations, verifyBackup, validateBackupForUpload, isValidGameFile, ALLOWED_GAME_EXTENSIONS } = require('./modules/BackupManager');
const { createOrUpdateSnapshot, getSnapshot, installMedia, uninstallMedia, getMediaSetStatus, hasMediaSnapshot, deleteCreationMedia, syncAutomaticMediaSnapshot } = require('./modules/MediaManager');

const isDev = !app.isPackaged;
const shouldOpenDevTools = isDev && process.argv.includes('--devtools');
const forceRecaptchaAppCheckForTest = isDev && process.argv.includes('--force-recaptcha-app-check-for-test');
const useHostedUiInDev = isDev && process.env.PLANETCREATIONS_USE_HOSTED_UI === '1';
const openLocalUiInDev = isDev && process.argv.includes('--local-ui');
const devServerUrl = resolveDevServerUrl(process.env.PLANETCREATIONS_DEV_SERVER_URL);
const AUTO_START_ARG = '--autostart';
const isAutoStart = app.isPackaged && process.argv.includes(AUTO_START_ARG);
const backupCategoryMap = { '.park2': 'Parks', '.zoo': 'Parks', '.blpr2': 'Blueprints', '.pzblueprint': 'Blueprints', '.prkauto2': 'Auto Save', '.zooauto': 'Auto Save' };
let mainWindow;
let tray;
let gameOverlayWindow;
let streamManagementWindow;
let overlayNotificationWindow;
let pendingStreamStartContext = null;
let pendingOverlayNotification = null;
let lastStreamNotificationIds = new Set();
let gameProcessTimer;
let activeGameId = null;
let gameProcessCheckInFlight = false;
let updateCheckTimer;
let overlayDragState = null;
let overlayDragFlushTimer = null;
let pendingOverlayDragPoint = null;
let overlaySettingsWriteTimer = null;
let pendingOverlaySettingsPatch = null;
let isGameOverlayExpanded = false;
let pendingMainWebRefresh = false;
let isQuitting = false;
let hasShownTrayHint = false;
let streamingIntegration = null;
let frontierMetadataScanGeneration = 0;
// Manueller Overlay-Schalter: zeigt das Overlay unabhängig von der
// PC2-Prozesserkennung — auf macOS/Linux der einzige Weg (kein tasklist.exe),
// auf Windows praktisch zum Positionieren/Testen ohne laufendes Spiel.
let overlayForcedVisible = false;
const activeNotifications = new Set();
const OVERLAY_MIN_SIZE = 56;
// 640 statt 180: Im QR-Modus zeigt der Puck das volle Sharing-Template, in dem
// der QR nur ~37% der Bildbreite ausmacht — Streamer müssen ihn groß genug
// ziehen können, damit er vom Stream abscanbar bleibt.
const OVERLAY_MAX_SIZE = 640;
const OVERLAY_DEFAULT_SIZE = 88;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRODUCTION_WEB_ORIGIN = 'https://planetcreations.net';

function getBundledAppUrl() {
    return withLocalTestParameters(isDev ? devServerUrl : pathToFileURL(path.join(__dirname, '../build/index.html')).toString());
}

function getHostedAppUrl() {
    return withLocalTestParameters(isDev && !useHostedUiInDev ? devServerUrl : PRODUCTION_WEB_ORIGIN);
}

function withLocalTestParameters(rawUrl) {
    if (!forceRecaptchaAppCheckForTest) return rawUrl;
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('pcAppCheck', 'recaptcha-test-only');
    return parsed.toString();
}

function isAllowedAppUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.origin === PRODUCTION_WEB_ORIGIN || parsed.origin === 'https://www.planetcreations.net') return true;
        if (isDev && parsed.origin === devServerUrl) return true;
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
            forcedVisible: stored.forcedVisible === true,
        };
    } catch (error) {
        return { x: null, y: null, size: OVERLAY_DEFAULT_SIZE, panelBounds: null, forcedVisible: false };
    }
}

function writeOverlaySettings(patch) {
    const current = readOverlaySettings();
    try {
        fs.writeFileSync(getOverlaySettingsPath(), JSON.stringify({ ...current, ...patch }, null, 2));
    } catch (error) {
        log.warn('Could not save In-Game Overlay settings:', error);
    }
}

function flushPendingOverlaySettings() {
    if (overlaySettingsWriteTimer) {
        clearTimeout(overlaySettingsWriteTimer);
        overlaySettingsWriteTimer = null;
    }
    if (!pendingOverlaySettingsPatch) return;
    const patch = pendingOverlaySettingsPatch;
    pendingOverlaySettingsPatch = null;
    writeOverlaySettings(patch);
}

function scheduleOverlaySettingsWrite(patch) {
    pendingOverlaySettingsPatch = { ...(pendingOverlaySettingsPatch || {}), ...patch };
    if (overlaySettingsWriteTimer) clearTimeout(overlaySettingsWriteTimer);
    overlaySettingsWriteTimer = setTimeout(flushPendingOverlaySettings, 250);
}

// --- Streaming-Integration (OBS ODER Streamlabs Desktop, wählbar) ---
// Beide Adapter teilen sich Event-Interface und IPC-Kanäle; hier liegen
// Konfiguration und Lifecycle. OBS: obs-websocket (Port 4455, Passwort).
// Streamlabs: SockJS-Remote-Control-API (IP, Port 59650 und API-Token).

function getStreamingSettingsPath() {
    return path.join(app.getPath('userData'), 'streaming-settings.json');
}

function readStreamingSettings() {
    const defaults = { provider: 'obs', enabled: false, obsPort: 4455, obsPassword: '', slHost: '127.0.0.1', slPort: 59650, slToken: '' };
    try {
        const stored = JSON.parse(fs.readFileSync(getStreamingSettingsPath(), 'utf8'));
        const validPort = (value, fallback) =>
            (Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback);
        return {
            provider: stored.provider === 'streamlabs' ? 'streamlabs' : 'obs',
            enabled: stored.enabled === true,
            obsPort: validPort(stored.obsPort, defaults.obsPort),
            obsPassword: typeof stored.obsPassword === 'string' ? stored.obsPassword : '',
            slHost: typeof stored.slHost === 'string' && stored.slHost.trim() ? stored.slHost.trim() : defaults.slHost,
            slPort: validPort(stored.slPort, defaults.slPort),
            slToken: typeof stored.slToken === 'string' ? stored.slToken : '',
        };
    } catch (error) {
        return defaults;
    }
}

function writeStreamingSettings(next) {
    try {
        fs.writeFileSync(getStreamingSettingsPath(), JSON.stringify(next, null, 2));
    } catch (error) {
        log.warn('Could not save streaming settings:', error);
    }
}

function createStreamingIntegration() {
    const common = {
        log,
        onEvent: (name, payload) => {
            if (name === 'stream-started') {
                pendingStreamStartContext = { ...payload, startedAt: Date.now() };
                const openInStreamManagement = Boolean(
                    gameOverlayWindow && !gameOverlayWindow.isDestroyed() && gameOverlayWindow.isVisible(),
                );
                if (openInStreamManagement) openStreamManagementWindow({ focus: true });
                broadcastToAppWindows(`obs-${name}`, { ...payload, openInStreamManagement });
                return;
            }
            broadcastToAppWindows(`obs-${name}`, payload);
            if (name === 'stream-stopped') {
                pendingStreamStartContext = null;
                if (streamManagementWindow && !streamManagementWindow.isDestroyed()) streamManagementWindow.hide();
            }
        },
    };
    if (readStreamingSettings().provider === 'streamlabs') {
        return new StreamlabsIntegration({
            ...common,
            getConfig: () => {
                const settings = readStreamingSettings();
                return { enabled: settings.enabled, host: settings.slHost, port: settings.slPort, token: settings.slToken };
            },
        });
    }
    return new OBSIntegration({
        ...common,
        getConfig: () => {
            const settings = readStreamingSettings();
            return { enabled: settings.enabled, port: settings.obsPort, password: settings.obsPassword };
        },
    });
}

function getStreamingStatus() {
    const settings = readStreamingSettings();
    const runtime = streamingIntegration ? streamingIntegration.getRuntimeStatus() :
        { connected: false, streaming: false, service: null };
    return {
        supported: true,
        provider: settings.provider,
        enabled: settings.enabled,
        obsPort: settings.obsPort,
        slHost: settings.slHost,
        slPort: settings.slPort,
        hasPassword: Boolean(settings.obsPassword),
        hasToken: Boolean(settings.slToken),
        ...runtime,
    };
}

async function setStreamingConfig(patch) {
    const current = readStreamingSettings();
    const provider = patch?.provider === 'streamlabs' ? 'streamlabs' : 'obs';
    const port = Number.isInteger(patch?.port) && patch.port > 0 && patch.port <= 65535 ? patch.port : null;
    const next = { ...current, provider, enabled: patch?.enabled === true };
    if (provider === 'obs') {
        if (port) next.obsPort = port;
        // undefined = "Passwort/Token unverändert lassen" (die Settings-UI
        // schickt das Feld nur mit, wenn der Nutzer es angefasst hat).
        if (typeof patch?.password === 'string') next.obsPassword = patch.password.slice(0, 200);
    } else {
        if (typeof patch?.host === 'string') {
            const host = patch.host.trim().slice(0, 255);
            if (/^[a-zA-Z0-9.:[\]_-]+$/.test(host)) next.slHost = host;
        }
        if (port) next.slPort = port;
        if (typeof patch?.token === 'string') next.slToken = patch.token.trim().slice(0, 200);
    }
    writeStreamingSettings(next);

    if (streamingIntegration) await streamingIntegration.stop();
    streamingIntegration = createStreamingIntegration();
    if (next.enabled) streamingIntegration.start();
    else broadcastToAppWindows('obs-status-changed', streamingIntegration.getRuntimeStatus());
    return getStreamingStatus();
}

function keepBoundsOnScreen(bounds) {
    const display = screen.getDisplayMatching(bounds);
    return keepBoundsInsideWorkArea(bounds, display.workArea);
}

function keepBoundsInsideWorkArea(bounds, area) {
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
    const rememberExpandedBounds = () => {
        if (isGameOverlayExpanded && gameOverlayWindow && !gameOverlayWindow.isDestroyed()) {
            scheduleOverlaySettingsWrite({ panelBounds: gameOverlayWindow.getBounds() });
        }
    };
    gameOverlayWindow.on('move', rememberExpandedBounds);
    gameOverlayWindow.on('resize', rememberExpandedBounds);
    gameOverlayWindow.on('closed', () => { gameOverlayWindow = null; });
    return gameOverlayWindow;
}

function getStreamManagementBounds() {
    const anchor = gameOverlayWindow && !gameOverlayWindow.isDestroyed() ?
        gameOverlayWindow.getBounds() : screen.getPrimaryDisplay().workArea;
    const area = screen.getDisplayMatching(anchor).workArea;
    const width = Math.min(520, area.width - 32);
    const height = Math.min(760, area.height - 32);
    return keepBoundsOnScreen({
        x: Math.round(anchor.x + anchor.width / 2 - width / 2),
        y: Math.round(anchor.y + Math.min(anchor.height, 120) + 12 + (
            overlayNotificationWindow && !overlayNotificationWindow.isDestroyed() && overlayNotificationWindow.isVisible() ?
                overlayNotificationWindow.getBounds().height + 8 : 0
        )),
        width,
        height,
    });
}

function getOverlayNotificationBounds() {
    const anchor = gameOverlayWindow.getBounds();
    const area = screen.getDisplayMatching(anchor).workArea;
    const width = Math.min(380, area.width - 24);
    const height = 190;
    return keepBoundsOnScreen({
        x: Math.round(anchor.x + anchor.width / 2 - width / 2),
        y: Math.round(anchor.y + anchor.height + 8),
        width,
        height,
    });
}

function createOverlayNotificationWindow() {
    if (overlayNotificationWindow && !overlayNotificationWindow.isDestroyed()) return overlayNotificationWindow;
    overlayNotificationWindow = new BrowserWindow({
        ...getOverlayNotificationBounds(),
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: ['--overlay-notification'],
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    overlayNotificationWindow.setMenu(null);
    secureAppWindow(overlayNotificationWindow);
    overlayNotificationWindow.setAlwaysOnTop(true, 'screen-saver');
    loadHostedAppWithFallback(overlayNotificationWindow, '/');
    overlayNotificationWindow.on('closed', () => { overlayNotificationWindow = null; });
    return overlayNotificationWindow;
}

function showOverlayNotificationPopover(notification) {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed() || !gameOverlayWindow.isVisible() || isGameOverlayExpanded) {
        return false;
    }
    pendingOverlayNotification = notification;
    const popover = createOverlayNotificationWindow();
    popover.setBounds(getOverlayNotificationBounds(), false);
    popover.showInactive();
    popover.webContents.send('overlay-notification-changed', pendingOverlayNotification);
    if (streamManagementWindow && !streamManagementWindow.isDestroyed() && streamManagementWindow.isVisible()) {
        streamManagementWindow.setBounds(getStreamManagementBounds(), false);
    }
    return true;
}

function createStreamManagementWindow() {
    if (streamManagementWindow && !streamManagementWindow.isDestroyed()) return streamManagementWindow;
    streamManagementWindow = new BrowserWindow({
        ...getStreamManagementBounds(),
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: true,
        icon: getAppIconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: ['--stream-management'],
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    streamManagementWindow.setMenu(null);
    secureAppWindow(streamManagementWindow);
    streamManagementWindow.setAlwaysOnTop(true, 'screen-saver');
    loadHostedAppWithFallback(streamManagementWindow, '/');
    streamManagementWindow.on('closed', () => { streamManagementWindow = null; });
    return streamManagementWindow;
}

function openStreamManagementWindow({ focus = true } = {}) {
    const manager = createStreamManagementWindow();
    manager.setBounds(getStreamManagementBounds(), false);
    if (focus) {
        manager.show();
        manager.focus();
    } else {
        manager.showInactive();
    }
    manager.webContents.send('stream-management-context-changed', pendingStreamStartContext);
    return true;
}

function setOverlayExpanded(expanded) {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed()) return false;
    flushPendingOverlaySettings();
    const settings = readOverlaySettings();
    if (expanded) {
        if (overlayNotificationWindow && !overlayNotificationWindow.isDestroyed()) overlayNotificationWindow.hide();
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

function detectActiveGame() {
    if (process.platform !== 'win32') return Promise.resolve(null);
    return new Promise((resolve) => {
        execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout = '') => {
            if (error) {
                log.warn('Unable to inspect running games:', error.message);
                resolve(undefined);
                return;
            }
            resolve(detectActiveGameFromTasklist(stdout));
        });
    });
}

async function updateGameOverlayVisibility() {
    if (gameProcessCheckInFlight) return;
    gameProcessCheckInFlight = true;
    try {
        const detectedGameId = await detectActiveGame();
        // `undefined` means tasklist failed. Keep the previous state so a transient
        // OS error cannot falsely end a collaboration build session.
        if (detectedGameId !== undefined && detectedGameId !== activeGameId) {
            const previousGameId = activeGameId;
            activeGameId = detectedGameId;
            if (previousGameId) {
                broadcastToAppWindows('game-process-stopped', { gameId: previousGameId });
            }
            broadcastToAppWindows('active-game-changed', activeGameId);
        }

        const running = overlayForcedVisible || Boolean(activeGameId);
        if (running) {
            const overlay = createGameOverlayWindow();
            if (!overlay.isVisible()) overlay.showInactive();
        } else if (gameOverlayWindow && !gameOverlayWindow.isDestroyed()) {
            gameOverlayWindow.hide();
            if (overlayNotificationWindow && !overlayNotificationWindow.isDestroyed()) overlayNotificationWindow.hide();
            if (streamManagementWindow && !streamManagementWindow.isDestroyed()) streamManagementWindow.hide();
        }
    } finally {
        gameProcessCheckInFlight = false;
    }
}

function setOverlayForcedVisible(value) {
    overlayForcedVisible = value === true;
    writeOverlaySettings({ forcedVisible: overlayForcedVisible });
    updateGameOverlayVisibility();
    refreshTrayMenu();
    broadcastToAppWindows('overlay-forced-changed', overlayForcedVisible);
    return overlayForcedVisible;
}

function startGameProcessMonitor() {
    updateGameOverlayVisibility();
    gameProcessTimer = setInterval(updateGameOverlayVisibility, 4000);
}

// Sendet ein Event an alle App-Fenster (Hauptfenster + Spiel-Overlay).
function broadcastToAppWindows(channel, payload) {
    for (const window of [mainWindow, gameOverlayWindow, streamManagementWindow]) {
        if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
    }
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

function buildTrayMenu() {
    return Menu.buildFromTemplate([
        { label: 'PlanetCreations is running in the background', enabled: false },
        { type: 'separator' },
        { label: 'Open', click: showMainWindow },
        {
            label: 'Keep In-Game Overlay visible',
            type: 'checkbox',
            checked: overlayForcedVisible,
            click: (item) => setOverlayForcedVisible(item.checked),
        },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ]);
}

function refreshTrayMenu() {
    if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
    if (tray && !tray.isDestroyed()) return;
    try {
        tray = new Tray(getAppIconPath());
        tray.setToolTip('PlanetCreations Client');
        tray.setContextMenu(buildTrayMenu());
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
    const buffer = await responseToBuffer(response);
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
        backgroundColor: '#111827',
        icon: getAppIconPath(),
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: true,
        },
    });

    mainWindow.setMenu(null);
    secureAppWindow(mainWindow);
    const splashPath = isDev ? path.join(__dirname, '../public/splash.html') : path.join(__dirname, '../build/splash.html');
    if (openOnline) loadHostedAppWithFallback(mainWindow, '/');
    else mainWindow.loadFile(splashPath);
    
    ipcMain.on('select-mode', (event, mode) => {
        if (!isTrustedIpcSender(event) || event.sender !== mainWindow?.webContents) return;
        if (mode === 'online') loadHostedAppWithFallback(mainWindow, '/');
        else if (mode === 'offline') loadHostedAppWithFallback(mainWindow, '/client/dashboard');
    });

    if (shouldOpenDevTools) mainWindow.webContents.openDevTools();

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

// Manueller Reload aus der Navbar: umgeht den HTTP-Cache, damit auch eine
// stale index.html der gehosteten UI (IONOS-Cache) frisch geladen wird.
ipcMain.handle('reload-window', (event) => {
    requireTrustedIpcSender(event, true);
    event.sender.reloadIgnoringCache();
    return true;
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
ipcMain.handle('get-obs-status', (event) => {
    requireTrustedIpcSender(event, true);
    return getStreamingStatus();
});
ipcMain.handle('set-obs-config', (event, config) => {
    requireTrustedIpcSender(event, true);
    return setStreamingConfig(config);
});
ipcMain.handle('get-overlay-forced', (event) => {
    requireTrustedIpcSender(event, true);
    return overlayForcedVisible;
});
ipcMain.handle('get-active-game', (event) => {
    requireTrustedIpcSender(event, true);
    return activeGameId;
});
ipcMain.handle('get-stream-start-context', (event) => {
    requireTrustedIpcSender(event, true);
    return pendingStreamStartContext;
});
ipcMain.handle('open-stream-management', (event) => {
    requireTrustedIpcSender(event, true);
    return openStreamManagementWindow({ focus: true });
});
ipcMain.handle('close-stream-management', (event) => {
    requireTrustedIpcSender(event, true);
    if (streamManagementWindow && !streamManagementWindow.isDestroyed()) streamManagementWindow.hide();
    return true;
});
ipcMain.handle('sync-stream-management-session', (event, session) => {
    requireTrustedIpcSender(event, true);
    if (!session?.sessionId || session.status !== 'active') {
        lastStreamNotificationIds = new Set();
        if (streamManagementWindow && !streamManagementWindow.isDestroyed()) streamManagementWindow.hide();
        return true;
    }
    const notifications = Array.isArray(session.notifications) ? session.notifications.slice(0, 30) : [];
    const ids = new Set(notifications.map((item) => String(item?.id || '')).filter(Boolean));
    const hasIncoming = [...ids].some((id) => !lastStreamNotificationIds.has(id));
    lastStreamNotificationIds = ids;
    const prefs = session.streamNotificationPrefs || {};
    const mutedUntilSeconds = Number(prefs.mutedUntil?.seconds || prefs.mutedUntil?._seconds || 0);
    const muted = prefs.mode === 'session' || prefs.mode === 'permanent' ||
        mutedUntilSeconds * 1000 > Date.now();
    if (hasIncoming && !muted) openStreamManagementWindow({ focus: false });
    return true;
});
ipcMain.handle('show-overlay-notification', (event, notification) => {
    requireTrustedIpcSender(event, true);
    if (!notification || typeof notification !== 'object') return false;
    const link = typeof notification.link === 'string' && notification.link.startsWith('/') &&
        !notification.link.startsWith('//') ? notification.link.slice(0, 500) : '/';
    return showOverlayNotificationPopover({
        id: String(notification.id || '').slice(0, 128),
        title: String(notification.title || 'PlanetCreations').slice(0, 120),
        message: String(notification.message || '').slice(0, 500),
        link,
    });
});
ipcMain.handle('get-overlay-notification-context', (event) => {
    requireTrustedIpcSender(event, true);
    return pendingOverlayNotification;
});
ipcMain.handle('close-overlay-notification', (event) => {
    requireTrustedIpcSender(event, true);
    pendingOverlayNotification = null;
    if (overlayNotificationWindow && !overlayNotificationWindow.isDestroyed()) overlayNotificationWindow.hide();
    if (streamManagementWindow && !streamManagementWindow.isDestroyed() && streamManagementWindow.isVisible()) {
        streamManagementWindow.setBounds(getStreamManagementBounds(), false);
    }
    return true;
});
ipcMain.handle('open-overlay-notification-link', (event, link) => {
    requireTrustedIpcSender(event, true);
    const route = typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link.slice(0, 500) : '/';
    showMainWindow();
    mainWindow?.webContents.send('navigate-to-route', route);
    pendingOverlayNotification = null;
    if (overlayNotificationWindow && !overlayNotificationWindow.isDestroyed()) overlayNotificationWindow.hide();
    return true;
});
ipcMain.handle('set-overlay-forced', (event, value) => {
    requireTrustedIpcSender(event, true);
    return setOverlayForcedVisible(value === true);
});
ipcMain.on('overlay-drag-start', (event, point) => {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed() || event.sender !== gameOverlayWindow.webContents) return;
    if (!Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
    const bounds = gameOverlayWindow.getBounds();
    overlayDragState = {
        pointerX: point.screenX,
        pointerY: point.screenY,
        bounds,
        workArea: screen.getDisplayMatching(bounds).workArea,
    };
});

function flushOverlayDrag() {
    if (overlayDragFlushTimer) {
        clearTimeout(overlayDragFlushTimer);
        overlayDragFlushTimer = null;
    }
    const point = pendingOverlayDragPoint;
    pendingOverlayDragPoint = null;
    if (!point || !overlayDragState || !gameOverlayWindow || gameOverlayWindow.isDestroyed()) return;
    const next = keepBoundsInsideWorkArea({
        ...overlayDragState.bounds,
        x: overlayDragState.bounds.x + Math.round(point.screenX - overlayDragState.pointerX),
        y: overlayDragState.bounds.y + Math.round(point.screenY - overlayDragState.pointerY),
    }, overlayDragState.workArea);
    gameOverlayWindow.setPosition(next.x, next.y, false);
}

ipcMain.on('overlay-drag-move', (event, point) => {
    if (!overlayDragState || !gameOverlayWindow || gameOverlayWindow.isDestroyed() || event.sender !== gameOverlayWindow.webContents) return;
    if (!Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
    pendingOverlayDragPoint = { screenX: point.screenX, screenY: point.screenY };
    if (!overlayDragFlushTimer) overlayDragFlushTimer = setTimeout(flushOverlayDrag, 16);
});
ipcMain.on('overlay-drag-end', (event) => {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed() || event.sender !== gameOverlayWindow.webContents) return;
    flushOverlayDrag();
    const bounds = gameOverlayWindow.getBounds();
    if (gameOverlayWindow.isResizable()) scheduleOverlaySettingsWrite({ panelBounds: bounds });
    else scheduleOverlaySettingsWrite({ x: bounds.x, y: bounds.y, size: bounds.width });
    flushPendingOverlaySettings();
    overlayDragState = null;
});
ipcMain.on('overlay-resize', (event, direction) => {
    if (!gameOverlayWindow || gameOverlayWindow.isDestroyed() || gameOverlayWindow.isResizable() || event.sender !== gameOverlayWindow.webContents) return;
    const steps = Math.max(-20, Math.min(20, Math.trunc(Number(direction) || 0)));
    if (steps === 0) return;
    const current = gameOverlayWindow.getBounds();
    const nextSize = Math.min(OVERLAY_MAX_SIZE, Math.max(OVERLAY_MIN_SIZE, current.width + steps * 8));
    const next = keepBoundsOnScreen({
        x: Math.round(current.x - (nextSize - current.width) / 2),
        y: Math.round(current.y - (nextSize - current.height) / 2),
        width: nextSize,
        height: nextSize,
    });
    gameOverlayWindow.setBounds(next, false);
    if (overlayDragState) {
        const pointer = screen.getCursorScreenPoint();
        overlayDragState = {
            pointerX: pointer.x,
            pointerY: pointer.y,
            bounds: next,
            workArea: screen.getDisplayMatching(next).workArea,
        };
    }
    scheduleOverlaySettingsWrite({ x: next.x, y: next.y, size: nextSize });
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
ipcMain.handle('show-main-window', (event) => {
    requireTrustedIpcSender(event, true);
    showMainWindow();
    return true;
});
ipcMain.handle('get-latest-collaboration-file', (event, gameId, expectedFileName) => {
    requireTrustedIpcSender(event, true);
    try {
        const frontierPath = getFrontierPathForInstall();
        const gameFiles = scanGamesFromPath(frontierPath);
        return findLatestCollaborationSave(gameFiles, gameId, expectedFileName);
    } catch (error) {
        return {
            success: false,
            message: error.message || 'The latest collaboration save could not be found.',
        };
    }
});
ipcMain.handle('select-collaboration-file', async (event, gameId) => {
    requireTrustedIpcSender(event, true);
    const extensionsByGame = {
        'planet-coaster-2': ['park2', 'blpr2', 'prkauto2'],
        'planet-zoo': ['zoo', 'pzblueprint', 'zooauto'],
    };
    const extensions = extensionsByGame[gameId];
    if (!extensions) {
        return { success: false, message: 'The collaboration game is not supported.' };
    }
    const result = await dialog.showOpenDialog({
        title: 'Choose the collaboration save file',
        defaultPath: getStoredPath() || app.getPath('documents'),
        filters: [{ name: 'Supported game files', extensions }],
        properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, status: 'canceled' };
    }
    const filePath = result.filePaths[0];
    const extension = path.extname(filePath).toLowerCase().slice(1);
    if (!extensions.includes(extension) || !isValidGameFile(filePath)) {
        return { success: false, message: 'The selected file does not match the collaboration game.' };
    }
    const stats = fs.statSync(filePath);
    return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        fileSize: stats.size,
        modifiedAt: stats.mtime.toISOString(),
    };
});
ipcMain.handle('save-collaboration-version', async (event, payload) => {
    requireTrustedIpcSender(event, true);
    const downloadUrl = typeof payload?.downloadUrl === 'string' ? payload.downloadUrl : '';
    const expectedGameId = typeof payload?.gameId === 'string' ? payload.gameId : '';
    let tempPath = null;
    try {
        tempPath = await downloadR2PackageToTemp(downloadUrl);
        const verification = await verifyBackup(tempPath);
        if (verification.status !== 'verified' || verification.metadata?.packageType !== 'creation') {
            throw new Error(verification.error || 'The collaboration package could not be verified.');
        }
        if (expectedGameId && verification.metadata.gameId !== expectedGameId) {
            throw new Error('The downloaded package does not match the collaboration game.');
        }
        const originalFileName = path.basename(verification.metadata.originalFileName || '');
        if (!isValidGameFile(originalFileName)) {
            throw new Error('The collaboration package contains an invalid game-file name.');
        }
        const rawSuggestedTargetPath =
            typeof payload?.suggestedTargetPath === 'string'
                ? payload.suggestedTargetPath.trim()
                : '';
        const suggestedTargetPath =
            rawSuggestedTargetPath.length <= 4096 &&
            path.isAbsolute(rawSuggestedTargetPath)
                ? path.resolve(rawSuggestedTargetPath)
                : '';
        const canReuseSuggestedTarget = Boolean(
            suggestedTargetPath &&
            fs.existsSync(suggestedTargetPath) &&
            isValidGameFile(suggestedTargetPath) &&
            path.extname(suggestedTargetPath).toLowerCase() ===
                path.extname(originalFileName).toLowerCase(),
        );
        const result = await dialog.showSaveDialog({
            title: 'Save collaboration version',
            defaultPath: canReuseSuggestedTarget
                ? suggestedTargetPath
                : path.join(
                    getStoredPath() || app.getPath('documents'),
                    originalFileName,
                ),
            filters: [{
                name: 'Supported game file',
                extensions: [path.extname(originalFileName).slice(1)],
            }],
        });
        if (result.canceled || !result.filePath) {
            return { success: false, status: 'canceled' };
        }
        return restoreBackup(app, tempPath, result.filePath);
    } catch (error) {
        log.error('Collaboration version download failed:', error);
        return { success: false, status: 'error', message: error.message };
    } finally {
        if (tempPath && fs.existsSync(tempPath)) {
            try {
                fs.unlinkSync(tempPath);
            } catch (error) {
                log.warn('Could not remove collaboration download temp file:', error);
            }
        }
    }
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
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backups-updated');
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

ipcMain.handle('read-frontier-preview', (event, filePath) => {
    requireTrustedIpcSender(event, true);
    if (!filePath || typeof filePath !== 'string') return null;
    const resolvedPath = path.resolve(filePath);
    const allowedRoots = [
        getStoredPath(),
        path.join(app.getPath('home'), 'Saved Games'),
        app.getPath('documents'),
    ].filter(Boolean);
    if (!allowedRoots.some(root => isPathInside(root, resolvedPath))) {
        throw new Error('Preview path is outside the configured game folders.');
    }
    return readFrontierPreview(resolvedPath);
});

ipcMain.handle('inspect-frontier-file', async (event, filePath) => {
    requireTrustedIpcSender(event, true);
    const storedPath = getStoredPath();
    if (!filePath || typeof filePath !== 'string' || !storedPath) {
        throw new Error('A configured local Frontier file is required.');
    }
    const resolvedPath = path.resolve(filePath);
    if (!isPathInside(storedPath, resolvedPath) || !isValidGameFile(resolvedPath) || !fs.existsSync(resolvedPath)) {
        throw new Error('The selected file is outside the configured game folders or unsupported.');
    }
    return inspectFrontierFileInWorker(resolvedPath);
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

    // The dashboard owns the sequential background scan. File pickers reuse its
    // persistent cache and analyze only the file the user actually selects.
    const gameFiles = indexGamesFromPath(storedPath).results;
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

ipcMain.handle('prepare-backup-for-upload', async (event, filePath, idToken, appCheckToken) => {
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
            const newBackupPath = await createBackup(
                app,
                filePath,
                "Uploaded with creation",
                true,
                idToken,
                tempDir,
                appCheckToken,
            );

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
            // Node's fetch/undici requires half-duplex mode when the request
            // body is a stream. Without it, the upload fails before any bytes
            // reach R2 with "RequestInit: duplex option is required".
            duplex: 'half',
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
ipcMain.handle('backup-creation-media', (event, filePath, note, isSigned, idToken, appCheckToken) =>
    backupCreationMedia(app, filePath, note, isSigned, idToken, appCheckToken));
ipcMain.handle('delete-creation-media', (event, filePath, mode) => deleteCreationMedia(filePath, mode));
ipcMain.handle('scan-games', (event, basePath, options = {}) => {
    requireTrustedIpcSender(event, true);
    const storedPath = getStoredPath();
    if (!basePath || typeof basePath !== 'string' || !storedPath ||
        path.resolve(basePath) !== path.resolve(storedPath)) {
        throw new Error('Only the configured Frontier folder can be scanned.');
    }
    const generation = ++frontierMetadataScanGeneration;
    const sender = event.sender;
    const indexed = indexGamesFromPath(basePath, {
        forceMetadataRefresh: options?.forceMetadataRefresh === true,
    });
    indexed.results.__metadataProgress = {
        completed: 0,
        total: indexed.pending.length,
        running: indexed.pending.length > 0,
    };

    void (async () => {
        let completed = 0;
        for (const pendingFile of indexed.pending) {
            if (generation !== frontierMetadataScanGeneration || sender.isDestroyed()) return;
            let inspection = null;
            let inspectionError = null;
            try {
                inspection = await inspectFrontierFileInWorker(pendingFile.path);
            } catch (error) {
                inspectionError = error;
            }
            if (generation !== frontierMetadataScanGeneration || sender.isDestroyed()) return;
            const cached = saveMetadataInspection(indexed.cache, pendingFile, inspection, inspectionError);
            completed += 1;
            sender.send('frontier-metadata-updated', {
                filePath: pendingFile.path,
                metadata: cached.metadata,
                mediaReferences: cached.mediaReferences,
                error: cached.error,
                status: cached.error ? 'error' : 'ready',
                progress: {
                    completed,
                    total: indexed.pending.length,
                    running: completed < indexed.pending.length,
                },
            });
        }
    })().catch(error => log.error('Sequential Frontier metadata scan failed:', error));

    return indexed.results;
});
ipcMain.handle('create-backup', (event, filePath, note, isSigned, idToken, appCheckToken) =>
    createBackup(app, filePath, note, isSigned, idToken, null, appCheckToken));
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
ipcMain.handle('backup-all-creations', (event, files, note, isSigned, idToken, appCheckToken, includeMediaPackages) =>
    backupAllCreations(app, files, note, isSigned, idToken, appCheckToken, includeMediaPackages));
ipcMain.handle('scan-all-media-files', () => scanAllMediaFiles(app));
ipcMain.handle('create-media-snapshot', (event, savePath, mediaPaths) => createOrUpdateSnapshot(savePath, mediaPaths));
ipcMain.handle('sync-automatic-media-snapshot', (event, savePath) => syncAutomaticMediaSnapshot(savePath));
ipcMain.handle('get-media-snapshot', (event, savePath) => getSnapshot(savePath));
ipcMain.handle('install-media', (event, savePath, options) => installMedia(savePath, options));
ipcMain.handle('uninstall-media', (event, savePath) => uninstallMedia(savePath));
ipcMain.handle('get-media-status', (event, savePath) => getMediaSetStatus(savePath));

app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.planetcreations.app');
    overlayForcedVisible = readOverlaySettings().forcedVisible;
    createTray();
    createWindow({ openOnline: isAutoStart || useHostedUiInDev || openLocalUiInDev });
    startGameProcessMonitor();
    streamingIntegration = createStreamingIntegration();
    streamingIntegration.start();
});
app.on('before-quit', () => {
    isQuitting = true;
    flushPendingOverlaySettings();
    if (gameProcessTimer) clearInterval(gameProcessTimer);
    if (updateCheckTimer) clearInterval(updateCheckTimer);
    if (streamingIntegration) streamingIntegration.stop();
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

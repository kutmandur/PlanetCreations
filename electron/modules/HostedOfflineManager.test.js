'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'App.jsx'), 'utf8');
const authPageSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'pages', 'AuthPage.jsx'), 'utf8');
const firebaseConfigSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'firebase', 'config.js'), 'utf8');
const navbarSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'ui', 'Navbar.jsx'), 'utf8');
const gameOverlaySource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'ui', 'GameOverlay.jsx'), 'utf8');

test('both desktop channels prefer the hosted Offline Manager with a bundled fallback', () => {
    assert.match(mainSource, /function loadOfflineManager[\s\S]*return loadHostedAppWithFallback/);
    assert.doesNotMatch(mainSource, /function loadOfflineManager[\s\S]*if \(isStoreBuild\) return loadBundledApp/);
    assert.match(mainSource, /requireOfflineManagerCapability:\s*true/);
    assert.match(mainSource, /allowBundledFallback:\s*true/);
    assert.match(mainSource, /return loadOfflineManager\(targetWindow, '\/client\/dashboard'\)/);
    assert.match(mainSource, /mode === 'offline'\) loadOfflineManager/);
    assert.match(mainSource, /getAppRoutePath\(currentUrl\) === '\/client\/dashboard'/);
    assert.match(mainSource, /isAllowedAppUrl\(currentUrl\)/);
});

test('the Online Workshop never falls back to the unauthenticated file origin', () => {
    assert.match(mainSource, /allowBundledFallback = false/);
    assert.match(mainSource, /if \(errorCode === -3\) return/);
    assert.match(mainSource, /preserving the HTTPS ` \+/);
    assert.match(mainSource, /hostedRetryDelayMs = Math\.min\(hostedRetryDelayMs \* 2, 30000\)/);
    assert.doesNotMatch(
        mainSource,
        /mode === 'online'\)[^\n]*allowBundledFallback:\s*true/,
    );
});

test('a network-triggered bundled fallback keeps probing the hosted UI', () => {
    assert.match(mainSource, /scheduleFallbackRecoveryProbe/);
    assert.match(mainSource, /net\.fetch\(getHostedAppUrl\(\), \{/);
    assert.match(mainSource, /method:\s*'HEAD'/);
    assert.match(mainSource, /fallbackProbeDelayMs = Math\.min\(fallbackProbeDelayMs \* 2, 60000\)/);
    assert.match(mainSource, /Hosted UI is reachable again; leaving bundled fallback/);
    assert.match(mainSource, /loadFallback\(reason, true\)/);
});

test('foregrounding the client or opening the overlay retries a fallback immediately', () => {
    assert.match(mainSource, /browserWindow\.__usingHostedFallback = true/);
    assert.match(mainSource, /function retryHostedFallbackIfNeeded/);
    assert.match(mainSource, /mainWindow\.on\('focus',[\s\S]*retryHostedFallbackIfNeeded\(mainWindow/);
    assert.match(mainSource, /the client was brought to the foreground/);
    assert.match(mainSource, /retryHostedFallbackIfNeeded\(gameOverlayWindow, 'the game overlay was opened'\)/);
    assert.match(mainSource, /handleHostedFinish[\s\S]*browserWindow\.__usingHostedFallback = false/);
});

test('background throttling and aborted navigations cannot trigger the fallback', () => {
    assert.doesNotMatch(
        mainSource,
        /if \(!capabilities\) \{\s*loadFallback\(/,
    );
    assert.match(mainSource, /compatibility handshake is delayed; keeping the hosted session active/);
    assert.match(mainSource, /error\?\.errno === -3 \|\| error\?\.code === 'ERR_ABORTED'/);
    assert.match(mainSource, /function refreshHostedWebViews[\s\S]*pendingMainWebRefresh = true/);
    assert.match(mainSource, /function refreshPendingMainHostedView[\s\S]*reloadIgnoringCache/);
    assert.doesNotMatch(
        mainSource,
        /mainWindow\.hide\(\);\s*if \(pendingMainWebRefresh[\s\S]{0,250}reloadIgnoringCache/,
    );
});

test('hosted Offline Manager compatibility is negotiated before local capabilities are used', () => {
    assert.match(mainSource, /offlineManagerVersion:\s*Number\.isInteger/);
    assert.match(mainSource, /minimumOfflineManagerBridgeVersion/);
    assert.match(mainSource, /MINIMUM_HOSTED_OFFLINE_MANAGER_VERSION/);
    assert.match(appSource, /offlineManagerVersion:\s*1/);
    assert.match(appSource, /minimumOfflineManagerBridgeVersion:\s*3/);
    assert.match(appSource, /hostedOfflineManagerVersion \|\| 0\) >= 1/);
});

test('the hosted Workshop stays compatible with the established pre-counter bridge', () => {
    assert.match(appSource, /const minimumBridgeVersion = 1/);
    assert.match(appSource, /bridgeVersion \?\? 1/);
});

test('Store and GitHub channels use the same versioned hosted Offline Manager bridge', () => {
    assert.match(preloadSource, /HOSTED_OFFLINE_MANAGER_VERSION = 1/);
    assert.match(preloadSource, /hostedOfflineManagerVersion:\s*HOSTED_OFFLINE_MANAGER_VERSION/);
    assert.match(preloadSource, /\.\.\.offlineManagerApi/);
});

test('the expanded overlay can switch into the Offline Manager without losing its window state', () => {
    assert.match(mainSource, /\[mainWindow, gameOverlayWindow\]\.find/);
    assert.match(mainSource, /canNavigateInPlace[\s\S]*navigate-to-route/);
    assert.match(mainSource, /requireOverlayCapability:\s*browserWindow === gameOverlayWindow/);
    assert.match(mainSource, /ipcMain\.handle\('get-overlay-expanded'/);
    assert.match(preloadSource, /getOverlayExpanded:\s*\(\) => ipcRenderer\.invoke\('get-overlay-expanded'\)/);
    assert.match(appSource, /getOverlayExpanded\?\.\(\)/);
    assert.match(navbarSource, /isGameOverlay\) navigate\(switchModePath\)/);
});

test('a connection recovery action immediately reloads the hosted origin', () => {
    assert.match(mainSource, /ipcMain\.handle\('retry-online-connection'/);
    assert.match(mainSource, /function retryHostedConnection[\s\S]*loadOnlineWorkshop/);
    assert.match(preloadSource, /retryOnlineConnection:\s*\(\) => ipcRenderer\.invoke\('retry-online-connection'\)/);
});

test('desktop authentication is shared between the main window and overlay', () => {
    assert.match(firebaseConfigSource, /setPersistence\(auth, browserLocalPersistence\)/);
    assert.match(authPageSource, /window\.electronAPI\?\.isElectron \|\| consent === 'accepted'/);
    assert.match(appSource, /authPersistenceReady\.then/);
});

test('stream management is docked to and hidden with the expanded game overlay', () => {
    assert.match(mainSource, /function syncStreamManagementWithOverlay/);
    assert.match(mainSource, /function shouldShowStreamManagementWithOverlay/);
    assert.match(mainSource, /isGameOverlayExpanded[\s\S]*hasActiveStreamManagementSession \|\| pendingStreamStartContext/);
    assert.match(mainSource, /if \(expanded\)[\s\S]*syncStreamManagementWithOverlay\(\)/);
    assert.match(mainSource, /isGameOverlayExpanded = false;[\s\S]*streamManagementWindow\.hide\(\)/);
    assert.doesNotMatch(gameOverlaySource, /openStreamManagement/);
    assert.doesNotMatch(gameOverlaySource, />Stream Management</);
});

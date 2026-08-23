'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'App.jsx'), 'utf8');

test('both desktop channels prefer the hosted Offline Manager with a bundled fallback', () => {
    assert.match(mainSource, /function loadOfflineManager[\s\S]*return loadHostedAppWithFallback/);
    assert.doesNotMatch(mainSource, /function loadOfflineManager[\s\S]*if \(isStoreBuild\) return loadBundledApp/);
    assert.match(mainSource, /requireOfflineManagerCapability:\s*true/);
    assert.match(mainSource, /mode === 'offline'\) return loadOfflineManager/);
    assert.match(mainSource, /mode === 'offline'\) loadOfflineManager/);
    assert.match(mainSource, /currentUrl\.startsWith\(getBundledAppUrl\(\)\) \|\| isHostedAppUrl\(currentUrl\)/);
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

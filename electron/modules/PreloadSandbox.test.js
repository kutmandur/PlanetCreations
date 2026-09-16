'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const preloadPath = path.join(__dirname, '..', 'preload.js');

test('sandboxed preload does not require local CommonJS modules', () => {
    const source = fs.readFileSync(preloadPath, 'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\.?[\\/]/);
    assert.match(source, /contextBridge\.exposeInMainWorld/);
});

function loadBridge({ url = 'https://www.planetcreations.net/settings', store = false } = {}) {
    let api;
    const calls = [];
    const ipcRenderer = new EventEmitter();
    ipcRenderer.invoke = channel => { calls.push(channel); return Promise.resolve({ version: '1.0.42' }); };
    const electron = { ipcRenderer, contextBridge: { exposeInMainWorld(name, value) { api = value; } } };
    vm.runInNewContext(fs.readFileSync(preloadPath, 'utf8'), {
        require: name => { assert.equal(name, 'electron'); return electron; },
        process: { windowsStore: store, env: {}, argv: [] },
        window: { location: new URL(url) }, URL,
    });
    return { api, ipcRenderer, calls };
}

test('the hosted and bundled bridges expose update checks with removable status subscriptions', async () => {
    for (const url of ['https://www.planetcreations.net/settings', 'file:///app/build/index.html']) {
        const { api, ipcRenderer, calls } = loadBridge({ url });
        await api.getClientUpdateStatus();
        await api.checkForUpdates();
        assert.deepEqual(calls, ['get-client-update-status', 'check-client-updates']);
        let received;
        const stop = api.onClientUpdateStatusChanged(value => { received = value; });
        ipcRenderer.emit('client-update-status-changed', {}, { status: 'current' });
        assert.equal(received.status, 'current');
        stop();
        assert.equal(ipcRenderer.listenerCount('client-update-status-changed'), 0);
    }
});

test('the Store bridge exposes version reads but no check, restart or updater event methods', async () => {
    const { api, calls } = loadBridge({ store: true });
    assert.equal(api.isStoreBuild, true);
    await api.getClientUpdateStatus();
    assert.deepEqual(calls, ['get-client-update-status']);
    for (const method of ['checkForUpdates', 'restartApp', 'onClientUpdateStatusChanged', 'onUpdateInfoAvailable', 'onUpdateDownloaded']) {
        assert.equal(api[method], undefined);
    }
});

test('untrusted pages receive no updater capabilities', () => {
    const { api } = loadBridge({ url: 'https://example.com/settings' });
    assert.equal(api.getClientUpdateStatus, undefined);
    assert.equal(api.checkForUpdates, undefined);
});

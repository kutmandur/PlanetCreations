'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ClientUpdater } = require('./ClientUpdater');

function setup(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-update-test-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('planetcreations-update-test-'));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const updater = new EventEmitter();
    updater.checkForUpdates = t.mock.fn(async () => ({ isUpdateAvailable: false }));
    const fetchRelease = t.mock.fn(async () => ({ ok: true, json: async () => ({ tag_name: 'v1.0.43' }) }));
    const notify = t.mock.fn();
    const legacyEvent = t.mock.fn();
    const config = {
        updater, version: '1.0.42', statePath: path.join(directory, 'update-check.json'),
        fetchRelease, notify, legacyEvent, now: () => Date.parse('2026-09-16T12:34:56Z'),
        logger: { warn() {} }, ...options,
    };
    return { manager: new ClientUpdater(config), config, updater, fetchRelease, notify, legacyEvent };
}

test('reads the installed version without checking; persists completed searches across restarts', async t => {
    const { manager, updater, config } = setup(t);
    assert.equal(manager.getStatus().version, '1.0.42');
    assert.equal(manager.getStatus().lastCheckedAt, null);
    assert.equal(updater.checkForUpdates.mock.callCount(), 0);
    assert.equal(fs.existsSync(config.statePath), false);
    const result = await manager.check();
    assert.equal(result.status, 'current');
    assert.equal(result.lastCheckedAt, '2026-09-16T12:34:56.000Z');
    const restarted = new ClientUpdater({ ...config, updater: new EventEmitter() });
    assert.equal(restarted.getStatus().lastCheckedAt, result.lastCheckedAt);
    assert.equal(restarted.getStatus().status, 'idle');
    assert.equal(updater.checkForUpdates.mock.callCount(), 1);
});

test('coalesces concurrent manual and scheduled searches into one network operation', async t => {
    const { manager, updater, fetchRelease } = setup(t);
    let finish;
    updater.checkForUpdates = t.mock.fn(() => new Promise(resolve => { finish = resolve; }));
    const first = manager.check();
    const second = manager.check();
    assert.equal(first, second);
    await Promise.resolve();
    assert.equal(manager.getStatus().status, 'checking');
    assert.equal(manager.getStatus().lastCheckedAt, null);
    finish({ isUpdateAvailable: false });
    await first;
    assert.equal(updater.checkForUpdates.mock.callCount(), 1);
    assert.equal(fetchRelease.mock.callCount(), 0);
});

test('Store and development builds never search, attach updater events or write state', async t => {
    for (const options of [{ isStore: true }, { enabled: false }]) {
        const { manager, updater, fetchRelease, config } = setup(t, options);
        const result = await manager.check();
        assert.equal(result.status, options.isStore ? 'store' : 'disabled');
        assert.equal(result.version, '1.0.42');
        assert.equal(result.lastCheckedAt, null);
        assert.equal(updater.eventNames().length, 0);
        assert.equal(updater.checkForUpdates.mock.callCount(), 0);
        assert.equal(fetchRelease.mock.callCount(), 0);
        assert.equal(fs.existsSync(config.statePath), false);
    }
});

test('falls back once when the updater both emits and rejects the same error', async t => {
    const { manager, updater, fetchRelease, legacyEvent } = setup(t);
    updater.checkForUpdates = async () => {
        const error = new Error('Feed unreachable');
        updater.emit('error', error);
        throw error;
    };
    const result = await manager.check();
    assert.equal(fetchRelease.mock.callCount(), 1);
    assert.ok(fetchRelease.mock.calls[0].arguments[1].signal instanceof AbortSignal);
    assert.equal(result.status, 'available');
    assert.equal(result.availableVersion, '1.0.43');
    assert.equal(result.downloadUrl, 'https://github.com/kutmandur/PlanetCreations/releases/tag/v1.0.43');
    assert.equal(legacyEvent.mock.calls[0].arguments[0], 'update-info-available');
});

test('records failed attempts without claiming to be up to date and allows retry', async t => {
    const { manager, updater, fetchRelease } = setup(t);
    updater.checkForUpdates = async () => { throw new Error('Offline'); };
    fetchRelease.mock.mockImplementation(async () => { throw new Error('Offline'); });
    const result = await manager.check();
    assert.equal(result.status, 'error');
    assert.ok(result.lastCheckedAt);
    updater.checkForUpdates = async () => ({ isUpdateAvailable: false });
    assert.equal((await manager.check()).status, 'current');
});

test('rejects malformed fallback releases instead of reporting a successful check', async t => {
    const { manager, updater, fetchRelease } = setup(t);
    updater.checkForUpdates = async () => { throw new Error('Feed unreachable'); };
    fetchRelease.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ tag_name: 'latest' }) }));
    assert.equal((await manager.check()).status, 'error');
});

test('keeps a pending or completed download on repeated checks and retains the search time', async t => {
    const { manager, updater, fetchRelease, legacyEvent } = setup(t);
    let finishDownload;
    const downloadPromise = new Promise(resolve => { finishDownload = resolve; });
    updater.checkForUpdates = t.mock.fn(async () => {
        updater.emit('update-available', { version: '1.0.43' });
        return { isUpdateAvailable: true, updateInfo: { version: '1.0.43' }, downloadPromise };
    });
    assert.equal((await manager.check()).status, 'downloading');
    await manager.check();
    finishDownload([]);
    updater.emit('update-downloaded', { version: '1.0.43' });
    const downloaded = await manager.check();
    assert.equal(downloaded.status, 'downloaded');
    assert.equal(downloaded.lastCheckedAt, '2026-09-16T12:34:56.000Z');
    assert.equal(updater.checkForUpdates.mock.callCount(), 1);
    assert.equal(fetchRelease.mock.callCount(), 0);
    assert.deepEqual(legacyEvent.mock.calls.map(call => call.arguments[0]), ['update-available', 'update-downloaded']);
});

test('handles rejected background downloads without an unhandled rejection or duplicate fallback', async t => {
    const { manager, updater, fetchRelease } = setup(t);
    let failDownload;
    const downloadPromise = new Promise((resolve, reject) => { failDownload = reject; });
    updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.0.43' }, downloadPromise });
    await manager.check();
    const error = new Error('Download interrupted');
    updater.emit('error', error);
    failDownload(error);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(manager.getStatus().status, 'available');
    assert.equal(fetchRelease.mock.callCount(), 1);
});

test('recovers from a corrupt local timestamp file', async t => {
    const { config } = setup(t);
    fs.writeFileSync(config.statePath, '{broken');
    const manager = new ClientUpdater(config);
    assert.equal(manager.getStatus().lastCheckedAt, null);
    await manager.check();
    assert.equal(JSON.parse(fs.readFileSync(config.statePath)).lastCheckedAt, '2026-09-16T12:34:56.000Z');
});

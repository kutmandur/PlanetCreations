const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const {
    FrontierSaveIndexWatcher,
    isFrontierSavePath,
} = require('./FrontierSaveIndexWatcher');

test('recognizes supported Frontier files only inside a Saves folder', () => {
    assert.equal(isFrontierSavePath('Planet Coaster 2/12345678901234567/Saves/Park.park2'), true);
    assert.equal(isFrontierSavePath('Planet Zoo\\12345678901234567\\Saves\\Zoo.zoo'), true);
    assert.equal(isFrontierSavePath('Planet Coaster 2/Screenshots/Park.park2'), false);
    assert.equal(isFrontierSavePath('Planet Coaster 2/12345678901234567/Saves/readme.txt'), false);
});

test('coalesces rapid save changes into one callback', async () => {
    let watchCallback;
    const fakeWatcher = new EventEmitter();
    fakeWatcher.close = () => {};
    const notifications = [];
    const watcher = new FrontierSaveIndexWatcher('C:\\Frontier Developments', paths => {
        notifications.push(paths);
    }, {
        debounceMs: 10,
        watchImpl: (_path, _options, callback) => {
            watchCallback = callback;
            return fakeWatcher;
        },
    });

    watcher.start();
    watchCallback('change', 'Planet Coaster 2\\12345678901234567\\Saves\\Park.park2');
    watchCallback('rename', 'Planet Coaster 2\\12345678901234567\\Saves\\New Park.park2');
    watchCallback('change', 'Planet Coaster 2\\Screenshots\\image.png');
    await new Promise(resolve => setTimeout(resolve, 30));

    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0].sort(), [
        'Planet Coaster 2\\12345678901234567\\Saves\\New Park.park2',
        'Planet Coaster 2\\12345678901234567\\Saves\\Park.park2',
    ]);
    watcher.close();
});

test('close cancels a pending notification', async () => {
    let watchCallback;
    const fakeWatcher = new EventEmitter();
    fakeWatcher.close = () => {};
    let notificationCount = 0;
    const watcher = new FrontierSaveIndexWatcher('C:\\Frontier Developments', () => {
        notificationCount += 1;
    }, {
        debounceMs: 10,
        watchImpl: (_path, _options, callback) => {
            watchCallback = callback;
            return fakeWatcher;
        },
    });

    watcher.start();
    watchCallback('change', 'Planet Zoo\\12345678901234567\\Saves\\Zoo.zoo');
    watcher.close();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(notificationCount, 0);
});

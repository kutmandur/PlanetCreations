'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDesktopWebUserAgent } = require('./DesktopUserAgent');

test('removes only the Electron product from the Chromium user agent', () => {
    assert.equal(
        buildDesktopWebUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'PlanetCreations/1.0.38 Chrome/140.0.7339.249 ' +
            'Electron/43.4.1 Safari/537.36'
        ),
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'PlanetCreations/1.0.38 Chrome/140.0.7339.249 Safari/537.36'
    );
});

test('leaves an ordinary browser user agent unchanged', () => {
    const chrome = 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36';
    assert.equal(buildDesktopWebUserAgent(chrome), chrome);
});

test('handles missing or malformed input safely', () => {
    assert.equal(buildDesktopWebUserAgent(), '');
    assert.equal(buildDesktopWebUserAgent(null), '');
});

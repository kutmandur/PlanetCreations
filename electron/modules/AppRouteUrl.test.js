'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildBundledAppRouteUrl,
    buildHostedAppRouteUrl,
    getAppRoutePath,
    normalizeAppRoute,
} = require('./AppRouteUrl');

test('hosted routes use native paths and retain desktop test parameters', () => {
    assert.equal(
        buildHostedAppRouteUrl(
            'https://www.planetcreations.net/?pcAppCheck=recaptcha-test-only',
            '/client/dashboard?view=parks',
        ),
        'https://www.planetcreations.net/client/dashboard?view=parks&pcAppCheck=recaptcha-test-only',
    );
});
test('bundled routes stay behind the file URL hash', () => {
    assert.equal(
        buildBundledAppRouteUrl(
            'file:///C:/PlanetCreations/build/index.html',
            '/client/dashboard',
        ),
        'file:///C:/PlanetCreations/build/index.html#/client/dashboard',
    );
});

test('extracts the same application path from native and hash URLs', () => {
    assert.equal(getAppRoutePath(
        'https://www.planetcreations.net/client/dashboard?view=parks'
    ), '/client/dashboard');
    assert.equal(getAppRoutePath(
        'file:///C:/PlanetCreations/build/index.html#/client/dashboard?view=parks'
    ), '/client/dashboard');
});

test('rejects protocol-relative and malformed routes', () => {
    assert.equal(normalizeAppRoute('//evil.invalid/path'), '/');
    assert.equal(normalizeAppRoute('https://evil.invalid/path'), '/');
});

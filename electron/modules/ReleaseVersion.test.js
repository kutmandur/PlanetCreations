'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getNewerReleaseVersion } = require('./ReleaseVersion');

test('compares numeric release components rather than tag strings', () => {
    assert.equal(getNewerReleaseVersion('v1.0.41', '1.0.9'), '1.0.41');
    assert.equal(getNewerReleaseVersion('v1.0.9', '1.0.41'), null);
    assert.equal(getNewerReleaseVersion('v1.10.0', '1.9.99'), '1.10.0');
    assert.equal(getNewerReleaseVersion('v2.0.0', '1.99.99'), '2.0.0');
});

test('handles equal, prerelease and malformed release versions safely', () => {
    assert.equal(getNewerReleaseVersion('v1.0.41', '1.0.41'), null);
    assert.equal(getNewerReleaseVersion('v1.0.41', '1.0.41-rc.1'), '1.0.41');
    assert.equal(getNewerReleaseVersion('v1.0.41-rc.1', '1.0.41'), null);
    for (const tag of [null, {}, 'latest', '1v.0.42']) {
        assert.equal(getNewerReleaseVersion(tag, '1.0.41'), null);
    }
    assert.equal(getNewerReleaseVersion('v1.0.42', 'unknown'), null);
});

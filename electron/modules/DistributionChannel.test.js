'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDistributionChannel, getDistributionInfo } = require('./DistributionChannel');

test('uses the Microsoft Store channel for a packaged Windows Store process', () => {
    assert.equal(getDistributionChannel({ windowsStore: true, env: {} }), 'store');
    assert.deepEqual(getDistributionInfo({ windowsStore: true, env: {} }), {
        channel: 'store',
        isStore: true,
        updatesManagedBy: 'microsoft-store',
    });
});

test('allows forcing the Store channel for local verification', () => {
    assert.equal(getDistributionChannel({
        windowsStore: false,
        env: { PLANETCREATIONS_DISTRIBUTION_CHANNEL: 'store' },
    }), 'store');
});

test('keeps GitHub as the default distribution channel', () => {
    assert.equal(getDistributionChannel({ windowsStore: false, env: {} }), 'github');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {assertLibraryTarget} = require('./LocalLibraryPath');

test('automatic install rejects child junction escapes and allows a selected root junction', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-install-boundary-'));
    const library = path.join(root, 'library'), outside = path.join(root, 'outside');
    const selected = path.join(root, 'selected'), child = path.join(library, 'child');
    fs.mkdirSync(library); fs.mkdirSync(outside);
    try {
        fs.symlinkSync(library, selected, 'junction'); fs.symlinkSync(outside, child, 'junction');
        assert.equal(assertLibraryTarget(path.join(selected, 'new', 'park.park2'), selected), path.join(selected, 'new', 'park.park2'));
        assert.throws(() => assertLibraryTarget(path.join(child, 'park.park2'), library), /resolves outside/);
        assert.throws(() => assertLibraryTarget(path.join(outside, 'park.park2'), library), /outside/);
    } finally {
        fs.unlinkSync(child); fs.unlinkSync(selected); fs.rmdirSync(library); fs.rmdirSync(outside); fs.rmdirSync(root);
    }
});

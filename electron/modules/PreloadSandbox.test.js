'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const preloadPath = path.join(__dirname, '..', 'preload.js');

test('sandboxed preload does not require local CommonJS modules', () => {
    const source = fs.readFileSync(preloadPath, 'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\.?[\\/]/);
    assert.match(source, /contextBridge\.exposeInMainWorld/);
});

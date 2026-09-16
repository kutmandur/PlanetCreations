'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {readFileBoundedSync} = require('./BoundedFile');

test('bounded file reads reject oversized and concurrently changed files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-bounded-'));
    const file = path.join(root, 'save'); const read = fs.readSync;
    try {
        fs.writeFileSync(file, 'original');
        assert.equal(readFileBoundedSync(file, 8).toString(), 'original');
        assert.throws(() => readFileBoundedSync(file, 7), /size limit/);
        let changed = false;
        fs.readSync = (...args) => {
            const result = read(...args);
            if (!changed) { changed = true; fs.appendFileSync(file, 'growth'); }
            return result;
        };
        assert.throws(() => readFileBoundedSync(file, 8), /changed/);
    } finally { fs.readSync = read; fs.unlinkSync(file); fs.rmdirSync(root); }
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainPath = path.join(__dirname, '..', 'main.js');

test('normal Store launches retain the Online Workshop / Offline Manager choice', () => {
    const source = fs.readFileSync(mainPath, 'utf8');
    assert.match(
        source,
        /createWindow\(\{ openOnline: isAutoStart \|\| useHostedUiInDev \|\| openLocalUiInDev \}\)/,
    );
    assert.doesNotMatch(source, /openOnline:\s*isStoreBuild/);
});

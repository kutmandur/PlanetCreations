const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function findJavaScriptFiles(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        if (entry.name === 'node_modules') return [];
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return findJavaScriptFiles(entryPath);
        return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
    });
}

test('all Discord bot CommonJS modules parse on the supported Node runtime', () => {
    for (const filePath of findJavaScriptFiles(__dirname)) {
        const source = fs.readFileSync(filePath, 'utf8');
        assert.doesNotThrow(
            () => new vm.Script(Module.wrap(source), {filename: filePath}),
            `Syntax check failed for ${path.relative(__dirname, filePath)}`,
        );
    }
});

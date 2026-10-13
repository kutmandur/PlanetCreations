const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const paths = require('./workspace-paths.cjs');
test('organized outputs stay outside the repository and web/electron are separate', () => {
    if (!paths.organizedWorkspace) return;
    assert.notEqual(paths.web, paths.electron);
    for (const key of ['web', 'electron', 'dist', 'evidence', 'runtimes']) {
        assert.ok(path.relative(paths.projectRoot, paths[key]).startsWith('..' + path.sep));
    }
});
test('CI preserves existing build and installer paths', () => {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./scripts/workspace-paths.cjs')))"], {cwd: paths.projectRoot, env: {...process.env, CI: 'true'}, encoding: 'utf8'}));
    assert.equal(result.organizedWorkspace, false);
    assert.equal(result.web, path.join(paths.projectRoot, 'build'));
    assert.equal(result.dist, path.join(paths.projectRoot, 'dist'));
});
test('desktop and store configs preserve the installed build directory', async () => {
    for (const file of [null, 'electron-builder.store.cjs']) {
        const config = require(file ? '../electron-builder.store.cjs' : '../electron-builder.paths.cjs');
        assert.equal(config.directories.output, file ? path.join(paths.dist, 'store') : paths.dist);
        if (paths.organizedWorkspace) assert.ok(config.files.some(entry => entry.from === paths.electron && entry.to === 'build'));
    }
});

'use strict';
// Backport https://github.com/electron-userland/electron-builder/pull/10172
// Remove this hook once the locked builder contains the upstream correction.
const fs = require('node:fs');
const version = require('app-builder-lib/package.json').version;
const file = require.resolve('app-builder-lib/out/codeSign/macCodeSign.js');
const changes = [
    ['return await importCerts(keychainFile, certPaths, cscPasswords);', 'return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);'],
    ['async function importCerts(keychainFile, paths, keyPasswords) {', 'async function importCerts(keychainFile, paths, keyPasswords, keychainPassword) {'],
    ['"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile', '"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile'],
];
let source = fs.readFileSync(file, 'utf8');
if (changes.every(([, fixed]) => source.includes(fixed))) {
    console.log('electron-builder macOS keychain password fix is present.');
} else {
    if (version !== '26.15.3' || changes.some(([original]) => source.split(original).length !== 2)) {
        throw new Error('Unexpected electron-builder signing implementation. Review the upstream keychain fix before changing this patch.');
    }
    for (const [original, fixed] of changes) source = source.replace(original, fixed);
    fs.writeFileSync(file, source);
    console.log('Applied upstream macOS keychain password fix to electron-builder 26.15.3.');
}

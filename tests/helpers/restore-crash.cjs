'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const root = process.argv[2], archive = process.argv[3], target = process.argv[4];
const load = Module._load;
Module._load = function(request, ...rest) {
    if (request === 'electron') return {app: {getPath: () => root}};
    return load.call(this, request, ...rest);
};
const {restoreBackup} = require('../../electron/modules/BackupManager');
Module._load = load;
const rename = fs.promises.rename;
fs.promises.rename = async (source, destination) => {
    if (destination !== target) return rename(source, destination);
    process.send('before-rename');
    setInterval(() => {}, 1000);
    await new Promise(() => {});
};
restoreBackup({getPath: () => root}, archive, target).then(result => {
    process.send({unexpected: result}); process.exit(1);
});

const {Worker} = require('node:worker_threads');
const path = require('node:path');
let tail = Promise.resolve();
// One memory-heavy job at a time. File paths cross the boundary; payloads stay in the worker.
function runBackupJob(operation, data) {
    const run = tail.catch(() => {}).then(() => new Promise((resolve, reject) => {
        const workerDirectory = __dirname.replace(/([/\\])app\.asar([/\\])/, '$1app.asar.unpacked$2');
        const worker = new Worker(path.join(workerDirectory, 'BackupWorker.js'), {workerData: {operation, data}});
        let result;
        worker.once('message', value => { result = value; });
        worker.once('error', reject);
        worker.once('exit', code => {
            if (!result || code !== 0) { reject(new Error(`Backup worker stopped (${code}).`)); return; }
            if (result.error) reject(new Error(result.error));
            else {
                if (result.value?.payloadBuffer) result.value.payloadBuffer = Buffer.from(result.value.payloadBuffer.buffer, result.value.payloadBuffer.byteOffset, result.value.payloadBuffer.byteLength);
                for (const asset of result.value?.assetBuffers || []) asset.buffer = Buffer.from(asset.buffer.buffer, asset.buffer.byteOffset, asset.buffer.byteLength);
                resolve(result.value);
            }
        });
    }));
    tail = run.then(() => {}, () => {});
    return run;
}
module.exports = {runBackupJob};

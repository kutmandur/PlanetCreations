const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {resolveZooSavePath} = require('./LocalLibraryPath');
let cached = null;
const pending = new Map();
// Serialize heavy reads and retain only one result. Metadata scans stay cheap.
let tail = Promise.resolve();
function loadPlanetZooAnalysis(filePath, {libraryRoot} = {}) {
    if (libraryRoot) filePath = resolveZooSavePath(filePath, libraryRoot);
    const stat = fs.statSync(filePath), key = `${filePath}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (!stat.isFile()) throw new Error('The zoo save is not a regular file.');
    if (cached?.key === key) return Promise.resolve(cached.result);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 8) return Promise.reject(new Error('Zoo analysis is busy. Please retry after the current analyses finish.'));
    const job = tail.catch(() => {}).then(() => new Promise((resolve, reject) => {
        if (libraryRoot) resolveZooSavePath(filePath, libraryRoot);
        const queuedStat = fs.statSync(filePath);
        if (queuedStat.size !== stat.size || queuedStat.mtimeMs !== stat.mtimeMs || queuedStat.ctimeMs !== stat.ctimeMs) throw new Error('The save changed while waiting for analysis. Please reload.');
        const worker = new Worker(path.join(__dirname, 'PlanetZooAnalysisWorker.js'), {
            workerData: { filePath, libraryRoot }, resourceLimits: {maxOldGenerationSizeMb: 768},
        });
        let settled = false, message, failure;
        const finish = (error, result) => {
            if (settled) return; settled = true; clearTimeout(timer);
            if (error) reject(error); else { cached = { key, result }; resolve(result); }
        };
        const timer = setTimeout(() => { failure = Error('Zoo analysis timed out.'); void worker.terminate(); }, 90000);
        worker.once('message', data => { message = data; });
        worker.once('error', error => { failure = error; });
        // Resolve only once the worker has released its parser/ZIP memory.
        worker.once('exit', code => {
            try {
                const latest = fs.statSync(filePath);
                if (latest.size !== stat.size || latest.mtimeMs !== stat.mtimeMs || latest.ctimeMs !== stat.ctimeMs) failure ||= Error('The save changed during analysis. Please reload.');
            } catch (error) { failure ||= error; }
            finish(failure || (code !== 0 || !message ? Error('Zoo analysis was interrupted.') : message.error ? Error(message.error) : null), message?.result);
        });
    }));
    pending.set(key, job); tail = job;
    job.finally(() => pending.delete(key)).catch(() => {}); return job;
}
module.exports = { loadPlanetZooAnalysis };

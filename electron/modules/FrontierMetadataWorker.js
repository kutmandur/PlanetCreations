const { parentPort, workerData } = require('worker_threads');
const { inspectFrontierFile } = require('./FrontierSaveParser');

try {
    const inspection = inspectFrontierFile(workerData.filePath, { includeMediaReferences: true });
    parentPort.postMessage({ inspection });
} catch (error) {
    parentPort.postMessage({ error: error?.message || String(error) });
}

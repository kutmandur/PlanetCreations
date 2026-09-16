const { parentPort, workerData } = require('node:worker_threads');
try {
    if (workerData.libraryRoot) require('./LocalLibraryPath').resolveZooSavePath(workerData.filePath, workerData.libraryRoot);
    parentPort.postMessage({ result: require('./PlanetZooAnalysis').analysePlanetZoo(workerData.filePath) });
}
catch (error) { parentPort.postMessage({ error: error.message }); }

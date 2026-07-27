const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const fixtureDirectory = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(fixtureDirectory)) {
    throw new Error('Pass an existing collaboration save fixture directory.');
}

const supportedExtensions = new Set(['.park2', '.blpr2', '.prkauto2']);
const fixtureFiles = fs.readdirSync(fixtureDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(fixtureDirectory, entry.name));

assert.equal(fixtureFiles.length, 3, 'Expected one park, blueprint, and autosave fixture.');
assert.deepEqual(
    new Set(fixtureFiles.map((filePath) => path.extname(filePath).toLowerCase())),
    supportedExtensions,
);

const runDirectory = path.join(fixtureDirectory, 'runs', crypto.randomUUID());
const appPaths = {
    documents: path.join(runDirectory, 'documents'),
    userData: path.join(runDirectory, 'user-data'),
    temp: path.join(runDirectory, 'temp'),
    downloads: path.join(runDirectory, 'downloads'),
    home: path.join(runDirectory, 'home'),
};
Object.values(appPaths).forEach((directoryPath) => fs.mkdirSync(directoryPath, { recursive: true }));

const fakeApp = {
    getPath(name) {
        const resolvedPath = appPaths[name];
        if (!resolvedPath) throw new Error(`Unexpected Electron app path: ${name}`);
        return resolvedPath;
    },
};

const originalModuleLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') return { app: fakeApp };
    return originalModuleLoad.call(this, request, parent, isMain);
};

const {
    createBackup,
    validateBackupForUpload,
    verifyBackup,
} = require('../electron/modules/BackupManager');
const { scanGamesFromPath } = require('../electron/modules/FileHandler');
Module._load = originalModuleLoad;

const { findLatestCollaborationSave } = require('../electron/modules/CollaborationSaveFinder');

function copyFixture(sourcePath, destinationPath, { preserveTimes = true } = {}) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (fs.existsSync(destinationPath)) {
        assert.equal(
            crypto.createHash('sha256').update(fs.readFileSync(destinationPath)).digest('hex'),
            crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),
            `Existing fixture copy differs: ${destinationPath}`,
        );
        return;
    }
    fs.copyFileSync(sourcePath, destinationPath);
    if (preserveTimes) {
        const sourceStats = fs.statSync(sourcePath);
        fs.utimesSync(destinationPath, sourceStats.atime, sourceStats.mtime);
    }
}

function getScannedFileCount(gameResult) {
    return ['parks', 'blueprints', 'autosaves']
        .reduce((total, category) => total + (gameResult?.[category]?.length || 0), 0);
}

async function run() {
    const nativeFrontierRoot = path.join(fixtureDirectory, 'native-frontier');
    const nativeSavesDirectory = path.join(
        nativeFrontierRoot,
        'Planet Coaster 2',
        '11111111111111111',
        'Saves',
    );
    for (const fixturePath of fixtureFiles) {
        copyFixture(fixturePath, path.join(nativeSavesDirectory, path.basename(fixturePath)));
    }

    const scanResult = scanGamesFromPath(nativeFrontierRoot);
    const planetCoasterResult = scanResult['Planet Coaster 2'];
    assert.equal(getScannedFileCount(planetCoasterResult), 3);
    assert.equal(planetCoasterResult.parks.length, 1);
    assert.equal(planetCoasterResult.blueprints.length, 1);
    assert.equal(planetCoasterResult.autosaves.length, 1);

    const parkFixture = fixtureFiles.find((filePath) => path.extname(filePath).toLowerCase() === '.park2');
    const staleResult = findLatestCollaborationSave(
        scanResult,
        'planet-coaster-2',
        path.basename(parkFixture),
    );
    assert.equal(staleResult.success, true);
    assert.equal(staleResult.nameMatchesExpected, true);
    assert.equal(staleResult.stale, true);
    assert.equal(path.resolve(staleResult.filePath), path.resolve(
        nativeSavesDirectory,
        path.basename(parkFixture),
    ));

    const freshFrontierRoot = path.join(runDirectory, 'fresh-frontier');
    const freshFileName = 'Fresh Collaboration Test.park2';
    const freshFilePath = path.join(
        freshFrontierRoot,
        'Planet Coaster 2',
        '22222222222222222',
        'Saves',
        freshFileName,
    );
    copyFixture(parkFixture, freshFilePath, { preserveTimes: false });
    const now = new Date();
    fs.utimesSync(freshFilePath, now, now);
    const freshResult = findLatestCollaborationSave(
        scanGamesFromPath(freshFrontierRoot),
        'planet-coaster-2',
        freshFileName,
    );
    assert.equal(freshResult.success, true);
    assert.equal(freshResult.stale, false);
    assert.equal(freshResult.nameMatchesExpected, true);

    const packageDirectory = path.join(runDirectory, 'packages');
    const packageResults = [];
    for (const fixturePath of fixtureFiles) {
        const packagePath = await createBackup(
            fakeApp,
            fixturePath,
            'Local Collaboration save fixture test',
            false,
            null,
            packageDirectory,
        );
        const verification = await verifyBackup(packagePath);
        assert.equal(verification.status, 'unsigned');
        assert.equal(verification.metadata.packageType, 'creation');
        assert.equal(verification.metadata.gameId, 'planet-coaster-2');
        assert.equal(verification.metadata.originalFileName, path.basename(fixturePath));
        assert.equal(verification.metadata.payloadSize, fs.statSync(fixturePath).size);
        assert.equal(
            verification.metadata.payloadSha256,
            crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'),
        );

        const uploadValidation = await validateBackupForUpload(packagePath);
        assert.equal(uploadValidation.valid, false);
        assert.match(uploadValidation.error, /verified version-2 creation packages/i);

        packageResults.push({
            sourceFile: path.basename(fixturePath),
            fileKind: verification.metadata.fileKind,
            payloadBytes: verification.metadata.payloadSize,
            packageBytes: fs.statSync(packagePath).size,
            integrityStatus: verification.status,
            unsignedUploadRejected: true,
        });
    }

    process.stdout.write(`${JSON.stringify({
        success: true,
        nativeFrontierRoot,
        scannedFiles: getScannedFileCount(planetCoasterResult),
        staleSaveWarningVerified: staleResult.stale,
        freshSaveAccepted: !freshResult.stale,
        packageResults,
        runDirectory,
    }, null, 2)}\n`);
}

run().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
